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

  /** 渲染 -> 主：打开通用设置面板。 */
  SETTINGS_OPEN: 'settings:open',
  /** 渲染 -> 主：呼出/聚焦常驻副窗口（Alt+Q 或标题栏按钮）。 */
  SUB_SUMMON: 'sub:summon',
  /** 渲染 -> 主：主副切换。 */
  SUB_SWAP: 'sub:swap',
  /** webview -> 主：网页内「新建对话」被触发，主进程据此自动应用默认模型模式（Bug2 修复）。 */
  NEW_CONVERSATION: 'new-conversation',
  /** webview -> 主：网页内剪刀按钮被点击，触发截图。 */
  SCISSORS_TRIGGER: 'scissors:trigger',

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

  /** 主 -> 渲染：登录态状态。 */
  LOGIN_STATUS: 'login:status',
  /** webview -> 主：登录态探测回报。 */
  LOGIN_DETECT: 'login:detect',

  /** 渲染 -> 主：发送系统通知请求。 */
  NOTIFY: 'app:notify',
} as const;

export type ChannelName = (typeof IPC)[keyof typeof IPC];
