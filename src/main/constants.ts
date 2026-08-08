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

/** 外壳渲染资源目录（__dirname = dist/main => dist/renderer/shell）。 */
export const SHELL_DIR = path.join(__dirname, '..', 'renderer', 'shell');
export const TITLEBAR_HTML = path.join(SHELL_DIR, 'titlebar.html');
export const OVERLAY_HTML = path.join(SHELL_DIR, 'overlay.html');
export const TRANSLATE_HTML = path.join(SHELL_DIR, 'translate.html');
export const SETTINGS_HTML = path.join(SHELL_DIR, 'settings.html');
export const BWINDOW_HTML = path.join(SHELL_DIR, 'bwindow.html');
/** 使用说明引导视图（内嵌于主窗口的 WebContentsView）。 */
export const ONBOARDING_HTML = path.join(SHELL_DIR, 'onboarding.html');
/** 更新提醒弹框（覆盖主窗口的透明窗口，发现新版本时弹出）。 */
export const UPDATE_PROMPT_HTML = path.join(SHELL_DIR, 'updatePrompt.html');
/** 共享屏幕模式提示弹框（覆盖主窗口的透明窗口，专家/快速模式限制时弹出）。 */
export const MODE_REMINDER_HTML = path.join(SHELL_DIR, 'modeReminder.html');
/** 首次运行登录引导 / 用户须知（覆盖主窗口的透明窗口，仅首次运行时弹出）。 */
export const FIRST_RUN_HTML = path.join(SHELL_DIR, 'firstRun.html');

/** 图标目录。 */
export const ICON_DIR = path.join(__dirname, '..', 'renderer', 'assets', 'icons');
export const ICON_PNG = path.join(ICON_DIR, 'icon.png');
export const ICON_ICO = path.join(ICON_DIR, 'icon.ico');

/**
 * 若图标存在则返回路径，否则返回 undefined（Electron 将使用默认图标，不阻断启动）。
 * 优先使用 DeepSeek 官方图标 icon.ico；缺失时回退到占位 icon.png（由 copy-assets 生成）。
 * Windows 上 Electron 的 nativeImage.createFromPath 原生支持 .ico。
 */
export function iconIfExists(): string | undefined {
  try {
    if (fs.existsSync(ICON_ICO)) return ICON_ICO;
    if (fs.existsSync(ICON_PNG)) return ICON_PNG;
    return undefined;
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
