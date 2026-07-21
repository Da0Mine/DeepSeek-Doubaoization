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

/** 将 WebContentsView 布局到标题栏下方，铺满剩余区域。 */
export function layoutView(win: BrowserWindow, view: WebContentsView): void {
  const [width, height] = win.getContentSize();
  view.setBounds({
    x: 0,
    y: TITLEBAR_HEIGHT,
    width,
    height: Math.max(0, height - TITLEBAR_HEIGHT),
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
    },
  });
  win.contentView.addChildView(view);
  view.webContents.loadURL(DEEPSEEK_URL);
  layoutView(win, view);
  win.on('resize', () => {
    const v = getView();
    if (v && !v.webContents.isDestroyed()) layoutView(win, v);
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
    width: 1100,
    height: 740,
    minWidth: 480,
    minHeight: 360,
    frame: false,
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

  if (config.get('alwaysOnTop')) {
    win.setAlwaysOnTop(true);
  }

  // 首次加载完成后显示，并以主屏居中。
  win.once('ready-to-show', () => {
    const { width: pw, height: ph } = screen.getPrimaryDisplay().workAreaSize;
    win.setPosition(Math.round((pw - win.getBounds().width) / 2), Math.round((ph - win.getBounds().height) / 2));
    // 首帧补发主题 CSS 变量（修复「broadcaster 晚于首次 applyTheme」导致的白屏）。
    try {
      const theme = new ThemeManager();
      const vars = theme.getCssVars();
      vars['--ds-font-size'] = `${config.get('fontSize')}px`;
      win.webContents.send(IPC.THEME_VARS, vars);
    } catch (e) {
      console.error('[mainWindow] 补发主题变量失败:', e);
    }
    if (!config.get('minimizeToTrayOnStart') || !config.get('trayEnabled')) {
      win.show();
    }
  });

  return { win, view };
}
