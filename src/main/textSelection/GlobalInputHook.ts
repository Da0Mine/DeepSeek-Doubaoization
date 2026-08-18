/**
 * 全局输入钩子：基于 uiohook-napi 检测鼠标拖拽选择文本，
 * 自动模拟 Ctrl+C 获取选中文本并触发划词工具栏。
 *
 * 工作原理（参考豆包/ima 等同类软件）：
 *  1. 检测鼠标按下位置（mousedown）
 *  2. 检测鼠标释放位置（mouseup），若距离 > 5px 视为拖拽选择
 *  3. 自动模拟 Ctrl+C 将选中文本复制到剪贴板
 *  4. 读取剪贴板文本后【立即还原原剪贴板内容】——内部取词不污染用户剪贴板；
 *     只有点击工具栏「复制」按钮时才真正写入剪贴板。
 *  5. 弹出划词工具栏
 *  整个过程无需用户手动按任何快捷键。
 */
import { uIOhook, UiohookMouseEvent, UiohookKey, UiohookKeyboardEvent } from 'uiohook-napi';
import { clipboard, type NativeImage } from 'electron';
import { logf } from '../logger';

export type InputSelectionCallback = (
  text: string,
  mouseDownPos?: { x: number; y: number },
  mouseUpPos?: { x: number; y: number }
) => void;

/** 剪贴板内容快照（文本 / 富文本 / 图片 / 文件），用于取词后还原。 */
interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: NativeImage | null;
  /** 剪贴板是否含文件列表（Windows CF_HDROP 无法通过 Electron writeBuffer 可靠还原，
   *  还原会损坏文件条目 → 检测到文件时自动取词应整体跳过）。 */
  hasFiles: boolean;
}

/** 读取剪贴板文件列表（FileNameW 格式：UTF-16LE，路径以 \0 分隔，双 \0 结尾）。 */
function readFileList(): string[] {
  try {
    const buf = clipboard.readBuffer('FileNameW');
    if (!buf || buf.length === 0) return [];
    const str = buf.toString('utf16le');
    return str.split('\0').filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

/** 快照当前剪贴板（自动取词前调用）。 */
function snapshotClipboard(): ClipboardSnapshot {
  try {
    return {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
      image: clipboard.readImage(),
      hasFiles: readFileList().length > 0,
    };
  } catch {
    return { text: '', html: '', rtf: '', image: null, hasFiles: false };
  }
}

/** 还原剪贴板快照（取词后调用，避免污染用户剪贴板）。
 *  逐格式写回（图片 / 富文本 / 文本）；原剪贴板为空时清空，避免残留模拟 Ctrl+C 的内容。 */
function restoreClipboard(s: ClipboardSnapshot): void {
  try {
    let wrote = false;
    if (s.image && !s.image.isEmpty()) {
      clipboard.writeImage(s.image);
      wrote = true;
    }
    if (s.html) {
      clipboard.writeHTML(s.html);
      wrote = true;
    }
    if (s.rtf) {
      clipboard.writeRTF(s.rtf);
      wrote = true;
    }
    if (s.text) {
      clipboard.writeText(s.text);
      wrote = true;
    }
    // 原剪贴板为空：清掉自动取词写入的文本，保持用户剪贴板干净
    if (!wrote) clipboard.clear();
  } catch {
    /* 还原失败忽略 */
  }
}

export class GlobalInputHook {
  private running = false;
  private mouseDownPos = { x: 0, y: 0 };
  private lastText = '';
  private pendingCheck: ReturnType<typeof setTimeout> | null = null;
  public onTextSelected: InputSelectionCallback | null = null;
  /** 任意鼠标按下时回调（用于检测外部点击关闭工具栏）。 */
  public onAnyMouseDown: ((e: UiohookMouseEvent) => void) | null = null;
  /** 任意键盘按键按下时回调（携带按键事件，用于识别 Win+V 等组合键）。 */
  public onAnyKeyDown: ((e: UiohookKeyboardEvent) => void) | null = null;
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
      // 快照原剪贴板：取词后立即还原，避免自动复制污染用户剪贴板
      const snapshot = snapshotClipboard();

      // 剪贴板含文件列表（如复制的图片/文档文件）时无法可靠还原——
      // Electron 的 writeBuffer 还原 CF_HDROP 会损坏文件条目（无法预览/粘贴）。
      // 此时跳过自动取词，保护用户剪贴板不被破坏。
      if (snapshot.hasFiles) {
        logf('INPUT_HOOK', '剪贴板含文件列表，跳过自动取词以保护剪贴板');
        return;
      }

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
            // 关键：取词后立即还原用户原剪贴板内容——
            // 内部取词不污染剪贴板，只有点击工具栏「复制」按钮时才真正写入。
            restoreClipboard(snapshot);
            this.onTextSelected?.(text, { ...this.mouseDownPos }, { x: e.x, y: e.y });
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
    uIOhook.on('keydown', (e: UiohookKeyboardEvent) => {
      if (!this.running) return;
      this.onAnyKeyDown?.(e);
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