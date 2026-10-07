/* 设置面板（毛玻璃 + GSAP 动画版）：三级菜单导航 + 右侧内容。 */
(function () {
  'use strict';
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // ---- 一级菜单图标 ----
  var TOP_ICONS = {
    '软件': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="6 9 10 12 6 15"/><line x1="13" y1="15" x2="18" y2="15"/></svg>',
    '板块': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
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
    '对话': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/></svg>',
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
    '共享文档': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    '黑名单': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  };

  // ---- 三级菜单结构 ----
  var MENU = [
    {
      label: '软件', icon: TOP_ICONS['软件'],
      children: [
        {
          label: '常规', icon: SUB_ICONS['常规'],
          keys: ['theme', 'fontSize', 'fontSizeMain', 'fontSizeSettings', 'fontSizeSub', 'fontSizeB', 'linkOpenMode', 'closeToTray', 'startAtLogin', 'minimizeToTrayOnStart'],
          items: [
            { key: 'theme', label: '外观主题', type: 'select', options: [{ label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }, { label: '跟随系统', value: 'system' }], hint: '选择应用界面的外观主题：浅色、深色，或跟随操作系统自动切换。' },
            { key: 'fontSize', label: '界面字号', type: 'fontsize-group', hint: '整体调整所有界面字号；展开下拉可单独控制主窗口、设置界面、副窗口与 B 类窗口的字号（在整体基础上再微调，覆盖该窗口的全部文字）。', subs: [
              { key: 'fontSizeMain', label: '主窗口', hint: '仅控制主窗口（含标题栏与内嵌网页对话）的全部文字。' },
              { key: 'fontSizeSettings', label: '设置界面', hint: '仅控制设置面板的全部文字。' },
              { key: 'fontSizeSub', label: '副窗口', hint: '仅控制副窗口（快捷键呼出的常驻对话小窗）的全部文字。' },
              { key: 'fontSizeB', label: 'B 类窗口', hint: '仅控制 B 类临时窗口（截图/划词呼出的翻译、解释、提取等小窗）的全部文字。' },
            ] },
            { key: 'linkOpenMode', label: '链接打开方式', type: 'select', options: [{ label: '内置浏览器窗口', value: 'internal' }, { label: '系统默认浏览器', value: 'external' }], hint: '点击链接时在应用内打开，或调用系统默认浏览器。' },
            { key: 'closeToTray', label: '关闭窗口时', type: 'select', options: [{ label: '退出程序', value: false }, { label: '最小化到系统托盘', value: true }], hint: '点击关闭按钮时退出程序，或最小化到系统托盘。' },
            { key: 'startAtLogin', label: '开机自启', type: 'checkbox', hint: '登录 Windows 时自动启动并最小化到系统托盘。' },
            { key: 'minimizeToTrayOnStart', label: '手动启动时最小化到托盘', type: 'checkbox', hint: '手动启动时直接最小化到系统托盘，不显示主窗口。' },
          ]
        },
        {
          label: '通知', icon: SUB_ICONS['通知'],
          keys: ['notificationEnabled', 'notificationScreenshot', 'notificationOperation', 'notificationTextSelection', 'notificationShortcut', 'notificationReplyDone'],
          items: [
            { key: 'notificationEnabled', label: '通知总开关', type: 'checkbox', hint: '关闭后所有系统通知一律不再弹出。' },
            { key: 'notificationScreenshot', label: '截图操作通知', type: 'checkbox', hint: '截图成功复制、截图失败、未知截图动作等提示。' },
            { key: 'notificationOperation', label: '功能操作通知', type: 'checkbox', hint: '上传/翻译失败、创建副窗口失败等提示。' },
            { key: 'notificationTextSelection', label: '划词操作通知', type: 'checkbox', hint: '划词失败等提示。' },
            { key: 'notificationShortcut', label: '快捷键提醒', type: 'checkbox', hint: '快捷键注册失败或被系统占用等提示。' },
            { key: 'notificationReplyDone', label: '回答完成提醒', type: 'checkbox', hint: 'AI 回答完成且窗口不在前台时弹通知，点击可跳回原会话。' },
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
      label: '板块', icon: TOP_ICONS['板块'],
      children: [
        {
          label: '对话', icon: SUB_ICONS['对话'],
          keys: ['deepThinkEnabled', 'smartSearchEnabled', 'collapseThinking', 'answerScrollMode'],
          items: [
            { key: 'deepThinkEnabled', label: '深度思考', type: 'checkbox', hint: '新建对话时自动打开网页的深度思考。' },
            { key: 'smartSearchEnabled', label: '智能搜索', type: 'checkbox', hint: '新建对话时自动打开网页的智能搜索。' },
            { key: 'collapseThinking', label: '折叠思考过程', type: 'checkbox', hint: '深度思考过程默认折叠，只显示最终答案。' },
            { key: 'answerScrollMode', label: '回答滚动方式', type: 'select', options: [{ label: '停留开头', value: 'stay' }, { label: '跟随回答', value: 'follow' }], hint: 'AI 流式输出回答时：停留开头 = 保持当前位置，自己下滑阅读；跟随回答 = 自动滚动跟随最新输出。' },
          ]
        },
        {
          label: '副窗口', icon: SUB_ICONS['窗口'],
          keys: ['alwaysOnTop', 'subWindowResetNew'],
          items: [
            { key: 'alwaysOnTop', label: '副窗口默认置顶', type: 'checkbox', hint: '副窗口与 B 窗口（临时窗口）始终置顶显示，主窗口不受影响。' },
            { key: 'subWindowResetNew', label: '重置为新对话', type: 'select', options: [{ label: '永不重置', value: 'never' }, { label: '每次打开', value: 'open' }, { label: '15 分钟后', value: '15' }, { label: '30 分钟后', value: '30' }, { label: '60 分钟后', value: '60' }], hint: '副窗口关闭后再打开时，自动清空上一段对话。可选每次重置，或仅在关闭超过一定时长后重置。' },
          ]
        },
        {
          label: '共享文档', icon: SUB_ICONS['共享文档'],
          keys: ['shareIdleTimeout', 'docSharePdfSaveInterval', 'docShareWpsWordLargeRounds', 'docShareWpsExcelLargeRounds', 'docSharePdfLargeRounds', 'docShareWpsWordLargeThreshold', 'docShareWpsExcelLargeThreshold', 'docSharePdfLargeThreshold'],
          items: [
            { key: 'shareIdleTimeout', label: '共享空闲自动退出（分钟）', type: 'number', hint: '共享屏幕/文档超时未发送消息自动退出。默认 10 分钟，0 = 不自动退出。' },
            { key: 'docSharePdfSaveInterval', label: 'PDF 改动检测保存间隔（秒）', type: 'number', hint: '0 = 仅发送时保存（默认）；设为秒数后按间隔自动保存并检测改动。' },
            { key: '_docShareRounds', label: '共享文件自动重提轮数', type: 'docshare-rounds', hint: '内容超过阈值时按设定轮数自动重新提交，检测到改动立即提交。Word 70 万字、Excel 10 万字、PDF 20 万。' },
          ]
        },
        {
          label: '快捷键', icon: SUB_ICONS['快捷键'],
          keys: ['screenshotShortcut', 'subWindowShortcut', 'screenShareShortcut', 'docShareShortcut', 'textSelectionShortcut'],
          items: [
            { key: 'screenshotShortcut', label: '一键截图', type: 'shortcut', hint: '一键唤起截图功能，默认 左 Alt + C。' },
            { key: 'subWindowShortcut', label: '呼出副窗口', type: 'shortcut', hint: '一键呼出/隐藏副窗口，默认 左 Alt + 空格。' },
            { key: 'screenShareShortcut', label: '屏幕共享', type: 'shortcut', hint: '一键开启/关闭屏幕共享（默认空）。开启时自动打开副窗口并进入共享，再次按下关闭共享。' },
            { key: 'docShareShortcut', label: '共享文档', type: 'shortcut', hint: '一键呼出「共享WPS文档」选择器（默认空）。' },
            { key: 'textSelectionShortcut', label: '划词功能', type: 'shortcut', hint: '一键开启/关闭划词功能（默认 Alt+V），用于快速避免划词误触发。' },
            { key: '_lockedFind', label: '页面查找', type: 'locked-shortcut', value: 'Ctrl + F', hint: '在对话页面中查找关键字（固定快捷键，不可更改，仅作介绍）。' },
            { key: '_lockedReload', label: '刷新页面', type: 'locked-shortcut', value: 'Ctrl + R', hint: '刷新当前对话页面，用于恢复卡死或注入异常（固定快捷键，不可更改，仅作介绍）。' },
          ]
        },
        {
          label: '黑名单', icon: SUB_ICONS['黑名单'],
          keys: ['blacklistProcesses'],
          items: [
            { key: '_blacklistPick', label: '点击或拖动到目标窗口进行选择', type: 'blacklist-pick', hint: '进入窗口选择模式：移动鼠标扫描窗口，窗口框左上角会显示其所属进程名称；点击窗口即可把该进程加入黑名单。加入后，该进程运行时本软件的快捷键、划词功能与所有系统通知自动停用，进程退出后自动恢复。' },
            { key: '_blacklistAdd', label: '手动添加进程', type: 'blacklist-add', hint: '输入进程名（不含 .exe，如 game）手动加入黑名单。' },
            { key: '_blacklistList', label: '已加入进程列表', type: 'blacklist-list', hint: '当前黑名单中的进程：其中任一正在运行时，本软件临时停用快捷键、划词功能与所有系统通知。' },
          ]
        },
        {
          label: '截图', icon: SUB_ICONS['截图'],
          keys: ['annotationColors', 'keepWindowsOnScreenshot', 'cleanBWindowHistoryOnScreenshot', 'screenshotButtons'],
          items: [
            { key: 'annotationColors', label: '标注画笔颜色', type: 'colorlist', hint: '设置截图标注画笔的默认颜色，可添加多个常用颜色。' },
            { key: 'keepWindowsOnScreenshot', label: '截图时保留窗口', type: 'checkbox', hint: '开启：截图时保留应用窗口（会截进图中）；关闭：截图前自动隐藏窗口。' },
            { key: 'cleanBWindowHistoryOnScreenshot', label: '临时窗口记录自动清理', type: 'checkbox', hint: '关闭临时窗口（截图提取文字、翻译、解释）后自动清除本次对话记录。' },
            {
              key: 'promptGroup', label: '提示词管理', type: 'prompt-group', hint: '管理截图功能按钮（提取文字/翻译/解释）的提示词模板，以及翻译默认目标语言。',
              children: [
                { key: 'defaultTranslateLang', label: '翻译默认目标语言', type: 'select', hint: '设置截图翻译、划词翻译等翻译功能默认输出的目标语言。', options: [
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
                { key: 'screenshotButtons', label: '截图工具按钮', type: 'screenshot-buttons', hint: '管理截图功能按钮：提取文字、翻译、解释。每个按钮可单独控制其弹出窗口的深度思考、智能搜索，并编辑各自提示词模板。' },
              ]
            },
          ]
        },
        {
          label: '划词', icon: SUB_ICONS['划词'],
          keys: ['textSelectionEnabled', 'textSelectionButtons', 'cleanBWindowHistoryOnTextSelection'],
          items: [
            { key: 'textSelectionEnabled', label: '启用划词功能', type: 'checkbox', hint: '选中文本并复制时自动弹出划词工具栏。' },
            { key: 'textSelectionButtons', label: '划词工具按钮', type: 'textselection-buttons', hint: '自定义划词工具栏按钮：可增删、拖拽排序、设置提示词。每个按钮可单独控制其弹出窗口的深度思考、智能搜索。' },
            { key: 'cleanBWindowHistoryOnTextSelection', label: '临时窗口记录自动清理', type: 'checkbox', hint: '关闭临时窗口（划词翻译、解释）后自动清除本次对话记录。' },
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
            { key: '_exportData', label: '导出对话记录', type: 'action', action: 'data:exportData', hint: '将本机的对话记录导出为文件，方便备份与迁移。' },
            { key: '_factoryReset', label: '恢复出厂设置', type: 'action', action: 'config:factoryReset', confirm: '确定要恢复出厂设置吗？将清除全部配置与登录状态，不可撤销。', hint: '清除全部配置与登录状态，回到首次安装状态。' },
          ]
        },
        {
          label: '使用说明', icon: SUB_ICONS['使用说明'],
          keys: [],
          manualDirect: true,
          items: [],
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

    // 黑名单历史列表刷新：从主进程拉取当前黑名单进程并渲染为可删除的列表。
    var BLACKLIST_SCOPE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    function refreshBlacklistList() {
      if (!shell.invoke) return;
      var container = inputs['_blacklistList'];
      if (!container) return;
      shell.invoke('blacklist:get').then(function (list) {
        var arr = Array.isArray(list) ? list : [];
        container.innerHTML = '';
        if (arr.length === 0) {
          var empty = document.createElement('div');
          empty.className = 'blacklist-empty';
          empty.textContent = '暂无黑名单进程';
          container.appendChild(empty);
          return;
        }
        arr.forEach(function (name) {
          var row = document.createElement('div');
          row.className = 'blacklist-item';
          var icon = document.createElement('span');
          icon.className = 'blacklist-item-icon';
          icon.innerHTML = BLACKLIST_SCOPE_ICON;
          var nameEl = document.createElement('span');
          nameEl.className = 'blacklist-item-name';
          nameEl.textContent = name;
          var del = document.createElement('button');
          del.type = 'button';
          del.className = 'blacklist-item-del';
          del.title = '移除：' + name;
          del.textContent = '×';
          del.addEventListener('click', function () {
            shell.invoke('blacklist:remove', { name: name }).then(function (res) {
              if (res && res.ok) showStatus('已移除：' + name);
              refreshBlacklistList();
            }).catch(function () { refreshBlacklistList(); });
          });
          row.appendChild(icon);
          row.appendChild(nameEl);
          row.appendChild(del);
          container.appendChild(row);
        });
      }).catch(function () {});
    }

    // 设置窗口重新获得焦点（如从「窗口选择模式」返回后）时刷新黑名单列表
    window.addEventListener('focus', function () {
      if (inputs['_blacklistList']) refreshBlacklistList();
    });

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
    document.getElementById('btn-max').onclick = function () { shell.toggleMax(); };
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

    // 主进程请求跳转到指定板块（如标题栏更新图标 → 软件 › 更新）：
    // 激活对应顶级菜单 + 子板块并渲染。
    if (shell.onSettingsGoto) {
      shell.onSettingsGoto(function (payload) {
        if (!payload || !payload.top || !payload.sub) return;
        var topIdx = -1, subIdx = -1;
        MENU.forEach(function (top, ti) {
          top.children.forEach(function (sub, si) {
            if (sub.label === payload.sub && top.label === payload.top) {
              topIdx = ti;
              subIdx = si;
            }
          });
        });
        if (topIdx >= 0 && subIdx >= 0) {
          expandedTops[topIdx] = true;
          activeTopIdx = topIdx;
          activeSubByTop[topIdx] = subIdx;
          // 注意：renderNormalNav 是 renderSidebar 的内部局部函数，顶层不可见；
          // 必须调用顶层函数 renderSidebar()（内部会重建导航），再渲染板块内容。
          renderSidebar();
          setSubSection();
        }
      });
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
      } else if (item.type === 'locked-shortcut') {
        // 固定快捷键：仅作介绍，锁定不可更改
        var lk = document.createElement('button');
        lk.type = 'button';
        lk.className = 'shortcut-btn locked';
        lk.disabled = true;
        lk.title = '固定快捷键，不可更改';
        var lockIcon = document.createElement('span');
        lockIcon.className = 'locked-icon';
        lockIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
        var lockLabel = document.createElement('span');
        lockLabel.className = 'locked-label';
        lockLabel.textContent = item.value || '';
        lk.appendChild(lockIcon);
        lk.appendChild(lockLabel);
        return { btn: lk };
      } else if (item.type === 'textselection-buttons') {
        return makeTextSelectionButtonsControl();
      } else if (item.type === 'screenshot-buttons') {
        return makeScreenshotButtonsControl();
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
        buttons.push({ label: '新功能', prompt: '请分析以下内容：\n{content}', deepThink: false, smartSearch: false, mode: 'simple' });
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
        // 顶部标题行：与下方按钮行使用相同网格，标题置于 深度思考/智能搜索 对应列上方并居中（模型模式已统一）
        var header = document.createElement('div');
        header.className = 'ts-btn-header';
        ['深度思考', '智能搜索'].forEach(function (t, i) {
          var cell = document.createElement('span');
          cell.className = 'ts-btn-header-cell';
          cell.textContent = t;
          cell.style.gridColumn = String(i + 4);
          header.appendChild(cell);
        });
        wrapper.appendChild(header);

        buttons.forEach(function (btn, idx) {
          var row = document.createElement('div');
          row.className = 'ts-button-row';
          row.draggable = true;
          row.setAttribute('data-index', idx);

          // 第1列：拖拽手柄
          var dragHandle = document.createElement('span');
          dragHandle.className = 'ts-btn-drag';
          dragHandle.innerHTML = '⠿';
          dragHandle.title = '拖拽排序';
          dragHandle.style.gridColumn = '1';
          row.appendChild(dragHandle);

          // 第2列：按钮名
          var labelInput = document.createElement('input');
          labelInput.type = 'text';
          labelInput.className = 'ts-btn-label';
          labelInput.value = btn.label || '';
          labelInput.placeholder = '按钮名称';
          labelInput.style.gridColumn = '2';
          labelInput.addEventListener('input', function () { container.saveButtons(); });
          row.appendChild(labelInput);

          // 简单按钮（问问DeepSeek/复制）：不显示后面的深度思考/智能搜索/对话模式细分项
          var isSimple = btn.type === 'quote' || btn.label === '复制';

          // 第3列：提示词（quote/复制 显示说明文字，跨第3~6列填满以替代被隐藏的细分项）
          if (btn.type === 'quote') {
            var quoteHint = document.createElement('span');
            quoteHint.className = 'ts-btn-quote-hint';
            quoteHint.style.gridColumn = isSimple ? '3 / span 4' : '3';
            quoteHint.textContent = '（引用模式：将选中文本用括号括起发送到输入框）';
            row.appendChild(quoteHint);
          } else if (btn.label === '复制') {
            var copyHint = document.createElement('span');
            copyHint.className = 'ts-btn-copy-hint';
            copyHint.style.gridColumn = isSimple ? '3 / span 3' : '3';
            copyHint.textContent = '（仅复制，无需提示词）';
            row.appendChild(copyHint);
          } else {
            var promptInput = document.createElement('textarea');
            promptInput.className = 'ts-btn-prompt';
            promptInput.style.gridColumn = '3';
            promptInput.value = btn.prompt || '';
            promptInput.placeholder = '提示词模板（{content} 为选中文本）';
            promptInput.rows = 1;
            promptInput.addEventListener('input', function () { container.saveButtons(); });
            row.appendChild(promptInput);
          }

          // 简单按钮（问问DeepSeek/复制）不渲染细分控件；其余按钮渲染第4~6列细分项
          if (!isSimple) {
            // 第4列：深度思考
            var deepCb = document.createElement('input');
            deepCb.type = 'checkbox';
            deepCb.className = 'ts-btn-toggle';
            deepCb.style.gridColumn = '4';
            deepCb.dataset.field = 'deepThink';
            deepCb.checked = !!btn.deepThink;
            deepCb.title = '深度思考';
            deepCb.addEventListener('change', function () { container.saveButtons(); });
            row.appendChild(deepCb);

            // 第5列：智能搜索
            var smartCb = document.createElement('input');
            smartCb.type = 'checkbox';
            smartCb.className = 'ts-btn-toggle';
            smartCb.style.gridColumn = '5';
            smartCb.dataset.field = 'smartSearch';
            smartCb.checked = !!btn.smartSearch;
            smartCb.title = '智能搜索';
            smartCb.addEventListener('change', function () { container.saveButtons(); });
            row.appendChild(smartCb);
          }

          // 第6列：删除（模型模式已统一，不再有「对话模式」列）
          var delBtn = document.createElement('button');
          delBtn.className = 'ts-btn-del';
          delBtn.style.gridColumn = '6';
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
            var b = container.readRow(r);
            if (b && b.label) newButtons.push(b);
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

      // 读取单行按钮的完整配置（含细分项 deepThink/smartSearch/mode）
      container.readRow = function (row) {
        var label = row.querySelector('.ts-btn-label').value.trim();
        if (!label) return null;
        var promptEl = row.querySelector('.ts-btn-prompt');
        var prompt = promptEl ? promptEl.value.trim() : '';
        var type = row.querySelector('.ts-btn-quote-hint') ? 'quote' : undefined;
        var btn = { label: label, prompt: prompt, deepThink: false, smartSearch: false, mode: 'simple' };
        if (type) btn.type = type;
        var deepEl = row.querySelector('[data-field="deepThink"]');
        var smartEl = row.querySelector('[data-field="smartSearch"]');
        var modeEl = row.querySelector('[data-field="mode"]');
        btn.deepThink = deepEl && deepEl.checked === true;
        btn.smartSearch = smartEl && smartEl.checked === true;
        if (modeEl && (modeEl.value === 'expert' || modeEl.value === 'simple')) btn.mode = modeEl.value;
        return btn;
      };

      container.readButtons = function () {
        var rows = wrapper.querySelectorAll('.ts-button-row');
        var buttons = [];
        rows.forEach(function (row) {
          var b = container.readRow(row);
          if (b) buttons.push(b);
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

    function makeScreenshotButtonsControl() {
      var container = document.createElement('div');
      container.className = 'ts-buttons';
      var wrapper = document.createElement('div');
      wrapper.className = 'ts-buttons-list';
      container.appendChild(wrapper);

      // 截图功能按钮固定三项，不可增删、不可改名、不可拖拽：仅编辑提示词与 深度思考/智能搜索 细分项（模型模式已统一）
      var FIXED = [
        { label: '提取文字', deepThink: false, smartSearch: false },
        { label: '翻译', deepThink: false, smartSearch: false },
        { label: '解释', deepThink: false, smartSearch: false },
      ];

      function makeRow(btn) {
        var row = document.createElement('div');
        row.className = 'sb-button-row';

        // 第1列：只读名称
        var nameEl = document.createElement('span');
        nameEl.className = 'sb-btn-name';
        nameEl.textContent = btn.label || '';
        nameEl.style.gridColumn = '1';
        row.appendChild(nameEl);

        // 第2列：提示词
        var promptEl = document.createElement('textarea');
        promptEl.className = 'ts-btn-prompt';
        promptEl.style.gridColumn = '2';
        promptEl.value = btn.prompt || '';
        promptEl.placeholder = '提示词模板（{content} 为内容，{targetLang} 为目标语言）';
        promptEl.rows = 1;
        promptEl.addEventListener('input', function () { container.saveButtons(); });
        row.appendChild(promptEl);

        // 第3列：深度思考
        var deepCb = document.createElement('input');
        deepCb.type = 'checkbox';
        deepCb.className = 'ts-btn-toggle';
        deepCb.style.gridColumn = '3';
        deepCb.dataset.field = 'deepThink';
        deepCb.checked = !!btn.deepThink;
        deepCb.title = '深度思考';
        deepCb.addEventListener('change', function () { container.saveButtons(); });
        row.appendChild(deepCb);

        // 第4列：智能搜索
        var smartCb = document.createElement('input');
        smartCb.type = 'checkbox';
        smartCb.className = 'ts-btn-toggle';
        smartCb.style.gridColumn = '4';
        smartCb.dataset.field = 'smartSearch';
        smartCb.checked = !!btn.smartSearch;
        smartCb.title = '智能搜索';
        smartCb.addEventListener('change', function () { container.saveButtons(); });
        row.appendChild(smartCb);

        return row;
      }

      container.renderButtons = function (buttons) {
        wrapper.innerHTML = '';
        // 顶部标题行：与下方按钮行相同网格，标题置于 深度思考/智能搜索 对应列上方（模型模式已统一）
        var header = document.createElement('div');
        header.className = 'sb-btn-header';
        ['深度思考', '智能搜索'].forEach(function (t, i) {
          var cell = document.createElement('span');
          cell.className = 'ts-btn-header-cell';
          cell.textContent = t;
          cell.style.gridColumn = String(i + 3);
          header.appendChild(cell);
        });
        wrapper.appendChild(header);

        FIXED.forEach(function (base) {
          // 用持久化值覆盖默认（保留用户自定义的 prompt/细分项）
          var conf = null;
          if (Array.isArray(buttons)) {
            for (var i = 0; i < buttons.length; i++) {
              if (buttons[i] && buttons[i].label === base.label) { conf = buttons[i]; break; }
            }
          }
          var btn = { label: base.label, prompt: '', deepThink: base.deepThink, smartSearch: base.smartSearch, mode: base.mode };
          if (conf) {
            btn.prompt = conf.prompt || '';
            if (conf.deepThink !== undefined) btn.deepThink = conf.deepThink;
            if (conf.smartSearch !== undefined) btn.smartSearch = conf.smartSearch;
            if (conf.mode) btn.mode = conf.mode;
          }
          wrapper.appendChild(makeRow(btn));
        });
      };

      container.readButtons = function () {
        var rows = wrapper.querySelectorAll('.sb-button-row');
        var buttons = [];
        rows.forEach(function (row) {
          var nameEl = row.querySelector('.sb-btn-name');
          if (!nameEl) return;
          var promptEl = row.querySelector('.ts-btn-prompt');
          var deepEl = row.querySelector('[data-field="deepThink"]');
          var smartEl = row.querySelector('[data-field="smartSearch"]');
          var modeEl = row.querySelector('[data-field="mode"]');
          buttons.push({
            label: nameEl.textContent,
            prompt: promptEl ? promptEl.value.trim() : '',
            deepThink: deepEl && deepEl.checked === true,
            smartSearch: smartEl && smartEl.checked === true,
            mode: modeEl && modeEl.value ? modeEl.value : 'simple',
          });
        });
        return buttons;
      };

      container.saveButtons = function () {
        var val = JSON.stringify(container.readButtons());
        inputs['screenshotButtons'] = { value: val };
        applyValue('screenshotButtons', val);
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

      // 卡片容器：hero / 操作按钮 / 结果卡片保持原宽度，粒子显示区单独铺满整个面板
      var cards = document.createElement('div');
      cards.className = 'update-cards';
      wrap.appendChild(cards);
      cards.appendChild(hero);

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

      // 查看历史更新按钮：点击拉取每个版本更新了什么
      var historyBtn = document.createElement('button');
      historyBtn.type = 'button';
      historyBtn.className = 'update-open-btn update-history-btn';
      historyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 14"/></svg> 历史更新';
      historyBtn.addEventListener('click', loadUpdateHistory);
      actions.appendChild(historyBtn);
      cards.appendChild(actions);

      // ---- 检查结果卡片 ----
      var result = document.createElement('div');
      result.className = 'update-result-card';
      result.style.display = 'none';
      cards.appendChild(result);

      // ---- 粒子文字特效卡片（参照 vibecoding：文字编译成点阵，鼠标靠近散开、离开聚拢） ----
      var particleCard = document.createElement('div');
      particleCard.className = 'update-particle';
      var pCanvas = document.createElement('canvas');
      pCanvas.className = 'update-particle-canvas';
      particleCard.appendChild(pCanvas);
      wrap.appendChild(particleCard);

      // 粒子文字输入框：回车保存并重新编译点阵（宽度/高度见 .update-particle-input）
      var particleInput = document.createElement('input');
      particleInput.type = 'text';
      particleInput.className = 'update-particle-input';
      particleInput.placeholder = '输入文字后回车，编译成点阵…';
      particleInput.maxLength = 20;
      particleInput.autocomplete = 'off';
      particleInput.spellcheck = false;
      wrap.appendChild(particleInput);

      // ---- 粒子动画实现 ----
      // 透明画布：不涂任何背景色，面板底色完全透出 → 粒子背景与界面背景零色差
      var pctx = pCanvas.getContext('2d', { alpha: true });
      var P = [];                          // 粒子数组
      var pDPR = 1, pW = 0, pH = 0, rafId = 0, started = false;
      var pTEXT = 'DeepSeek-Doubaoization';
      var mouse = { x: -9999, y: -9999, active: false };
      var REPEL_RADIUS = 90;               // 鼠标排斥作用半径
      var REPEL_FORCE = 1.1;               // 排斥强度
      var SPRING = 0.02;                   // 回归原位弹力
      var FRICTION = 0.86;                 // 阻尼
      // 粒子效果：白色粒子（原版 vibecoding 配色），背景沿用面板主题底色（不搬原版黑底）
      var P_FG = { r: 255, g: 255, b: 255 }; // 白色粒子

      function hexToRgb(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return null;
        var n = parseInt(m[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
      }

      // 读取主题背景色（画布底色 = 面板底色，完美融入界面）
      function pThemeBg() {
        var cs = getComputedStyle(document.documentElement);
        return hexToRgb(cs.getPropertyValue('--ds-bg').trim()) || { r: 255, g: 255, b: 255 };
      }

      // 离屏画布采样文字像素 → 生成点阵（粒子初始即位于落点，直接成型）
      function pBuild() {
        if (pW <= 0 || pH <= 0) return;
        var off = document.createElement('canvas');
        var octx = off.getContext('2d');
        off.width = pW;
        off.height = pH;

        // 字号尽量取大：长文本按 96% 宽度压缩后即为最终高度，短文本则尽量撑满高度
        var fontSize = Math.max(24, Math.min(pH * 0.6, pW * 0.28));
        var fontFamily = '"Arial Black", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif';
        octx.fillStyle = '#fff';
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.font = 'bold ' + fontSize + 'px ' + fontFamily;

        var maxW = pW * 0.96;
        var measured = octx.measureText(pTEXT).width;
        if (measured > maxW) {
          fontSize *= maxW / measured;
          octx.font = 'bold ' + fontSize + 'px ' + fontFamily;
        }
        octx.fillText(pTEXT, pW / 2, pH / 2);

        var img = octx.getImageData(0, 0, pW, pH).data;
        var gap = Math.max(3, Math.round(fontSize / 20)); // 采样更密 → 文字更饱满
        P = [];
        for (var y = 0; y < pH; y += gap) {
          for (var x = 0; x < pW; x += gap) {
            if (img[(y * pW + x) * 4 + 3] > 128) {
              P.push({ hx: x, hy: y, x: x, y: y, vx: 0, vy: 0 });
            }
          }
        }
      }

      function pResize() {
        var rect = pCanvas.getBoundingClientRect();
        pW = Math.max(1, Math.floor(rect.width));
        pH = Math.max(1, Math.floor(rect.height));
        pDPR = Math.min(window.devicePixelRatio || 1, 2);
        pCanvas.width = pW * pDPR;
        pCanvas.height = pH * pDPR;
        pctx.setTransform(pDPR, 0, 0, pDPR, 0, 0);
        // 透明底：不涂背景，面板底色透出
        pctx.clearRect(0, 0, pW, pH);
        pBuild();
      }

      function pRender() {
        if (!pCanvas.isConnected) {
          // 尚未挂载（板块切换动画中）→ 等下一帧；已渲染过说明离开了板块 → 停止动画
          if (started) { rafId = 0; return; }
          rafId = requestAnimationFrame(pRender);
          return;
        }
        started = true;
        if (pW < 2 || pH < 2) pResize(); // 初次挂载/尺寸就绪后补初始化

        // 拖尾：把上一帧向「透明」淡出（destination-out），不涂任何背景色 → 画布始终透明，
        // 与面板背景完全一致；被推开的粒子余晖随帧衰减
        pctx.globalCompositeOperation = 'destination-out';
        pctx.fillStyle = 'rgba(0,0,0,0.30)';
        pctx.fillRect(0, 0, pW, pH);

        var bg = pThemeBg();
        // 深色底用「加色混合」出白色光晕；浅色底普通混合，靠深色柔边保证白色粒子可见
        var isDark = (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) < 128;
        pctx.globalCompositeOperation = isDark ? 'lighter' : 'source-over';

        for (var i = 0; i < P.length; i++) {
          var p = P[i];

          // 鼠标排斥力：靠近鼠标的粒子被推开
          if (mouse.active) {
            var dx = p.x - mouse.x;
            var dy = p.y - mouse.y;
            var dist = Math.hypot(dx, dy);
            if (dist < REPEL_RADIUS && dist > 0.0001) {
              var force = (REPEL_RADIUS - dist) / REPEL_RADIUS;
              var ang = Math.atan2(dy, dx);
              p.vx += Math.cos(ang) * force * REPEL_FORCE;
              p.vy += Math.sin(ang) * force * REPEL_FORCE;
            }
          }

          // 弹簧回归 + 阻尼
          p.vx += (p.hx - p.x) * SPRING;
          p.vy += (p.hy - p.y) * SPRING;
          p.vx *= FRICTION;
          p.vy *= FRICTION;
          p.x += p.vx;
          p.y += p.vy;

          // 位移量决定亮度与大小（被推开的粒子更亮更大）
          var disp = Math.min(1, Math.hypot(p.x - p.hx, p.y - p.hy) / 45);
          var r = 1.6 + disp * 2.8;
          var a = 0.5 + disp * 0.5;

          if (!isDark) {
            // 浅色底：先画深色柔边，白色粒子才清晰可见
            pctx.beginPath();
            pctx.fillStyle = 'rgba(0,0,0,0.25)';
            pctx.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2);
            pctx.fill();
          }

          pctx.beginPath();
          pctx.fillStyle = 'rgba(255,255,255,' + a + ')';
          pctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          pctx.fill();
        }

        pctx.globalCompositeOperation = 'source-over';
        rafId = requestAnimationFrame(pRender);
      }

      // 鼠标交互：监听画布本身，离开板块时随 DOM 一起释放
      pCanvas.addEventListener('mousemove', function (e) {
        var rect = pCanvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
        mouse.active = true;
      });
      pCanvas.addEventListener('mouseleave', function () {
        mouse.active = false;
        mouse.x = -9999;
        mouse.y = -9999;
      });

      // 画布尺寸跟随卡片变化（含板块切换、窗口缩放）
      if (window.ResizeObserver) {
        new ResizeObserver(pResize).observe(pCanvas);
      } else {
        window.addEventListener('resize', pResize);
      }

      // 回车保存文字并重新编译点阵
      particleInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var v = particleInput.value.trim();
        if (v) {
          pTEXT = v;
          pBuild();
          shell.setConfig('particleText', v).then(function () {
            showStatus('已保存');
          }).catch(function (err) {
            showStatus('保存失败：' + err);
          });
        }
        particleInput.blur();
      });

      // 初始文字：优先读取配置（默认 DeepSeek-Doubaoization）
      shell.getConfig('particleText').then(function (val) {
        if (val) {
          pTEXT = String(val);
          particleInput.value = pTEXT;
          if (pW > 0) pBuild();
        }
      }).catch(function () {});

      // 启动动画
      pResize();
      rafId = requestAnimationFrame(pRender);

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
                    progText.textContent = '安装程序已打开，请按提示完成安装。';
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

    // ---- 详细使用说明内容：按功能分组排版，逐一说明特色项及所在位置 ----
    var MANUAL_GROUPS = [
        ['窗口与切换', [
          ['主副窗口切换', '点击标题栏 ⇄ 按钮在主副窗口间切换，副窗口适合边查边聊。', '标题栏 ⇄ 按钮'],
          ['一键呼出副窗口', '无论你在哪个应用，按 左 Alt + 空格 即可随时呼出或隐藏副窗口。', '设置 → 板块 → 快捷键'],
          ['副窗口默认置顶', '副窗口和临时窗口（B 窗口）默认显示在其他窗口之上，不被遮挡。', '设置 → 板块 → 副窗口'],
          ['重置为新对话', '副窗口关闭后再打开时，自动清空上一段对话，可选每次重置或按分钟计时（15/30/60）重置。', '设置 → 板块 → 副窗口'],
          ['关闭窗口时', '点击关闭按钮时退出程序，或最小化到系统托盘。', '设置 → 软件 → 常规'],
          ['开机自启', '登录系统时自动启动并最小化到托盘，不显示主窗口。', '设置 → 软件 → 常规'],
          ['手动启动时最小化到托盘', '开启后，手动打开程序时也直接最小化到系统托盘，不显示主窗口。', '设置 → 软件 → 常规'],
        ]],
        ['快捷键', [
          ['一键截图', '一键唤起截图（默认 左 Alt + C），截取后可翻译、提取文字、解释或向 AI 提问。', '设置 → 板块 → 快捷键'],
          ['呼出副窗口', '一键呼出或隐藏副窗口（默认 左 Alt + 空格）。', '设置 → 板块 → 快捷键'],
          ['屏幕共享', '一键开启或关闭屏幕共享（默认空，可自行设置）。', '设置 → 板块 → 快捷键'],
          ['共享文档', '一键呼出「共享WPS文档」选择器（默认空，可自行设置）。', '设置 → 板块 → 快捷键'],
          ['划词功能', '一键开启或关闭划词功能（默认 Alt+V），用于避免划词误触发。', '设置 → 板块 → 快捷键'],
        ]],
        ['截图与识图', [
          ['一键截图提问', '按快捷键或点击聊天框旁的剪刀按钮，截取屏幕选区，直接向 AI 提问。', '左 Alt + C 或剪刀按钮'],
          ['标注画笔', '截图时可用画笔、矩形、椭圆标注重点，画笔颜色可自定义。', '设置 → 板块 → 截图'],
          ['临时窗口记录自动清理', '关闭截图临时窗口（提取文字、翻译、解释）后自动清除本次对话记录，默认开启。', '设置 → 板块 → 截图'],
          ['截图窗口深度思考', '截图临时窗口是否默认打开深度思考，回答前展示推理过程，默认关闭。', '设置 → 板块 → 截图'],
          ['截图窗口智能搜索', '截图临时窗口是否默认打开智能搜索，自动联网搜索最新信息，默认关闭。', '设置 → 板块 → 截图'],
        ]],
        ['划词', [
          ['划词即用', '选中任意文字，无需任何快捷键，划词工具栏自动弹出。', '设置 → 板块 → 划词'],
          ['引用 DeepSeek 内容', '在本软件某个 DeepSeek 对话窗口内划词时，工具栏第一个按钮自动变为「引用」；点击后在输入框上方出现引用条，发送时自动整理成 markdown 引用块（> 开头）格式；引用条可点 × 关闭，输入框为空时按退格/删除键也能移除。', 'DeepSeek 对话窗口内划词 → 引用'],
          ['自定义按钮', '默认提供复制、翻译、解释、问问 DeepSeek，可增删、拖拽排序、自定义提示词。', '设置 → 板块 → 划词'],
          ['按按钮细分设置', '每个划词按钮可单独设置打开窗口的深度思考与智能搜索，默认均关闭。', '设置 → 板块 → 划词'],
          ['临时窗口记录自动清理', '关闭划词临时窗口（翻译、解释）后自动清除本次对话记录，默认开启。', '设置 → 板块 → 划词'],
        ]],
        ['对话', [
          ['深度思考', '回答前展示详细推理过程，适合复杂问题。', '设置 → 板块 → 对话'],
          ['智能搜索', '自动联网搜索最新信息，辅助回答。', '设置 → 板块 → 对话'],
          ['折叠思考过程', '深度思考过程默认折叠收起，界面更简洁。', '设置 → 板块 → 对话'],
          ['开关自动同步', '新建对话或切换会话时，深度思考与智能搜索自动按设置恢复。', '自动生效'],
          ['回答滚动方式', 'AI 流式输出时的滚动策略可选「停留开头」（生成时保持当前位置，自己下滑阅读）或「跟随回答」（自动滚动跟随最新输出）。', '设置 → 板块 → 对话'],
        ]],
        ['共享屏幕', [
          ['共享屏幕', '发送消息时自动附带当前屏幕截图，屏幕四角显示共享指示框。', '聊天框 + 按钮 → 共享屏幕'],
          ['共享文档', '在 WPS 选择要共享的 Word 文档，发送时自动带上最新内容。', '聊天框 + 按钮 → 共享WPS Word'],
          ['共享WPS Excel', '在 WPS 选择要共享的工作簿，发送时自动带上最新内容。', '聊天框 + 按钮 → 共享WPS Excel'],
          ['文档自动重新提交', '内容超过阈值时按设定轮数自动重新提交最新版，检测到改动立即重新提交。', '设置 → 板块 → 共享文档'],
          ['共享空闲自动退出', '共享期间超时未发送消息自动退出，默认 10 分钟，0 = 不自动退出。', '设置 → 板块 → 共享文档'],
        ]],
        ['无痕', [
          ['无痕模式', '在聊天框加号菜单开启无痕模式（图标为虚线聊天框），当前会话被标记为无痕：关闭对话窗口、新建对话、切换对话或退出程序时自动删除该条对话记录。开启后输入框上方显示悬浮徽章，可点击退出。', '聊天框 + 按钮 → 无痕模式'],
        ]],
        ['黑名单', [
          ['黑名单窗口选择', '点击瞄镜按钮后主窗口短暂隐藏、进入全屏画框模式；移动鼠标扫描窗口，框选左上角实时显示所属进程名，点击窗口即把该进程加入黑名单。', '设置 → 板块 → 黑名单'],
          ['手动添加进程', '可通过下拉框从「识别到的软件」中直接选择（每项带软件图标），或点右侧「从文件选择」在文件管理器里挑 .exe 添加。', '设置 → 板块 → 黑名单'],
          ['运行时自动停用', '黑名单中任一进程正在运行时，本软件临时停用快捷键、划词功能与所有系统通知；该进程全部退出后自动恢复。', '设置 → 板块 → 黑名单'],
        ]],
        ['更新', [
          ['查看历史更新', '在「检查更新」界面点击「历史更新」按钮，可查看以往每个版本分别更新了什么内容。', '设置 → 更新 → 历史更新'],
        ]],
        ['翻译', [
          ['翻译默认目标语言', '设置截图翻译、划词翻译等翻译功能默认输出的目标语言。', '设置 → 板块 → 提示词管理'],
        ]],
        ['个性化', [
          ['外观主题', '浅色 / 深色 / 跟随系统三种模式，界面自动适配。', '设置 → 软件 → 常规'],
          ['界面字号', '界面字号整体微调（-10 ~ +10），设置界面与网页对话内容同步放大缩小。', '设置 → 软件 → 常规'],
          ['提示词模板', '提取文字、翻译、解释等功能的提示词均可自定义。', '设置 → 板块 → 截图 → 提示词管理'],
        ]],
        ['通知与提醒', [
          ['通知总开关', '关闭后所有系统通知一律不再弹出。', '设置 → 软件 → 通知'],
          ['回答完成提醒', 'AI 回答完成且窗口不在前台时弹通知，点击可跳回原会话。', '设置 → 软件 → 通知'],
          ['分类通知控制', '截图、操作、划词、快捷键等通知可分别开关。', '设置 → 软件 → 通知'],
        ]],
        ['使用说明', [
          ['说明书问问 AI', '把整份说明书上传给临时窗口（B 窗口），看不懂的地方直接向 AI 提问。', '设置 → 个人中心 → 使用说明'],
        ]],
        ['更新与数据', [
          ['软件内更新', '自动检查新版本，发现后一键下载并唤起安装；也可手动检查。', '设置 → 软件 → 更新'],
          ['导出对话记录', '将对话记录导出保存，方便备份与迁移。', '设置 → 个人中心 → 数据'],
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
      var lines = ['# DeepSeek 桌面版详细使用说明', ''];
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
     * 「详细使用说明」面板内子页：不切换左侧导航，直接在面板中展示说明书，
     * 顶部提供「返回」按钮回到使用说明板块。
     */
    function renderManual() {
      var old = panelBody.children;
      function fill() {
        panelBody.innerHTML = '';
        // 头部：标题 + 搜索 + 问问 AI（说明书为一级直接展示，无需返回按钮）
        var head = document.createElement('div');
        head.className = 'manual-head';
        var title = document.createElement('div');
        title.className = 'manual-head-title';
        title.textContent = '详细使用说明';
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

    /** 构建一个字号 +/- 控制条（− 当前值 +）。返回 { el, minus, plus, set, get }。 */
    function makeFontSizeControl() {
      var el = document.createElement('div');
      el.className = 'fontsize-control';
      var minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'fontsize-btn';
      minus.textContent = '−';
      minus.title = '缩小字号';
      var display = document.createElement('span');
      display.className = 'fontsize-display';
      var plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'fontsize-btn';
      plus.textContent = '+';
      plus.title = '增大字号';
      el.appendChild(minus);
      el.appendChild(display);
      el.appendChild(plus);
      function set(val) {
        var offset = Number(val) || 0;
        if (offset === 0) display.textContent = '默认';
        else if (offset > 0) display.textContent = '+' + offset;
        else display.textContent = String(offset);
        minus.disabled = offset <= -10;
        plus.disabled = offset >= 10;
      }
      function get() {
        var text = display.textContent;
        if (text === '默认') return 0;
        return parseInt(text, 10) || 0;
      }
      return { el: el, minus: minus, plus: plus, display: display, set: set, get: get };
    }

    // ---- HTML 转义（更新历史等复用） ----
    function extEsc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ---- 历史更新（每个版本更新了什么） ----
    function fmtDate(iso) {
      if (!iso) return '';
      try {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      } catch { return ''; }
    }
    // 把 GitHub release 说明（markdown）转成可读文本：去标题#、星号、链接语法，保留换行和列表。
    function releaseToText(body) {
      if (!body) return '（无更新说明）';
      return String(body)
        .replace(/```/g, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*[\-*+]\s+/gm, '• ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*\*|__|\*|`/g, '')
        .trim();
    }
    function closeUpdateHistoryModal() {
      var o = document.getElementById('uh-overlay');
      if (o) o.remove();
    }
    function buildHistoryCard(it, last) {
      var wrap = document.createElement('div');
      wrap.className = 'uh-item' + (last ? ' is-current' : '');
      var head = document.createElement('div');
      head.className = 'uh-item-head';
      var badge = document.createElement('span');
      badge.className = 'uh-ver';
      badge.textContent = last ? 'v' + extEsc(it.version) + ' · 当前版本' : 'v' + extEsc(it.version);
      var date = document.createElement('span');
      date.className = 'uh-date';
      date.textContent = fmtDate(it.publishedAt);
      head.appendChild(badge);
      head.appendChild(date);
      wrap.appendChild(head);
      var bodyBox = document.createElement('div');
      bodyBox.className = 'uh-item-body';
      bodyBox.textContent = releaseToText(it.body);
      wrap.appendChild(bodyBox);
      return wrap;
    }
    function fillHistoryModal(list) {
      var overlay = document.getElementById('uh-overlay');
      if (!overlay) return;
      var body = overlay.querySelector('.uh-body');
      if (!body) return;
      body.innerHTML = '';
      if (!list || list.length === 0) {
        body.innerHTML = '<div class="uh-empty">未获取到历史更新，请检查网络后重试。</div>';
        return;
      }
      var frag = document.createDocumentFragment();
      for (var i = 0; i < list.length; i++) {
        frag.appendChild(buildHistoryCard(list[i], i === 0));
      }
      body.appendChild(frag);
    }
    function openHistoryModal() {
      closeUpdateHistoryModal();
      var overlay = document.createElement('div');
      overlay.className = 'uh-overlay';
      overlay.id = 'uh-overlay';
      var card = document.createElement('div');
      card.className = 'uh-card';
      var head = document.createElement('div');
      head.className = 'uh-head';
      head.innerHTML = '<span class="uh-title">历史更新记录</span>';
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'uh-close';
      close.title = '关闭';
      close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
      close.addEventListener('click', closeUpdateHistoryModal);
      head.appendChild(close);
      var body = document.createElement('div');
      body.className = 'uh-body';
      body.innerHTML = '<div class="uh-loading"><span class="uh-spinner"></span>正在加载历史更新…</div>';
      card.appendChild(head);
      card.appendChild(body);
      overlay.appendChild(card);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeUpdateHistoryModal(); });
      document.body.appendChild(overlay);
    }
    function loadUpdateHistory() {
      if (!shell.getUpdateHistory) { showStatus('重启软件后即可使用该功能'); return; }
      openHistoryModal();
      shell.getUpdateHistory()
        .then(fillHistoryModal)
        .catch(function (e) {
          var overlay = document.getElementById('uh-overlay');
          var body = overlay && overlay.querySelector('.uh-body');
          if (body) body.innerHTML = '<div class="uh-empty">获取历史更新失败：' + extEsc((e && e.message) ? e.message : e) + '</div>';
        });
    }

    function buildField(item) {
      if (item.type === 'docshare-rounds') {
        return buildDocShareRoundsField(item);
      }
      var field = document.createElement('div');
      field.className = 'field';
      field.style.opacity = '0';
      field.style.transform = 'translateY(8px)';
      // 更新板块为整行卡片式设计，不显示左侧固定宽度的标签；提示词管理分组自带折叠头
      if (item.type !== 'update' && item.type !== 'prompt-group') {
        var label = document.createElement('label');
        label.textContent = item.label;
        field.appendChild(label);

        if (item.hint) {
          label.appendChild(makeHintIcon(item.hint));
        }
      } else {
        // 更新板块占满整个面板：粒子特效铺满剩余空间，输入框贴底
        field.classList.add('field-update');
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
      } else if (item.type === 'blacklist-pick') {
        // 黑名单：瞄镜按钮 → 进入「窗口选择模式」
        var pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        pickBtn.className = 'action-btn blacklist-pick-btn';
        pickBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>选择窗口</span>';
        pickBtn.addEventListener('click', function () {
          shell.send('blacklist:pick');
          showStatus('已进入窗口选择模式，请点击目标窗口加入黑名单');
        });
        field.appendChild(pickBtn);
        inputs[item.key] = pickBtn;
      } else if (item.type === 'blacklist-add') {
        // 黑名单：识别到的软件自定义下拉（每项带图标，选中即添加）+ 右侧「从文件选择 .exe」按钮。
        var DEFAULT_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa3b2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M11 3v7H4"/></svg>');
        var addRow = document.createElement('div');
        addRow.className = 'blacklist-add-row';
        // 下拉头（占位/当前选择 + 箭头）
        var addSel = document.createElement('div');
        addSel.className = 'blacklist-add-select';
        var selHead = document.createElement('div');
        selHead.className = 'blacklist-sel-head';
        selHead.innerHTML = '<span class="blacklist-sel-ph">从下方识别到的软件中选择…</span>' +
          '<svg class="blacklist-sel-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
        // 展开面板：每项 = 图标 + 进程名
        var selPanel = document.createElement('div');
        selPanel.className = 'blacklist-sel-panel';
        var loading = document.createElement('div');
        loading.className = 'blacklist-sel-empty';
        loading.textContent = '加载中…';
        selPanel.appendChild(loading);

        function renderCandidate(item) {
          var row = document.createElement('div');
          row.className = 'blacklist-sel-item';
          row.title = '点击加入黑名单：' + item.name;
          var img = document.createElement('img');
          img.className = 'blacklist-sel-ico';
          img.src = item.icon || DEFAULT_ICON;
          img.alt = '';
          var txt = document.createElement('span');
          txt.className = 'blacklist-sel-name';
          txt.textContent = item.name;
          row.appendChild(img);
          row.appendChild(txt);
          row.addEventListener('click', function () {
            closeSelPanel();
            addSel.disabled = true;
            addSel.classList.add('is-busy');
            shell.invoke('blacklist:add', { name: item.name }).then(function (res) {
              addSel.disabled = false;
              addSel.classList.remove('is-busy');
              if (res && res.ok) {
                selHead.querySelector('.blacklist-sel-ph').textContent = '已加入：' + item.name;
                showStatus('已加入黑名单：' + item.name);
                refreshBlacklistList();
              } else {
                showStatus('已存在或添加失败：' + item.name);
              }
            }).catch(function (e) {
              addSel.disabled = false;
              addSel.classList.remove('is-busy');
              showStatus('添加失败：' + e);
            });
          });
          return row;
        }
        if (shell.getBlacklistCandidates) {
          shell.getBlacklistCandidates().then(function (list) {
            selPanel.innerHTML = '';
            var items = Array.isArray(list) ? list : [];
            if (!items.length) {
              var empty = document.createElement('div');
              empty.className = 'blacklist-sel-empty';
              empty.textContent = '暂未识别到运行中的软件';
              selPanel.appendChild(empty);
              return;
            }
            items.forEach(function (it) { selPanel.appendChild(renderCandidate(it)); });
          }).catch(function () {
            selPanel.innerHTML = '';
            var bad = document.createElement('div');
            bad.className = 'blacklist-sel-empty';
            bad.textContent = '获取候选失败';
            selPanel.appendChild(bad);
          });
        }
        function openSelPanel() {
          selPanel.classList.add('open');
        }
        function closeSelPanel() {
          selPanel.classList.remove('open');
        }
        selHead.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (addSel.disabled) return;
          selPanel.classList.toggle('open');
        });
        // 点击面板外部关闭
        document.addEventListener('click', function (ev) {
          if (!addRow.contains(ev.target)) closeSelPanel();
        });

        var browseBtn = document.createElement('button');
        browseBtn.type = 'button';
        browseBtn.className = 'action-btn blacklist-browse-btn';
        browseBtn.title = '从文件管理器中选择 .exe 文件加入黑名单';
        browseBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16V5a1 1 0 0 1 1-1h5l2 2h6a1 1 0 0 1 1 1v9"/><path d="M2 16a1 1 0 0 1 1-1h4a2 2 0 0 1 2 2 2 2 0 0 0 2 2h7a1 1 0 0 0 1-1v-2"/></svg> 从文件选择';
        browseBtn.addEventListener('click', function () {
          if (!shell.browseAddBlacklist) return;
          browseBtn.disabled = true;
          shell.browseAddBlacklist().then(function (res) {
            browseBtn.disabled = false;
            if (res && res.ok) {
              showStatus('已加入黑名单：' + res.name);
              refreshBlacklistList();
              selHead.querySelector('.blacklist-sel-ph').textContent = '已加入：' + res.name;
            } else if (!(res && res.canceled)) {
              showStatus('未加入黑名单（可能已存在）');
            }
          }).catch(function (e) {
            browseBtn.disabled = false;
            showStatus('添加失败：' + e);
          });
        });
        addRow.appendChild(addSel);
        addSel.appendChild(selHead);
        addSel.appendChild(selPanel);
        addRow.appendChild(browseBtn);
        field.appendChild(addRow);
        inputs[item.key] = addSel;
      } else if (item.type === 'blacklist-list') {
        // 黑名单：已加入进程列表（动态渲染 + 删除按钮）
        var listEl = document.createElement('div');
        listEl.className = 'blacklist-list';
        field.appendChild(listEl);
        inputs[item.key] = listEl;
        refreshBlacklistList();
      } else if (item.type === 'textselection-buttons') {
        // 纵向布局：标签独占一行，按钮列表全宽贴左铺开，避免左侧 170px 留白
        field.classList.add('field-ts-buttons');
        var ctrl = createControl(item);
        field.appendChild(ctrl);
        inputs[item.key] = ctrl;
      } else if (item.type === 'screenshot-buttons') {
        // 纵向布局：与划词工具按钮一致，标签独占一行、按钮列表全宽铺开
        field.classList.add('field-ts-buttons');
        var ctrl = createControl(item);
        field.appendChild(ctrl);
        inputs[item.key] = ctrl;
      } else if (item.type === 'fontsize' || item.type === 'fontsize-group') {
        // 全体字号 +/- 按钮；fontsize-group 时额外带「细分窗口字号」下拉（主窗口/设置界面/副窗口/B 类窗口）
        var fsCtrl = makeFontSizeControl();
        if (item.type === 'fontsize') {
          field.appendChild(fsCtrl.el);
          inputs[item.key] = {
            element: fsCtrl.el,
            setValue: fsCtrl.set,
            getValue: fsCtrl.get
          };
          fsCtrl.minus.addEventListener('click', function () {
            var next = Math.max(-10, fsCtrl.get() - 1);
            fsCtrl.set(next);
            applyValue(item.key, next);
          });
          fsCtrl.plus.addEventListener('click', function () {
            var next = Math.min(10, fsCtrl.get() + 1);
            fsCtrl.set(next);
            applyValue(item.key, next);
          });
        } else {
          var groupEl = document.createElement('div');
          groupEl.className = 'fs-group';
          var bodyEl = document.createElement('div');
          bodyEl.className = 'fs-group-body';
          var topEl = document.createElement('div');
          topEl.className = 'fs-group-top';
          topEl.appendChild(fsCtrl.el);
          var toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = 'fs-group-toggle';
          toggleBtn.title = '展开/收起细分字号控制';
          toggleBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
          topEl.appendChild(toggleBtn);
          bodyEl.appendChild(topEl);
          var dropEl = document.createElement('div');
          dropEl.className = 'fs-group-dropdown';
          var subCtrls = {};
          (item.subs || []).forEach(function (sub) {
            var row = document.createElement('div');
            row.className = 'fs-sub-row';
            var lab = document.createElement('span');
            lab.className = 'fs-sub-label';
            lab.textContent = sub.label;
            if (sub.hint) lab.appendChild(makeHintIcon(sub.hint));
            var subCtrl = makeFontSizeControl();
            row.appendChild(lab);
            row.appendChild(subCtrl.el);
            dropEl.appendChild(row);
            subCtrls[sub.key] = subCtrl;
            subCtrl.minus.addEventListener('click', function () {
              var next = Math.max(-10, subCtrl.get() - 1);
              subCtrl.set(next);
              applyValue(sub.key, next);
            });
            subCtrl.plus.addEventListener('click', function () {
              var next = Math.min(10, subCtrl.get() + 1);
              subCtrl.set(next);
              applyValue(sub.key, next);
            });
          });
          bodyEl.appendChild(dropEl);
          groupEl.appendChild(bodyEl);
          field.appendChild(groupEl);
          toggleBtn.addEventListener('click', function () {
            var open = dropEl.classList.toggle('open');
            toggleBtn.classList.toggle('open', open);
          });
          inputs[item.key] = {
            element: groupEl,
            setGlobal: fsCtrl.set,
            setSub: function (key, val) {
              if (subCtrls[key]) subCtrls[key].set(val);
            }
          };
          // 从配置读取初始值后设置
          var initVal = item._value;
          if (initVal !== undefined) inputs[item.key].setGlobal(initVal);
        }
      } else if (item.type === 'update') {
        var ctrl = makeUpdateControl();
        field.appendChild(ctrl);
        inputs[item.key] = ctrl;
      } else if (item.type === 'prompt-group') {
        // 「提示词管理」可展开分组：点击折叠头展开/收起内部子字段
        var group = document.createElement('div');
        group.className = 'prompt-group';
        var head = document.createElement('div');
        head.className = 'prompt-group-head';
        var caret = document.createElement('span');
        caret.className = 'prompt-group-caret';
        caret.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
        var headLabel = document.createElement('span');
        headLabel.className = 'prompt-group-label';
        headLabel.textContent = item.label;
        if (item.hint) headLabel.appendChild(makeHintIcon(item.hint));
        head.appendChild(caret);
        head.appendChild(headLabel);
        var body = document.createElement('div');
        body.className = 'prompt-group-body';
        // 提示词管理分组默认展开（用户要求）
        body.style.display = '';
        caret.classList.add('open');
        (item.children || []).forEach(function (child) {
          var childField = buildField(child);
          // 子字段在展开时才显示，无需随板块入场动画，直接恢复可见
          childField.style.opacity = '1';
          childField.style.transform = 'none';
          body.appendChild(childField);
        });
        head.addEventListener('click', function () {
          var open = body.style.display !== 'none';
          body.style.display = open ? 'none' : '';
          caret.classList.toggle('open', !open);
          if (!open && window.gsap) window.gsap.fromTo(body.children, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.18, stagger: 0.03 });
        });
        group.appendChild(head);
        group.appendChild(body);
        field.appendChild(group);
        // 分组本身不持有值，仅占位
        inputs[item.key] = { element: group };
      } else {
        var ctrl = createControl(item);
        if (item.type === 'shortcut' || item.type === 'locked-shortcut') {
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
              text: item.label + ' ' + (item.value || '') + ' ' + sub.label + ' ' + top.label
            });
            // 提示词管理分组：其子字段同样可搜索
            if (item.type === 'prompt-group' && item.children) {
              item.children.forEach(function (child) {
                searchIndex.push({
                  topLabel: top.label,
                  subLabel: sub.label,
                  sub: sub,
                  item: child,
                  text: child.label + ' ' + (child.value || '') + ' ' + sub.label + ' ' + top.label
                });
              });
            }
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
          var isDirect = !!top.directManual;
          var topBtn = document.createElement('button');
          topBtn.className = 'nav-top' + (isExpanded ? ' expanded' : '') +
            (isDirect && activeTopIdx === topIdx ? ' active' : '');
          topBtn.innerHTML = top.icon + '<span>' + top.label + '</span>' +
            (isDirect ? '' :
              '<svg class="nav-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>');
          topBtn.onclick = function () {
            if (isDirect) {
              // 一级直接展示型（如个人中心 → 使用说明）：点击即渲染说明书，不展开子菜单
              activeTopIdx = topIdx;
              if (activeSubByTop[topIdx] === undefined) activeSubByTop[topIdx] = 0;
              renderNormalNav();
              setSubSection();
              return;
            }
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

          if (isExpanded && !isDirect) {
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

      // 「黑名单窗口选择」结束后回到黑名单板块并刷新列表（由主进程 BLACKLIST_PICK_DONE 通知）。
      // 定义在可访问 renderNormalNav/setSubSection 的作用域内。
      function openSectionByLabel(label) {
        for (var t = 0; t < MENU.length; t++) {
          var tt = MENU[t];
          if (!tt.children) continue;
          for (var s = 0; s < tt.children.length; s++) {
            if (tt.children[s].label === label) {
              expandedTops[t] = true;
              activeTopIdx = t;
              activeSubByTop[t] = s;
              renderNormalNav();
              setSubSection();
              return true;
            }
          }
        }
        return false;
      }
      if (shell && shell.onBlacklistPickDone) {
        shell.onBlacklistPickDone(function () {
          openSectionByLabel('黑名单');
          if (typeof refreshBlacklistList === 'function') refreshBlacklistList();
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

      // 「使用说明」直接展示说明书正文，不经过面板内的按钮层级
      if (sec.manualDirect) {
        renderManual();
        return;
      }

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

        // 特殊处理：标注画笔颜色
        if (sec.label === '截图') {
          shell.getConfig('annotationColors').then(function (val) { renderColors(val || []); }).catch(function () {});
        }
        // 特殊处理：划词工具栏按钮
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
        if (sec.label === '共享文档') {
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
          // 提示词管理分组：加载其子字段的值
          if (item.type === 'prompt-group') {
            (item.children || []).forEach(function (child) {
              shell.getConfig(child.key).then(function (val) {
                var el = inputs[child.key];
                if (!el) return;
                if (child.type === 'screenshot-buttons') {
                  // 截图工具按钮：解析 JSON 并调用 renderButtons 渲染固定三项
                  var buttons = [];
                  try { buttons = JSON.parse(val || '[]'); } catch { buttons = []; }
                  if (el.renderButtons) el.renderButtons(buttons);
                  else if (el.value !== undefined) el.value = val == null ? '' : String(val);
                } else if (child.type === 'checkbox') el.checked = !!val;
                else if (child.type === 'select') el.value = val == null ? '' : String(val);
                else el.value = val == null ? '' : String(val);
              }).catch(function () {});
            });
            return;
          }
          if (item.type === 'info' || item.type === 'action' || item.type === 'update' || item.type === 'manual-goto' || item.type === 'docshare-rounds' || item.type === 'locked-shortcut' || item.type === 'blacklist-pick' || item.type === 'blacklist-add' || item.type === 'blacklist-list') return; // 特殊类型无需加载配置值（锁定快捷键为固定展示）
          shell.getConfig(item.key).then(function (val) {
            var el = inputs[item.key];
            if (!el) return;
            if (item.type === 'checkbox') el.checked = !!val;
            else if (item.type === 'shortcut') el.setText(val == null ? '' : String(val));
            else if (item.type === 'textselection-buttons') {
              // 已由上面特殊处理
            } else if (item.type === 'fontsize') {
              if (el.setValue) el.setValue(val);
            } else if (item.type === 'fontsize-group') {
              // 全体字号 + 各细分窗口字号（主窗口/设置界面/副窗口/B 类窗口）
              if (el.setGlobal) el.setGlobal(val);
              (item.subs || []).forEach(function (sub) {
                shell.getConfig(sub.key).then(function (subVal) {
                  if (el.setSub) el.setSub(sub.key, subVal);
                }).catch(function () {});
              });
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