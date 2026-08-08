/**
 * 设置面板（I-09）：内嵌在主窗口中的 WebContentsView，铺满整个窗口，
 * 覆盖在 chat 视图之上，加载 settings.html 经 IPC 读写 ConfigStore 热更新。
 * 替代旧版独立 BrowserWindow，实现「点击设置按钮就在主窗口内显示，不再新开窗口」。
 */
import { BrowserWindow, WebContents, WebContentsView } from 'electron';
import { SETTINGS_HTML, SHELL_PRELOAD } from '../constants';

type MainWindowRef = { win: BrowserWindow; view: WebContentsView | null } | null;

export class SettingsWindow {
  private view: WebContentsView | null = null;
  private host: BrowserWindow | null = null;
  private listeningResize = false;
  private listeningHide = false;
  /** 主窗口 resize 防抖 timer。 */
  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  /** 设置视图首次就绪回调（供主进程下发主题变量）。 */
  public onReady: (() => void) | null = null;

  constructor(
    private readonly getMainWin: () => MainWindowRef,
    private readonly getThemeBg: () => string = () => '#ffffff'
  ) {}

  /** 打开（已打开则重新置顶并聚焦）；单例。 */
  public open(): void {
    const host = this.getMainWin()?.win;
    if (!host || host.isDestroyed()) return;
    this.host = host;

    if (!this.listeningResize) {
      host.on('resize', this.onHostResize);
      this.listeningResize = true;
    }
    // 主窗口被隐藏（✕ 关闭进托盘等）时一并收起设置面板，
    // 否则从托盘重新打开主窗口时设置界面会残留。
    if (!this.listeningHide) {
      host.on('hide', this.onHostHide);
      this.listeningHide = true;
    }

    if (this.view && !this.view.webContents.isDestroyed()) {
      // 已存在：重新挂载到顶层并聚焦
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
        // 防止设置面板所在主窗口被最小化/隐藏（如 B 窗口流程）后，渲染进程被节流冻结，
        // 导致恢复后点击（返回/关闭等）全部无效。
        backgroundThrottling: false,
        additionalArguments: ['--window-type=settings'],
      },
    });
    this.view = view;
    // 加载完成前隐藏设置视图：彻底杜绝「页面首帧前白色底」的闪白。
    // （Windows 上 WebContentsView 首帧前的背景色不可靠，隐藏直到页面渲染出深色背景再显示。）
    try {
      view.setVisible(false);
    } catch {
      /* 平台不支持则忽略 */
    }
    // 加载 HTML 期间视图默认白底，深色主题下会闪白：提前按当前主题设置背景色（兜底）
    try {
      view.setBackgroundColor(this.getThemeBg());
    } catch {
      /* 平台不支持则忽略 */
    }
    this.attachToHost();
    // 首帧防闪白：把当前主题背景色经 URL query 传给页面（settings.html 的 head 内联脚本
    // 在首帧绘制前同步设置 --ds-bg），比仅 setBackgroundColor 更彻底。
    view.webContents.loadFile(SETTINGS_HTML, { query: { bg: this.getThemeBg() } });
    this.layout();
    view.webContents.once('dom-ready', () => {
      // DOM 就绪（head 内联脚本已设置深色 --ds-bg，CSS 未就绪时也由视图背景色兜底）：
      // 此时显示设置视图，首帧必为深色，杜绝白底闪白。
      try {
        view.setVisible(true);
      } catch {
        /* 忽略 */
      }
      view.webContents.focus();
    });
    view.webContents.once('did-finish-load', () => {
      // 页面完全加载后通知主进程下发主题变量（settings.js 已注册监听）
      if (this.onReady) this.onReady();
    });
    view.webContents.once('destroyed', () => {
      this.view = null;
    });
  }

  /**
   * 设置面板打开期间，临时关闭主窗口自身标题栏的拖拽区域。
   * 根因：Electron 中 `-webkit-app-region: drag` 区域会把鼠标事件（hover/click）全部吞掉，
   * 即使它位于其他 WebContentsView 之下（官方仅修复了全屏场景，见 electron#41002）。
   * 主窗口的 titlebar.html 顶部 40px 整条都是 drag 区，仅在右侧按钮处留了 no-drag 空洞，
   * 导致设置视图左上角「返回」按钮正好落在 drag 区上无法点击/无悬浮效果，
   * 而右上角关闭按钮恰好落在底层按钮的 no-drag 空洞上表现正常。
   * 设置面板本身就是铺满主窗口的自绘浮层，关闭后立即恢复拖拽。
   */
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
      ).catch(() => {
        // 页面尚未就绪时延后重试一次（如托盘呼出设置时标题栏仍在加载）
        if (!wc.isDestroyed()) setTimeout(apply, 250);
      });
    };
    apply();
  }

  /** 挂载到主窗口（置于所有子视图之上）。 */
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
    // 关闭底层标题栏 drag 区域，避免其吞掉设置视图的鼠标事件（返回按钮被遮挡问题）
    this.setBaseDragRegion(false);
    view.webContents.focus();
  }

  /** 设置视图铺满整个主窗口（含标题栏区域，settings.html 自带标题栏）。 */
  private layout(): void {
    const host = this.host;
    const view = this.view;
    if (!host || host.isDestroyed() || !view || view.webContents.isDestroyed()) return;
    const { width, height } = host.getContentBounds();
    if (width <= 0 || height <= 0) return;
    view.setBounds({ x: 0, y: 0, width, height });
  }

  /** 窗口尺寸变化时重新布局（防抖，与主窗口 chat 视图布局策略一致）。 */
  private onHostResize = (): void => {
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    this.layoutTimer = setTimeout(() => this.layout(), 0);
  };

  /** 主窗口隐藏（关闭进托盘）时收起设置面板，避免托盘重开后设置界面残留。 */
  private onHostHide = (): void => {
    this.close();
  };

  /** 返回设置视图的 webContents（未打开则 null）。 */
  public getWebContents(): WebContents | null {
    if (this.view && !this.view.webContents.isDestroyed()) {
      return this.view.webContents;
    }
    return null;
  }

  /** 关闭并移除设置视图。 */
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
        /* 页面不响应关闭时忽略 */
      }
    }
    // 恢复主窗口标题栏拖拽区域（设置面板关闭后重新允许拖拽窗口）
    this.setBaseDragRegion(true);
    this.view = null;
    this.host = null;
  }
}
