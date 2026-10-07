/**
 * 共享类型定义（主进程 / 预加载脚本 / 外壳渲染层 共用）。
 * 作为类型单一来源，避免跨模块类型漂移。
 */

/** 窗口类型枚举（单一来源：constants.ts 仅作值导出，此处为类型定义）。 */
export type WindowType = 'main' | 'sub' | 'vision' | 'translate' | 'explain' | 'extract';

/** 主题模式。 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 链接打开方式：internal=内置浏览器窗口（多标签），external=系统默认浏览器。 */
export type LinkOpenMode = 'internal' | 'external';

/** 副窗口关闭后重新打开时重置为新对话：never=永不，open=每次打开，15/30/60=关闭超过对应分钟才重置。 */
export type SubWindowResetNewMode = 'never' | 'open' | '15' | '30' | '60';

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

/** 完整的配置形状（23 项）。ConfigStore 的默认值必须完整覆盖。 */
export interface ConfigShape {
  globalToggleShortcut: string;
  /** 一键唤起截图的全局快捷键（默认 "Alt+C"，即 左Alt+C）。 */
  screenshotShortcut: string;
  theme: ThemeMode;
  closeToTray: boolean;
  trayEnabled: boolean;
  startAtLogin: boolean;
  minimizeToTrayOnStart: boolean;
  /** 链接打开方式：internal=内置浏览器窗口（多标签），external=系统默认浏览器。默认内置。 */
  linkOpenMode: LinkOpenMode;
  /** 截图时保留应用窗口（默认关闭：截图前自动隐藏应用窗口，避免被截进图里）。 */
  keepWindowsOnScreenshot: boolean;
  deepThinkEnabled: boolean;
  /** 新建对话/窗口就绪时是否自动开启「智能搜索」（联网搜索）。默认开启。 */
  smartSearchEnabled: boolean;
  /** 副窗口和 B 类窗口默认置顶（主窗口不参与）。默认开启。 */
  alwaysOnTop: boolean;
  /** 副窗口关闭后重新打开时重置为新对话：never=永不，open=每次打开，15/30/60=关闭超过对应分钟才重置。默认 never。 */
  subWindowResetNew: SubWindowResetNewMode;
  /** 全局字号相对偏移量（-10 ~ +10，0=默认）。旧版为绝对 px 值，新版为相对偏移。 */
  fontSize: number;
  /** 主窗口专属字号偏移（在全局 fontSize 之上叠加，-10 ~ +10，0=跟随全局）。 */
  fontSizeMain: number;
  /** 设置界面专属字号偏移（在全局 fontSize 之上叠加，-10 ~ +10，0=跟随全局）。 */
  fontSizeSettings: number;
  /** 副窗口专属字号偏移（含识图/翻译/解释/提取等常驻副窗口，在全局 fontSize 之上叠加，-10 ~ +10）。 */
  fontSizeSub: number;
  /** B 类临时窗口专属字号偏移（在全局 fontSize 之上叠加，-10 ~ +10）。 */
  fontSizeB: number;
  visionPromptTemplate: string;
  extractTextPromptTemplate: string;
  translatePromptTemplate: string;
  explainPromptTemplate: string;
  proxyEnabled: boolean;
  proxyUrl: string;
  notificationEnabled: boolean;
  /** 截图类反馈通知（截图成功复制、截图失败等）。默认开启。 */
  notificationScreenshot: boolean;
  /** 操作类反馈通知（上传/翻译失败、没有对话窗口、创建副窗口失败等）。默认开启。 */
  notificationOperation: boolean;
  /** 划词类反馈通知（划词失败等）。默认开启。 */
  notificationTextSelection: boolean;
  /** 快捷键类提示（注册失败/被系统占用）。默认开启。 */
  notificationShortcut: boolean;
  /** 回答完成提醒：AI 回答完成时若窗口在后台或已切到其他会话，弹通知并可点击跳回。默认开启。 */
  notificationReplyDone: boolean;
  /** 一键呼出/聚焦副窗口的全局快捷键（默认 "Alt+Space"，即 左Alt+空格）。 */
  subWindowShortcut: string;
  /** 一键开关屏幕共享的全局快捷键（默认空，由用户自行设置）。
   *  开启时共享屏幕；再次按下关闭共享。 */
  screenShareShortcut: string;
  /** 一键呼出「共享WPS文档」选择器的全局快捷键（默认空，由用户自行设置）。 */
  docShareShortcut: string;
  /** 共享（屏幕/文档）空闲自动退出时间（分钟）：0=不自动退出。默认 10。 */
  shareIdleTimeout: number;
  /** 共享WPS Word 大文档（>70万字）重新提交轮数，默认 15（WPS Word 专属设置；≤70万字仅在检测到改动时提交）。 */
  docShareWpsWordLargeRounds: number;
  /** 共享WPS Word 触发阈值（字符数），超过该值才按轮数重复提交，默认 700000。 */
  docShareWpsWordLargeThreshold: number;
  /** 共享WPS Excel 大工作簿（>10万字）重新提交轮数，默认 15（WPS Excel 专属设置；≤10万字仅在检测到改动时提交）。 */
  docShareWpsExcelLargeRounds: number;
  /** 共享WPS Excel 触发阈值（字符数），超过该值才按轮数重复提交，默认 100000。 */
  docShareWpsExcelLargeThreshold: number;
  /** 共享WPS PDF 大文档重新提交轮数，默认 15（WPS PDF 专属设置）。 */
  docSharePdfLargeRounds: number;
  /** 共享WPS PDF 触发阈值（按文件字节数近似字符数），超过该值才按轮数重复提交，默认 200000。 */
  docSharePdfLargeThreshold: number;
  /** 共享WPS PDF 改动检测保存间隔（秒）：0=仅发送时保存（默认，平时绝不自动保存原件，发送那一刻才 Save() 抓取最新）；
   *  >0=共享期间按该间隔自动保存一次并检测改动（kpdf 无内存内容读取接口，感知未保存修改必须落盘）。 */
  docSharePdfSaveInterval: number;
  /** 标注画笔色板（设置面板可编辑）。 */
  annotationColors: string[];
  /** 折叠思考过程：true=默认折叠深度思考过程，仅显示最终答案。 */
  collapseThinking: boolean;
  /** AI 流式输出回答时的界面滚动方式：stay=停留开头（生成时保持当前位置），follow=跟随回答（自动滚动到最新输出）。默认停留开头。 */
  answerScrollMode: 'stay' | 'follow';
  /** 截图翻译默认目标语言（如 '简体中文'、'English'）。 */
  defaultTranslateLang: string;
  /** 关闭划词 B 窗口时自动删除该对话记录。默认开启。 */
  cleanBWindowHistoryOnTextSelection: boolean;
  /** 关闭截图 B 窗口时自动删除该对话记录。默认开启。 */
  cleanBWindowHistoryOnScreenshot: boolean;
  // 划词窗口的深度思考 / 智能搜索 / 对话模式已移至每个划词按钮的细分配置
  // （textSelectionButtons 的每项含 deepThink / smartSearch / mode 字段），不再使用全局开关。
  // 截图窗口的深度思考 / 智能搜索 / 对话模式同理，已移至每个截图按钮的细分配置
  // （screenshotButtons 的每项含 deepThink / smartSearch / mode 字段），不再使用截图全局开关。

  // ---- 截图功能 ----
  /** 截图按钮列表（JSON 数组，固定三项：提取文字 / 翻译 / 解释。每项：{ label, prompt, deepThink, smartSearch, mode }）。 */
  screenshotButtons: string;

  // ---- 划词功能（I-12） ----
  /** 划词功能总开关。默认开启。 */
  textSelectionEnabled: boolean;
  /** 划词按钮列表（JSON 数组，每项：{ label, prompt }。复制按钮 prompt 固定为空）。 */
  textSelectionButtons: string;
  /** 划词功能开关快捷键（默认空，需手动设置）。 */
  textSelectionShortcut: string;
  /** 是否已展示过首次运行登录引导 / 用户须知（true 后不再弹出）。 */
  firstRunNoticeShown: boolean;
  /** 启动时自动检查更新（默认开启，可在设置中关闭）。 */
  autoCheckUpdate: boolean;
  /** 已忽略的更新版本号（「暂不更新」后记录，等待下一个版本再提醒）。 */
  ignoredUpdateVersion: string;
  /** 更新板块粒子文字特效显示的文本（默认 "DeepSeek-Doubaoization"，可在设置中修改）。 */
  particleText: string;

  // ---- 黑名单板块 ----
  /** 黑名单进程名集合（如 game.exe 的前缀 game）：其中任一进程运行时临时停用快捷键 / 划词 / 系统通知。 */
  blacklistProcesses: string[];
}

/** 配置键。 */
export type ConfigKey = keyof ConfigShape;

/** 系统通知分类（对应「通知」板块的各类开关）。 */
export type NotificationType =
  | 'screenshot'
  | 'operation'
  | 'textSelection'
  | 'shortcut'
  | 'replyDone';

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

/** 更新检查结果（设置 → 更新板块）。 */
export interface UpdateInfo {
  /** 当前安装版本（如 '1.0.0'）。 */
  currentVersion: string;
  /** 展示用当前版本（去掉末尾 .0，如 '1.0'）。 */
  currentVersionDisplay: string;
  /** GitHub 最新 release 版本号（去掉前缀 v，无则 null）。 */
  latestVersion: string | null;
  /** 是否存在新版本。 */
  hasUpdate: boolean;
  /** 最新 release 详情页地址。 */
  releaseUrl: string;
  /** Release 列表页地址。 */
  releasePageUrl: string;
  /** 最新 release 说明（正文，可能为 null）。 */
  releaseNotes: string | null;
  /** 该 release 的资产列表（安装包等）。 */
  assets: ReleaseAsset[];
  /** 错误信息（成功为 null）。 */
  error: string | null;
  /** 检查完成时间（毫秒时间戳）。 */
  checkedAt: number;
}

/** Release 资产（安装包等，供软件内下载更新）。 */
export interface ReleaseAsset {
  /** 文件名（如 DeepSeek-Setup-1.1.0.exe）。 */
  name: string;
  /** GitHub 原始下载地址。 */
  url: string;
  /** 文件大小（字节）。 */
  size: number;
}

/** 下载进度（主 -> 渲染推送）。 */
export interface UpdateDownloadProgress {
  /** 已下载字节数。 */
  received: number;
  /** 总字节数（未知为 0）。 */
  total: number;
  /** 百分比 0-100。 */
  percent: number;
  /** 进度归属（更新弹框用 'prompt'），用于多窗口区分；设置面板的下载不带此字段。 */
  receiver?: string;
}

/** 下载/唤起结果（渲染 <- 主）。 */
export interface UpdateDownloadResult {
  ok: boolean;
  /** 本地安装包路径（成功时）。 */
  path?: string;
  /** 错误信息（失败时）。 */
  error?: string;
}



/** 更新弹框：主进程下发给弹框窗口的版本信息。 */
export interface UpdatePromptInfo {
  /** 最新版本号（展示用，去 v 前缀）。 */
  latestVersion: string;
  /** Release 更新说明（markdown 文本）。 */
  releaseNotes: string | null;
}

/** 历史更新条目（GitHub Release）：设置 → 更新 → 查看历史更新使用。 */
export interface ReleaseHistoryItem {
  /** 版本号（去前导 v，如 1.4.1）。 */
  version: string;
  /** 发布标题（无则取版本号）。 */
  name: string;
  /** Release 页面地址。 */
  url: string;
  /** Release 说明正文（markdown，可能很长）。 */
  body: string | null;
  /** 发布时间（ISO 字符串，可能为空）。 */
  publishedAt: string | null;
}
