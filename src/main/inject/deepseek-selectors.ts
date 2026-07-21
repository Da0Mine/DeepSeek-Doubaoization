/**
 * DeepSeek 页面 DOM 选择器（脆弱点唯一收口）。
 *
 * 2026-07-20 已通过 Playwright CDP 连接真实登录的 Edge、抓取
 * chat.deepseek.com 实时无障碍树核对：
 *   - 输入框：<textarea>，aria-label/placeholder 含「给 DeepSeek 发送消息」
 *   - 发送按钮：右下工具栏最后一个按钮（空输入时 disabled，无「发送」类 aria-label）
 *   - 上传按钮：右下工具栏第一个按钮（paperclip 图标）
 *   - 页面另有底部搜索框会抢注通用 `textarea` 选择器，故专属选择器须放最前。
 *
 * Injector 中的 fillText/clickSend/injectScissorsButton 已据此改为结构定位，
 * 本文件保留候选以供人工核对与后续微调。
 */

/** 文本输入区候选选择器（textarea / contenteditable / role=textbox）。 */
export const TEXT_INPUT_SELECTORS: string[] = [
  // ✅ 实机核对：DeepSeek 聊天输入框
  'textarea[aria-label*="发送消息"]',
  'textarea[placeholder*="发送消息"]',
  '[role="textbox"][aria-label*="发送消息"]',
  'div[contenteditable="true"][aria-label*="发送消息"]',
  // 通用回退
  'textarea',
  'div[contenteditable="true"]',
  '#chat-input',
  '[data-testid="chat-input"]',
  '[data-testid="input"]',
  '[role="textbox"]',
  '.chat-input',
];

/** 发送按钮候选选择器（aria-label 含「发送」/「send」、提交按钮、含 svg 的按钮）。 */
export const SEND_BUTTON_SELECTORS: string[] = [
  'button[aria-label*="发送"]',
  'button[aria-label*="send" i]',
  'button[type="submit"]',
  '[data-testid="send-button"]',
  '[data-testid="send"]',
  'button:has(svg)',
];
// ⚠️ 实机核对：chat.deepseek.com 当前发送按钮无「发送/send」类 aria-label，
//    实际依赖「右下工具栏最后一个非禁用按钮」的位置策略（见 Injector.clickSend）。

/** 文件上传 input（用于图片注入）。 */
export const FILE_INPUT_SELECTORS: string[] = [
  'input[type="file"]',
  'input[type="file"][accept*="image"]',
];

/**
 * 可见「上传/附件」按钮锚点（剪刀按钮插入其左侧）。
 * 多数站点把 file input 包在一个 button/label 里，这里优先选可见按钮。
 * ⚠️ 待实机验证：chat.deepseek.com 的真实上传按钮结构需 DevTools 核对。
 */
export const UPLOAD_BUTTON_SELECTORS: string[] = [
  'button[aria-label*="上传"]',
  'button[aria-label*="附件"]',
  'button[aria-label*="图片"]',
  'button[aria-label*="upload" i]',
  'button[aria-label*="attach" i]',
  'label[for]', // 常见：<label for="file-input"> 包裹上传图标
  'div[role="button"][tabindex]', // 退而求其次的自定义按钮
];

/**
 * 发送按钮「可用态」判定辅助：Injector.clickSend 轮询时，会跳过
 * `disabled` / `aria-disabled="true"` 的候选（见 Injector.tryClickEnabled）。
 * 下列为发送按钮候选（与 SEND_BUTTON_SELECTORS 一致，集中收口）。
 */
export const SEND_BUTTON_ENABLED_HINT = 'disabled 或 aria-disabled 视为不可用';

/** 开启「深度思考」的开关候选选择器。 */
export const DEEP_THINK_SELECTORS: string[] = [
  '[data-testid="deep-think"]',
  'button[aria-label*="深度思考"]',
  'label:has(input[name*="think"])',
  'span:has(> svg) ~ button', // 待实机验证
];

/** 切换到「视觉/上传图片」模型的候选按钮（点击后会出现文件输入）。 */
export const VISION_TOGGLE_SELECTORS: string[] = [
  'button[aria-label*="图片"]',
  'button[aria-label*="上传图片"]',
  'button[aria-label*="附件"]',
  'button[aria-label*="image" i]',
  '[data-testid="upload-image"]',
  '[data-testid="vision"]',
];

/** 模型选择按钮（切换 deepseek-v3 / reasoner 等）。 */
export const MODEL_SWITCH_SELECTORS: string[] = [
  '[data-testid="model-switch"]',
  'button[aria-label*="模型"]',
  '.model-selector',
];

/** 登录态探测：未登录时通常存在的登录按钮文本。 */
export const LOGIN_BUTTON_TEXTS: string[] = ['登录', 'Log in', 'Sign in', '注册'];

/** 最近一条 AI 回复的候选容器（用于翻译回填，待实机验证）。 */
export const ASSISTANT_MESSAGE_SELECTORS: string[] = [
  '[data-role="assistant"]',
  '.message-assistant',
  '.chat-message.assistant',
  '.assistant-message',
  'div[class*="assistant"]:last-child',
  'div[class*="response"]:last-child',
];
