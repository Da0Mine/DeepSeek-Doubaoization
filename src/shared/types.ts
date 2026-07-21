/**
 * 共享类型定义（主进程 / 预加载脚本 / 外壳渲染层 共用）。
 * 作为类型单一来源，避免跨模块类型漂移。
 */

/** 窗口类型枚举（单一来源：constants.ts 仅作值导出，此处为类型定义）。 */
export type WindowType = 'main' | 'sub' | 'vision' | 'translate' | 'explain' | 'extract';

/** 默认新建对话的模型模式。 */
export type DefaultModelMode = 'simple' | 'expert' | 'vision';

/** 主题模式。 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 用户在遮罩上选择截图后提交的动作。 */
export type ScreenshotAction =
  | 'chat'
  | 'extract'
  | 'translate'
  | 'explain'
  | 'clipboard'
  | 'sendCurrent'
  | 'sendNew';

/**
 * 标注对象（一笔/一个形状为一项，撤销按对象栈）。
 * 坐标均为相对截图图片的 CSS 像素。
 */
export interface Annotation {
  tool: 'pen' | 'rect' | 'ellipse';
  color: string;
  /** pen：折点序列。 */
  points?: { x: number; y: number }[];
  /** rect / ellipse：包围盒。 */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** 截图遮罩状态机。 */
export type OverlayState =
  | 'idle'
  | 'selecting'
  | 'selected'
  | 'annotating'
  | 'actionChosen';

/** 窗口角色标签：主窗口为 'main'，副窗口为 'sub'。 */
export type SubWindowRole = 'main' | 'sub';

/** 完整的配置形状（22 项）。ConfigStore 的默认值必须完整覆盖。 */
export interface ConfigShape {
  globalToggleShortcut: string;
  screenshotShortcut: string;
  theme: ThemeMode;
  closeToTray: boolean;
  trayEnabled: boolean;
  startAtLogin: boolean;
  minimizeToTrayOnStart: boolean;
  deepThinkEnabled: boolean;
  /** 新建对话/窗口就绪时是否自动开启「智能搜索」（联网搜索）。默认开启。 */
  smartSearchEnabled: boolean;
  alwaysOnTop: boolean;
  fontSize: number;
  visionPromptTemplate: string;
  extractTextPromptTemplate: string;
  translatePromptTemplate: string;
  explainPromptTemplate: string;
  proxyEnabled: boolean;
  proxyUrl: string;
  notificationEnabled: boolean;
  /** 一键呼出/聚焦副窗口的全局快捷键（默认 "Alt+Q"）。 */
  subWindowShortcut: string;
  /** 默认新建对话的模型模式（simple=简单，expert=专家/深度思考，vision=识图）。 */
  defaultModelMode: DefaultModelMode;
  /** 标注画笔色板（设置面板可编辑）。 */
  annotationColors: string[];
  /** 默认折叠模型的思考过程（深度思考/思维链），true=折叠，false=展开。 */
  collapseThinking: boolean;
}

/** 配置键。 */
export type ConfigKey = keyof ConfigShape;

/** 截图选区（屏幕坐标，CSS 像素）。 */
export interface ScreenshotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 登录态回报负载（webviewPreload -> 主进程 -> 外壳）。 */
export interface LoginStatusPayload {
  loggedIn: boolean;
  url: string;
}

/** 翻译同步负载（翻译窗口 -> 主进程 / 主进程 -> 翻译窗口）。 */
export interface TranslateSyncPayload {
  sourceLang: string;
  targetLang: string;
  text: string;
  translated: string;
}

/**
 * IPC 事件映射（文档用途）：
 * - 方向：renderer->main 使用 ipcRenderer.send/invoke；main->renderer 使用 webContents.send。
 * - 通道名字符串见 src/main/ipc/channels.ts（唯一真实来源）。
 */
export interface IPCEventMap {
  'win:toggle': void;
  'win:min': void;
  'win:max': void;
  'win:close': void;
  'win:alwaysOnTop': void;
  'screenshot:start': void;
  'screenshot:action': { action: ScreenshotAction; rect: ScreenshotRect; annotations?: Annotation[] };
  'config:get': { key: ConfigKey };
  'config:set': { key: ConfigKey; value: unknown };
  'config:reset': void;
  'theme:apply': { mode: ThemeMode };
  'theme:vars': Record<string, string>;
  'translate:sync': TranslateSyncPayload;
  'translate:result': TranslateSyncPayload;
  'login:status': LoginStatusPayload;
  'login:detect': LoginStatusPayload;
  'app:notify': { title: string; body: string };
  // ---- 增量通道 ----
  'settings:open': void;
  'sub:summon': void;
  'sub:swap': void;
  'scissors:trigger': void;
  'overlay:select': ScreenshotRect;
  'overlay:setImage': string; // 截图裁剪后的 PNG dataURL
  'overlay:setColor': { color: string };
  'overlay:setTool': { tool: 'pen' | 'rect' | 'ellipse' };
  'overlay:undo': void;
  'overlay:clear': void;
  'overlay:compose': { annotations: Annotation[] }; // main -> overlay 请求合成
  'overlay:compose-result': string; // 合成后的 PNG dataURL
}

/** 主题 CSS 变量集合。 */
export type ThemeVars = Record<string, string>;
