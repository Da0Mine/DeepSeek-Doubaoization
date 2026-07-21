/**
 * 系统托盘 + 菜单（基于 electron.Tray + Menu）。
 * 提供 buildMenu / show / hide / rebuild；配置项 trayEnabled 控制显隐。
 * 托盘右键菜单仅保留「退出」，其余功能移除（用户反馈：菜单项过多）。
 * 托盘单击仍用于显隐主窗口。
 */
import { Menu, Tray, nativeImage } from 'electron';
import { iconIfExists } from '../constants';
import type { ConfigStore } from '../config/ConfigStore';

export interface TrayCallbacks {
  /** 单击托盘图标：显隐主窗口。 */
  onToggle: () => void;
  /** 退出应用。 */
  onQuit: () => void;
}

export class TrayManager {
  private tray: Tray | null = null;

  constructor(private readonly config: ConfigStore, private readonly cb: TrayCallbacks) {}

  /** 构建托盘右键菜单（仅「退出」）。 */
  public buildMenu(): Menu {
    return Menu.buildFromTemplate([{ label: '退出', click: () => this.cb.onQuit() }]);
  }

  /** 创建并显示托盘。 */
  public show(): void {
    if (this.tray) return;
    let image: Electron.NativeImage;
    const iconPath = iconIfExists();
    if (iconPath) {
      image = nativeImage.createFromPath(iconPath);
    } else {
      image = nativeImage.createEmpty();
    }
    this.tray = new Tray(image);
    this.tray.setToolTip('DeepSeek Desktop');
    this.tray.setContextMenu(this.buildMenu());
    this.tray.on('click', () => this.cb.onToggle());
  }

  /** 隐藏并销毁托盘。 */
  public hide(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  /** 依据配置重建（显隐 + 菜单刷新）。 */
  public rebuild(): void {
    if (this.config.get('trayEnabled')) {
      this.show();
    } else {
      this.hide();
    }
    if (this.tray) {
      this.tray.setContextMenu(this.buildMenu());
    }
  }
}
