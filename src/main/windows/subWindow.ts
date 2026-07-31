/**
 * 副窗口工厂：识图 / 翻译 / 解释 / 提取文字。
 * - vision / explain / extract：复用标题栏 + WebContentsView 内嵌 chat（共享 session）。
 * - translate：加载 translate.html（纯 UI，经 IPC 把翻译请求发往主对话窗口）。
 * 所有窗口均使用自绘标题栏（frame: false，customTitleBar 配置已移除，固定为自绘）。
 */
import { BrowserWindow, WebContentsView, nativeTheme } from 'electron';
import {
  SHELL_PRELOAD,
  TITLEBAR_HTML,
  TRANSLATE_HTML,
  WINDOW_TITLES,
  SUB_WINDOW_WIDTH,
  SUB_WINDOW_HEIGHT,
  SUB_WINDOW_RATIO,
  iconIfExists,
} from '../constants';
import { IPC } from '../ipc/channels';
import { ThemeManager } from '../theme/ThemeManager';
import type { ConfigStore } from '../config/ConfigStore';
import type { WindowType } from '../../shared/types';
import { layoutView, createChatView } from './mainWindow';
import { injectBWindowScrollFix, scheduleBWindowAutoSize } from './bWindow';

export interface SubWindowResult {
  win: BrowserWindow;
  view: WebContentsView | null;
  type: WindowType;
}

/** 计算窗口底色（首帧防白屏）。 */
function resolveBackgroundColor(config: ConfigStore): string {
  const mode = config.get('theme');
  const dark = mode === 'dark' || (mode === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#1e1e1e' : '#ffffff';
}

/**
 * 创建副窗口。
 * - translate：独立翻译 UI（保持原尺寸）。
 * - 其余类型（sub/vision/explain/extract）：统一 9:16 常驻 chat 窗口，内嵌 chat.deepseek.com（共享 session）。
 */
export function createSubWindow(
  type: WindowType,
  config: ConfigStore,
  opts?: { isQuitting?: () => boolean },
  getView?: () => WebContentsView | null,
  showOnReady = true
): SubWindowResult {
  const isTranslate = type === 'translate';
  const isChat = !isTranslate;
  const win = new BrowserWindow({
    width: isTranslate ? 720 : SUB_WINDOW_WIDTH,
    height: isTranslate ? 560 : SUB_WINDOW_HEIGHT,
    minWidth: isTranslate ? 420 : 300,
    minHeight: isTranslate ? 320 : Math.round(300 / SUB_WINDOW_RATIO),
    frame: false,
    title: WINDOW_TITLES[type],
    backgroundColor: resolveBackgroundColor(config),
    show: false,
    icon: iconIfExists(),
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--window-type=${type}`],
    },
  });

  if (isTranslate) {
    win.loadFile(TRANSLATE_HTML);
  } else {
    win.loadFile(TITLEBAR_HTML);
  }

  let view: WebContentsView | null = null;
  if (!isTranslate) {
    view = createChatView(win, getView ?? (() => null));
    // 备注：B/vision 窗口的视觉切换由 Injector 在页面注入时完成（switchToVisionModel），
    // 此处不再根据 autoStartVisionModel 配置做判断（该配置项已移除）。

    // 副窗口去留白（复用 B 窗口的两层修复）：层1 完整页面滚动 + 层2 按输入框底部收紧窗口高度
    // 解决"副窗口底部留白"问题（用户反馈：输入框下方有灰色 AI 提示 + 空白未消除）。
    const injectScrollFix = (): void => {
      if (view && !view.webContents.isDestroyed()) injectBWindowScrollFix(view.webContents);
    };
    injectScrollFix();
    view.webContents.on('did-finish-load', injectScrollFix);
    view.webContents.on('did-navigate-in-page', () => {
      // SPA 内部路由可能重建布局，延迟一点再修（等 DOM 稳定）
      setTimeout(injectScrollFix, 500);
    });
    scheduleBWindowAutoSize(win, view);
  }

  // 关闭行为：closeToTray 且非真正退出时隐藏；正在退出则放行 close。
  const isQuitting = () => (opts?.isQuitting ? opts.isQuitting() : false);
  win.on('close', (e: Electron.Event) => {
    if (config.get('closeToTray') && !isQuitting()) {
      e.preventDefault();
      if (!win.isDestroyed()) win.hide();
    }
  });

  if (config.get('alwaysOnTop') || type === 'vision') {
    win.setAlwaysOnTop(true);
  }

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      // 首帧补发主题 CSS 变量，确保外壳标题栏立即正确配色。
      try {
        const theme = new ThemeManager();
        const vars = theme.getCssVars();
        vars['--ds-font-size'] = `${config.get('fontSize')}px`;
        win.webContents.send(IPC.THEME_VARS, vars);
      } catch (e) {
        console.error('[subWindow] 补发主题变量失败:', e);
      }
      // showOnReady=false 时（如「截图发送到新对话」）由调用方等页面真正就绪后再 revealWindow，
      // 避免窗口提前显示却仍是空白（白屏）。
      if (showOnReady) win.show();
    }
  });

  return { win, view, type };
}
