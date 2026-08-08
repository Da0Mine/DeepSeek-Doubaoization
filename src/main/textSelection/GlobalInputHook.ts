/**
 * 全局输入钩子：基于 uiohook-napi 检测鼠标拖拽选择文本，
 * 自动模拟 Ctrl+C 获取选中文本并触发划词工具栏。
 *
 * 工作原理（参考豆包/ima 等同类软件）：
 *  1. 检测鼠标按下位置（mousedown）
 *  2. 检测鼠标释放位置（mouseup），若距离 > 5px 视为拖拽选择
 *  3. 自动模拟 Ctrl+C 将选中文本复制到剪贴板
 *  4. 读取剪贴板文本，弹出划词工具栏
 *  整个过程无需用户手动按任何快捷键。
 */
import { uIOhook, UiohookMouseEvent, UiohookKey } from 'uiohook-napi';
import { clipboard } from 'electron';
import { logf } from '../logger';

export type InputSelectionCallback = (text: string, mouseDownPos?: { x: number; y: number }) => void;

export class GlobalInputHook {
  private running = false;
  private mouseDownPos = { x: 0, y: 0 };
  private lastText = '';
  private pendingCheck: ReturnType<typeof setTimeout> | null = null;
  public onTextSelected: InputSelectionCallback | null = null;
  /** 任意鼠标按下时回调（用于检测外部点击关闭工具栏）。 */
  public onAnyMouseDown: ((e: UiohookMouseEvent) => void) | null = null;
  /** 任意键盘按键按下时回调（用于按下按键后关闭工具栏）。 */
  public onAnyKeyDown: (() => void) | null = null;
  /** 滚轮滚动时回调（用于跟随滚动重定位工具栏）。 */
  public onWheel: ((deltaY: number) => void) | null = null;

  /** 启动输入钩子。 */
  public start(): void {
    if (this.running) return;
    this.running = true;
    this.lastText = clipboard.readText();

    // 记录鼠标按下位置，用于判断是否拖拽选择
    uIOhook.on('mousedown', (e: UiohookMouseEvent) => {
      this.mouseDownPos = { x: e.x, y: e.y };
      // 取消上一个待处理的检查
      if (this.pendingCheck) {
        clearTimeout(this.pendingCheck);
        this.pendingCheck = null;
      }
      // 通知外部（用于关闭工具栏）
      this.onAnyMouseDown?.(e);
    });

    // 鼠标释放：如果位置有明显移动（拖拽选择），模拟 Ctrl+C 获取选中文本
    uIOhook.on('mouseup', (e: UiohookMouseEvent) => {
      if (!this.running) return;
      const dx = Math.abs(e.x - this.mouseDownPos.x);
      const dy = Math.abs(e.y - this.mouseDownPos.y);
      // 距离 > 5px 视为拖拽选择
      if (dx <= 5 && dy <= 5) return;

      // 保存当前剪贴板文本，用于后续比较
      const prevClip = this.lastText;

      // 模拟 Ctrl+C：将选中文本复制到系统剪贴板
      try {
        uIOhook.keyTap(UiohookKey.C, [UiohookKey.Ctrl]);
      } catch (err) {
        logf('INPUT_HOOK', '模拟 Ctrl+C 失败:', err);
        return;
      }

      // 延迟 40ms 等剪贴板更新（Windows 剪贴板写入约 10-20ms，40ms 足够且明显更快）
      this.pendingCheck = setTimeout(() => {
        this.pendingCheck = null;
        try {
          const text = clipboard.readText();
          if (text && text !== prevClip && text.length > 0) {
            logf('INPUT_HOOK', `检测到选中文本: "${text.slice(0, 40)}..."`);
            this.lastText = text;
            this.onTextSelected?.(text, { ...this.mouseDownPos });
          }
        } catch {
          // 剪贴板不可用时静默忽略
        }
      }, 40);
    });

    // 滚轮事件：用于工具栏跟随滚动
    uIOhook.on('wheel', (e: any) => {
      if (!this.running) return;
      this.onWheel?.(e.rotation);
    });

    // 键盘按键按下：通知外部关闭工具栏（用户按下任意按键后悬浮框即消失）
    uIOhook.on('keydown', () => {
      if (!this.running) return;
      this.onAnyKeyDown?.();
    });

    uIOhook.start();
    logf('INPUT_HOOK', '全局输入钩子已启动，自动检测文本选择');
  }

  /** 停止输入钩子。 */
  public stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pendingCheck) {
      clearTimeout(this.pendingCheck);
      this.pendingCheck = null;
    }
    try {
      uIOhook.stop();
    } catch {
      // 忽略
    }
    uIOhook.removeAllListeners('mousedown');
    uIOhook.removeAllListeners('mouseup');
    uIOhook.removeAllListeners('wheel');
    uIOhook.removeAllListeners('keydown');
    logf('INPUT_HOOK', '全局输入钩子已停止');
  }

  /** 暂停一次检测（工具栏操作后同步 lastText，避免误触发）。 */
  public pauseOne(): void {
    try {
      this.lastText = clipboard.readText();
    } catch {
      // ignore
    }
  }

  /** 是否正在运行。 */
  public isRunning(): boolean {
    return this.running;
  }
}