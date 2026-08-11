/**
 * 主窗口：自绘标题栏（加载 titlebar.html）+ WebContentsView 内嵌 chat.deepseek.com。
 * 所有窗口共享 session.defaultSession，登录态自动持久化跨启动。
 */
import { BrowserWindow, WebContentsView, nativeTheme, screen } from 'electron';
import {
  DEEPSEEK_URL,
  SHELL_PRELOAD,
  TITLEBAR_HEIGHT,
  TITLEBAR_HTML,
  WEBVIEW_PRELOAD,
  iconIfExists,
} from '../constants';
import { IPC } from '../ipc/channels';
import { ThemeManager } from '../theme/ThemeManager';
import type { ConfigStore } from '../config/ConfigStore';
import { installLinkOpenHandler } from './browserWindow';
import { logf } from '../logger';
import { getLoginItem } from '../loginItem';

/** 依据配置主题 + 系统深浅，计算窗口底色（首帧防白屏）。 */
function resolveBackgroundColor(config: ConfigStore): string {
  const mode = config.get('theme');
  const dark =
    mode === 'dark' ||
    (mode === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#1e1e1e' : '#ffffff';
}

export interface MainWindowResult {
  win: BrowserWindow;
  view: WebContentsView;
}

/** 已创建且持有 chat 视图的窗口集合（display-metrics-changed 时统一重新布局）。 */
const chatWindows = new Map<BrowserWindow, () => WebContentsView | null>();
let displayMetricsListenerAdded = false;

/**
 * 实际设置 WebContentsView 边界（同步核心）。
 * 含防零/防负与销毁守卫：窗口或视图已销毁、或尺寸非法时直接返回，不设置错误 bounds。
 */
function applyViewBounds(win: BrowserWindow, view: WebContentsView, titlebarHeight = TITLEBAR_HEIGHT): void {
  if (win.isDestroyed() || view.webContents.isDestroyed()) return;
  const { width, height } = win.getContentBounds();
  if (width <= 0 || height <= 0) return;
  // 诊断用：仅当项目根目录存在 .debug-autolog（或 DS_DEBUG=1）时才落盘/打印，生产环境无感。
  logf('layout', 'applyViewBounds', { width, height, titlebar: titlebarHeight });
  view.setBounds({
    x: 0,
    y: titlebarHeight,
    width,
    height: Math.max(0, height - titlebarHeight),
  });
}

/** 每个窗口的延迟布局 timer（WeakMap 避免内存泄漏，且窗口销毁后自动回收 key）。 */
const layoutTimers = new WeakMap<BrowserWindow, ReturnType<typeof setTimeout>>();

/**
 * 延迟布局：将实际 setBounds 包在 setTimeout(..., 0) 中，让窗口在 resize / maximize /
 * unmaximize 等事件完成、尺寸稳定后再布局，避免网页拿到错误的 viewport 做响应式布局。
 * 用 WeakMap 保存每个窗口的 timer，多个事件快速触发时只保留最后一次（防抖）。
 */
export function scheduleLayoutView(win: BrowserWindow, view: WebContentsView, titlebarHeight = TITLEBAR_HEIGHT): void {
  if (win.isDestroyed() || view.webContents.isDestroyed()) return;
  const prev = layoutTimers.get(win);
  if (prev !== undefined) clearTimeout(prev);
  const timer = setTimeout(() => {
    layoutTimers.delete(win);
    applyViewBounds(win, view, titlebarHeight);
  }, 0);
  layoutTimers.set(win, timer);
}

/** 将 WebContentsView 布局到标题栏下方，铺满剩余区域（防零/防负 + 延迟防抖）。 */
export function layoutView(win: BrowserWindow, view: WebContentsView, titlebarHeight = TITLEBAR_HEIGHT): void {
  scheduleLayoutView(win, view, titlebarHeight);
}

/** 监听显示器 / DPI 变化，统一重新布局所有已注册窗口的 chat 视图（全局仅注册一次）。 */
function ensureDisplayMetricsListener(): void {
  if (displayMetricsListenerAdded) return;
  displayMetricsListenerAdded = true;
  // 测试环境下 electron 的 screen 可能没有 on（如 bwindow.test 的桩），安全跳过。
  if (typeof screen.on !== 'function') return;
  screen.on('display-metrics-changed', () => {
    for (const [w, getV] of chatWindows) {
      if (w.isDestroyed()) {
        chatWindows.delete(w);
        continue;
      }
      const v = getV();
      if (v && !v.webContents.isDestroyed()) scheduleLayoutView(w, v);
    }
  });
}

/**
 * 窗口显示（show）时自动聚焦聊天输入框，实现「打开窗口即可直接输入」。
 * 主窗口 / 副窗口 / B 窗口共用。
 *
 * 可靠性设计：
 *  - 挂在 win.on('show') 上：首次显示与再次显示（托盘唤出 / 截图重开）都会触发。
 *  - 注入脚本内部轮询最长约 6 秒：SPA 的 chat DOM 加载有延迟，窗口先显示、输入框后出现也能补上。
 *  - 若 executeJavaScript 直接失败（页面尚未建立 JS 上下文，如首次启动加载中），
 *    等 did-finish-load 后再注入一次；已销毁则放弃。
 */
export function focusChatInputOnShow(wc: Electron.WebContents): void {
  if (!wc || wc.isDestroyed()) return;
  // 关键：先把键盘焦点给 chat 视图本身（WebContentsView 架构下，窗口 focus 时焦点
  // 默认落在外壳标题栏 webContents；不 focus 视图则输入框的 DOM focus 无效——无光标、
  // 按键无响应）。主副切换重建的视图是全新 webContents，从未获得过焦点，必须显式 focus。
  try {
    wc.focus();
  } catch {
    /* 忽略 */
  }
  const code = `(() => {
    try {
      // 优先 DeepSeek 聊天输入框（aria-label/placeholder 含「发送消息」）；
      // 回退：按「附近按钮最多的候选」定位聊天输入框，避免页面底部搜索框抢注通用 textarea。
      function findChatInput() {
        var sp = document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], [contenteditable][aria-label*="发送消息"]');
        if (sp) return sp;
        var cands = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
        var best = null, bestN = -1;
        for (var ci = 0; ci < cands.length; ci++) {
          var el = cands[ci];
          var p = el.parentElement, chain = [];
          for (var i = 0; i < 6 && p; i++) { chain.push(p); p = p.parentElement; }
          var maxN = -1;
          for (var j = 0; j < chain.length; j++) {
            var n = chain[j].querySelectorAll('button').length;
            if (n > maxN) maxN = n;
          }
          if (maxN > bestN) { bestN = maxN; best = el; }
        }
        return best;
      }
      function tryFocus(t) {
        if (t <= 0) return;
        var el = findChatInput();
        if (el) {
          try { el.focus(); } catch (e) {}
          try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
          return;
        }
        setTimeout(function () { tryFocus(t - 1); }, 300);
      }
      tryFocus(20);
    } catch (e) {}
  })()`;
  wc.executeJavaScript(code).catch(() => {
    // 页面尚未建立 JS 上下文（首次启动加载中）：等加载完成后再聚焦一次。
    wc.once('did-finish-load', () => {
      if (wc.isDestroyed()) return;
      wc.executeJavaScript(code).catch(() => {});
    });
  });
}

/**
 * 创建内嵌 chat.deepseek.com 的 WebContentsView 并挂到指定窗口。
 * getView 在窗口 resize 时读取「当前」视图引用——主副切换（swapMainSub）会以
 * 「原地重建视图」的方式迁移对话，此时 entry.view 已被替换；用闭包持有旧 view 会在
 * resize 时布局一个已销毁的视图。改为读取 getView() 始终拿到最新视图。
 */
export function createChatView(win: BrowserWindow, getView: () => WebContentsView | null): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: WEBVIEW_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.contentView.addChildView(view);
  view.webContents.loadURL(DEEPSEEK_URL);
  layoutView(win, view);
  // 页面完整加载后聚焦输入框（show 聚焦是快速路径；若 show 发生在页面加载中，
  // 注入脚本的 setTimeout 会随导航销毁，did-finish-load 兜底可靠聚焦）。
  view.webContents.on('did-finish-load', () => {
    if (!view.webContents.isDestroyed()) focusChatInputOnShow(view.webContents);
  });
  // 链接打开方式（内置浏览器窗口 / 系统默认浏览器）
  installLinkOpenHandler(view.webContents);

  // 注册该窗口，供 DPI / 显示器变化时统一重新布局。
  chatWindows.set(win, getView);
  ensureDisplayMetricsListener();
  // 清理：窗口真正销毁时才从集合移除；仅视图销毁（如 swapMainSub 原地重建）则保留，
  // 因为 getView 仍会返回新的当前视图。
  const cleanupRegistry = (): void => {
    if (win.isDestroyed()) chatWindows.delete(win);
  };
  view.webContents.once('destroyed', cleanupRegistry);
  win.once('closed', cleanupRegistry);

  // 窗口状态变化（resize/maximize/unmaximize/full-screen/show）后重新布局。
  // 所有监听器内部都通过 getView() 取「当前」视图，不闭包捕获旧 view
  // （swapMainSub 会原地重建视图，旧 view 已销毁）。
  const relayout = (): void => {
    const v = getView();
    if (v && !v.webContents.isDestroyed()) scheduleLayoutView(win, v);
  };
  win.on('resize', relayout);
  win.on('resized', relayout);
  win.on('maximize', relayout);
  win.on('unmaximize', relayout);
  win.on('enter-full-screen', relayout);
  win.on('leave-full-screen', relayout);
  win.on('show', relayout);
  // 打开窗口即可直接输入：show 时聚焦聊天输入框（主窗口 / 副窗口共用本视图创建逻辑）。
  // 用 getView() 取「当前」视图（主副切换会原地重建视图，闭包捕获的旧 view 已销毁）。
  win.on('show', () => {
    const v = getView();
    if (v && !v.webContents.isDestroyed()) focusChatInputOnShow(v.webContents);
  });
  return view;
}

/** 创建主窗口（标题栏 + 内嵌网页）。
 * @param opts.isQuitting 外部退出守卫：返回 true 时（应用正在退出）不拦截 close，允许真正关闭。
 * @param getView resize 时回读「当前」视图引用（供主副切换重建视图后正确布局）。
 */
export function createMainWindow(
  config: ConfigStore,
  opts?: { isQuitting?: () => boolean },
  getView?: () => WebContentsView | null
): MainWindowResult {
  const win = new BrowserWindow({
    width: 1280,
    height: 770,
    minWidth: 480,
    minHeight: 360,
    autoHideMenuBar: true,
    frame: false,
    titleBarOverlay: false,
    title: 'DeepSeek',
    backgroundColor: resolveBackgroundColor(config),
    show: false,
    icon: iconIfExists(),
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: ['--window-type=main'],
    },
  });

  win.loadFile(TITLEBAR_HTML);

  const view = createChatView(win, getView ?? (() => null));
  layoutView(win, view);

  // 关闭行为：closeToTray 且非真正退出时隐藏（由托盘退出）；正在退出则放行 close。
  const isQuitting = () => (opts?.isQuitting ? opts.isQuitting() : false);
  win.on('close', (e: Electron.Event) => {
    if (config.get('closeToTray') && !isQuitting()) {
      e.preventDefault();
      if (!win.isDestroyed()) win.hide();
    }
  });

  // 首次加载完成后显示，并以主屏居中。
  win.once('ready-to-show', () => {
    const { width: pw, height: ph } = screen.getPrimaryDisplay().workAreaSize;
    win.setPosition(Math.round((pw - win.getBounds().width) / 2), Math.round((ph - win.getBounds().height) / 2));
    // 首帧补发主题 CSS 变量（修复「broadcaster 晚于首次 applyTheme」导致的白屏）。
    try {
      const theme = new ThemeManager();
      const vars = theme.getCssVars();
      vars['--ds-font-size'] = `${15 + (config.get('fontSize') || 0)}px`;
      win.webContents.send(IPC.THEME_VARS, vars);
    } catch (e) {
      console.error('[mainWindow] 补发主题变量失败:', e);
    }
    // 开机自启（startAtLogin）时始终最小化到托盘，不显示主界面；
    // 手动启动时按 minimizeToTrayOnStart 设置决定是否显示。
    // 注意：托盘禁用时（trayEnabled=false）无法最小化到托盘，开机自启也正常显示窗口。
    if (getLoginItem().wasOpenedAtLogin && config.get('trayEnabled')) {
      // 开机自启且托盘启用：不显示主窗口，直接最小化到托盘
      // 不执行 win.show()
    } else if (!config.get('minimizeToTrayOnStart') || !config.get('trayEnabled')) {
      win.show();
    }
    // 窗口真正显示并居中后，立即刷新视图边界（确保拿到稳定后的 viewport 尺寸）。
    if (!win.isDestroyed()) layoutView(win, view);
  });

  return { win, view };
}
