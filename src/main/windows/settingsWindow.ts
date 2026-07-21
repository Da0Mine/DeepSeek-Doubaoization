/**
 * 通用设置窗口工厂（I-09）：加载 settings.html，经 IPC 读写 ConfigStore 热更新。
 * 单例：已开则聚焦。
 */
import { BrowserWindow, WebContents } from 'electron';
import { SETTINGS_HTML, SHELL_PRELOAD, iconIfExists } from '../constants';

export class SettingsWindow {
  private win: BrowserWindow | null = null;
  /** 窗口首次就绪回调（供主进程下发主题变量）。 */
  public onReady: (() => void) | null = null;

  /** 打开（已开则聚焦）；单例。 */
  public open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 900,
      height: 720,
      minWidth: 700,
      minHeight: 540,
      frame: false,
      title: '设置',
      backgroundColor: '#ffffff',
      show: false,
      icon: iconIfExists(),
      webPreferences: {
        preload: SHELL_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        additionalArguments: ['--window-type=settings'],
      },
    });
    win.loadFile(SETTINGS_HTML);
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
      if (this.onReady) this.onReady();
    });
    win.on('closed', () => {
      this.win = null;
    });
    this.win = win;
  }

  /** 返回当前窗口的 webContents（未打开则 null）。 */
  public getWebContents(): WebContents | null {
    if (this.win && !this.win.isDestroyed()) {
      return this.win.webContents;
    }
    return null;
  }

  /** 关闭并销毁。 */
  public close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close();
    this.win = null;
  }
}
