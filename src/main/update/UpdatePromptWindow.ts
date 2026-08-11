/**
 * 更新提醒弹框：发现新版本时覆盖在主窗口上的透明窗口（居中卡片），
 * 显示最新版本号与 Release 更新说明，提供「暂不更新」/「立即更新」。
 * 「立即更新」复用 UpdateChecker 下载安装包（进度实时推送到弹框），
 * 完成后自动唤起安装程序并关闭弹框。
 */
import { BrowserWindow } from 'electron';
import { SHELL_PRELOAD, UPDATE_PROMPT_HTML } from '../constants';
import { IPC } from '../ipc/channels';
import type { ConfigStore } from '../config/ConfigStore';
import type { WindowManager } from '../windows/WindowManager';
import { formatVersion, UpdateChecker } from './UpdateChecker';
import type { UpdateInfo } from '../../shared/types';

export class UpdatePromptWindow {
  private win: BrowserWindow | null = null;
  private info: UpdateInfo | null = null;
  private installing = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: ConfigStore,
    private readonly windows: WindowManager,
    private readonly update: UpdateChecker
  ) {}

  /** 弹框是否已打开。 */
  public isOpen(): boolean {
    return !!(this.win && !this.win.isDestroyed());
  }

  /** 弹出更新提示（透明覆盖主窗口，居中卡片）。 */
  public open(info: UpdateInfo): void {
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
        additionalArguments: ['--window-type=update-prompt'],
      },
    });
    this.win = win;
    this.info = info;

    win.loadFile(UPDATE_PROMPT_HTML);
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
        win.webContents.send(IPC.UPDATE_PROMPT_INFO, {
          latestVersion: formatVersion(info.latestVersion ?? ''),
          releaseNotes: info.releaseNotes ?? null,
        });
      }
    });
  }

  /** 当前提示的版本号（供「暂不更新」记录忽略）。 */
  public getLatestVersion(): string | null {
    return this.info?.latestVersion ?? null;
  }

  /** 立即更新：下载安装包（进度实时推送到弹框），完成后唤起安装程序并关闭弹框。 */
  public async startInstall(): Promise<void> {
    const win = this.win;
    const info = this.info;
    if (!win || win.isDestroyed() || !info || this.installing) return;
    this.installing = true;
    const wc = win.webContents;
    const asset = this.update.findInstaller();
    if (!asset) {
      // 无安装包资产：通知渲染层展示失败
      if (!wc.isDestroyed()) {
        wc.send(IPC.UPDATE_DOWNLOAD_PROGRESS, { received: 0, total: 0, percent: -1, receiver: 'prompt' });
      }
      return;
    }
    try {
      const localPath = await this.update.downloadInstaller(asset, (p) => {
        if (!wc.isDestroyed()) wc.send(IPC.UPDATE_DOWNLOAD_PROGRESS, { ...p, receiver: 'prompt' });
      });
      await this.update.launchInstallerAndQuit(localPath);
      this.close();
    } catch {
      if (!wc.isDestroyed()) {
        wc.send(IPC.UPDATE_DOWNLOAD_PROGRESS, { received: 0, total: 0, percent: -1, receiver: 'prompt' });
      }
    }
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
    this.info = null;
    this.installing = false;
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
