/**
 * 插件管理面板：内嵌在主窗口中的 WebContentsView，铺满整个窗口（同设置面板方案），
 * 覆盖在 chat 视图之上，加载 extensions.html，经 IPC 管理 session 上加载的浏览器插件。
 */
import { BrowserWindow, WebContents, WebContentsView } from 'electron';
import { EXTENSIONS_HTML, SHELL_PRELOAD } from '../constants';

type MainWindowRef = { win: BrowserWindow; view: WebContentsView | null } | null;

export class ExtensionsWindow {
  private view: WebContentsView | null = null;
  private host: BrowserWindow | null = null;
  private listeningResize = false;
  private listeningHide = false;
  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  /** 插件视图是否已加载完成。 */
  public isReady = false;

  constructor(
    private readonly getMainWin: () => MainWindowRef,
    private readonly getThemeBg: () => string = () => '#ffffff'
  ) {}

  public open(): void {
    const host = this.getMainWin()?.win;
    if (!host || host.isDestroyed()) return;
    this.host = host;

    if (!this.listeningResize) {
      host.on('resize', this.onHostResize);
      this.listeningResize = true;
    }
    if (!this.listeningHide) {
      host.on('hide', this.onHostHide);
      this.listeningHide = true;
    }

    if (this.view && !this.view.webContents.isDestroyed()) {
      this.attachToHost();
      this.layout();
      this.view.webContents.focus();
      return;
    }

    const view = new WebContentsView({
      webPreferences: {
        preload: SHELL_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        additionalArguments: ['--window-type=extensions'],
      },
    });
    this.view = view;
    try {
      view.setVisible(false);
    } catch {
      /* 平台不支持则忽略 */
    }
    try {
      view.setBackgroundColor(this.getThemeBg());
    } catch {
      /* 平台不支持则忽略 */
    }
    this.attachToHost();
    view.webContents.loadFile(EXTENSIONS_HTML, { query: { bg: this.getThemeBg() } });
    this.layout();
    view.webContents.once('dom-ready', () => {
      try {
        view.setVisible(true);
      } catch {
        /* 忽略 */
      }
      view.webContents.focus();
    });
    view.webContents.once('did-finish-load', () => {
      this.isReady = true;
    });
    view.webContents.once('destroyed', () => {
      this.view = null;
    });
  }

  /** 关闭主窗口标题栏 drag 区，避免吞掉面板左上角返回按钮的鼠标事件。 */
  private setBaseDragRegion(enable: boolean): void {
    const host = this.host;
    if (!host || host.isDestroyed()) return;
    const wc = host.webContents;
    if (!wc || wc.isDestroyed()) return;
    const region = enable ? 'drag' : 'no-drag';
    const apply = (): void => {
      if (wc.isDestroyed()) return;
      wc.executeJavaScript(
        `(function () {
          var el = document.getElementById('titlebar');
          if (el) el.style.webkitAppRegion = ${JSON.stringify(region)};
          return true;
        })()`
      ).catch(() => {});
    };
    apply();
  }

  private attachToHost(): void {
    const host = this.host;
    const view = this.view;
    if (!host || host.isDestroyed() || !view || view.webContents.isDestroyed()) return;
    try {
      host.contentView.removeChildView(view);
    } catch {
      /* 未挂载时忽略 */
    }
    host.contentView.addChildView(view);
    this.setBaseDragRegion(false);
    view.webContents.focus();
  }

  private layout(): void {
    const host = this.host;
    const view = this.view;
    if (!host || host.isDestroyed() || !view || view.webContents.isDestroyed()) return;
    const { width, height } = host.getContentBounds();
    if (width <= 0 || height <= 0) return;
    view.setBounds({ x: 0, y: 0, width, height });
  }

  private onHostResize = (): void => {
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    this.layoutTimer = setTimeout(() => this.layout(), 0);
  };

  private onHostHide = (): void => {
    this.close();
  };

  public getWebContents(): WebContents | null {
    if (this.view && !this.view.webContents.isDestroyed()) {
      return this.view.webContents;
    }
    return null;
  }

  public close(): void {
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    if (this.host && this.listeningResize) {
      this.host.removeListener('resize', this.onHostResize);
      this.listeningResize = false;
    }
    if (this.view && !this.view.webContents.isDestroyed()) {
      if (this.host && !this.host.isDestroyed()) {
        try {
          this.host.contentView.removeChildView(this.view);
        } catch {
          /* 忽略 */
        }
      }
      try {
        this.view.webContents.close();
      } catch {
        /* 忽略 */
      }
    }
    this.setBaseDragRegion(true);
    this.view = null;
    this.host = null;
    this.isReady = false;
  }
}