/**
 * WPS 自研划词取词：只复制读取、不恢复剪贴板。
 *
 * 背景：WPS 不暴露 UIA/IAccessible 选区，selection-hook 只能靠内置剪贴板回退
 * （保存→复制→读→恢复原内容），导致每次划词产生 a,b,a 三段剪贴板历史，且恢复动作
 * 可能覆盖用户刚手动复制的内容（粘贴变 a）。selection-hook 未提供「只取词不恢复」的 API，
 * 故对 WPS 禁用其内置剪贴板回退（见 GlobalInputHook），改由本模块自研：
 *   1. GlobalInputHook 的 onDragEnd 提供鼠标拖选结束的 down/up 坐标（物理像素）；
 *   2. 位移超过阈值、且当前前台窗口确为 WPS；
 *   3. 通过 koffi 直接调 user32.SendInput 模拟一次 Ctrl+C（毫秒级，无子进程开销）；
 *   4. 用 Electron clipboard.readText() 读到选区文字（仅在剪贴板发生变化后）；
 *   5. 交给 onTextSelected（复用现有划词渲染链路），**不执行任何剪贴板恢复**。
 *
 * 说明：用 koffi 而非 PowerShell，是因为每次划词都 spawn powershell.exe 子进程有数百 ms
 * 开销（这就是此前"弹出很慢"的根源）；koffi 在主进程内直接 FFI 调用 user32，快且可控。
 */
import { clipboard } from 'electron';

/**
 * koffi 懒加载：user32.dll 上绑定我们需要的几个函数。
 * 用 lazy 避免模块加载即报错（正常环境 win 平台均可用）。
 */
let koffiLib: any = null;
function lib() {
  if (koffiLib) return koffiLib;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const koffi = require('koffi') as any;
  const u = koffi.load('user32.dll');
  koffiLib = {
    getForegroundWindow: u.func('void* GetForegroundWindow()'),
    getWindowThreadProcessId: u.func('uint32 GetWindowThreadProcessId(void* hWnd, void* pidOut)'),
    mapVirtualKey: u.func('uint16 MapVirtualKeyW(uint32 uCode, uint32 uMapType)'),
    sendInput: u.func('uint32 SendInput(uint32 nInputs, void* inputs, int32 cbSize)'),
    // kernel32 全 koffi 拿前台进程 exe 名（无子进程），一次绑定缓存复用
    k32: (() => {
      const k = koffi.load('kernel32.dll');
      return {
        openProcess: k.func('void* OpenProcess(uint32 dwDesiredAccess, int32 bInheritHandle, uint32 dwProcessId)'),
        queryImage: k.func('uint32 QueryFullProcessImageNameW(void* hProcess, uint32 dwFlags, void* lpExeName, void* lpdwSize)'),
        closeHandle: k.func('int32 CloseHandle(void* hObject)'),
      };
    })(),
  };
  return koffiLib;
}

/** 拖选判定位移阈值（物理像素）。WPS 拖选文字会明显位移；小于该值视为单击/误触。 */
const DRAG_THRESHOLD = 5;

/** 模拟 Ctrl+C 后等待 WPS 把选区写入剪贴板的单次延时（ms）。 */
const POLL_INTERVAL = 60;
/** 读剪贴板最大轮询次数（给 WPS 写入留时间，约 500ms）。 */
const POLL_MAX = 8;

/** Windows INPUT 结构体大小。x64 下 union 取 MOUSEINPUT 为 32 字节 → INPUT = type(4)+pad(4)+union(32)=40。 */
const INPUT_SIZE = 40;
/** KEYBDINPUT 在 union 内从偏移 8 开始（type 4 + pad 4）；拼接进 INPUT 时 ki 起始 offset=8。 */
const KI_OFFSET = 8;

const VK_CONTROL = 0x11;
const VK_C = 0x43;
const KEYEVENTF_KEYUP = 0x0002;

/** 用 koffi 构造一次 Ctrl+C 的 INPUT 数组并 SendInput（同步、毫秒级）。 */
function sendCtrlC(): void {
  const L = lib();
  const wScan = L.mapVirtualKey(VK_C, 0);

  // 一条 INPUT 的内部 KEYBDINPUT：wVk(2)+wScan(2)+dwFlags(4)+time(4)+dwExtraInfo(8)=24 字节，置于 INPUT offset 8 起
  const mk = (vk: number, wScan: number, flags: number) => {
    const buf = Buffer.alloc(24);
    buf.writeUInt16LE(vk, 0);       // wVk
    buf.writeUInt16LE(wScan, 2);     // wScan
    buf.writeUInt32LE(flags, 4);     // dwFlags
    buf.writeUInt32LE(0, 8);         // time
    // dwExtraInfo @16 置 0，Buffer 已 0
    return buf;
  };

  const inputs = Buffer.alloc(INPUT_SIZE * 4);
  const put = (idx: number, vk: number, flags: number) => {
    const base = idx * INPUT_SIZE;
    inputs.writeUInt32LE(1 /*KEYBD_INPUT*/, base);          // type
    mk(vk, wScan, flags).copy(inputs, base + KI_OFFSET);    // union.ki
  };

  put(0, VK_CONTROL, 0);          // Ctrl down
  put(1, VK_C, 0);                // C down
  put(2, VK_C, KEYEVENTF_KEYUP);  // C up
  put(3, VK_CONTROL, KEYEVENTF_KEYUP); // Ctrl up

  L.sendInput(4, inputs, INPUT_SIZE);
}

/**
 * 判断前台窗口是否为 wps.exe（全 koffi 调用，无子进程、毫秒级）。
 * 若当前前台是 WPS，则通过 SendInput 发一次 Ctrl+C。
 * @returns true = 前台是 WPS 且已发送复制
 */
function isForegroundWpsAndCopy(): boolean {
  const L = lib();
  const hwnd = L.getForegroundWindow();
  if (!hwnd) return false;
  const pidBuf = Buffer.alloc(4);
  L.getWindowThreadProcessId(hwnd, pidBuf);
  const pid = pidBuf.readUInt32LE(0);
  if (!pid) return false;

  // 拿前台进程 exe 路径：kernel32 OpenProcess + QueryFullProcessImageNameW（无子进程）
  const k32 = L.k32;
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const h = k32.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!h) return false;
  try {
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32LE(1024, 0);
    const nameBuf = Buffer.alloc(1024 * 2);
    k32.queryImage(h, 0, nameBuf, sizeBuf);
    const len = sizeBuf.readUInt32LE(0);
    const name = nameBuf.toString('utf16le', 0, Math.min(len * 2, nameBuf.length)).toLowerCase();
    if (!name.endsWith('wps.exe') && !name.endsWith('/wps.exe')) return false;
  } finally {
    k32.closeHandle(h);
  }

  sendCtrlC();
  return true;
}

/** 读取剪贴板文本，但只在「与发送前不同」时才返回（避免把旧的/遗留内容误当选区）。 */
function readClipboardWithPoll(prevText: string): Promise<string> {
  return new Promise((resolve) => {
    let tries = 0;
    const poll = () => {
      const t = clipboard.readText() || '';
      // 剪贴板不再是发送前的旧值，视为 WPS 已写入选区
      if (t !== prevText || tries >= POLL_MAX) { resolve(t); return; }
      tries += 1;
      setTimeout(poll, POLL_INTERVAL);
    };
    setTimeout(poll, POLL_INTERVAL);
  });
}

/**
 * WPS 划词取词统一入口：拖选结束且位移达标 → 校验前台为 WPS → 模拟复制读取（不恢复）。
 * @param down 拖选起点（物理像素）
 * @param up 拖选终点（物理像素）
 * @param onTextSelected 拿到文本后回调（复用 GlobalInputHook.onTextSelected 语义）
 */
export async function tryExtractWpsSelection(
  down: { x: number; y: number },
  up: { x: number; y: number },
  onTextSelected: (text: string, mouseDownPos?: { x: number; y: number }, mouseUpPos?: { x: number; y: number }) => void
): Promise<boolean> {
  // 1) 位移过小视为单击，忽略
  const dist = Math.hypot(up.x - down.x, up.y - down.y);
  if (dist < DRAG_THRESHOLD) return false;

  // 2) 记下发送前的剪贴板，判断前台是否 WPS；是则模拟 Ctrl+C
  const prevText = clipboard.readText() || '';
  if (!isForegroundWpsAndCopy()) return false;

  // 3) 短轮询读取剪贴板；内容已变化才认定取词成功（未变可能未复制到，放弃）
  const text = await readClipboardWithPoll(prevText);
  if (text.trim().length === 0 || text === prevText) return false;

  // 4) 交给现有对外的 onTextSelected
  onTextSelected(text, down, up);
  return true;
}