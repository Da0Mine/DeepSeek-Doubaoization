/**
 * 共享屏幕模式提示弹框：专家/快速模式限制时，覆盖在主窗口上的透明提示窗口
 * （全局半透明遮罩 + 居中卡片），提供「我知道了」与右下角「不再提醒」。
 * 点击「不再提醒」后主进程写入配置 screenShareModeReminder=false，之后不再弹出；
 * 用户可在设置中重新开启。
 */
import { BrowserWindow } from 'electron';
import { MODE_REMINDER_HTML, SHELL_PRELOAD } from '../constants';
import { IPC } from '../ipc/channels';
import type { WindowManager } from '../windows/WindowManager';

export type ModeReminderType = 'expert' | 'simple';

/** 通用提示内容（模式提示外的场景，如快捷键占用提示）。 */
export interface ModeReminderNotice {
  title?: string;
  message: string;
  detail?: string;
  /** 是否隐藏「不再提醒」按钮（普通提示无需该按钮）。 */
  hideNever?: boolean;
}

export class ModeReminderWindow {
  private win: BrowserWindow | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly windows: WindowManager) {}

  /** 弹框是否已打开。 */
  public isOpen(): boolean {
    return !!(this.win && !this.win.isDestroyed());
  }

  /** 弹出模式提示（透明窗口覆盖主窗口，半透明遮罩 + 居中卡片）。 */
  public open(type: ModeReminderType): void {
    this.showWindow({ type });
  }

  /** 弹出通用提示（自定义标题/正文/详情，可隐藏「不再提醒」）。 */
  public openNotice(notice: ModeReminderNotice): void {
    this.showWindow({ notice });
  }

  /** 创建透明覆盖窗口并下发内容（模式提示与通用提示共用）。 */
  private showWindow(payload: { type?: ModeReminderType; notice?: ModeReminderNotice }): void {
    const main = this.windows.getMainWindow();
    if (!main || !main.win || main.win.isDestroyed() || this.isOpen()) return;
    const host = main.win;
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
        additionalArguments: ['--window-type=mode-reminder'],
      },
    });
    this.win = win;

    win.loadFile(MODE_REMINDER_HTML);
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.showInactive();
    });
    win.on('closed', () => {
      this.win = null;
    });
    host.on('move', this.syncBounds);
    host.on('resize', this.syncBounds);

    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.MODE_REMINDER_INFO, payload);
      }
    });
  }

  /** 关闭弹框。 */
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
