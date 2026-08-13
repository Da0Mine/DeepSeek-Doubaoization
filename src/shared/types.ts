/**
 * 共享类型定义（主进程 / 预加载脚本 / 外壳渲染层 共用）。
 * 作为类型单一来源，避免跨模块类型漂移。
 */

/** 窗口类型枚举（单一来源：constants.ts 仅作值导出，此处为类型定义）。 */
export type WindowType = 'main' | 'sub' | 'vision' | 'translate' | 'explain' | 'extract';

/** 默认新建对话的模型模式。 */
export type DefaultModelMode = 'simple' | 'expert' | 'vision';

/** 截图「发送到新对话」窗口的模型模式：simple=快速模式，vision=识图模式。 */
export type ScreenshotSendNewMode = 'simple' | 'vision';

/** 主题模式。 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 链接打开方式：internal=内置浏览器窗口（多标签），external=系统默认浏览器。 */
export type LinkOpenMode = 'internal' | 'external';

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
  /** 全局字号相对偏移量（-2 ~ +2，0=默认）。旧版为绝对 px 值，新版为相对偏移。 */
  fontSize: number;
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
  /** 默认新建对话的模型模式（simple=简单，expert=专家/深度思考，vision=识图）。 */
  defaultModelMode: DefaultModelMode;
  /** 截图「发送到新对话」窗口的模型模式（simple=快速模式，vision=识图模式）。默认识图模式。 */
  screenshotSendNewMode: ScreenshotSendNewMode;
  /** 点击「共享屏幕」时是否自动切换到识图模式（默认开启；关闭则仅按当前模式提示）。 */
  screenShareSwitchVision: boolean;
  /** 共享屏幕模式提示弹框总开关（专家/快速模式限制时弹提示）。默认开启；点「不再提醒」后关闭，可在设置中重新开启。 */
  screenShareModeReminder: boolean;
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
  /** 关闭 B 窗口时自动删除该对话记录。默认开启。 */
  cleanBWindowHistory: boolean;

  // ---- 划词功能（I-12） ----
  /** 划词功能总开关。默认开启。 */
  textSelectionEnabled: boolean;
  /** 划词按钮列表（JSON 数组，每项：{ label, prompt }。复制按钮 prompt 固定为空）。 */
  textSelectionButtons: string;
  /** 划词功能开关快捷键（默认空，需手动设置）。 */
  textSelectionShortcut: string;
  /** 是否已完成首次使用说明引导（true 后不再自动弹出，可在设置中重新打开）。 */
  onboardingCompleted: boolean;
  /** 是否已展示过首次运行登录引导 / 用户须知（true 后不再弹出）。 */
  firstRunNoticeShown: boolean;
  /** 启动时自动检查更新（默认开启，可在设置中关闭）。 */
  autoCheckUpdate: boolean;
  /** 已忽略的更新版本号（「暂不更新」后记录，等待下一个版本再提醒）。 */
  ignoredUpdateVersion: string;
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

/** 使用说明引导：主进程下发给引导视图的步骤数据。 */
export interface OnboardingFocus {
  /** 当前步骤下标。 */
  index: number;
  /** 总步骤数。 */
  total: number;
  /** 步骤标题。 */
  title: string;
  /** 步骤正文说明。 */
  body: string;
  /** 高亮区域（引导视图全窗口坐标系；null 表示无高亮，居中展示）。 */
  rect: { x: number; y: number; width: number; height: number } | null;
  /** 高亮移动起点：高亮框先出现在这里，再平滑移动到 rect（如共享屏幕演示：加号 → 菜单项）。 */
  fromRect: { x: number; y: number; width: number; height: number } | null;
  /** 演示动画类型（渲染层播放模拟演示；null 无）。textSelection=划词演示，subWindow=副窗口呼出演示。 */
  demo: 'textSelection' | 'subWindow' | null;
  /** 卡片摆放方式：'left'=固定屏幕左侧（避开演示区/底部菜单）；null=自动跟随高亮。 */
  cardPos: 'left' | null;
  /** 是否显示「上一步」。 */
  showPrev: boolean;
  /** 是否为最后一步（按钮显示「完成」）。 */
  isLast: boolean;
}

/** 更新弹框：主进程下发给弹框窗口的版本信息。 */
export interface UpdatePromptInfo {
  /** 最新版本号（展示用，去 v 前缀）。 */
  latestVersion: string;
  /** Release 更新说明（markdown 文本）。 */
  releaseNotes: string | null;
}
