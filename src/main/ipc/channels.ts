/**
 * IPC 通道名（唯一真实来源）。
 * 主进程（handlers.ts）与预加载脚本（shellPreload / webviewPreload）必须对称使用本表。
 */
export const IPC = {
  /** 渲染 -> 主：切换（显示/隐藏）主窗口。 */
  WIN_TOGGLE: 'win:toggle',
  /** 渲染 -> 主：最小化当前窗口。 */
  WIN_MIN: 'win:min',
  /** 渲染 -> 主：最大化/还原当前窗口。 */
  WIN_MAX: 'win:max',
  /** 渲染 -> 主：关闭当前窗口。 */
  WIN_CLOSE: 'win:close',
  /** 渲染 -> 主：切换当前窗口置顶。 */
  WIN_ALWAYS_ON_TOP: 'win:alwaysOnTop',
  /** 渲染 -> 主（invoke）：查询当前窗口是否置顶。 */
  WIN_IS_ALWAYS_ON_TOP: 'win:isAlwaysOnTop',
  /** 主 -> 渲染：当前窗口置顶状态变化通知。 */
  WIN_ALWAYS_ON_TOP_STATE: 'win:alwaysOnTopState',

  /** 渲染 -> 主：开始截图（弹出遮罩）。 */
  SCREENSHOT_START: 'screenshot:start',
  /** 渲染 -> 主：遮罩选区完成，提交动作、选区与标注。 */
  SCREENSHOT_ACTION: 'screenshot:action',

  /** 渲染 -> 主（invoke）：读取配置项。 */
  CONFIG_GET: 'config:get',
  /** 渲染 -> 主（invoke）：写入配置项。 */
  CONFIG_SET: 'config:set',
  /** 渲染 -> 主（invoke）：重置配置为默认值。 */
  CONFIG_RESET: 'config:reset',
  /** 渲染 -> 主（invoke）：清除本地全部配置与登录状态，软件回到最初状态。 */
  CONFIG_FACTORY_RESET: 'config:factoryReset',

  /** 渲染 -> 主：打开通用设置面板。 */
  SETTINGS_OPEN: 'settings:open',
  /** 渲染 -> 主：关闭设置面板（内嵌于主窗口的设置视图）。 */
  SETTINGS_CLOSE: 'settings:close',
  /** 渲染 -> 主：呼出/聚焦常驻副窗口（Alt+Q 或标题栏按钮）。 */
  SUB_SUMMON: 'sub:summon',
  /** 渲染 -> 主：主副切换。 */
  SUB_SWAP: 'sub:swap',
  /** webview -> 主：网页内「新建对话」被触发，主进程据此自动应用默认模型模式（Bug2 修复）。 */
  NEW_CONVERSATION: 'new-conversation',
  /** webview -> 主：网页内剪刀按钮被点击，触发截图。 */
  SCISSORS_TRIGGER: 'scissors:trigger',
  /** webview -> 主：「+」按钮→截图提问（截图简化模式，仅发送到当前对话）。 */
  PLUS_SCREENSHOT_Q: 'plus:screenshotQ',
  /** webview -> 主：「+」按钮→上传文件。 */
  PLUS_UPLOAD_FILE: 'plus:uploadFile',
  /** webview -> 主：「+」按钮→共享屏幕（切换）。 */
  PLUS_SHARE_SCREEN: 'plus:shareScreen',
  /** webview -> 主：「+」按钮→共享文档（WPS 打开的文档）。 */
  PLUS_SHARE_DOC: 'plus:shareDoc',
  /** webview -> 主：「+」按钮→共享WPS Excel（WPS 表格打开的工作簿）。 */
  PLUS_SHARE_EXCEL: 'plus:shareExcel',
  /** webview -> 主：「+」按钮→共享WPS PDF（WPS PDF 打开的文档）。 */
  PLUS_SHARE_PDF: 'plus:sharePdf',
  /** webview -> 主：共享文档模式下发送（payload: { text: string; docName: string; mode: 'word' | 'excel' | 'pdf' }）。 */
  DOC_SHARE_SEND: 'docShare:send',
  /** webview -> 主：退出共享文档模式（浮层取消按钮；payload: { mode }）。 */
  DOC_SHARE_STOP: 'docShare:stop',
  /** webview -> 主：请求刷新打开的文档列表（共享期间定时轮询；payload: { mode }）。 */
  DOC_SHARE_REFRESH: 'docShare:refresh',
  /** 主 -> webview：刷新后的文档名列表（payload: string[]）。 */
  DOC_SHARE_REFRESH_RESULT: 'docShare:refreshResult',

  // ---- 共享屏幕 ----
  /** webview -> 主：共享屏幕模式下 Enter 键被拦截，需截屏+上传+发送。 */
  SCREEN_SHARE_ENTER: 'screenShare:enterPressed',
  /** 渲染 -> 主：退出共享屏幕模式（任务栏按钮或加号按钮）。 */
  SCREEN_SHARE_STOP: 'screenShare:stop',

  /** 渲染（overlay）-> 主：选区完成，回报 rect。 */
  OVERLAY_SELECT: 'overlay:select',
  /** 主 -> 渲染（overlay）：下发裁剪后的截图 PNG（dataURL）用于冻结显示。 */
  OVERLAY_SET_IMAGE: 'overlay:setImage',
  /** 主 -> 渲染（overlay）：设置标注颜色。 */
  OVERLAY_SET_COLOR: 'overlay:setColor',
  /** 主 -> 渲染（overlay）：设置标注工具。 */
  OVERLAY_SET_TOOL: 'overlay:setTool',
  /** 主 -> 渲染（overlay）：撤销一笔标注。 */
  OVERLAY_UNDO: 'overlay:undo',
  /** 主 -> 渲染（overlay）：清空标注。 */
  OVERLAY_CLEAR: 'overlay:clear',
  /** 主 -> 渲染（overlay）：请求把标注合成进截图，返回 dataURL。 */
  OVERLAY_COMPOSE: 'overlay:compose',
  /** 渲染（overlay）-> 主：合成结果（PNG dataURL）。 */
  OVERLAY_COMPOSE_RESULT: 'overlay:compose-result',
  /** 主 -> 渲染（overlay）：下发全屏截图背景图（PNG dataURL），替代透明窗口看穿桌面（修复全屏独占应用黑屏）。 */
  OVERLAY_SET_BACKGROUND_IMAGE: 'overlay:setBackgroundImage',
  /** 渲染（overlay）-> 主：渲染进程就绪（监听器已注册），主进程据此才下发背景图，避免 send 早于监听被丢弃。 */
  OVERLAY_READY: 'overlay:ready',

  /** 渲染 -> 主（invoke）：应用主题。 */
  THEME_APPLY: 'theme:apply',
  /** 主 -> 渲染：下发主题 CSS 变量。 */
  THEME_VARS: 'theme:vars',
  /** 渲染 -> 主（invoke）：请求当前主题 CSS 变量（用于新窗口首帧）。 */
  THEME_VARS_REQUEST: 'theme:vars:request',

  /** 渲染 <-> 主：翻译实时同步（双向）。 */
  TRANSLATE_SYNC: 'translate:sync',
  /** 主 -> 渲染：翻译结果回填。 */
  TRANSLATE_RESULT: 'translate:result',
  /** 主 -> B 窗口外壳：设置翻译语言并显示语言栏（payload: lang string）。 */
  TRANSLATE_SET_LANG: 'translate:setLang',
  /** B 窗口外壳 -> 主：用户切换翻译语言，请求重新翻译（payload: { lang: string }）。 */
  TRANSLATE_CHANGE_LANG: 'translate:changeLang',

  /** 主 -> 渲染：登录态状态。 */
  LOGIN_STATUS: 'login:status',
  /** webview -> 主：登录态探测回报。 */
  LOGIN_DETECT: 'login:detect',

  /** 渲染 -> 主：发送系统通知请求。 */
  NOTIFY: 'app:notify',

  // ---- 划词功能（I-12） ----
  /** 主 -> 渲染（划词工具栏）：显示工具栏并传入选中文本。 */
  TEXT_SELECTION_SHOW: 'textSelection:show',
  /** 渲染（划词工具栏）-> 主：用户点击工具栏按钮。 */
  TEXT_SELECTION_ACTION: 'textSelection:action',
  /** 渲染（划词工具栏）-> 主：工具栏关闭。 */
  TEXT_SELECTION_CLOSE: 'textSelection:close',
  /** 渲染 -> 主（invoke）：重置指定配置键为默认值。 */
  CONFIG_RESET_KEYS: 'config:resetKeys',

  // ---- 账号管理 ----
  /** 渲染 -> 主（invoke）：获取登录状态。 */
  ACCOUNT_GET_STATUS: 'account:getStatus',
  /** 渲染 -> 主（invoke）：退出登录。 */
  ACCOUNT_LOGOUT: 'account:logout',

  // ---- 数据管理 ----
  /** 渲染 -> 主（invoke）：清理所有对话。 */
  DATA_CLEAR_CONVERSATIONS: 'data:clearConversations',
  /** 渲染 -> 主（invoke）：导出对话数据。 */
  DATA_EXPORT: 'data:exportData',

  // ---- 划词工具栏（窗口复用后动态更新内容 / 尺寸） ----
  /** 主 -> 划词工具栏：下发按钮列表与选中文本（payload: { buttons, text }）。 */
  TOOLBAR_UPDATE: 'toolbar:update',
  /** 划词工具栏 -> 主：内容渲染完成后回报实际宽度（payload: { width }），用于自适应窗口尺寸。 */
  TOOLBAR_RESIZE: 'toolbar:resize',

  // ---- 更新 ----
  /** 渲染 -> 主（invoke）：检查更新（payload: { force?: boolean }，true 时忽略缓存强制请求 GitHub）。 */
  UPDATE_CHECK: 'update:check',
  /** 渲染 -> 主（invoke）：在默认浏览器打开 GitHub Release 页面。 */
  UPDATE_OPEN_RELEASES: 'update:openReleases',
  /** 渲染 -> 主（invoke）：下载最新安装包，进度经 UPDATE_DOWNLOAD_PROGRESS 推送到发起者，完成后返回本地路径。 */
  UPDATE_DOWNLOAD: 'update:download',
  /** 主 -> 渲染：下载进度（payload: UpdateDownloadProgress）。 */
  UPDATE_DOWNLOAD_PROGRESS: 'update:downloadProgress',
  /** 渲染 -> 主（invoke）：唤起本地安装程序（payload: { path: string }）。 */
  UPDATE_LAUNCH: 'update:launch',
  /** 主 -> 渲染：更新弹框接收版本信息（payload: UpdatePromptInfo）。 */
  UPDATE_PROMPT_INFO: 'update:promptInfo',
  /** 更新弹框 -> 主：按钮操作（payload: { action: 'later' | 'install' }）。 */
  UPDATE_PROMPT_ACTION: 'update:promptAction',

  // ---- 共享屏幕模式提示弹框 ----
  /** 主 -> 模式提示弹框：下发提示类型（payload: { type: 'expert' | 'simple' }）。 */
  MODE_REMINDER_INFO: 'modeReminder:info',
  /** 模式提示弹框 -> 主：按钮操作（payload: { action: 'ok' | 'never' }）。 */
  MODE_REMINDER_ACTION: 'modeReminder:action',

  // ---- 使用说明引导 ----
  /** 渲染 -> 主：打开使用说明引导（首次运行或设置面板手动打开）。 */
  ONBOARDING_OPEN: 'onboarding:open',
  /** 引导视图 -> 主：结束引导（写入 onboardingCompleted）。 */
  ONBOARDING_CLOSE: 'onboarding:close',
  /** 引导视图 -> 主：切换步骤（payload: { dir: 1 | -1 }）。 */
  ONBOARDING_STEP: 'onboarding:step',
  /** 主 -> 引导视图：下发步骤数据（payload: OnboardingFocus）。 */
  ONBOARDING_FOCUS: 'onboarding:focus',
  /** 引导视图 -> 主：鼠标是否位于交互控件内（payload: boolean），用于切换点击穿透。 */
  ONBOARDING_SET_INTERACTIVE: 'onboarding:setInteractive',

  // ---- 首次运行登录引导 / 用户须知 ----
  /** 首次运行弹窗 -> 主：按钮操作（payload: { action: 'done' | 'close' }）。 */
  FIRST_RUN_ACTION: 'firstRun:action',
  /** 设置说明书 -> 主：打开副窗口并把说明书 Markdown 提交到快速模式对话并发送（payload: markdown 文本）。 */
  MANUAL_ASK_AI: 'manual:askAi',

  // ---- 回答完成提醒 ----
  /** webview -> 主：页面报告「开始生成 / 回答完成」（payload: { started: boolean }）。 */
  ANSWER_STATUS: 'answer:status',
} as const;

export type ChannelName = (typeof IPC)[keyof typeof IPC];
