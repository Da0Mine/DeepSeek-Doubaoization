/**
 * 首次运行登录引导 / 用户须知：覆盖在主窗口上的透明引导层（半透明遮罩 + 居中卡片）。
 * 仅首次运行时弹出：弹窗一提示「请先登录您的账号」→ 点「确定」→ 弹窗二展示用户须知 →
 * 点「我已知晓」后关闭并回调主进程（主进程据此开始检测登录态，登录成功后再弹使用说明引导）。
 */
import { BrowserWindow } from 'electron';
import { FIRST_RUN_HTML, SHELL_PRELOAD } from '../constants';
import type { WindowManager } from '../windows/WindowManager';

export class FirstRunDialog {
  private win: BrowserWindow | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  /** 点「我已知晓」后的回调（由 main.ts 注入，用于启动登录等待）。 */
  private onDone: (() => void) | null = null;

  constructor(private readonly windows: WindowManager) {}

  /** 弹框是否已打开。 */
  public isOpen(): boolean {
    return !!(this.win && !this.win.isDestroyed());
  }

  /** 弹出首次运行引导（透明窗口覆盖主窗口）；点「我已知晓」后触发 onDone。 */
  public open(onDone: () => void): void {
    if (this.isOpen()) return;
    const main = this.windows.getMainWindow();
    if (!main || !main.win || main.win.isDestroyed()) return;
    const host = main.win;
    this.onDone = onDone;
    const b = host.getBounds();
    const win = new BrowserWindow({
      parent: host,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: SHELL_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        additionalArguments: ['--window-type=first-run'],
      },
    });
    this.win = win;
    win.loadFile(FIRST_RUN_HTML);
    // Windows 上透明窗口的 ready-to-show 可能不触发（透明窗口首帧无绘制信号），
    // 曾出现「首次登录引导」偶尔不弹出的问题。多路兜底：ready-to-show /
    // did-finish-load / 2 秒定时器，任一满足即显示，确保弹窗每次都出现。
    let shown = false;
    const tryShow = (): void => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      // showInactive：不抢主窗口焦点，用户可直接在遮罩下方的页面中操作
      if (!win.isVisible()) win.showInactive();
    };
    win.once('ready-to-show', tryShow);
    win.webContents.once('did-finish-load', () => setTimeout(tryShow, 0));
    setTimeout(tryShow, 2000);
    win.on('closed', () => {
      this.win = null;
    });
    // 主窗口移动 / 缩放时同步引导层位置与尺寸
    host.on('move', this.syncBounds);
    host.on('resize', this.syncBounds);
  }

  /** 渲染进程按钮操作：done=我已知晓（关闭并触发回调）；close=直接关闭。 */
  public handleAction(action: string): void {
    this.close();
    if (action === 'done') {
      const cb = this.onDone;
      this.onDone = null;
      cb?.();
    }
  }

  /** 关闭引导层。 */
  public close(): void {
    const host = this.windows.getMainWindow()?.win;
    if (host && !host.isDestroyed()) {
      host.removeListener('move', this.syncBounds);
      host.removeListener('resize', this.syncBounds);
    }
    if (this.win && !this.win.isDestroyed()) this.win.close();
    this.win = null;
  }

  /** 主窗口移动 / 缩放同步（防抖）。 */
  private syncBounds = (): void => {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      const host = this.windows.getMainWindow()?.win;
      const win = this.win;
      if (!host || host.isDestroyed() || !win || win.isDestroyed()) return;
      win.setBounds(host.getBounds());
    }, 0);
  };
}
