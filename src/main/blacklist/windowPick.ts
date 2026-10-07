/**
 * 黑名单窗口选择：全屏透明遮罩 + hover 高亮窗口 + 左上角显示进程名 + 点击加入黑名单。
 * 复用截图遮罩思路（透明置顶全屏窗）。窗口枚举沿用 windowSnap.ts 内联 C#（user32）的
 * GetTopWindow 链序遍历思路，额外用 GetWindowThreadProcessId 取 PID / ProcessName。
 * 坐标：物理像素 → 主屏局部 CSS（比例映射，自适应 DPI），与 screenshotOverlay 一致（先做主屏）。
 */
import { BrowserWindow, ipcMain, screen } from 'electron';
import { execFile } from 'child_process';
import { BLACKLIST_PICKER_HTML, SHELL_PRELOAD, appIconIfExists } from '../constants';
import { IPC } from '../ipc/channels';
import type { WindowManager } from '../windows/WindowManager';

/** 下发到黑名单遮罩的可选窗口（遮罩局部 CSS 坐标）。processName 为进程基名（不含扩展）。 */
export interface PickableWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 进程基名（如 game）。 */
  processName: string;
  z: number;
}

/** PowerShell 输出的原始窗口（物理像素）。 */
interface RawWin {
  hw: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 进程基名（不带扩展）。 */
  pn: string;
}

// 内联 C#（user32）沿真实 Z 序（GetTopWindow 链）遍历可见顶层窗口矩形 + 进程名。
// 过滤规则同 windowSnap：系统壳窗口（桌面/任务栏/输入法层等）+ 工具窗口（WS_EX_TOOLWINDOW）
// + owned 窗口（右键菜单/下拉/Electron 辅助窗口），避免污染链序与命中。
const PS_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinPick {
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
  public static extern IntPtr GetWindowLongPtr64(IntPtr h, int n);
  [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
  public static extern IntPtr GetWindowLong32(IntPtr h, int n);
  public static long GetExStyle(IntPtr h) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(h, -20).ToInt64() : GetWindowLong32(h, -20).ToInt64();
  }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$list = New-Object System.Collections.ArrayList
$h = [WinPick]::GetTopWindow([IntPtr]::Zero)
while ($h -ne [IntPtr]::Zero) {
  if ([WinPick]::IsWindowVisible($h)) {
    $r = New-Object WinPick+RECT
    [WinPick]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = $r.Right - $r.Left
    $ht = $r.Bottom - $r.Top
    if ($w -ge 24 -and $ht -ge 24) {
      $sb = New-Object System.Text.StringBuilder 256
      [WinPick]::GetClassName($h, $sb, 256) | Out-Null
      $cn = $sb.ToString()
      if ($cn -notin @('Progman','WorkerW','Shell_TrayWnd','Shell_SecondaryTrayWnd','DV2ControlHost','TaskListThumbnailWnd','MultitaskingViewFrame','ImmersiveLauncher','Windows.UI.Core.CoreWindow','DummyDWMListenerWindow','ThumbnailDeviceHelperWnd')) {
        if (([WinPick]::GetExStyle($h) -band 0x80) -eq 0) {
          $own = [WinPick]::GetWindow($h, 4)
          if ($own -eq [IntPtr]::Zero) {
            $procId = [uint32]0
            [WinPick]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
            $pname = ''
            try { $pname = [System.Diagnostics.Process]::GetProcessById([int]$procId).ProcessName } catch { $pname = '' }
            if ($pname -ne '') {
              [void]$list.Add([pscustomobject]@{ x=$r.Left; y=$r.Top; w=$w; h=$ht; pn=$pname; hw=[string]$h.ToInt64() })
            }
          }
        }
      }
    }
  }
  $h = [WinPick]::GetWindow($h, 2)
}
$list | ConvertTo-Json -Compress -Depth 3
`;

function runPowerShell(): Promise<RawWin[]> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          const data = JSON.parse(stdout.trim());
          resolve(Array.isArray(data) ? data : []);
        } catch {
          resolve([]);
        }
      }
    );
  });
}

/** 枚举可见顶层窗口并用进程名填充，转成主屏局部 CSS 坐标（自适应 DPI）。失败返回空数组。 */
async function enumPickWindows(skipHandles: number[]): Promise<PickableWindow[]> {
  const skip = new Set(skipHandles);
  const raw = await runPowerShell();
  const primary = screen.getPrimaryDisplay();
  const physW = primary.size.width || primary.bounds.width;
  const physH = primary.size.height || primary.bounds.height;
  if (physW <= 0 || physH <= 0) return [];
  const physX0 = (primary.bounds.x / primary.bounds.width) * physW;
  const physY0 = (primary.bounds.y / primary.bounds.height) * physH;
  const out: PickableWindow[] = [];
  raw.forEach((r, i) => {
    // 过滤掉本软件窗口（遮罩自身 + 主/副窗口等 electron 窗口）：
    // PS 已输出窗口句柄 hw，用 skipHandles（startBlacklistPicker 里已把全部本软件窗口
    // 及遮罩自身的数值句柄加入）排除，否则本软件 electron 窗口也会被当作可选窗口下发，
    // 导致 hover 命中「electron」而无法选到真实外部窗口。
    if (skip.has(Number(r.hw))) return;
    // 裁剪到主屏物理范围（最大化窗口 DWM 阴影带负偏移）
    const clipX = Math.max(physX0, r.x);
    const clipY = Math.max(physY0, r.y);
    const clipR = Math.min(r.x + r.w, physX0 + physW);
    const clipB = Math.min(r.y + r.h, physY0 + physH);
    const cw = clipR - clipX;
    const ch = clipB - clipY;
    if (cw < 16 || ch < 16) return;
    out.push({
      x: ((clipX - physX0) / physW) * primary.bounds.width,
      y: ((clipY - physY0) / physH) * primary.bounds.height,
      width: (cw / physW) * primary.bounds.width,
      height: (ch / physH) * primary.bounds.height,
      processName: r.pn,
      z: i,
    });
  });
  return out;
}

let pickerWin: BrowserWindow | null = null;
/** 本次选择的进程判定回调（主进程 BlacklistManager 注入：收到的进程名加入黑名单）。 */
let onPickSelected: ((name: string) => void) | null = null;
/** 全部运行窗口句柄（用于枚举时排除本软件窗口）。 */
let skipHandles: number[] = [];
/** 应用窗口恢复器（由 startBlacklistPicker 注入，黑名单选择流程结束后恢复 app 窗口）。 */
let restoreWindows: (() => void) | null = null;
/** 恢复 app 窗口后再执行的回调（由 startBlacklistPicker 注入，如「切回进入前的设置界面」）。 */
let afterRestore: (() => void) | null = null;
/** 遮罩回报 IPC 处理器引用（closePicker 时移除，避免监听器泄漏）。 */
let onSelectedHandler: ((e: Electron.IpcMainEvent, payload: { name?: string }) => void) | null = null;
let onCancelHandler: ((e: Electron.IpcMainEvent) => void) | null = null;

function closePicker(restore: boolean): void {
  if (onSelectedHandler) ipcMain.removeListener(IPC.BLACKLIST_PICK_SELECTED, onSelectedHandler);
  if (onCancelHandler) ipcMain.removeListener(IPC.BLACKLIST_PICK_CANCEL, onCancelHandler);
  onSelectedHandler = null;
  onCancelHandler = null;
  if (pickerWin && !pickerWin.isDestroyed()) {
    pickerWin.removeAllListeners('closed');
    pickerWin.close();
  }
  pickerWin = null;
  onPickSelected = null;
  skipHandles = [];
  if (restore) {
    try {
      restoreWindows?.();
    } catch { /* 忽略 */ }
    restoreWindows = null;
    // 恢复 app 窗口后执行「恢复后回调」（调用方注入，回到进入前的设置界面等）
    const after = afterRestore;
    afterRestore = null;
    try {
      after?.();
    } catch { /* 忽略 */ }
  }
}

/**
 * 进入黑名单窗口选择模式：隐藏 app 窗口，弹出全屏透明遮罩，hover 高亮窗口并显示进程名，
 * 点击窗口后把其进程名交给 onSelected 加入黑名单；Esc / 点击空白取消。结束后恢复 app 窗口。
 */
export function startBlacklistPicker(
  windows: WindowManager,
  onSelected: (name: string) => void,
  opts?: { afterRestore?: () => void }
): void {
  if (pickerWin && !pickerWin.isDestroyed()) {
    pickerWin.focus();
    return;
  }
  // 收集本软件窗口句柄，枚举时排除（避免把自己的窗口也计入可选窗口）
  skipHandles = [];
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      skipHandles.push(Number(w.getNativeWindowHandle().readBigUInt64LE(0)));
    } catch { /* 忽略单个窗口句柄读取失败 */ }
  }
  // 隐藏 app 窗口（复用截图期间的隐藏机制，结束后恢复）。选择器不采集桌面画面，
  // 故这里无需等隐藏完成（仅需在枚举窗口句柄时它们已不参与）。
  void windows.hideChatWindowsForScreenshot();
  restoreWindows = async () => windows.restoreChatWindowsAfterScreenshot();
  onPickSelected = onSelected;
  // 恢复 app 窗口后再执行的回调（如进入前在主窗口显示设置界面，结束后切回设置界面）
  afterRestore = opts?.afterRestore ?? null;

  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;
  pickerWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreen: true,
    fullscreenable: true,
    show: false,
    icon: appIconIfExists(),
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: ['--window-type=blacklist-pick'],
    },
  });
  pickerWin.loadFile(BLACKLIST_PICKER_HTML);
  pickerWin.once('ready-to-show', () => {
    if (!pickerWin || pickerWin.isDestroyed()) return;
    pickerWin.show();
    try {
      pickerWin.setFullScreen(true);
      pickerWin.setAlwaysOnTop(true, 'screen-saver');
    } catch { /* 忽略 */ }
    pickerWin.focus();
    // 枚举并下发可选窗口（遮罩排除自身句柄）：异步，结果就绪后 send
    enumPickWindows([...skipHandles, pickerWin ? getHandle(pickerWin) : 0]).then((list) => {
      const wc = pickerWin?.webContents;
      if (wc && !wc.isDestroyed()) {
        wc.send(
          IPC.BLACKLIST_PICK_WINDOWS,
          list.map(({ processName, ...r }) => ({ ...r, processName }))
        );
      }
    }).catch(() => {});
  });
  // 监听遮罩回报：点击窗口 → 加入黑名单；取消 → 直接关
  onSelectedHandler = (e: Electron.IpcMainEvent, payload: { name?: string }): void => {
    if (!pickerWin || e.sender !== pickerWin.webContents) return;
    const name = typeof payload?.name === 'string' ? payload.name : '';
    // 先执行「选中」回调（handlers 注入：把进程写入黑名单），
    // 完成后再恢复窗口 / 打开设置界面，保证列表在设置重开前已写入（否则列表不更新）。
    Promise.resolve(name ? onPickSelected?.(name) : undefined)
      .catch(() => {})
      .finally(() => closePicker(true));
  };
  onCancelHandler = (e: Electron.IpcMainEvent): void => {
    if (!pickerWin || e.sender !== pickerWin.webContents) return;
    closePicker(true);
  };
  ipcMain.on(IPC.BLACKLIST_PICK_SELECTED, onSelectedHandler);
  ipcMain.on(IPC.BLACKLIST_PICK_CANCEL, onCancelHandler);
  // 遮罩窗口被外部关闭（异常）也要恢复 app 窗口
  pickerWin.once('closed', () => {
    closePicker(false);
  });
}

function getHandle(win: BrowserWindow): number {
  try {
    return Number(win.getNativeWindowHandle().readBigUInt64LE(0));
  } catch {
    return 0;
  }
}