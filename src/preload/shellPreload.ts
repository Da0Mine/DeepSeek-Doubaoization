/**
 * 外壳窗口预加载脚本（标题栏 / 遮罩 / 翻译 UI 桥接）。
 * 通过 contextBridge 暴露 window.shell，供原生 JS（titlebar.js / overlay.js / translate.js）调用。
 * 所有通道名来自 channels.ts，与主进程对称。
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../main/ipc/channels';
import type {
  Annotation,
  ConfigKey,
  ConfigShape,
  LoginStatusPayload,
  OnboardingFocus,
  ScreenshotAction,
  ScreenshotRect,
  ThemeMode,
  ThemeVars,
  TranslateSyncPayload,
  UpdateDownloadProgress,
  UpdateDownloadResult,
  UpdateInfo,
  UpdatePromptInfo,
} from '../shared/types';

/** 从 additionalArguments 读取窗口类型（主进程以 --window-type=xxx 传入）。 */
function getWindowType(): string {
  const arg = process.argv.find((a) => a.startsWith('--window-type='));
  return arg ? arg.split('=')[1] : 'unknown';
}

/** 从 additionalArguments 读取截图模式（仅 overlay 窗口使用）。 */
function getScreenshotMode(): string {
  const arg = process.argv.find((a) => a.startsWith('--screenshot-mode='));
  return arg ? arg.split('=')[1] : 'normal';
}

const shellApi = {
  windowType: getWindowType(),
  screenshotMode: getScreenshotMode(),

  minimize: (): void => ipcRenderer.send(IPC.WIN_MIN),
  toggleMax: (): void => ipcRenderer.send(IPC.WIN_MAX),
  close: (): void => ipcRenderer.send(IPC.WIN_CLOSE),
  toggleMainWindow: (): void => ipcRenderer.send(IPC.WIN_TOGGLE),

  getConfig: <K extends ConfigKey>(key: K): Promise<ConfigShape[K]> =>
    ipcRenderer.invoke(IPC.CONFIG_GET, { key }),
  setConfig: <K extends ConfigKey>(key: K, value: ConfigShape[K]): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CONFIG_SET, { key, value }),
  resetConfig: (): Promise<boolean> => ipcRenderer.invoke(IPC.CONFIG_RESET),
  resetKeys: (keys: ConfigKey[]): Promise<boolean> => ipcRenderer.invoke(IPC.CONFIG_RESET_KEYS, { keys }),

  applyTheme: (mode: ThemeMode): void => ipcRenderer.send(IPC.THEME_APPLY, { mode }),
  requestThemeVars: (): Promise<ThemeVars> => ipcRenderer.invoke(IPC.THEME_VARS_REQUEST),

  startScreenshot: (): void => ipcRenderer.send(IPC.SCREENSHOT_START),
  screenshotAction: (
    action: ScreenshotAction,
    rect: ScreenshotRect,
    annotations?: Annotation[]
  ): void => ipcRenderer.send(IPC.SCREENSHOT_ACTION, { action, rect, annotations }),

  // ---- 增量：设置 / 副窗口 / 置顶 ----
  openSettings: (): void => ipcRenderer.send(IPC.SETTINGS_OPEN),
  closeSettings: (): void => ipcRenderer.send(IPC.SETTINGS_CLOSE),
  summonSub: (): void => ipcRenderer.send(IPC.SUB_SUMMON),
  swapMainSub: (): void => ipcRenderer.send(IPC.SUB_SWAP),
  alwaysOnTop: (): void => ipcRenderer.send(IPC.WIN_ALWAYS_ON_TOP),
  isAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke(IPC.WIN_IS_ALWAYS_ON_TOP),
  onAlwaysOnTop: (cb: (pinned: boolean) => void): void => {
    ipcRenderer.on(IPC.WIN_ALWAYS_ON_TOP_STATE, (_e, pinned: boolean) => cb(pinned));
  },

  // ---- 增量：截图遮罩桥 ----
  overlaySelect: (rect: ScreenshotRect): void => ipcRenderer.send(IPC.OVERLAY_SELECT, rect),
  overlaySetColor: (color: string): void => ipcRenderer.send(IPC.OVERLAY_SET_COLOR, { color }),
  overlaySetTool: (tool: 'pen' | 'rect' | 'ellipse'): void =>
    ipcRenderer.send(IPC.OVERLAY_SET_TOOL, { tool }),
  overlayUndo: (): void => ipcRenderer.send(IPC.OVERLAY_UNDO),
  overlayClear: (): void => ipcRenderer.send(IPC.OVERLAY_CLEAR),
  /** 渲染（overlay）-> 主：渲染进程就绪（监听器已注册），请求主进程下发截图背景图。 */
  overlayReady: (): void => ipcRenderer.send(IPC.OVERLAY_READY),

  translateSync: (payload: TranslateSyncPayload): void => ipcRenderer.send(IPC.TRANSLATE_SYNC, payload),

  notify: (title: string, body: string): void => ipcRenderer.send(IPC.NOTIFY, { title, body }),

  // ---- 主 -> 渲染 订阅 ----
  onThemeVars: (cb: (vars: ThemeVars) => void): void => {
    ipcRenderer.on(IPC.THEME_VARS, (_e, vars: ThemeVars) => cb(vars));
  },
  onLoginStatus: (cb: (payload: LoginStatusPayload) => void): void => {
    ipcRenderer.on(IPC.LOGIN_STATUS, (_e, payload: LoginStatusPayload) => cb(payload));
  },
  onTranslateResult: (cb: (payload: TranslateSyncPayload) => void): void => {
    ipcRenderer.on(IPC.TRANSLATE_RESULT, (_e, payload: TranslateSyncPayload) => cb(payload));
  },
  /** 主 -> 渲染：设置翻译语言并显示语言栏（B 窗口翻译用）。 */
  onTranslateSetLang: (cb: (lang: string) => void): void => {
    ipcRenderer.on(IPC.TRANSLATE_SET_LANG, (_e, lang: string) => cb(lang));
  },
  /** 渲染 -> 主：用户切换翻译语言，请求重新翻译（B 窗口翻译用）。 */
  changeTranslateLang: (lang: string): void => {
    ipcRenderer.send(IPC.TRANSLATE_CHANGE_LANG, { lang });
  },
  onOverlayImage: (cb: (dataUrl: string) => void): void => {
    ipcRenderer.on(IPC.OVERLAY_SET_IMAGE, (_e, dataUrl: string) => cb(dataUrl));
  },
  onSetColor: (cb: (color: string) => void): void => {
    ipcRenderer.on(IPC.OVERLAY_SET_COLOR, (_e, { color }: { color: string }) => cb(color));
  },
  onSetTool: (cb: (tool: 'pen' | 'rect' | 'ellipse') => void): void => {
    ipcRenderer.on(IPC.OVERLAY_SET_TOOL, (_e, { tool }: { tool: 'pen' | 'rect' | 'ellipse' }) => cb(tool));
  },
  onUndo: (cb: () => void): void => {
    ipcRenderer.on(IPC.OVERLAY_UNDO, () => cb());
  },
  onClear: (cb: () => void): void => {
    ipcRenderer.on(IPC.OVERLAY_CLEAR, () => cb());
  },
  onCompose: (cb: (annotations: Annotation[]) => string): void => {
    ipcRenderer.on(IPC.OVERLAY_COMPOSE, async (_e, { annotations }: { annotations: Annotation[] }) => {
      const result = cb(annotations);
      ipcRenderer.send(IPC.OVERLAY_COMPOSE_RESULT, result);
    });
  },

  // ---- 主 -> 渲染（overlay）：全屏截图背景图（修复全屏应用黑屏） ----
  onOverlayBackgroundImage: (cb: (dataUrl: string) => void): void => {
    ipcRenderer.on(IPC.OVERLAY_SET_BACKGROUND_IMAGE, (_e, dataUrl: string) => cb(dataUrl));
  },

  // ---- 通用 IPC 发送（划词工具栏等场景使用） ----
  send: (channel: string, ...args: unknown[]): void => {
    ipcRenderer.send(channel, ...args);
  },
  // ---- 通用 IPC invoke（设置面板 action 按钮等场景使用） ----
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    return ipcRenderer.invoke(channel, ...args);
  },

  // ---- 划词工具栏（窗口复用后动态更新内容） ----
  onToolbarUpdate: (cb: (p: { buttons: { label: string; prompt: string }[]; text: string }) => void): void => {
    ipcRenderer.on(IPC.TOOLBAR_UPDATE, (_e, p) => cb(p));
  },

  // ---- 更新 ----
  /** 检查更新（force=true 时忽略缓存，强制请求 GitHub）。 */
  checkUpdate: (force?: boolean): Promise<UpdateInfo> =>
    ipcRenderer.invoke(IPC.UPDATE_CHECK, { force: !!force }),
  /** 在默认浏览器打开 GitHub Release 页面。 */
  openReleases: (): Promise<boolean> => ipcRenderer.invoke(IPC.UPDATE_OPEN_RELEASES),
  /** 下载最新安装包（加速链接优先），进度经 onUpdateDownloadProgress 推送，完成后返回本地路径。 */
  downloadUpdate: (): Promise<UpdateDownloadResult> => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
  /** 唤起本地安装程序（打开安装包路径）。 */
  launchInstaller: (p: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.UPDATE_LAUNCH, { path: p }),
  /** 主 -> 渲染：订阅下载进度。 */
  onUpdateDownloadProgress: (cb: (p: UpdateDownloadProgress) => void): void => {
    ipcRenderer.on(IPC.UPDATE_DOWNLOAD_PROGRESS, (_e, p: UpdateDownloadProgress) => cb(p));
  },
  /** 主 -> 更新弹框：订阅版本信息下发。 */
  onUpdatePromptInfo: (cb: (info: UpdatePromptInfo) => void): void => {
    ipcRenderer.on(IPC.UPDATE_PROMPT_INFO, (_e, info: UpdatePromptInfo) => cb(info));
  },
  /** 主 -> 模式提示弹框：订阅提示类型下发（payload: { type: 'expert' | 'simple' }）。 */
  onModeReminderInfo: (cb: (info: { type: 'expert' | 'simple' }) => void): void => {
    ipcRenderer.on(IPC.MODE_REMINDER_INFO, (_e, info: { type: 'expert' | 'simple' }) => cb(info));
  },

  // ---- 使用说明引导 ----
  /** 打开使用说明引导（首次运行自动触发；设置面板手动打开）。 */
  openOnboarding: (): void => ipcRenderer.send(IPC.ONBOARDING_OPEN),
  /** 设置说明书 -> 主：打开副窗口并把说明书 Markdown 提交到快速模式对话并发送。 */
  askAiWithManual: (md: string): void => ipcRenderer.send(IPC.MANUAL_ASK_AI, md),
  /** 引导视图 -> 主：鼠标是否位于交互控件（说明卡片）内，用于切换点击穿透。 */
  setOnboardingInteractive: (interactive: boolean): void => {
    ipcRenderer.send(IPC.ONBOARDING_SET_INTERACTIVE, interactive);
  },
  // ---- 主 -> 引导视图：订阅步骤数据下发 ----
  onOnboardingFocus: (cb: (p: OnboardingFocus) => void): void => {
    ipcRenderer.on(IPC.ONBOARDING_FOCUS, (_e, p: OnboardingFocus) => cb(p));
  },

  // ---- 内置浏览器窗口（多标签） ----
  /** 浏览器外壳 -> 主（invoke）：请求当前标签快照。 */
  getBrowserState: (): Promise<unknown> => ipcRenderer.invoke(IPC.BROWSER_GET_STATE),
  /** 浏览器外壳 -> 主：切换标签。 */
  switchBrowserTab: (id: number): void => ipcRenderer.send(IPC.BROWSER_SWITCH_TAB, { id }),
  /** 浏览器外壳 -> 主：关闭标签。 */
  closeBrowserTab: (id: number): void => ipcRenderer.send(IPC.BROWSER_CLOSE_TAB, { id }),
  /** 浏览器外壳 -> 主：关闭整个浏览器窗口。 */
  closeBrowserWindow: (): void => ipcRenderer.send(IPC.BROWSER_CLOSE),
  /** 浏览器外壳 -> 主：新建标签页。 */
  newBrowserTab: (url?: string): void => ipcRenderer.send(IPC.BROWSER_NEW_TAB, { url }),
  /** 主 -> 浏览器外壳：订阅标签列表快照更新。 */
  onBrowserTabsUpdated: (cb: (state: unknown) => void): void => {
    ipcRenderer.on(IPC.BROWSER_TABS_UPDATED, (_e, state: unknown) => cb(state));
  },
};

contextBridge.exposeInMainWorld('shell', shellApi);

// 声明全局类型（供外壳 JS 使用）
declare global {
  interface Window {
    shell: typeof shellApi;
  }
}
