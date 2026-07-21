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
  ScreenshotAction,
  ScreenshotRect,
  ThemeMode,
  ThemeVars,
  TranslateSyncPayload,
} from '../shared/types';

/** 从 additionalArguments 读取窗口类型（主进程以 --window-type=xxx 传入）。 */
function getWindowType(): string {
  const arg = process.argv.find((a) => a.startsWith('--window-type='));
  return arg ? arg.split('=')[1] : 'unknown';
}

const shellApi = {
  windowType: getWindowType(),

  minimize: (): void => ipcRenderer.send(IPC.WIN_MIN),
  toggleMax: (): void => ipcRenderer.send(IPC.WIN_MAX),
  close: (): void => ipcRenderer.send(IPC.WIN_CLOSE),
  toggleMainWindow: (): void => ipcRenderer.send(IPC.WIN_TOGGLE),

  getConfig: <K extends ConfigKey>(key: K): Promise<ConfigShape[K]> =>
    ipcRenderer.invoke(IPC.CONFIG_GET, { key }),
  setConfig: <K extends ConfigKey>(key: K, value: ConfigShape[K]): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CONFIG_SET, { key, value }),
  resetConfig: (): Promise<boolean> => ipcRenderer.invoke(IPC.CONFIG_RESET),

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
  summonSub: (): void => ipcRenderer.send(IPC.SUB_SUMMON),
  swapMainSub: (): void => ipcRenderer.send(IPC.SUB_SWAP),
  alwaysOnTop: (): void => ipcRenderer.send(IPC.WIN_ALWAYS_ON_TOP),

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
};

contextBridge.exposeInMainWorld('shell', shellApi);

// 声明全局类型（供外壳 JS 使用）
declare global {
  interface Window {
    shell: typeof shellApi;
  }
}
