/**
 * 全局输入钩子：划词取词。对标 Cherry Studio 的实现。
 *
 * 驱动方式：直接用 selection-hook 的原生「text-selection」事件触发（自动识别拖拽/双击选词），
 * 并保持窗口图标/应用正常。取词三级路径完全交给 selection-hook：
 *   UIA → IAccessible → 剪贴板回退（保存→复制→读→还原，默认开启）。
 * 这样浏览器/Office/记事本走 UIA/IAccessible（零剪贴板），微信/WPS/PDF 这类不暴露
 * 无障碍选区的程序自动落剪贴板回退，从而能稳定划词（这也是 Cherry 能在微信/WPS 用的原因）。
 *
 * 对齐 Cherry 的要点：
 *  - 单实例、常驻：SelectionHook 实例在首次 start() 时创建一次，之后 start/stop 只启停原生
 *    钩子、不复建，避免事件重复挂载导致的重复弹框。
 *  - 应用过滤：开全局黑名单（explorer/Office/截图/建模等默认不弹框）、对 wps/PDF 等做 fine-tune。
 *  - 去重：除主进程「工具栏已可见则忽略」外，本层再叠一个短冷却，双保险。
 */
import SelectionHook, { type TextSelectionData, type MouseEventData, type KeyboardEventData } from 'selection-hook';
import { logf } from '../logger';

/** selection-hook 实例的运行时形态（默认导出为类）。 */
type SelectionHookInstance = InstanceType<typeof SelectionHook>;

/** 预定义黑名单（沿用 Cherry Studio）：全局过滤，这些程序划词默认不弹框，避免误触。 */
const PREDEFINED_BLACKLIST = [
  'explorer.exe',
  'snipaste.exe', 'pixpin.exe', 'sharex.exe',        // 截图
  'excel.exe', 'powerpnt.exe',                       // Office
  'photoshop.exe', 'illustrator.exe',                // 图像
  'adobe premiere pro.exe', 'afterfx.exe', 'adobe audition.exe', // 影音
  'blender.exe', '3dsmax.exe', 'maya.exe',           // 3D
  'acad.exe', 'sldworks.exe',                        // CAD
  'mstsc.exe',                                        // 远程桌面
];

/** 需 fine-tune 的应用（跳过光标形状检测 + 延迟读剪贴板）：PDF 阅读器类更稳定取词。 */
const FINETUNED_APPS = ['acrobat.exe', 'cajviewer.exe', 'foxitphantom.exe'];

/** 完全禁用剪贴板回退的程序：WPS 不暴露 UIA/IAccessible 选区，selection-hook 只能靠剪贴板回退
 *  （保存→复制→读→恢复原内容），导致每次划词产生 a,b,a 三段历史且可能覆盖用户手动复制。
 *  因此对 WPS 禁用其内置回退，改由 WpsWordHook 自研「只复制读取、不恢复」通道。 */
const EXCLUDE_CLIPBOARD_APPS = ['wps.exe'];

/** 选中文本的包围盒（物理像素，来自 SEL_FULL/SEL_DETAILED 级坐标），用于工具栏贴合选区定位。 */
export interface SelPosData {
  startTop: { x: number; y: number };
  endBottom: { x: number; y: number };
  posLevel: number;
}

export type InputSelectionCallback = (
  text: string,
  mouseDownPos?: { x: number; y: number },
  mouseUpPos?: { x: number; y: number },
  selPos?: SelPosData
) => void;

/** 把 selection-hook 的坐标点（物理像素）转 {x,y}；非法坐标(-99999)返回 undefined。 */
function toPos(p: { x: number; y: number } | null | undefined): { x: number; y: number } | undefined {
  if (!p) return undefined;
  if (p.x === SelectionHook.INVALID_COORDINATE || p.y === SelectionHook.INVALID_COORDINATE) return undefined;
  return { x: p.x, y: p.y };
}

export class GlobalInputHook {
  private running = false;
  /** selection-hook 单实例（首次 start 创建，之后复用）。 */
  private selHook: SelectionHookInstance | null = null;
  /** 上次触发弹框的时间戳，配合主进程「工具栏已可见则忽略」做双重去重。 */
  private lastFireAt = 0;
  private static readonly FIRE_COOLDOWN = 250;
  public onTextSelected: InputSelectionCallback | null = null;
  /** 任意鼠标按下时回调（携带坐标，用于检测外部点击关闭工具栏）。 */
  public onAnyMouseDown: ((e: { x: number; y: number }) => void) | null = null;
  /** 任意键盘按键按下时回调（携带按键数据，用于识别组合键）。 */
  public onAnyKeyDown: ((e: KeyboardEventData) => void) | null = null;
  /** 滚轮滚动时回调（跟随滚动重定位工具栏）。 */
  public onWheel: (() => void) | null = null;
  /** 拖选结束回调（mouse-up 且相对按下发生位移时触发），供 WpsWordHook 自研 WPS 取词。 */
  public onDragEnd: ((down: { x: number; y: number }, up: { x: number; y: number }) => void) | null = null;
  /** 最近一次鼠标按下的坐标（物理像素），用于判定拖选。 */
  private lastPress: { x: number; y: number; t: number } | null = null;

  /** 首次创建并配置单实例（仅一次）；事件只在此挂载，避免 start/stop 反复造成重复监听。 */
  private ensureInstance(): boolean {
    if (this.selHook) return true;
    try {
      const hook = new SelectionHook();
      // 对齐 Cherry：对 PDF 阅读器类跳过光标形状检测
      hook.setFineTunedList(SelectionHook.FineTunedListType.EXCLUDE_CLIPBOARD_CURSOR_DETECT, FINETUNED_APPS);
      // 对齐 Cherry：对 PDF 阅读器类延迟读剪贴板（避免读到中间态）
      hook.setFineTunedList(SelectionHook.FineTunedListType.INCLUDE_CLIPBOARD_DELAY_READ, FINETUNED_APPS);
      // WPS：禁用 selection-hook 内置剪贴板回退（避免其保存+恢复逻辑污染剪贴板），改由自研通道
      hook.setClipboardMode(SelectionHook.FilterMode.EXCLUDE_LIST, EXCLUDE_CLIPBOARD_APPS);
      // 全局黑名单：这些程序划词不弹框
      hook.setGlobalFilterMode(SelectionHook.FilterMode.EXCLUDE_LIST, PREDEFINED_BLACKLIST);

      hook.on('text-selection', (data: TextSelectionData) => this.handleTextSelection(data));
      hook.on('mouse-down', (e: MouseEventData) => {
        if (!this.running) return;
        this.lastPress = { x: e.x, y: e.y, t: Date.now() };
        this.onAnyMouseDown?.({ x: e.x, y: e.y });
      });
      hook.on('mouse-up', (e: MouseEventData) => {
        if (!this.running) return;
        const down = this.lastPress;
        this.lastPress = null;
        // 无按下起点则忽略；转换非法坐标并平移
        if (!down || down.x === SelectionHook.INVALID_COORDINATE || down.y === SelectionHook.INVALID_COORDINATE) return;
        if (e.x === SelectionHook.INVALID_COORDINATE || e.y === SelectionHook.INVALID_COORDINATE) return;
        this.onDragEnd?.({ x: down.x, y: down.y }, { x: e.x, y: e.y });
      });
      hook.on('key-down', (e: KeyboardEventData) => {
        if (this.running) this.onAnyKeyDown?.(e);
      });
      hook.on('mouse-wheel', () => {
        if (this.running) this.onWheel?.();
      });

      this.selHook = hook;
      return true;
    } catch (err) {
      this.selHook = null;
      logf('INPUT_HOOK', 'selection-hook 初始化失败: ' + (err instanceof Error ? err.message : String(err)));
      return false;
    }
  }

  /** 启动输入钩子。 */
  public start(): void {
    try { logf('INPUT_HOOK', '划词 start() 进入 running=' + this.running); } catch {}
    if (this.running) return;
    if (!this.ensureInstance()) return;
    try {
      // 剪贴板回退默认开启（对齐 Cherry），让微信/WPS/PDF 也能取词
      this.selHook!.start({ debug: false });
      this.running = true;
      logf('INPUT_HOOK', 'selection-hook 启动完成（text-selection 事件驱动，剪贴板回退开启）');
    } catch (err) {
      logf('INPUT_HOOK', 'selection-hook.start 失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private handleTextSelection(data: TextSelectionData): void {
    if (!this.running) return;
    const text = (data && data.text) || '';
    if (text.trim().length === 0) return;
    // 去重：同一选取或其引发的窗口/焦点事件在冷却窗口内重复上报 → 忽略，避免弹框闪动/连弹
    const now = Date.now();
    if (now - this.lastFireAt < GlobalInputHook.FIRE_COOLDOWN) {
      logf('INPUT_HOOK', `忽略去重内重复 text-selection: "${text.slice(0, 30)}..."`);
      return;
    }
    this.lastFireAt = now;
    logf('INPUT_HOOK', `text-selection(method=${data.method}): "${text.slice(0, 40)}..."`);
    // 优先用选区包围盒（SEL_FULL/SEL_DETAILED 级）定位，鼠标坐标仅作兜底。
    const full =
      data.posLevel >= 3 && data.startTop && data.endBottom &&
      data.startTop.x !== SelectionHook.INVALID_COORDINATE &&
      data.startTop.y !== SelectionHook.INVALID_COORDINATE &&
      data.endBottom.x !== SelectionHook.INVALID_COORDINATE &&
      data.endBottom.y !== SelectionHook.INVALID_COORDINATE;
    const selPos: SelPosData | undefined = full
      ? {
          startTop: { x: data.startTop.x, y: data.startTop.y },
          endBottom: { x: data.endBottom.x, y: data.endBottom.y },
          posLevel: data.posLevel,
        }
      : undefined;
    this.onTextSelected?.(text, toPos(data.mousePosStart), toPos(data.mousePosEnd), selPos);
  }

  /** 停止输入钩子（复用实例，仅停原生钩子；下次 start 直接重启）。 */
  public stop(): void {
    if (!this.running) return;
    this.running = false;
    try { this.selHook?.stop(); } catch { /* 忽略 */ }
    logf('INPUT_HOOK', '划词钩子已停止（实例保留复用）');
  }

  /** 暂停一次检测（保留接口兼容；去重由工具栏可见 + 冷却双保险保证）。 */
  public pauseOne(): void {
    // no-op
  }

  /** 是否正在运行。 */
  public isRunning(): boolean {
    return this.running;
  }
}