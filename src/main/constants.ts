/**
 * 主进程常量（路径、窗口类型、事件名、配置名）。
 * 路径常量集中在此，避免散落各处。CONFIG_PATH 即 PRD 要求的
 * %APPDATA%/DeepSeek/config.json（Windows 上 = userData/config.json，app name = DeepSeek）。
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { WindowType } from '../shared/types';

/** 产品名（同时影响 app name 与 userData 路径）。 */
export const PRODUCT_NAME = 'DeepSeek';

/** 内嵌的 DeepSeek 网页地址。 */
export const DEEPSEEK_URL = 'https://chat.deepseek.com';

/** 自定义标题栏高度（CSS 像素）。WebContentsView 自此高度之下开始布局。 */
export const TITLEBAR_HEIGHT = 40;

/**
 * 配置文件路径。Windows 上等价于 %APPDATA%/DeepSeek/config.json。
 * 使用 try/catch 兜底，防止在 app ready 之前调用 app.getPath 抛出异常导致进程崩溃。
 */
export const CONFIG_PATH: string = (() => {
  try {
    return path.join(app.getPath('userData'), 'config.json');
  } catch (e) {
    const fallback = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'DeepSeek')
      : path.join(process.cwd(), 'DeepSeek');
    return path.join(fallback, 'config.json');
  }
})();

/** 编译后预加载脚本路径（__dirname = dist/main）。 */
export const SHELL_PRELOAD = path.join(__dirname, '..', 'preload', 'shellPreload.js');
export const WEBVIEW_PRELOAD = path.join(__dirname, '..', 'preload', 'webviewPreload.js');
export const SCREEN_SHARE_TASKBAR_PRELOAD = path.join(__dirname, '..', 'preload', 'screenShareTaskbarPreload.js');
/** DeepSeek++ 侧边栏（dspp:// 协议加载 sidepanel.html）专用 preload。 */
export const DSPP_SIDEPANEL_PRELOAD = path.join(__dirname, '..', 'preload', 'dsppSidepanelPreload.js');

/** 外壳渲染资源目录（__dirname = dist/main => dist/renderer/shell）。 */
export const SHELL_DIR = path.join(__dirname, '..', 'renderer', 'shell');
export const TITLEBAR_HTML = path.join(SHELL_DIR, 'titlebar.html');
export const OVERLAY_HTML = path.join(SHELL_DIR, 'overlay.html');
export const TRANSLATE_HTML = path.join(SHELL_DIR, 'translate.html');
export const SETTINGS_HTML = path.join(SHELL_DIR, 'settings.html');
/** 插件管理面板（内嵌于主窗口的 WebContentsView）。 */
export const EXTENSIONS_HTML = path.join(SHELL_DIR, 'extensions.html');
/** 内置插件（DeepSeek++）所在目录：随 copy-assets 复制到 dist/renderer/extensions/deepseek-pp。 */
export const EXTENSIONS_BUILTIN_DIR = path.join(__dirname, '..', 'renderer', 'extensions', 'deepseek-pp');
/** 内置插件展示名（与扩展 manifest 名称一致，locale 解析为 DeepSeek++）。 */
export const EXTENSIONS_BUILTIN_NAME = 'DeepSeek++';
export const BWINDOW_HTML = path.join(SHELL_DIR, 'bwindow.html');
/** 内置浏览器窗口外壳（多标签页标签栏 UI）。 */
export const BROWSER_HTML = path.join(SHELL_DIR, 'browser.html');
/** 更新提醒弹框（覆盖主窗口的透明窗口，发现新版本时弹出）。 */
export const UPDATE_PROMPT_HTML = path.join(SHELL_DIR, 'updatePrompt.html');
/** 共享屏幕模式提示弹框（覆盖主窗口的透明窗口，专家/快速模式限制时弹出）。 */
export const MODE_REMINDER_HTML = path.join(SHELL_DIR, 'modeReminder.html');
/** 首次运行登录引导 / 用户须知（覆盖主窗口的透明窗口，仅首次运行时弹出）。 */
export const FIRST_RUN_HTML = path.join(SHELL_DIR, 'firstRun.html');

/** 图标目录。 */
export const ICON_DIR = path.join(__dirname, '..', 'renderer', 'assets', 'icons');
/** 托盘图标（DeepSeek 官方图标，保持不变）。 */
export const TRAY_ICON = path.join(ICON_DIR, 'icon.ico');
/** 应用图标（窗口标题栏 / 任务栏 / 快捷方式）：白 logo + 蓝底(#5D72F5)圆角矩形。 */
export const APP_ICON = path.join(ICON_DIR, 'deepseek-app-256.png');

/**
 * 托盘图标路径：icon.ico（DeepSeek 官方图标）；缺失时回退 undefined（Electron 用默认，不阻断）。
 * 与窗口/应用图标分离，保证托盘图标始终不变。
 */
export function iconIfExists(): string | undefined {
  try {
    if (fs.existsSync(TRAY_ICON)) return TRAY_ICON;
    return undefined;
  } catch (e) {
    return undefined;
  }
}

/**
 * 窗口（标题栏 / 任务栏 / 快捷方式）应用图标路径：优先 deepseek-app-256.png（白 logo 蓝底圆角矩形，即任务栏新图标），
 * 缺失时回退托盘图标。与托盘分离，二者可各自定制。
 * 说明：Electron nativeImage.createFromPath 在 Windows 原生支持 PNG，任务栏显示新 PNG 图标无需转 .ico。
 */
export function appIconIfExists(): string | undefined {
  try {
    if (fs.existsSync(APP_ICON)) return APP_ICON;
    return TRAY_ICON;
  } catch (e) {
    return undefined;
  }
}

/** 窗口类型枚举（值单一来源）。 */
export const WINDOW_TYPES: WindowType[] = [
  'main',
  'vision',
  'translate',
  'explain',
  'extract',
];

/** 副窗口类型（不含 main）；'sub' 为常驻副窗口（9:16 通用 chat）。 */
export const SUB_WINDOW_TYPES: WindowType[] = [
  'sub',
  'vision',
  'translate',
  'explain',
  'extract',
];

/** 常驻副窗口尺寸：固定 9:16 比例（宽:高 = 9:16），保持原大小不变。
 *  用户反馈"只让我改比例不是改大小"——本轮仅改比例不动尺寸。 */
export const SUB_WINDOW_RATIO = 9 / 16;
export const SUB_WINDOW_WIDTH = 360;
export const SUB_WINDOW_HEIGHT = Math.round(SUB_WINDOW_WIDTH / SUB_WINDOW_RATIO); // 640

/** B 类临时窗口：保持原 7/29 稳定版自带大小（304×540），比例仍是 9:16。
 *  比副窗口略小（304<360），适合截图后选区旁的窄弹窗定位。 */
export const B_WINDOW_WIDTH = 304; // 9:16 比例
export const B_WINDOW_HEIGHT = Math.round(B_WINDOW_WIDTH / SUB_WINDOW_RATIO); // 540

/** 各窗口类型对应的标题。 */
export const WINDOW_TITLES: Record<WindowType, string> = {
  main: 'DeepSeek',
  sub: '副窗口',
  vision: '识图',
  translate: '翻译',
  explain: '解释',
  extract: '提取文字',
};
