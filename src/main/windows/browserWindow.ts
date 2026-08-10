/**
 * 内置浏览器窗口（多标签页）。
 * 用于「链接打开方式 = 内置」时承载所有外部链接：一个窗口、任意多个标签页。
 * 标签页用 WebContentsView 实现（共享 session，登录态一致），切换时控制 visible。
 * 外壳加载 browser.html（标签栏 UI），通过 IPC 与主进程交互。
 */
import { BrowserWindow, WebContents, WebContentsView, shell, nativeTheme } from 'electron';
import { BROWSER_HTML, SHELL_PRELOAD, WEBVIEW_PRELOAD, TITLEBAR_HEIGHT, DEEPSEEK_URL, iconIfExists } from '../constants';
import { IPC } from '../ipc/channels';
import type { ConfigStore } from '../config/ConfigStore';
import { logf } from '../logger';

/** 浏览器窗口默认尺寸。 */
const BROWSER_WIDTH = 1100;
const BROWSER_HEIGHT = 760;

/** 单个标签页。 */
interface BrowserTab {
  id: number;
  url: string;
  title: string;
  view: WebContentsView;
}

/** 渲染层标签描述（不含 view 引用）。 */
export interface BrowserTabInfo {
  id: number;
  url: string;
  title: string;
  active: boolean;
}

/** 主 -> 渲染：标签列表快照。 */
export interface BrowserTabsState {
  tabs: BrowserTabInfo[];
  /** 窗口是否已打开。 */
  visible: boolean;
}

export class BrowserWindowManager {
  private win: BrowserWindow | null = null;
  private tabs: BrowserTab[] = [];
  private activeId: number | null = null;
  private counter = 0;

  constructor(private readonly config: ConfigStore) {}

  /**
   * 打开 URL：根据「链接打开方式」决定。
   *   - internal（内置）：在浏览器窗口打开标签页——同 URL 已有标签则激活，否则新建标签；
   *   - external（默认浏览器）：shell.openExternal。
   * 非 http/https 协议一律走系统浏览器。
   */
  public async openUrl(url: string): Promise<void> {
    if (!url) return;
    const mode = this.config.get('linkOpenMode');
    // 内置模式只接管 http/https；其余协议（mailto 等）交给系统处理
    const isWeb = /^https?:\/\//i.test(url);
    if (mode === 'external' || !isWeb) {
      await shell.openExternal(url).catch(() => logf('browser', 'openExternal 失败', url));
      return;
    }
    // 同 URL 已有标签 → 激活并聚焦
    const existing = this.tabs.find((t) => t.url === url);
    if (existing) {
      this.activateTab(existing.id);
      return;
    }
    this.ensureWindow();
    this.addTab(url);
  }

  /** 切换标签。 */
  public switchTab(id: number): void {
    this.activateTab(id);
  }

  /** 关闭标签（最后一个关闭时窗口同步关闭）。 */
  public closeTab(id: number): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];
    try {
      this.win?.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    } catch {
      /* 忽略 */
    }
    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) {
      this.activeId = null;
      this.closeWindow();
      return;
    }
    if (this.activeId === id) {
      // 激活相邻标签
      this.activateTab(this.tabs[Math.min(idx, this.tabs.length - 1)].id);
    } else {
      this.pushState();
    }
  }

  /** 关闭浏览器窗口（所有标签随之销毁）。 */
  public closeWindow(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close();
  }

  /** 新建空白标签页（外壳「+」按钮）：默认打开 DeepSeek 首页，便于接着使用对话。 */
  public newTab(url?: string): void {
    this.ensureWindow();
    this.addTab(url || DEEPSEEK_URL);
  }

  /** 获取当前标签快照（供渲染层初始化）。 */
  public getState(): BrowserTabsState {
    return {
      tabs: this.tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        active: t.id === this.activeId,
      })),
      visible: !!(this.win && !this.win.isDestroyed() && this.win.isVisible()),
    };
  }

  /** 当前是否有打开的浏览器窗口。 */
  public isOpen(): boolean {
    return !!(this.win && !this.win.isDestroyed() && this.win.isVisible());
  }

  /** 返回浏览器窗口外壳 webContents（供主题广播使用；未打开返回 null）。 */
  public getShellWebContents(): WebContents | null {
    if (!this.win || this.win.isDestroyed()) return null;
    return this.win.webContents;
  }

  /** 创建（或聚焦）浏览器窗口并新增标签。 */
  private ensureWindow(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (!this.win.isVisible()) this.win.show();
      this.win.focus();
      return;
    }
    const mode = this.config.get('theme');
    const dark = mode === 'dark' || (mode === 'system' && nativeTheme.shouldUseDarkColors);
    this.win = new BrowserWindow({
      width: BROWSER_WIDTH,
      height: BROWSER_HEIGHT,
      minWidth: 600,
      minHeight: 400,
      frame: false,
      title: '浏览器',
      backgroundColor: dark ? '#1e1e1e' : '#ffffff',
      show: false,
      icon: iconIfExists(),
      webPreferences: {
        preload: SHELL_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        additionalArguments: ['--window-type=browser'],
      },
    });
    this.win.loadFile(BROWSER_HTML);
    this.win.once('ready-to-show', () => {
      if (this.win && !this.win.isDestroyed()) {
        this.win.show();
        this.win.focus();
        this.pushState();
      }
    });
    this.win.on('resize', () => this.layoutActiveTab());
    this.win.on('resized', () => this.layoutActiveTab());
    this.win.on('closed', () => {
      // 窗口关闭 → 清空全部标签（view 随窗口销毁）
      this.tabs = [];
      this.activeId = null;
      this.win = null;
    });
  }

  /** 新建标签页。 */
  private addTab(url: string): void {
    if (!this.win || this.win.isDestroyed()) return;
    const id = ++this.counter;
    const view = new WebContentsView({
      webPreferences: {
        preload: WEBVIEW_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.win.contentView.addChildView(view);
    view.webContents.loadURL(url).catch(() => logf('browser', '标签页加载失败', url));
    // 标签页内再点链接 → 也按链接打开方式处理
    this.attachLinkOpenHandler(view.webContents);
    // 标题更新（SPA/页面标题变化）
    view.webContents.on('page-title-updated', (_e, title) => {
      this.updateTitle(id, title);
    });
    // URL 变化（含重定向后）
    view.webContents.on('did-navigate', (_e, url2) => {
      this.updateUrl(id, url2);
    });
    view.webContents.on('did-navigate-in-page', (_e, url2) => {
      this.updateUrl(id, url2);
    });
    this.tabs.push({ id, url, title: url, view });
    this.layoutActiveTab();
    this.activateTab(id);
  }

  /** 激活标签：仅显示当前标签的 view，其余隐藏。 */
  private activateTab(id: number): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.activeId = id;
    for (const t of this.tabs) {
      const visible = t.id === id;
      try {
        t.view.setVisible(visible);
      } catch {
        /* 忽略 */
      }
    }
    this.layoutActiveTab();
    if (!this.win.isVisible()) {
      this.win.show();
    }
    this.win.focus();
    this.pushState();
  }

  /** 按窗口内容区布局当前激活标签的 view（从标题栏下方铺满）。 */
  private layoutActiveTab(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const { width, height } = this.win.getContentBounds();
    if (width <= 0 || height <= 0) return;
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (!tab || tab.view.webContents.isDestroyed()) return;
    tab.view.setBounds({
      x: 0,
      y: TITLEBAR_HEIGHT,
      width,
      height: Math.max(0, height - TITLEBAR_HEIGHT),
    });
  }

  private updateTitle(id: number, title: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || !title) return;
    tab.title = title.slice(0, 60);
    this.pushState();
  }

  private updateUrl(id: number, url: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.url = url;
    this.pushState();
  }

  /** 向浏览器外壳推送标签快照。 */
  private pushState(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const wc = this.win.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.BROWSER_TABS_UPDATED, this.getState());
  }

  /** 给任意 webContents 挂链接打开处理器（拦截 window.open / target=_blank）。 */
  private attachLinkOpenHandler(wc: WebContents): void {
    if (!wc || wc.isDestroyed()) return;
    if (typeof wc.setWindowOpenHandler !== 'function') return; // 测试桩无此方法
    wc.setWindowOpenHandler(({ url }) => {
      this.openUrl(url).catch(() => {});
      return { action: 'deny' };
    });
  }
}

// -------------------- 模块级单例 & 便捷挂载 --------------------

let instance: BrowserWindowManager | null = null;

/** 初始化浏览器窗口管理器（main.ts 装配时调用一次）。 */
export function initBrowserWindowManager(config: ConfigStore): BrowserWindowManager {
  instance = new BrowserWindowManager(config);
  return instance;
}

/** 获取浏览器窗口管理器单例（未初始化返回 null）。 */
export function getBrowserWindowManager(): BrowserWindowManager | null {
  return instance;
}

/**
 * 给对话 view / 标签 view 挂「链接打开处理器」：
 * 拦截 window.open / target=_blank，按「链接打开方式」设置处理
 * （内置 → 浏览器窗口新标签；外部 → 系统默认浏览器）。
 * 所有对话 view（主/副/B 窗口）创建后都应调用。
 */
export function installLinkOpenHandler(wc: WebContents): void {
  if (!wc || wc.isDestroyed()) return;
  if (typeof wc.setWindowOpenHandler !== 'function') return; // 测试桩无此方法
  // 经单例的 openUrl 统一处理：内部按「链接打开方式」配置决定内置新标签 or 系统浏览器
  wc.setWindowOpenHandler(({ url }) => {
    if (instance) {
      instance.openUrl(url).catch(() => {});
    } else {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
}
