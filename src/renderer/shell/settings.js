/* 设置面板（毛玻璃 + GSAP 动画版）：三级菜单导航 + 右侧内容。 */
(function () {
  'use strict';
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // ---- 一级菜单图标 ----
  var TOP_ICONS = {
    '应用': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    '对话': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    '工具': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    '高级': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    '个人中心': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    '帮助': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  };

  // ---- 二级菜单图标 ----
  var SUB_ICONS = {
    '常规': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
    '窗口': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    '快捷键': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h.01M10 16h.01M14 16h.01M18 16h.01"/></svg>',
    '提示词': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    '模型行为': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10h-10V2z"/><path d="M22 12a10 10 0 0 0-10-10v10h10z"/></svg>',
    '对话管理': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/></svg>',
    '截图': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    '划词': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    '翻译': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    '账号': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    '数据': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    '更新': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><polyline points="21 3 21 9 15 9"/></svg>',
    '使用说明': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    '通知': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    '共享': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  };

  // ---- 三级菜单结构 ----
  var MENU = [
    {
      label: '应用', icon: TOP_ICONS['应用'],
      children: [
        {
          label: '常规', icon: SUB_ICONS['常规'],
          keys: ['theme', 'fontSize', 'linkOpenMode'],
          items: [
            { key: 'theme', label: '主题', type: 'select', options: [{ label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }, { label: '跟随系统', value: 'system' }] },
            { key: 'fontSize', label: '全局字号', type: 'fontsize' },
            { key: 'linkOpenMode', label: '链接打开方式', type: 'select', options: [{ label: '内置浏览器窗口', value: 'internal' }, { label: '系统默认浏览器', value: 'external' }], hint: '点击网页中的链接时：内置浏览器窗口会在应用内多标签页打开；系统默认浏览器会调用你电脑默认的浏览器打开。' },
          ]
        },
        {
          label: '窗口', icon: SUB_ICONS['窗口'],
          keys: ['alwaysOnTop', 'closeToTray', 'startAtLogin', 'minimizeToTrayOnStart'],
          items: [
            { key: 'alwaysOnTop', label: '副窗口默认置顶', type: 'checkbox', hint: '开启后，副窗口和提问小窗（B 窗口）默认置顶显示，始终位于其他窗口之上。主窗口不受此设置影响。' },
            { key: 'closeToTray', label: '关闭行为', type: 'select', options: [{ label: '直接关闭', value: false }, { label: '最小化到托盘', value: true }], hint: '选择点击窗口关闭按钮时的行为：直接关闭并退出程序，或最小化到系统托盘继续运行。' },
            { key: 'startAtLogin', label: '开机自启', type: 'checkbox', hint: '开启后，登录系统时自动启动本程序，并直接最小化到系统托盘（不显示主窗口）。' },
            { key: 'minimizeToTrayOnStart', label: '手动启动最小化到托盘', type: 'checkbox', hint: '开启后，手动打开程序时也直接最小化到系统托盘，不显示主窗口（开机自启始终最小化到托盘，不受此设置影响）。' },
          ]
        },
        {
          label: '快捷键', icon: SUB_ICONS['快捷键'],
          keys: ['screenshotShortcut', 'subWindowShortcut', 'textSelectionShortcut'],
          items: [
            { key: 'screenshotShortcut', label: '截图快捷键', type: 'shortcut', hint: '一键唤起截图，默认 左 Alt + C。' },
            { key: 'subWindowShortcut', label: '副窗呼出键', type: 'shortcut', hint: '一键呼出/隐藏副窗口，默认 左 Alt + 空格。' },
            { key: 'textSelectionShortcut', label: '划词开关快捷键', type: 'shortcut', hint: '设置后可按快捷键一键开启/关闭划词功能（默认空，需手动设置）。' },
          ]
        },
        {
          label: '通知', icon: SUB_ICONS['通知'],
          keys: ['notificationEnabled', 'notificationScreenshot', 'notificationOperation', 'notificationTextSelection', 'notificationShortcut', 'notificationReplyDone'],
          items: [
            { key: 'notificationEnabled', label: '总开关', type: 'checkbox', hint: '关闭后所有系统通知一律不再弹出。' },
            { key: 'notificationScreenshot', label: '截图反馈', type: 'checkbox', hint: '截图成功复制、截图失败、未知截图动作等提示。' },
            { key: 'notificationOperation', label: '操作反馈', type: 'checkbox', hint: '上传/翻译失败、没有对话窗口、创建副窗口失败、引用失败等提示。' },
            { key: 'notificationTextSelection', label: '划词反馈', type: 'checkbox', hint: '划词失败等提示。' },
            { key: 'notificationShortcut', label: '快捷键提示', type: 'checkbox', hint: '快捷键注册失败或被系统占用等提示。' },
            { key: 'notificationReplyDone', label: '回答完成提醒', type: 'checkbox', hint: 'AI 回答完成时，若窗口在后台或你已切到其他会话，弹通知提醒；点击通知可跳回原会话。' },
          ]
        },
        {
          label: '更新', icon: SUB_ICONS['更新'],
          keys: [],
          items: [
            { key: '_update', label: '软件更新', type: 'update' },
          ]
        },
      ]
    },
    {
      label: '对话', icon: TOP_ICONS['对话'],
      children: [
        {
          label: '模型行为', icon: SUB_ICONS['模型行为'],
          keys: ['deepThinkEnabled', 'smartSearchEnabled', 'collapseThinking', 'defaultModelMode'],
          items: [
            { key: 'deepThinkEnabled', label: '深度思考', type: 'checkbox', hint: '开启后，AI 在回答前会进行深度思考，展示详细的推理过程，适用于复杂问题。' },
            { key: 'smartSearchEnabled', label: '智能搜索', type: 'checkbox', hint: '开启后，AI 会根据问题自动联网搜索，获取最新信息来辅助回答。' },
            { key: 'collapseThinking', label: '折叠思考过程', type: 'checkbox', hint: '开启后，AI 的深度思考过程默认折叠收起，只显示最终答案，界面更简洁。' },
            { key: 'defaultModelMode', label: '默认模型模式', type: 'select', options: [{ label: '快速模式', value: 'simple' }, { label: '专家模式', value: 'expert' }, { label: '识图模式', value: 'vision' }], hint: '选择新建对话时默认使用的模型模式：快速模式响应最快，专家模式适合复杂任务，识图模式支持图片理解。' },
          ]
        },
        {
          label: '共享设置', icon: SUB_ICONS['共享'],
          keys: ['screenShareSwitchVision', 'screenShareModeReminder', 'docSharePdfSaveInterval', 'docShareWpsWordLargeRounds', 'docShareWpsExcelLargeRounds', 'docSharePdfLargeRounds', 'docShareWpsWordLargeThreshold', 'docShareWpsExcelLargeThreshold', 'docSharePdfLargeThreshold'],
          items: [
            { key: 'screenShareSwitchVision', label: '共享屏幕自动切识图模式', type: 'checkbox', hint: '开启后，点击「共享屏幕」时自动切换到识图模式以便发送截图（默认开启）。若当前对话已无法切换模型，则按当前模式给出提示。' },
            { key: 'screenShareModeReminder', label: '共享屏幕模式提示', type: 'checkbox', hint: '控制共享屏幕时对话模式非识图模式时的提醒' },
            { key: 'docSharePdfSaveInterval', label: 'PDF改动检测保存间隔（秒）', type: 'number', hint: '0 = 仅发送时保存（默认）：平时绝不自动保存原件，只有点发送上传那一刻才保存一次抓取最新内容。设为 10/30/60 等秒数后，共享期间会按该间隔自动保存一次并检测改动（PDF 的 COM 接口没有内存内容读取能力，感知未保存修改必须让 WPS 落盘一次）。' },
            { key: '_docShareRounds', label: '共享文件提交轮数', type: 'docshare-rounds', hint: '文档/工作簿/PDF 内容超过各自的触发阈值时，对话每经过设定的提交轮数自动重新提交最新文件；检测到改动会立即提交并重新计数。WPS Word 触发阈值默认 70 万字，WPS Excel 默认 10 万字，WPS PDF 默认 20 万（按文件字节数近似）。' },
          ]
        },
        {
          label: '对话管理', icon: SUB_ICONS['对话管理'],
          keys: ['cleanBWindowHistory'],
          items: [
            { key: 'cleanBWindowHistory', label: '提问小窗对话自动清理', type: 'checkbox', hint: '开启后，关闭提问小窗（包括截图翻译、截图解释、截图提取文字、截图提问等窗口）时，自动删除该次对话记录，避免历史记录堆积。' },
          ]
        },
        {
          label: '提示词', icon: SUB_ICONS['提示词'],
          keys: ['visionPromptTemplate', 'extractTextPromptTemplate', 'translatePromptTemplate', 'explainPromptTemplate'],
          items: [
            { key: 'visionPromptTemplate', label: '识别图片', type: 'textarea', hint: '截图识图模式下发送给 AI 的提示词模板，{content} 为图片或文本内容占位符。' },
            { key: 'extractTextPromptTemplate', label: '提取文字', type: 'textarea', hint: '截图「提取文字」功能使用的提示词模板。' },
            { key: 'translatePromptTemplate', label: '翻译提示词（{content}{targetLang}）', type: 'textarea', hint: '截图翻译功能使用的提示词模板，{content} 为待翻译内容，{targetLang} 为目标语言。' },
            { key: 'explainPromptTemplate', label: '解释提示词（{content}）', type: 'textarea', hint: '截图「解释」功能使用的提示词模板。' },
          ]
        },
      ]
    },
    {
      label: '工具', icon: TOP_ICONS['工具'],
      children: [
        {
          label: '截图', icon: SUB_ICONS['截图'],
          keys: ['annotationColors', 'keepWindowsOnScreenshot'],
          items: [
            { key: 'annotationColors', label: '标注画笔色板', type: 'colorlist' },
            { key: 'keepWindowsOnScreenshot', label: '截图时保留窗口', type: 'checkbox', hint: '开启后，截图时应用窗口保持显示在屏幕上（会被截进图里）；关闭后截图前自动隐藏应用窗口，避免窗口出现在截图中。' },
          ]
        },
        {
          label: '划词', icon: SUB_ICONS['划词'],
          keys: ['textSelectionEnabled', 'textSelectionButtons'],
          items: [
            { key: 'textSelectionEnabled', label: '划词功能开关', type: 'checkbox', hint: '开启后，选中文本并按 Ctrl+C 复制后，自动弹出划词工具栏，快速复制、翻译或解释选中内容。' },
            { key: 'textSelectionButtons', label: '划词按钮列表', type: 'textselection-buttons' },
          ]
        },
        {
          label: '翻译', icon: SUB_ICONS['翻译'],
          keys: ['defaultTranslateLang'],
          items: [
            { key: 'defaultTranslateLang', label: '默认翻译语言', type: 'select', options: [
              { label: '简体中文', value: '简体中文' },
              { label: '繁體中文', value: '繁體中文' },
              { label: 'English', value: 'English' },
              { label: '日本語', value: '日本語' },
              { label: '한국어', value: '한국어' },
              { label: 'Français', value: 'Français' },
              { label: 'Deutsch', value: 'Deutsch' },
              { label: 'Español', value: 'Español' },
              { label: 'Português', value: 'Português' },
              { label: 'Русский', value: 'Русский' },
              { label: 'العربية', value: 'العربية' },
              { label: 'Italiano', value: 'Italiano' },
              { label: 'Nederlands', value: 'Nederlands' },
              { label: 'Polski', value: 'Polski' },
              { label: 'Tiếng Việt', value: 'Tiếng Việt' },
              { label: 'ภาษาไทย', value: 'ภาษาไทย' },
              { label: 'हिन्दी', value: 'हिन्दी' },
            ] },
          ]
        },
      ]
    },
    {
      label: '个人中心', icon: TOP_ICONS['个人中心'],
      children: [
        {
          label: '账号', icon: SUB_ICONS['账号'],
          keys: [],
          items: [
            { key: '_loginStatus', label: '登录状态', type: 'info', getter: 'account:getStatus' },
            { key: '_logout', label: '退出登录', type: 'action', action: 'account:logout', confirm: '确定要退出登录吗？' },
          ]
        },
        {
          label: '数据', icon: SUB_ICONS['数据'],
          keys: [],
          items: [
            { key: '_exportData', label: '导出对话数据', type: 'action', action: 'data:exportData' },
            { key: '_factoryReset', label: '清除本地配置数据', type: 'action', action: 'config:factoryReset', confirm: '确定要清除所有本地配置数据吗？此操作将退出登录并恢复默认设置，软件回到最初状态，且不可撤销。', hint: '清除本机的全部配置与登录状态，软件回到最初状态；下次启动将重新进行首次登录引导与使用说明。' },
          ]
        },
      ]
    },
    {
      label: '帮助', icon: TOP_ICONS['帮助'],
      children: [
        {
          label: '使用说明', icon: SUB_ICONS['使用说明'],
          keys: [],
          items: [
            { key: '_openOnboarding', label: '快速上手', type: 'action', action: 'onboarding:open', send: true, hint: '重新播放首次运行时的引导动画，介绍主副窗口切换、快捷键、划词与共享屏幕等核心功能。' },
            { key: '_gotoManual', label: '详细说明书', type: 'manual-goto', hint: '在本面板内查看软件所有特殊功能的分组说明，可随时返回上一级。' },
          ]
        },
      ]
    },
  ];

  // 展平所有二级菜单用于快速查找
  var FLAT_SUBS = [];
  (function flatten() {
    MENU.forEach(function (top) {
      top.children.forEach(function (sub) {
        sub._topLabel = top.label;
        FLAT_SUBS.push(sub);
      });
    });
  })();

  ready(function () {
    var shell = window.shell;
    if (!shell) { console.error('[settings] window.shell 不可用'); return; }

    var gsap = window.gsap;
    var sidebar = document.getElementById('sidebar');
    var panelHeader = document.getElementById('panel-header');
    var panelBody = document.getElementById('panel-body');
    var statusEl = document.getElementById('status');
    var inputs = {};
    var colorListEl = null;
    var activeTopIdx = 0;
    // 一级菜单多展开集合：展开某一项不会关闭其他项（初始全部展开）
    var expandedTops = {};
    // 每个一级菜单各自记住当前激活的二级索引
    var activeSubByTop = {};
    MENU.forEach(function (top, i) { expandedTops[i] = true; });
    var saveTimers = {};
    var textSelectionButtonsEl = null;

    function applyValue(key, value) {
      if (saveTimers[key]) clearTimeout(saveTimers[key]);
      saveTimers[key] = setTimeout(function () {
        shell.setConfig(key, value).then(function () {
          showStatus('已应用');
        }).catch(function (e) {
          showStatus('应用失败：' + e);
        });
      }, 200);
    }

    function showStatus(msg) {
      statusEl.textContent = msg;
      statusEl.classList.add('show');
      if (gsap) {
        gsap.to(statusEl, { opacity: 1, duration: 0.2 });
        gsap.to(statusEl, { opacity: 0, duration: 0.4, delay: 1.2, onComplete: function () { statusEl.classList.remove('show'); } });
      } else {
        setTimeout(function () { statusEl.classList.remove('show'); }, 1500);
      }
    }

    function readColorList() {
      var arr = [];
      if (!colorListEl) return arr;
      var cols = colorListEl.querySelectorAll('input[type="color"]');
      for (var i = 0; i < cols.length; i++) arr.push(cols[i].value);
      return arr;
    }

    // 内嵌于主窗口的设置面板：左上角返回按钮关闭设置面板回到主界面（主窗口保留）；
    // 右上角 ✕ 关闭整个主窗口（标准窗口关闭行为，closeToTray 开启时最小化到托盘）；
    // 最小化按钮保留（最小化主窗口）。
    var btnBack = document.getElementById('btn-back');
    if (btnBack) {
      btnBack.onclick = function () {
        if (shell.closeSettings) shell.closeSettings();
      };
    }
    document.getElementById('btn-min').onclick = function () { shell.minimize(); };
    document.getElementById('btn-close').onclick = function () { shell.close(); };

    // 二次确认弹窗：破坏性操作（如重置默认）点击后弹出自定义确认框，确定才执行。
    function showConfirmDialog(message, onOk) {
      var overlay = document.createElement('div');
      overlay.className = 'ds-confirm-overlay';
      var card = document.createElement('div');
      card.className = 'ds-confirm-card';
      var title = document.createElement('div');
      title.className = 'ds-confirm-title';
      title.textContent = '确认操作';
      var msg = document.createElement('div');
      msg.className = 'ds-confirm-msg';
      msg.textContent = message;
      var actions = document.createElement('div');
      actions.className = 'ds-confirm-actions';
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ds-confirm-btn';
      cancelBtn.textContent = '取消';
      var okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'ds-confirm-btn ds-confirm-btn-primary';
      okBtn.textContent = '确定';
      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      card.appendChild(title);
      card.appendChild(msg);
      card.appendChild(actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      function close() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      cancelBtn.onclick = close;
      okBtn.onclick = function () { close(); if (onOk) onOk(); };
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
    }

    // 底部「重置默认」按钮：恢复全部设置为默认值。靠右下角 + 二次确认，避免误触。
    var btnReset = document.getElementById('btn-reset');
    if (btnReset) {
      btnReset.onclick = function () {
        showConfirmDialog('确定要恢复所有设置为默认值吗？此操作不可撤销。', function () {
          shell.resetConfig().then(function (res) {
            if (res) {
              showStatus('已恢复默认设置');
              renderSidebar();
              setSubSection();
            } else {
              showStatus('重置失败');
            }
          }).catch(function (e) {
            showStatus('重置失败：' + e);
          });
        });
      };
    }

    function applyThemeVars(vars) {
      // 全局字号基础已整体放大一号（非设置界面生效）；设置界面保持原大小：
      // --ds-font-size 不再额外 +1，仅保留 --ds-font-offset 相对偏移（供 calc() 字号使用）。
      var fs = parseInt(vars['--ds-font-size']) || 14;
      var offset = Number(vars['--ds-font-offset'] || 0);
      document.documentElement.style.setProperty('--ds-font-size', fs + 'px');
      document.documentElement.style.setProperty('--ds-font-offset', String(offset + 1));
      for (var k in vars) {
        if (k === '--ds-font-size' || k === '--ds-font-offset') continue;
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          document.documentElement.style.setProperty(k, vars[k]);
        }
      }
      var bg = vars['--ds-bg'] || '#ffffff';
      var isDark = /^#/.test(bg) ? parseInt(bg.replace('#', ''), 16) < 0x888888 : false;
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    }
    shell.onThemeVars(function (vars) { applyThemeVars(vars); });
    if (shell.requestThemeVars) {
      shell.requestThemeVars().then(function (vars) { applyThemeVars(vars); }).catch(function () {});
    }

    function accelFromEvent(e) {
      var key = e.key;
      if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta' || key === 'AltGraph') return null;
      var parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      var k = key;
      if (k === ' ') k = 'Space';
      else if (k === 'Escape') return 'Escape';
      else if (k.length === 1) k = k.toUpperCase();
      parts.push(k);
      return parts.join('+');
    }

    function makeShortcutControl(onCommit) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shortcut-btn empty';
      var current = '';
      var recording = false;
      function setText(v) {
        current = v || '';
        if (!current) {
          btn.textContent = '点击设置快捷键';
          btn.classList.add('empty');
        } else {
          btn.textContent = current;
          btn.classList.remove('empty');
        }
      }
      function stop() {
        if (!recording) return;
        recording = false;
        btn.classList.remove('recording');
        document.removeEventListener('keydown', onKey, true);
      }
      function onKey(e) {
        if (!recording) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') { setText(''); stop(); if (onCommit) onCommit(); return; }
        var accel = accelFromEvent(e);
        if (!accel) return;
        setText(accel);
        stop();
        if (onCommit) onCommit();
      }
      btn.addEventListener('click', function () {
        if (recording) { stop(); return; }
        recording = true;
        btn.classList.add('recording');
        btn.textContent = '请按下快捷键…（Esc 清除）';
        document.addEventListener('keydown', onKey, true);
      });
      btn.addEventListener('blur', stop);
      return { btn: btn, get: function () { return current; }, setText: setText };
    }

    /**
     * 自定义下拉选择器（加号菜单同款：毛玻璃深色浮层 + 圆角 + hover 高亮 + GSAP 动效）。
     * 原生 <select> 的弹出列表是系统渲染的，无法做样式/动效，故用 div 模拟。
     * 对外兼容原生 select 的接口：value 属性（get/set）、addEventListener('change')。
     */
    function makeCustomSelect(item) {
      var options = item.options || [];
      var currentValue = options.length && (options[0] && typeof options[0] === 'object' ? options[0].value : options[0]);
      currentValue = currentValue == null ? '' : currentValue;

      var box = document.createElement('div');
      box.className = 'ds-custom-select';

      var trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'ds-select-trigger';
      var labelEl = document.createElement('span');
      labelEl.className = 'ds-select-label';
      var arrowEl = document.createElement('span');
      arrowEl.className = 'ds-select-arrow';
      trigger.appendChild(labelEl);
      trigger.appendChild(arrowEl);

      var menu = document.createElement('div');
      menu.className = 'ds-select-menu';
      var menuOpen = false;

      function labelOf(v) {
        for (var i = 0; i < options.length; i++) {
          var o = options[i];
          if (o && typeof o === 'object') { if (String(o.value) === String(v)) return o.label; }
          else if (String(o) === String(v)) return o;
        }
        return String(v == null ? '' : v);
      }

      function render() {
        labelEl.textContent = labelOf(currentValue);
      }

      function buildMenu() {
        menu.innerHTML = '';
        options.forEach(function (o) {
          var v = o && typeof o === 'object' ? o.value : o;
          var l = o && typeof o === 'object' ? o.label : o;
          var el = document.createElement('div');
          el.className = 'ds-select-option' + (String(v) === String(currentValue) ? ' selected' : '');
          el.textContent = l;
          el.addEventListener('click', function () {
            setValue(v);
            close();
          });
          menu.appendChild(el);
        });
      }

      function open() {
        if (menuOpen) { close(); return; }
        menuOpen = true;
        box.classList.add('open');
        buildMenu();
        document.body.appendChild(menu);
        // 定位：优先向下展开，空间不足则向上
        var r = box.getBoundingClientRect();
        var mw = Math.max(r.width, 160);
        menu.style.minWidth = mw + 'px';
        menu.style.display = 'block';
        var mh = menu.offsetHeight;
        var spaceBelow = window.innerHeight - r.bottom - 8;
        var top = spaceBelow >= mh ? r.bottom + 4 : Math.max(8, r.top - mh - 4);
        menu.style.left = Math.min(r.left, window.innerWidth - mw - 8) + 'px';
        menu.style.top = top + 'px';
        menu.classList.add('open');
        if (gsap) {
          gsap.fromTo(menu,
            { opacity: 0, y: spaceBelow >= mh ? -6 : 6, scale: 0.98 },
            { opacity: 1, y: 0, scale: 1, duration: 0.18, ease: 'power2.out' });
        } else {
          menu.style.opacity = '1';
        }
      }

      function close() {
        if (!menuOpen) return;
        menuOpen = false;
        box.classList.remove('open');
        if (gsap && menu.parentNode) {
          gsap.to(menu, { opacity: 0, y: -4, scale: 0.98, duration: 0.12, ease: 'power1.in', onComplete: function () { if (menu.parentNode) menu.parentNode.removeChild(menu); } });
        } else if (menu.parentNode) {
          menu.parentNode.removeChild(menu);
        }
      }

      function setValue(v) {
        if (String(currentValue) === String(v)) { close(); return; }
        currentValue = v;
        render();
        box.dispatchEvent(new CustomEvent('change', { detail: { value: v } }));
      }

      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        open();
      });
      // 点击外部关闭
      document.addEventListener('click', function (e) {
        if (!menuOpen) return;
        if (menu.contains(e.target) || box.contains(e.target)) return;
        close();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') close();
      });

      // 兼容原生 select：value 属性
      Object.defineProperty(box, 'value', {
        get: function () { return currentValue; },
        set: function (v) { currentValue = v == null ? '' : v; render(); },
        configurable: true,
      });

      box.appendChild(trigger);
      render();
      return box;
    }

    function createControl(item) {
      if (item.type === 'checkbox') {
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        return cb;
      } else if (item.type === 'number') {
        var num = document.createElement('input');
        num.type = 'number';
        return num;
      } else if (item.type === 'select') {
        // 自定义下拉（加号菜单同款 + 动效），替代原生 select
        return makeCustomSelect(item);
      } else if (item.type === 'textarea') {
        var ta = document.createElement('textarea');
        return ta;
      } else if (item.type === 'shortcut') {
        var sc = makeShortcutControl(function () { applyValue(item.key, sc.get()); });
        return sc;
      } else if (item.type === 'textselection-buttons') {
        return makeTextSelectionButtonsControl();
      } else if (item.type === 'info') {
        var span = document.createElement('span');
        span.className = 'info-value';
        span.textContent = '加载中…';
        return span;
      } else if (item.type === 'action') {
        var btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = item.label;
        return btn;
      } else {
        var tx = document.createElement('input');
        tx.type = 'text';
        return tx;
      }
    }

    function makeTextSelectionButtonsControl() {
      var container = document.createElement('div');
      container.className = 'ts-buttons';
      textSelectionButtonsEl = container;

      var addBtn = document.createElement('button');
      addBtn.className = 'ts-btn-add';
      addBtn.textContent = '+ 添加按钮';
      addBtn.onclick = function () {
        var buttons = container.readButtons();
        buttons.push({ label: '新功能', prompt: '请分析以下内容：\n{content}' });
        container.renderButtons(buttons);
        container.saveButtons();
      };

      container.appendChild(addBtn);

      // 渲染但先由外部初始化
      var wrapper = document.createElement('div');
      wrapper.className = 'ts-buttons-list';
      container.insertBefore(wrapper, addBtn);

      container.renderButtons = function (buttons) {
        wrapper.innerHTML = '';
        if (!Array.isArray(buttons) || buttons.length === 0) {
          buttons = [{ label: '复制', prompt: '' }];
        }
        buttons.forEach(function (btn, idx) {
          var row = document.createElement('div');
          row.className = 'ts-button-row';
          row.draggable = true;
          row.setAttribute('data-index', idx);

          // 拖拽手柄
          var dragHandle = document.createElement('span');
          dragHandle.className = 'ts-btn-drag';
          dragHandle.innerHTML = '⠿';
          dragHandle.title = '拖拽排序';
          row.appendChild(dragHandle);

          var labelInput = document.createElement('input');
          labelInput.type = 'text';
          labelInput.className = 'ts-btn-label';
          labelInput.value = btn.label || '';
          labelInput.placeholder = '按钮名称';
          labelInput.addEventListener('input', function () { container.saveButtons(); });

          if (btn.type === 'quote') {
            // 问问DeepSeek：无提示词编辑，显示说明文字
            row.appendChild(labelInput);
            var quoteHint = document.createElement('span');
            quoteHint.className = 'ts-btn-quote-hint';
            quoteHint.textContent = '（引用模式：将选中文本用括号括起发送到输入框）';
            row.appendChild(quoteHint);
          } else if (btn.label === '复制') {
            var labelSpan = document.createElement('span');
            labelSpan.className = 'ts-btn-copy-hint';
            labelSpan.textContent = '（仅复制，无需提示词）';
            labelSpan.style.cssText = 'flex:1;font-size:calc(11px + var(--ds-font-offset, 0) * 1px);color:#999;padding:5px 8px;min-width:0;';
            row.appendChild(labelInput);
            row.appendChild(labelSpan);
          } else {
            var promptInput = document.createElement('textarea');
            promptInput.className = 'ts-btn-prompt';
            promptInput.value = btn.prompt || '';
            promptInput.placeholder = '提示词模板（{content} 为选中文本）';
            promptInput.rows = 2;
            promptInput.addEventListener('input', function () { container.saveButtons(); });
            row.appendChild(labelInput);
            row.appendChild(promptInput);
          }

          var delBtn = document.createElement('button');
          delBtn.className = 'ts-btn-del';
          delBtn.textContent = '×';
          delBtn.title = '删除此按钮';
          delBtn.onclick = function () {
            buttons.splice(idx, 1);
            container.renderButtons(buttons);
            container.saveButtons();
          };

          row.appendChild(delBtn);
          wrapper.appendChild(row);
        });

        // 拖拽排序事件 - 简化版：只在 drop 时执行排序
        var draggedRow = null;
        var placeholder = null;

        wrapper.addEventListener('dragstart', function (e) {
          var row = e.target.closest('.ts-button-row');
          if (!row) return;
          draggedRow = row;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', '');
          // 创建占位符
          placeholder = document.createElement('div');
          placeholder.className = 'ts-button-row ts-drag-placeholder';
          placeholder.style.height = row.offsetHeight + 'px';
          placeholder.style.opacity = '0.3';
          row.parentNode.insertBefore(placeholder, row.nextSibling);
          // 延迟添加 dragging 类，避免影响拖拽图像
          setTimeout(function () { row.classList.add('dragging'); }, 0);
        });

        wrapper.addEventListener('dragover', function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!draggedRow || !placeholder) return;

          var afterElement = getDragAfterElement(wrapper, e.clientY);
          if (afterElement == null) {
            wrapper.appendChild(placeholder);
          } else {
            wrapper.insertBefore(placeholder, afterElement);
          }
        });

        wrapper.addEventListener('drop', function (e) {
          e.preventDefault();
          if (!draggedRow || !placeholder) return;

          // 将拖动的元素插入到占位符位置
          placeholder.parentNode.insertBefore(draggedRow, placeholder);
          // 移除占位符和 dragging 类
          placeholder.remove();
          draggedRow.classList.remove('dragging');
          draggedRow = null;
          placeholder = null;

          // 从 DOM 读取新顺序并保存
          var allRows = wrapper.querySelectorAll('.ts-button-row');
          var newButtons = [];
          allRows.forEach(function (r) {
            var label = r.querySelector('.ts-btn-label').value.trim();
            var promptEl = r.querySelector('.ts-btn-prompt');
            var prompt = promptEl ? promptEl.value.trim() : '';
            var type = r.querySelector('.ts-btn-quote-hint') ? 'quote' : undefined;
            if (label) {
              var btn = { label: label, prompt: prompt };
              if (type) btn.type = type;
              newButtons.push(btn);
            }
          });
          // 更新闭包中的 buttons 数组并保存
          buttons = newButtons;
          container.saveButtons();
        });

        wrapper.addEventListener('dragend', function () {
          if (draggedRow) draggedRow.classList.remove('dragging');
          if (placeholder) placeholder.remove();
          draggedRow = null;
          placeholder = null;
        });

        // 辅助函数：获取鼠标位置后应该插入的元素
        function getDragAfterElement(container, y) {
          var draggableElements = Array.from(container.querySelectorAll('.ts-button-row:not(.dragging):not(.ts-drag-placeholder)'));
          return draggableElements.reduce(function (closest, child) {
            var box = child.getBoundingClientRect();
            var offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
              return { offset: offset, element: child };
            } else {
              return closest;
            }
          }, { offset: Number.NEGATIVE_INFINITY }).element;
        }
      };

      container.readButtons = function () {
        var rows = wrapper.querySelectorAll('.ts-button-row');
        var buttons = [];
        rows.forEach(function (row) {
          var label = row.querySelector('.ts-btn-label').value.trim();
          var promptEl = row.querySelector('.ts-btn-prompt');
          var prompt = promptEl ? promptEl.value.trim() : '';
          var type = row.querySelector('.ts-btn-quote-hint') ? 'quote' : undefined;
          if (label) {
            var btn = { label: label, prompt: prompt };
            if (type) btn.type = type;
            buttons.push(btn);
          }
        });
        if (buttons.length === 0) {
          buttons = [{ label: '复制', prompt: '' }];
        }
        return buttons;
      };

      container.saveButtons = function () {
        var buttons = container.readButtons();
        if (buttons.length === 0) {
          buttons = [{ label: '复制', prompt: '' }];
        }
        var val = JSON.stringify(buttons);
        inputs['textSelectionButtons'] = { value: val };
        applyValue('textSelectionButtons', val);
      };

      return container;
    }

    function makeUpdateControl() {
      var wrap = document.createElement('div');
      wrap.className = 'update-wrap';

      // ---- 版本信息头部卡片 ----
      var hero = document.createElement('div');
      hero.className = 'update-hero';

      var heroIcon = document.createElement('div');
      heroIcon.className = 'update-hero-icon';
      // DeepSeek 官方鲸鱼 logo（fill 用 currentColor 跟随主题强调色）
      heroIcon.innerHTML =
        '<svg width="30" height="21" viewBox="0 0 35 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<g clip-path="url(#dsUpdateClip)">' +
        '<path fill="currentColor" d="M26.5542 4.34393C26.2719 4.20592 26.1506 4.46928 25.9856 4.60268C25.9292 4.64581 25.8815 4.70216 25.8338 4.75391C25.4215 5.19438 24.9396 5.48361 24.3105 5.44911C23.3905 5.39736 22.605 5.68659 21.9104 6.39041C21.7626 5.52271 21.2721 5.00462 20.5258 4.67226C20.1353 4.49976 19.7403 4.32668 19.4666 3.95119C19.2757 3.68381 19.2234 3.38595 19.1279 3.09211C19.0669 2.91501 19.0066 2.73388 18.8024 2.7034C18.5811 2.6689 18.4942 2.85463 18.4074 3.00989C18.0601 3.6447 17.9255 4.34393 17.9388 5.05235C17.9692 6.64572 18.642 7.91478 19.9789 8.81756C20.1307 8.92106 20.1698 9.02457 20.1221 9.1758C20.0307 9.48688 19.9226 9.78876 19.8271 10.0998C19.7662 10.2982 19.6753 10.3419 19.4626 10.2551C18.7288 9.94862 18.0952 9.49493 17.5351 8.94694C16.5846 8.02749 15.7249 7.01258 14.6531 6.21791C14.4013 6.03218 14.1494 5.85967 13.8889 5.69522C12.7952 4.63316 14.0321 3.76086 14.3185 3.65736C14.618 3.54925 14.4225 3.17779 13.4548 3.18239C12.487 3.18642 11.6015 3.51073 10.4727 3.94256C10.3077 4.00754 10.1341 4.05469 9.95637 4.09379C8.93227 3.89944 7.86849 3.85631 6.75755 3.98167C4.66564 4.21455 2.99464 5.20358 1.7664 6.89183C0.290908 8.92106 -0.0564026 11.2269 0.368535 13.6316C0.815324 16.1663 2.10911 18.2645 4.09695 19.905C6.15838 21.6059 8.53263 22.4397 11.2415 22.2799C12.8867 22.185 14.7181 21.9648 16.7841 20.2161C17.3051 20.4755 17.8519 20.579 18.7587 20.6566C19.4574 20.7216 20.1302 20.6221 20.6511 20.514C21.4671 20.3415 21.4107 19.5859 21.1157 19.4473C18.7242 18.3335 19.2492 18.7866 18.772 18.4198C19.987 16.9822 21.8431 14.4269 22.4158 10.9474C22.4722 10.5633 22.5441 10.0222 22.5355 9.71114C22.5309 9.52138 22.5746 9.44778 22.7913 9.42593C23.3905 9.35693 23.9718 9.19305 24.506 8.89921C26.0557 8.05279 26.6808 6.6624 26.828 4.996C26.8498 4.74126 26.8234 4.47791 26.5542 4.34393ZM13.0511 19.3438C10.7332 17.5216 9.60906 16.9219 9.14502 16.9477C8.71089 16.9736 8.78909 17.4704 8.88454 17.7942C8.98459 18.1139 9.11455 18.3341 9.29683 18.6147C9.42276 18.8004 9.50959 19.0764 9.1709 19.284C8.42453 19.7458 7.12671 19.1288 7.06576 19.0983C5.55519 18.2087 4.29245 17.0346 3.40233 15.4285C2.54268 13.8829 2.04356 12.2245 1.96133 10.4546C1.93948 10.0274 2.06541 9.87617 2.49092 9.79854C3.05099 9.69504 3.62831 9.67319 4.1878 9.75541C6.55342 10.101 8.56713 11.1585 10.2554 12.8341C11.2191 13.788 11.9482 14.9283 12.6992 16.0421C13.4979 17.2249 14.357 18.3519 15.4512 19.276C15.8377 19.5997 16.1459 19.8458 16.4408 20.0275C15.5513 20.127 14.0666 20.1483 13.0511 19.345V19.3438ZM14.162 12.1981C14.162 12.0083 14.3139 11.8571 14.5048 11.8571C14.5479 11.8571 14.587 11.8657 14.6221 11.8784C14.6698 11.8956 14.7135 11.9215 14.748 11.9606C14.8089 12.021 14.8434 12.1072 14.8434 12.1981C14.8434 12.3878 14.6916 12.5391 14.5007 12.5391C14.3098 12.5391 14.162 12.3878 14.162 12.1981ZM17.6127 13.968C17.3913 14.0588 17.17 14.1365 16.9572 14.1451C16.6271 14.1623 16.2672 14.0284 16.0717 13.8645C15.7681 13.6098 15.5507 13.4671 15.4599 13.0227C15.4208 12.8329 15.4426 12.5391 15.4771 12.3706C15.5553 12.0078 15.4685 11.7749 15.2126 11.5633C15.0045 11.3908 14.7394 11.343 14.4484 11.343C14.3397 11.343 14.2403 11.2953 14.1661 11.2568C14.0447 11.1964 13.9447 11.0452 14.0401 10.8594C14.0706 10.7991 14.2184 10.6524 14.2529 10.6266C14.6479 10.4017 15.1034 10.4753 15.5248 10.6438C15.9153 10.8037 16.2108 11.0969 16.6358 11.5115C17.0699 12.0124 17.1481 12.1504 17.3954 12.5264C17.5909 12.8203 17.7686 13.1221 17.8905 13.4677C17.9641 13.6834 17.8686 13.8599 17.6127 13.968Z"/>' +
        '</g><defs><clipPath id="dsUpdateClip"><rect width="26.634" height="19.6" fill="white" transform="translate(0.199951 2.69922)"></rect></clipPath></defs></svg>';

      var heroMeta = document.createElement('div');
      heroMeta.className = 'update-hero-meta';
      var heroName = document.createElement('div');
      heroName.className = 'update-hero-name';
      heroName.textContent = 'DeepSeek 桌面版';
      var heroVer = document.createElement('div');
      heroVer.className = 'update-hero-ver';
      heroVer.textContent = 'v…';
      heroMeta.appendChild(heroName);
      heroMeta.appendChild(heroVer);

      var heroState = document.createElement('div');
      heroState.className = 'update-hero-state';
      heroState.textContent = '待检查';

      hero.appendChild(heroIcon);
      hero.appendChild(heroMeta);
      hero.appendChild(heroState);
      wrap.appendChild(hero);

      // ---- 操作按钮行 ----
      var actions = document.createElement('div');
      actions.className = 'update-actions';

      var checkBtn = document.createElement('button');
      checkBtn.type = 'button';
      checkBtn.className = 'update-check-btn';
      checkBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><polyline points="21 3 21 9 15 9"/></svg> 检查更新';

      var openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'update-open-btn';
      openBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> 前往 GitHub Release 页面';
      openBtn.addEventListener('click', function () {
        shell.openReleases();
      });

      actions.appendChild(checkBtn);
      actions.appendChild(openBtn);
      wrap.appendChild(actions);

      // ---- 检查结果卡片 ----
      var result = document.createElement('div');
      result.className = 'update-result-card';
      result.style.display = 'none';
      wrap.appendChild(result);

      function setState(text) {
        heroState.textContent = text;
      }

      function renderResult(info) {
        result.style.display = 'block';
        result.innerHTML = '';
        result.className = 'update-result-card';
        if (!info || info.error) {
          result.classList.add('update-result-error');
          setState('检查失败');
          var errText = document.createElement('div');
          errText.className = 'update-err-text';
          errText.textContent = '检查更新失败：' + ((info && info.error) || '未知错误');
          result.appendChild(errText);
          return;
        }
        if (info.hasUpdate) {
          result.classList.add('update-result-new');
          setState('发现新版本');
          var title = document.createElement('div');
          title.className = 'update-new-title';
          title.textContent = '发现新版本 v' + info.latestVersion;
          result.appendChild(title);
          if (info.releaseNotes) {
            var notes = document.createElement('div');
            notes.className = 'update-notes';
            notes.textContent = info.releaseNotes.length > 500 ? info.releaseNotes.slice(0, 500) + '…' : info.releaseNotes;
            result.appendChild(notes);
          }
          // 有安装包资产时支持软件内下载安装
          if (info.assets && info.assets.length > 0) {
            var dlBtn = document.createElement('button');
            dlBtn.type = 'button';
            dlBtn.className = 'update-dl-btn';
            dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 下载并安装更新';
            result.appendChild(dlBtn);

            // 进度条
            var progressWrap = document.createElement('div');
            progressWrap.className = 'update-progress';
            progressWrap.style.display = 'none';
            progressWrap.innerHTML =
              '<div class="update-progress-bar"><div class="update-progress-fill"></div></div>' +
              '<div class="update-progress-text">准备下载…</div>';
            result.appendChild(progressWrap);

            var fill = progressWrap.querySelector('.update-progress-fill');
            var progText = progressWrap.querySelector('.update-progress-text');
            var fmtMb = function (n) { return (n / 1024 / 1024).toFixed(1) + ' MB'; };
            var progressListener = null;

            // 订阅下载进度（仅注册一次；旧实例的 DOM 已卸载时跳过，避免误更新）
            function ensureProgressListener() {
              if (progressListener) return;
              progressListener = function (p) {
                // 只处理设置面板自己的下载进度（更新弹框的进度带 receiver='prompt'，忽略）
                if (p.receiver && p.receiver !== 'settings') return;
                if (!fill.isConnected) return;
                fill.style.width = (p.percent || 0) + '%';
                progText.textContent =
                  p.total > 0
                    ? '正在下载 ' + fmtMb(p.received) + ' / ' + fmtMb(p.total) + '（' + p.percent + '%）'
                    : '正在下载 ' + fmtMb(p.received) + '…';
              };
              shell.onUpdateDownloadProgress(progressListener);
            }

            function doDownload() {
              ensureProgressListener();
              dlBtn.disabled = true;
              dlBtn.textContent = '下载中…';
              progressWrap.style.display = 'block';
              fill.style.width = '0%';
              progText.textContent = '准备下载…';
              shell.downloadUpdate().then(function (res) {
                if (!res || !res.ok || !res.path) {
                  dlBtn.disabled = false;
                  dlBtn.textContent = '重试下载';
                  progText.textContent = '下载失败：' + ((res && res.error) || '未知错误');
                  return;
                }
                fill.style.width = '100%';
                progText.textContent = '下载完成，正在打开安装程序…';
                // 自动唤起安装包
                return shell.launchInstaller(res.path).then(function (lr) {
                  dlBtn.disabled = false;
                  dlBtn.textContent = '重新打开安装程序';
                  if (lr && !lr.ok) {
                    progText.textContent = '打开安装程序失败：' + (lr.error || '未知错误');
                  } else {
                    progText.textContent = '安装程序已打开，请按提示完成安装。安装完成后建议重新启动本程序。';
                  }
                });
              }).catch(function (e) {
                dlBtn.disabled = false;
                dlBtn.textContent = '重试下载';
                progText.textContent = '下载失败：' + e;
              });
            }
            dlBtn.addEventListener('click', doDownload);
          } else {
            // 无安装包资产时仅提供跳转页面
            var pageBtn = document.createElement('button');
            pageBtn.type = 'button';
            pageBtn.className = 'update-dl-btn';
            pageBtn.textContent = '前往下载';
            pageBtn.addEventListener('click', function () {
              shell.openReleases();
            });
            result.appendChild(pageBtn);
          }
        } else {
          result.classList.add('update-result-ok');
          setState('已是最新版本');
          var okText = document.createElement('div');
          okText.className = 'update-ok-text';
          okText.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> 当前已是最新版本，无需更新';
          result.appendChild(okText);
        }
      }

      function doCheck() {
        checkBtn.disabled = true;
        checkBtn.textContent = '检查中…';
        setState('正在检查更新');
        shell.checkUpdate(true).then(function (info) {
          renderResult(info);
          checkBtn.disabled = false;
          checkBtn.textContent = '再次检查';
        }).catch(function (e) {
          result.style.display = 'block';
          result.className = 'update-result-card update-result-error';
          result.innerHTML = '';
          var errText = document.createElement('div');
          errText.className = 'update-err-text';
          errText.textContent = '检查更新失败：' + e;
          result.appendChild(errText);
          setState('检查失败');
          checkBtn.disabled = false;
          checkBtn.textContent = '重试';
        });
      }
      checkBtn.addEventListener('click', doCheck);

      // 初始静默填充版本号（优先走缓存），不显示「检查中」以免长时间停留；
      // 真正检查由用户点击「检查更新」按钮触发
      shell.checkUpdate(false).then(function (info) {
        heroVer.textContent = 'v' + ((info && (info.currentVersionDisplay || info.currentVersion)) || '未知');
        if (info && info.hasUpdate) {
          renderResult(info);
        } else if (info && !info.error) {
          setState('已是最新版本');
        }
        // 检查失败时保持「待检查」，等用户手动点击检查更新
      }).catch(function () {
        heroVer.textContent = 'v未知';
      });

      return wrap;
    }

    // ---- 详细说明书内容：按功能分组排版，逐一说明特色项及所在位置 ----
    var MANUAL_GROUPS = [
        ['窗口与切换', [
          ['主副窗口切换', '点击标题栏右侧的 ⇄ 按钮，在主窗口与副窗口之间来回切换，副窗口适合边查边聊、多任务并行。', '标题栏 ⇄ 按钮'],
          ['一键呼出副窗口', '无论你在哪个应用，按 左 Alt + 空格 即可随时呼出或隐藏副窗口。', '设置 → 应用 → 快捷键'],
          ['副窗口默认置顶', '副窗口和提问小窗默认显示在其他窗口之上，不被遮挡。', '设置 → 应用 → 窗口'],
          ['关闭行为', '点击窗口关闭按钮时，可选择直接退出程序，或最小化到系统托盘继续运行。', '设置 → 应用 → 窗口'],
          ['开机自启', '登录系统时自动启动本程序并最小化到系统托盘，不显示主窗口；手动打开仍正常显示主界面。', '设置 → 应用 → 窗口'],
          ['手动启动最小化到托盘', '开启后，手动打开程序时也直接最小化到系统托盘，不显示主窗口。', '设置 → 应用 → 窗口'],
        ]],
        ['快捷键', [
          ['截图快捷键', '一键唤起截图（默认 左 Alt + C），截取后可翻译、提取文字、解释或向 AI 提问。', '设置 → 应用 → 快捷键'],
          ['副窗呼出键', '一键呼出或隐藏副窗口（默认 左 Alt + 空格）。', '设置 → 应用 → 快捷键'],
          ['划词开关快捷键', '一键开启或关闭划词功能，避免工作时误弹出。', '设置 → 应用 → 快捷键'],
        ]],
        ['截图与识图', [
          ['一键截图提问', '按快捷键或点击聊天框旁的剪刀按钮，截取屏幕选区，直接向 AI 提问。', '左 Alt + C 或剪刀按钮'],
          ['标注画笔', '截图时可用画笔、矩形、椭圆标注重点，画笔颜色可自定义。', '设置 → 工具 → 截图'],
          ['识图模式', '新建对话默认使用识图模式后，AI 直接理解图片内容。', '设置 → 对话 → 模型行为'],
        ]],
        ['划词', [
          ['划词即用', '选中任意文字，无需任何快捷键，划词工具栏自动弹出。', '设置 → 工具 → 划词'],
          ['自定义按钮', '默认提供复制、翻译、解释、问问 DeepSeek，可增删、拖拽排序、自定义提示词。', '设置 → 工具 → 划词'],
        ]],
        ['对话', [
          ['深度思考', '回答前展示详细推理过程，适合复杂问题。', '设置 → 对话 → 模型行为'],
          ['智能搜索', '自动联网搜索最新信息，辅助回答。', '设置 → 对话 → 模型行为'],
          ['折叠思考过程', '深度思考过程默认折叠收起，界面更简洁。', '设置 → 对话 → 模型行为'],
          ['默认模型模式', '快速 / 专家 / 识图三档，新建对话时自动应用。', '设置 → 对话 → 模型行为'],
          ['开关自动同步', '新建对话或切换会话时，深度思考与智能搜索自动按设置恢复，不会被网页记住的手动状态带偏。', '自动生效'],
          ['提问小窗清理', '关闭提问小窗（截图翻译、解释等，含说明书「问问AI」）时自动删除该次对话记录。', '设置 → 对话 → 对话管理'],
        ]],
        ['共享屏幕', [
          ['共享屏幕', '发送消息时自动附带当前屏幕截图，适合远程演示与求助，屏幕四角会显示共享指示框。', '聊天框 + 按钮 → 共享屏幕'],
          ['自动切识图模式', '点击「共享屏幕」时自动切换到识图模式，以便直接理解图片内容；可在设置中关闭。', '设置 → 对话 → 共享设置'],
          ['模式提示', '若当前对话已无法切换模型（已有对话），快速模式会提示「只支持 OCR 识别，可能不精准」；专家模式会提示「不支持上传图片」且不开启共享屏幕。', '聊天框 + 按钮 → 共享屏幕'],
          ['模式提示开关', '模式提示弹窗默认开启，点「不再提醒」后不再弹出，可在设置中随时重新开启。', '设置 → 对话 → 共享设置'],
          ['共享文档', 'WPS 中打开 Word 文档后，点击「+」→「共享文档」，在输入框上方选择要共享的文档；发送时会自动带上该文档最新内容。', '聊天框 + 按钮 → 共享WPS Word'],
          ['共享WPS Excel', 'WPS 表格中打开工作簿后，点击「+」→「共享WPS Excel」，在输入框上方选择要共享的工作簿；发送时会自动带上该工作簿最新内容。', '聊天框 + 按钮 → 共享WPS Excel'],
          ['文档自动重新提交', '同一对话内文档提交后，WPS Word 超过 70 万字（可在设置修改轮数，默认 15）与 WPS Excel 超过 10 万字（可在设置修改轮数，默认 15）自动按轮数重新提交最新版；其余文档仅在检测到改动时立即重新提交。', '设置 → 对话 → 共享设置'],
        ]],
        ['翻译', [
          ['默认翻译语言', '设置截图翻译、划词翻译默认输出的目标语言。', '设置 → 工具 → 翻译'],
        ]],
        ['个性化', [
          ['主题', '浅色 / 深色 / 跟随系统三种模式，界面自动适配。', '设置 → 应用 → 常规'],
          ['全局字号', '界面字号整体微调（-10 ~ +10），设置界面与网页对话内容同步放大缩小。', '设置 → 应用 → 常规'],
          ['提示词模板', '识图、提取文字、翻译、解释等功能的提示词均可自定义。', '设置 → 对话 → 提示词'],
        ]],
        ['通知与提醒', [
          ['通知总开关', '关闭后所有系统通知（截图、操作、划词、快捷键、回答完成）一律不再弹出。', '设置 → 应用 → 通知'],
          ['回答完成提醒', 'AI 回答完成时，若窗口在后台或你已切到其他会话，会弹通知提醒；点击通知可跳回原会话。', '设置 → 应用 → 通知'],
          ['分类通知控制', '截图反馈、操作反馈、划词反馈、快捷键提示可分别开关，按需保留关注的通知。', '设置 → 应用 → 通知'],
        ]],
        ['使用说明', [
          ['说明书问问 AI', '在「详细说明书」页面点击「看不懂，问问AI？」，会打开一个提问小窗并把整份说明书作为文档上传给 AI，看不懂的地方可直接提问；关闭小窗时按「提问小窗清理」设置自动删除该次对话。', '设置 → 帮助 → 使用说明 → 详细说明书'],
        ]],
        ['更新与数据', [
          ['软件内更新', '自动检查新版本，发现后一键下载并唤起安装；也可手动检查。', '设置 → 应用 → 更新'],
          ['导出对话数据', '将对话记录导出保存，方便备份与迁移。', '设置 → 个人中心 → 数据'],
          ['账号管理', '查看登录状态、退出登录。', '设置 → 个人中心 → 账号'],
        ]],
      ];

    /** 生成说明书 HTML（分类排版展示）。 */
    function buildManualHtml() {
      return MANUAL_GROUPS.map(function (g) {
        var items = g[1].map(function (it) {
          return '<div class="manual-item">' +
            '<div class="manual-item-name">' + it[0] + '</div>' +
            '<div class="manual-item-desc">' + it[1] + '</div>' +
            '<div class="manual-item-where">' + it[2] + '</div>' +
            '</div>';
        }).join('');
        return '<div class="manual-group">' +
          '<div class="manual-group-title">' + g[0] + '</div>' +
          '<div class="manual-items">' + items + '</div>' +
          '</div>';
      }).join('');
    }

    /**
     * 生成完整说明书 Markdown（提交给 AI 解读用）：
     * 分组标题 + 每条功能说明 + 末尾引导 AI 仔细阅读并请用户提问的提示语。
     */
    function buildManualMarkdown() {
      var lines = ['# DeepSeek 桌面版详细说明书', ''];
      MANUAL_GROUPS.forEach(function (g) {
        lines.push('## ' + g[0]);
        lines.push('');
        g[1].forEach(function (it) {
          lines.push('### ' + it[0]);
          lines.push(it[1]);
          lines.push('');
          lines.push('所在位置：' + it[2]);
          lines.push('');
        });
      });
      lines.push('---');
      lines.push('请你仔细阅读说明书文件，我将问你相关问题，请你用最直白，最简单，最不绕弯子的话和我解释，阅读完回复请问有什么问题？并给出三个用户想问的例子问题');
      return lines.join('\n');
    }

    var MANUAL_CONTENT = buildManualHtml();

    /**
     * 「详细说明书」面板内子页：不切换左侧导航，直接在面板中展示说明书，
     * 顶部提供「返回」按钮回到使用说明板块。
     */
    function renderManual() {
      var old = panelBody.children;
      function fill() {
        panelBody.innerHTML = '';
        // 子页头部：返回按钮 + 标题
        var head = document.createElement('div');
        head.className = 'manual-head';
        var backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'manual-back-btn';
        backBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> 返回使用说明';
        backBtn.addEventListener('click', setSubSection);
        head.appendChild(backBtn);
        var title = document.createElement('div');
        title.className = 'manual-head-title';
        title.textContent = '详细说明书';
        head.appendChild(title);
        // 说明书搜索框：按文字过滤说明条目
        var search = document.createElement('input');
        search.type = 'text';
        search.className = 'manual-search-input';
        search.placeholder = '搜索说明书…';
        head.appendChild(search);
        // 「看不懂，问问AI？」：打开副窗口，把说明书提交到快速模式对话并发送，AI 帮你解读
        var askBtn = document.createElement('button');
        askBtn.type = 'button';
        askBtn.className = 'manual-ask-btn';
        askBtn.title = '打开副窗口，将整份说明书提交给 AI，看不懂的地方可以直接向它提问';
        askBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4"/><path d="M12 16h.01"/><circle cx="12" cy="12" r="10"/></svg> 看不懂，问问AI？';
        askBtn.addEventListener('click', function () {
          var md = buildManualMarkdown();
          if (!md) return;
          askBtn.disabled = true;
          askBtn.textContent = '正在提交…';
          shell.send('manual:askAi', md);
          showStatus('已在副窗口提交说明书，可直接向 AI 提问');
          setTimeout(function () {
            askBtn.disabled = false;
            askBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4"/><path d="M12 16h.01"/><circle cx="12" cy="12" r="10"/></svg> 看不懂，问问AI？';
          }, 3000);
        });
        head.appendChild(askBtn);
        panelBody.appendChild(head);
        // 说明书内容
        var doc = document.createElement('div');
        doc.className = 'manual-doc';
        doc.innerHTML = MANUAL_CONTENT;
        panelBody.appendChild(doc);
        // 过滤逻辑：隐藏不匹配的条目，组内全不匹配则隐藏整组
        search.addEventListener('input', function () {
          var q = search.value.trim().toLowerCase();
          var groups = doc.querySelectorAll('.manual-group');
          var items = doc.querySelectorAll('.manual-item');
          if (!q) {
            items.forEach(function (it) { it.style.display = ''; });
            groups.forEach(function (g) { g.style.display = ''; });
            return;
          }
          groups.forEach(function (g) {
            var gItems = g.querySelectorAll('.manual-item');
            var any = false;
            gItems.forEach(function (it) {
              var hit = (it.textContent || '').toLowerCase().indexOf(q) !== -1;
              it.style.display = hit ? '' : 'none';
              if (hit) any = true;
            });
            g.style.display = any ? '' : 'none';
          });
        });
        if (gsap) {
          gsap.fromTo(panelBody.children, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.25, stagger: 0.03, ease: 'power2.out' });
        }
      }
      if (old.length && gsap) {
        gsap.to(old, { opacity: 0, y: -6, duration: 0.15, stagger: 0.015, ease: 'power1.in', onComplete: fill });
      } else {
        fill();
      }
    }

    /** 创建带悬浮解释的问号图标（?）。 */
    function makeHintIcon(text) {
      var hint = document.createElement('span');
      hint.className = 'hint-icon';
      hint.textContent = '?';
      hint.setAttribute('data-tooltip', text);
      // 悬浮提示框
      var tooltip = null;
      var showTimer = null;
      hint.addEventListener('mouseenter', function (e) {
        clearTimeout(showTimer);
        showTimer = setTimeout(function () {
          if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'ts-tooltip';
            tooltip.textContent = hint.getAttribute('data-tooltip');
            document.body.appendChild(tooltip);
          }
          var rect = hint.getBoundingClientRect();
          tooltip.style.left = Math.round(rect.right + 8) + 'px';
          tooltip.style.top = Math.round(rect.top + rect.height / 2) + 'px';
          tooltip.style.transform = 'translateY(-50%)';
          tooltip.classList.add('show');
        }, 300);
      });
      hint.addEventListener('mouseleave', function () {
        clearTimeout(showTimer);
        if (tooltip) tooltip.classList.remove('show');
      });
      return hint;
    }

    /** 创建一个带左侧标题的数字输入框（用于共享文件提交轮数分组）。 */
    function makeNumberField(key, labelText) {
      var wrap = document.createElement('div');
      wrap.className = 'doc-round-field';
      var lab = document.createElement('label');
      lab.textContent = labelText;
      wrap.appendChild(lab);
      var input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.setAttribute('data-key', key);
      input.addEventListener('input', function () {
        var v = Math.max(1, Math.round(Number(input.value) || 0));
        applyValue(key, v);
      });
      wrap.appendChild(input);
      return wrap;
    }

    /** 「共享文件提交轮数」分组框：标题 + 统一问号解释 + Word/Excel 两行（轮数 + 触发阈值）。 */
    function buildDocShareRoundsField(item) {
      var group = document.createElement('div');
      group.className = 'doc-rounds-group';
      group.style.opacity = '0';
      group.style.transform = 'translateY(8px)';

      var titleRow = document.createElement('div');
      titleRow.className = 'doc-rounds-title';
      var titleText = document.createElement('span');
      titleText.textContent = item.label;
      titleRow.appendChild(titleText);
      if (item.hint) titleRow.appendChild(makeHintIcon(item.hint));
      group.appendChild(titleRow);

      [
        { name: 'WPS Word', roundsKey: 'docShareWpsWordLargeRounds', thresholdKey: 'docShareWpsWordLargeThreshold' },
        { name: 'WPS Excel', roundsKey: 'docShareWpsExcelLargeRounds', thresholdKey: 'docShareWpsExcelLargeThreshold' },
        { name: 'WPS PDF', roundsKey: 'docSharePdfLargeRounds', thresholdKey: 'docSharePdfLargeThreshold' },
      ].forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'doc-round-row';
        var name = document.createElement('div');
        name.className = 'doc-round-name';
        name.textContent = r.name;
        row.appendChild(name);
        row.appendChild(makeNumberField(r.roundsKey, '提交轮数'));
        row.appendChild(makeNumberField(r.thresholdKey, '触发阈值'));
        group.appendChild(row);
      });
      return group;
    }

    function buildField(item) {
      if (item.type === 'docshare-rounds') {
        return buildDocShareRoundsField(item);
      }
      var field = document.createElement('div');
      field.className = 'field';
      field.style.opacity = '0';
      field.style.transform = 'translateY(8px)';
      // 更新板块为整行卡片式设计，不显示左侧固定宽度的标签
      if (item.type !== 'update') {
        var label = document.createElement('label');
        label.textContent = item.label;
        field.appendChild(label);

        if (item.hint) {
          label.appendChild(makeHintIcon(item.hint));
        }
      }

      if (item.type === 'colorlist') {
        colorListEl = document.createElement('div');
        colorListEl.className = 'colors';
        field.appendChild(colorListEl);
        inputs[item.key] = {
          get: function () {
            var arr = [];
            var cols = colorListEl.querySelectorAll('input[type="color"]');
            for (var i = 0; i < cols.length; i++) arr.push(cols[i].value);
            return arr;
          }
        };
      } else if (item.type === 'info') {
        var ctrl = createControl(item);
        field.appendChild(ctrl);
        inputs[item.key] = ctrl;
      } else if (item.type === 'action') {
        var ctrl = createControl(item);
        field.appendChild(ctrl);
        inputs[item.key] = ctrl;
        ctrl.addEventListener('click', function () {
          if (item.confirm && !confirm(item.confirm)) return;
          // send 型动作：单向通知主进程，无需返回值（如打开使用说明引导）
          if (item.send) {
            shell.send(item.action);
            return;
          }
          ctrl.disabled = true;
          ctrl.textContent = '处理中…';
          shell.invoke(item.action).then(function (res) {
            if (res && res.ok) {
              showStatus('操作成功');
            } else if (res && res.error) {
              showStatus(res.error);
            }
            ctrl.disabled = false;
            ctrl.textContent = item.label;
          }).catch(function (e) {
            showStatus('操作失败：' + e);
            ctrl.disabled = false;
            ctrl.textContent = item.label;
          });
        });
      } else if (item.type === 'textselection-buttons') {
        var ctrl = createControl(item);
        field.appendChild(ctrl);
        inputs[item.key] = ctrl;
      } else if (item.type === 'fontsize') {
        // 全局字号 +/- 按钮
        var ctrl = document.createElement('div');
        ctrl.className = 'fontsize-control';
        var minusBtn = document.createElement('button');
        minusBtn.className = 'fontsize-btn';
        minusBtn.textContent = '−';
        minusBtn.title = '缩小字号';
        var display = document.createElement('span');
        display.className = 'fontsize-display';
        var plusBtn = document.createElement('button');
        plusBtn.className = 'fontsize-btn';
        plusBtn.textContent = '+';
        plusBtn.title = '增大字号';
        ctrl.appendChild(minusBtn);
        ctrl.appendChild(display);
        ctrl.appendChild(plusBtn);
        field.appendChild(ctrl);
        inputs[item.key] = {
          element: ctrl,
          setValue: function (val) {
            var offset = Number(val);
            if (offset === 0) display.textContent = '默认';
            else if (offset > 0) display.textContent = '+' + offset;
            else display.textContent = String(offset);
            minusBtn.disabled = offset <= -10;
            plusBtn.disabled = offset >= 10;
          },
          getValue: function () {
            var text = display.textContent;
            if (text === '默认') return 0;
            return parseInt(text) || 0;
          }
        };
        // 从配置读取初始值后设置
        var initVal = item._value;
        if (initVal !== undefined) inputs[item.key].setValue(initVal);
        minusBtn.addEventListener('click', function () {
          var cur = inputs[item.key].getValue();
          var next = Math.max(-10, cur - 1);
          inputs[item.key].setValue(next);
          applyValue(item.key, next);
        });
        plusBtn.addEventListener('click', function () {
          var cur = inputs[item.key].getValue();
          var next = Math.min(10, cur + 1);
          inputs[item.key].setValue(next);
          applyValue(item.key, next);
        });
      } else if (item.type === 'manual-goto') {
        // 「详细说明书」按钮：点击后在本面板内打开说明书子页（可返回上一级）
        var mBtn = document.createElement('button');
        mBtn.className = 'action-btn';
        mBtn.textContent = item.label;
        mBtn.addEventListener('click', renderManual);
        field.appendChild(mBtn);
        inputs[item.key] = mBtn;
      } else if (item.type === 'update') {
        var ctrl = makeUpdateControl();
        field.appendChild(ctrl);
        inputs[item.key] = ctrl;
      } else {
        var ctrl = createControl(item);
        if (item.type === 'shortcut') {
          field.appendChild(ctrl.btn);
          inputs[item.key] = ctrl;
        } else {
          field.appendChild(ctrl);
          inputs[item.key] = ctrl;
          if (item.type === 'checkbox') {
            ctrl.addEventListener('change', function () { applyValue(item.key, ctrl.checked); });
          } else if (item.type === 'select') {
            ctrl.addEventListener('change', function () { 
              var v = ctrl.value;
              if (v === 'true') v = true;
              else if (v === 'false') v = false;
              applyValue(item.key, v); 
            });
          } else if (item.type === 'number') {
            ctrl.addEventListener('input', function () { applyValue(item.key, Number(ctrl.value)); });
            ctrl.addEventListener('change', function () { applyValue(item.key, Number(ctrl.value)); });
          } else {
            ctrl.addEventListener('input', function () { applyValue(item.key, ctrl.value); });
            ctrl.addEventListener('change', function () { applyValue(item.key, ctrl.value); });
          }
        }
      }
      return field;
    }

    function renderColors(colors) {
      if (!colorListEl) return;
      colorListEl.innerHTML = '';
      (colors || []).forEach(function (c) { addColorItem(c); });
      var add = document.createElement('button');
      add.id = 'add-color';
      add.textContent = '+ 添加';
      add.onclick = function () { addColorItem('#000000'); };
      colorListEl.appendChild(add);
    }
    function addColorItem(color) {
      var item = document.createElement('span');
      item.className = 'color-item';
      var ci = document.createElement('input');
      ci.type = 'color'; ci.value = color;
      var del = document.createElement('button');
      del.className = 'del'; del.textContent = '×'; del.title = '删除';
      del.onclick = function () { colorListEl.removeChild(item); };
      item.appendChild(ci); item.appendChild(del);
      colorListEl.insertBefore(item, document.getElementById('add-color'));
    }

    function renderSidebar() {
      sidebar.innerHTML = '';

      // 搜索栏
      var searchContainer = document.createElement('div');
      searchContainer.className = 'sidebar-search';
      var searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = '搜索设置…';
      searchInput.className = 'sidebar-search-input';
      searchContainer.appendChild(searchInput);
      sidebar.appendChild(searchContainer);

      // 搜索结果容器
      var searchResults = document.createElement('div');
      searchResults.className = 'sidebar-search-results';
      searchResults.style.display = 'none';
      sidebar.appendChild(searchResults);

      // 构建搜索索引
      var searchIndex = [];
      MENU.forEach(function (top) {
        top.children.forEach(function (sub) {
          sub.items.forEach(function (item) {
            if (item.type === 'info' || item.type === 'action' || item.type === 'update' || item.type === 'manual-goto') return;
            searchIndex.push({
              topLabel: top.label,
              subLabel: sub.label,
              sub: sub,
              item: item,
              text: item.label + ' ' + sub.label + ' ' + top.label
            });
          });
        });
      });

      searchInput.addEventListener('input', function () {
        var q = searchInput.value.trim().toLowerCase();
        if (!q) {
          searchResults.style.display = 'none';
          renderNormalNav();
          return;
        }
        var navItems = sidebar.querySelectorAll('.nav-top, .nav-sub');
        navItems.forEach(function (el) { el.style.display = 'none'; });
        var matches = searchIndex.filter(function (entry) {
          return entry.text.toLowerCase().indexOf(q) !== -1;
        });
        searchResults.innerHTML = '';
        if (matches.length === 0) {
          searchResults.innerHTML = '<div class="search-no-result">未找到匹配项</div>';
        } else {
          matches.forEach(function (match) {
            var resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';
            resultItem.innerHTML = '<span class="search-result-label">' + match.item.label + '</span><span class="search-result-path">' + match.topLabel + ' › ' + match.subLabel + '</span>';
            resultItem.onclick = function () {
              var topIdx = -1, subIdx = -1;
              MENU.forEach(function (top, ti) {
                top.children.forEach(function (sub, si) {
                  if (sub === match.sub) {
                    topIdx = ti;
                    subIdx = si;
                  }
                });
              });
              if (topIdx >= 0 && subIdx >= 0) {
                expandedTops[topIdx] = true;
                activeTopIdx = topIdx;
                activeSubByTop[topIdx] = subIdx;
                searchInput.value = '';
                searchResults.style.display = 'none';
                renderNormalNav();
                setSubSection();
              }
            };
            searchResults.appendChild(resultItem);
          });
        }
        searchResults.style.display = 'block';
      });

      function renderNormalNav() {
        var existing = sidebar.querySelectorAll('.nav-top, .nav-sub');
        existing.forEach(function (el) { el.remove(); });
        MENU.forEach(function (top, topIdx) {
          var isExpanded = !!expandedTops[topIdx];
          var topBtn = document.createElement('button');
          topBtn.className = 'nav-top' + (isExpanded ? ' expanded' : '');
          topBtn.innerHTML = top.icon + '<span>' + top.label + '</span>' +
            '<svg class="nav-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
          topBtn.onclick = function () {
            if (expandedTops[topIdx]) {
              // 已展开 → 只收起自身（不影响其他顶项的展开状态，面板内容保持不变）
              expandedTops[topIdx] = false;
              renderNormalNav();
            } else {
              // 收起 → 展开并展示该板块
              expandedTops[topIdx] = true;
              activeTopIdx = topIdx;
              if (activeSubByTop[topIdx] === undefined) activeSubByTop[topIdx] = 0;
              renderNormalNav();
              setSubSection();
            }
          };
          sidebar.appendChild(topBtn);

          if (isExpanded) {
            top.children.forEach(function (sub, subIdx) {
              var subBtn = document.createElement('button');
              subBtn.className = 'nav-sub' +
                (activeTopIdx === topIdx && activeSubByTop[topIdx] === subIdx ? ' active' : '');
              subBtn.innerHTML = (sub.icon || '') + '<span>' + sub.label + '</span>';
              subBtn.onclick = function () {
                activeTopIdx = topIdx;
                activeSubByTop[topIdx] = subIdx;
                renderNormalNav();
                setSubSection();
              };
              sidebar.appendChild(subBtn);
            });
          }
        });
      }

      renderNormalNav();
    }

    function animateSectionTransition(newFields, callback) {
      var children = panelBody.children;
      if (children.length > 0 && gsap) {
        gsap.to(children, {
          opacity: 0, y: -6, duration: 0.15, stagger: 0.015, ease: 'power1.in',
          onComplete: function () {
            panelBody.innerHTML = '';
            callback();
            var newChildren = panelBody.children;
            if (newChildren.length > 0 && gsap) {
              gsap.fromTo(newChildren,
                { opacity: 0, y: 10 },
                { opacity: 1, y: 0, duration: 0.25, stagger: 0.035, ease: 'power2.out' }
              );
            }
          }
        });
      } else {
        panelBody.innerHTML = '';
        callback();
        if (gsap) {
          gsap.set(panelBody.children, { opacity: 0, y: 8 });
          gsap.to(panelBody.children, { opacity: 1, y: 0, duration: 0.25, stagger: 0.035, ease: 'power2.out' });
        }
      }
    }

    function setSubSection() {
      if (activeTopIdx < 0 || activeTopIdx >= MENU.length) return;
      var top = MENU[activeTopIdx];
      if (!top.children) return;
      var activeSubIdx = activeSubByTop[activeTopIdx] ?? 0;
      if (activeSubIdx >= top.children.length) return;
      var sec = top.children[activeSubIdx];

      var headerText = panelHeader.querySelector('.panel-header-text');
      if (headerText) headerText.textContent = sec.label + ' · ' + top.label;

      var fields = [];
      sec.items.forEach(function (item) {
        fields.push(buildField(item));
      });

      // 通知板块层级排版：第一个「总开关」突出显示，其余分类开关缩进分组
      if (sec.label === '通知' && fields.length > 0) {
        fields.forEach(function (f, i) {
          if (i === 0) f.classList.add('field-primary');
          else f.classList.add('field-sub');
        });
      }

      animateSectionTransition(fields, function () {
        fields.forEach(function (f) { panelBody.appendChild(f); });

        // 添加分板块重置按钮（有配置键的才显示）
        if (sec.keys && sec.keys.length > 0) {
          var resetSection = document.createElement('div');
          resetSection.className = 'section-reset';
          var resetBtn = document.createElement('button');
          resetBtn.className = 'section-reset-btn';
          resetBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> 重置此板块';
          resetBtn.onclick = function () {
            if (sec.keys.length === 0) return;
            shell.resetKeys(sec.keys).then(function () {
              setSubSection();
              showStatus('此板块已重置为默认');
            }).catch(function () {});
          };
          resetSection.appendChild(resetBtn);
          panelBody.appendChild(resetSection);
        }

        // 特殊处理：色板
        if (sec.label === '截图') {
          shell.getConfig('annotationColors').then(function (val) { renderColors(val || []); }).catch(function () {});
        }
        // 特殊处理：划词按钮列表
        if (sec.label === '划词') {
          shell.getConfig('textSelectionButtons').then(function (val) {
            var buttons = [];
            try { buttons = JSON.parse(val || '[]'); } catch { buttons = []; }
            var el = inputs['textSelectionButtons'];
            if (el && el.renderButtons) {
              el.renderButtons(buttons);
            }
          }).catch(function () {});
        }
        // 特殊处理：账号状态
        if (sec.label === '账号') {
          refreshAccountStatus();
        }
        // 特殊处理：共享文件提交轮数分组（Word/Excel/PDF 轮数与触发阈值）
        if (sec.label === '共享设置') {
          var roundsGroup = panelBody.querySelector('.doc-rounds-group');
          if (roundsGroup) {
            ['docShareWpsWordLargeRounds', 'docShareWpsExcelLargeRounds', 'docSharePdfLargeRounds', 'docShareWpsWordLargeThreshold', 'docShareWpsExcelLargeThreshold', 'docSharePdfLargeThreshold'].forEach(function (key) {
              shell.getConfig(key).then(function (val) {
                var input = roundsGroup.querySelector('input[data-key="' + key + '"]');
                if (input) input.value = val == null ? '' : String(val);
              }).catch(function () {});
            });
          }
        }

        // 加载当前 section 的值
        sec.items.forEach(function (item) {
          if (item.type === 'info' || item.type === 'action' || item.type === 'update' || item.type === 'manual-goto' || item.type === 'docshare-rounds') return; // 特殊类型无需加载配置值
          shell.getConfig(item.key).then(function (val) {
            var el = inputs[item.key];
            if (!el) return;
            if (item.type === 'checkbox') el.checked = !!val;
            else if (item.type === 'shortcut') el.setText(val == null ? '' : String(val));
            else if (item.type === 'textselection-buttons') {
              // 已由上面特殊处理
            } else if (item.type === 'fontsize') {
              if (el.setValue) el.setValue(val);
            } else el.value = val == null ? '' : String(val);
          }).catch(function () {});
        });
      });
    }

    function refreshAccountStatus() {
      if (!shell.invoke) return;
      shell.invoke('account:getStatus').then(function (res) {
        var el = inputs['_loginStatus'];
        if (el) {
          if (res && res.loggedIn) {
            el.textContent = '已登录';
            el.className = 'info-value logged-in';
          } else {
            el.textContent = '未登录' + (res && res.error ? '（' + res.error + '）' : '');
            el.className = 'info-value logged-out';
          }
        }
      }).catch(function () {
        var el = inputs['_loginStatus'];
        if (el) {
          el.textContent = '检测失败';
          el.className = 'info-value';
        }
      });
    }

    // 初始渲染
    renderSidebar();
    setSubSection();
  });
})();