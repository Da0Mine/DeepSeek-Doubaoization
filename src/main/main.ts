/**
 * 主进程入口：装配各模块、注册 IPC、处理生命周期。
 * 锁定决策：
 *  - Electron + WebContentsView 内嵌 chat.deepseek.com（配置存 %APPDATA%/DeepSeek/config.json）
 *  - 嵌入网页版：截图/提示词经 Injector 注入网页对话框
 *  - 手动登录：用户在 WebContentsView 登录，session 由 Electron 持久化到磁盘
 */
import { app, ipcMain, Menu, Notification, screen, session } from 'electron';
import { ConfigStore } from './config/ConfigStore';
import { WindowManager } from './windows/WindowManager';
import { ShortcutManager } from './shortcuts/ShortcutManager';
import { TrayManager } from './tray/TrayManager';
import { ThemeManager } from './theme/ThemeManager';
import { ScreenshotManager } from './screenshot/ScreenshotManager';
import { Injector } from './inject/Injector';
import { PromptTemplates } from './prompts/promptTemplates';
import { SettingsWindow } from './windows/settingsWindow';
import { registerHandlers, getDocShareAllTrigger } from './ipc/handlers';
import { IPC } from './ipc/channels';
import { GlobalInputHook } from './textSelection/GlobalInputHook';
import { ScreenShareManager } from './screenShare/ScreenShareManager';
import { UpdateChecker } from './update/UpdateChecker';
import { UpdatePromptWindow } from './update/UpdatePromptWindow';
import { ModeReminderWindow } from './modeReminder/ModeReminderWindow';
import { WpsDocManager } from './wps/WpsDocManager';
import { FirstRunDialog } from './firstRun/FirstRunDialog';
import { AnswerReminder } from './reminder/AnswerReminder';
import { initBrowserWindowManager } from './windows/browserWindow';
import { setLoginItem } from './loginItem';
import { BlacklistManager } from './blacklist/BlacklistManager';
import { isBlacklistPaused } from './blacklist/blacklistState';
import type { UpdateInfo } from '../shared/types';

app.setName('DeepSeek');
// Windows 任务栏图标 / 通知需 AppUserModelID：打包后取「与该 ID 匹配的安装快捷方式」里的图标，
// 否则回退到 Electron 默认图标。此值必须与 electron-builder 的 appId（com.deepseek.desktop）一致。
// 注意：仅在有实际安装快捷方式的「打包版」里设置该 ID；开发模式（npm start）没有对应快捷方式，
// 一旦设置反而会让任务栏显示空白图标。开发模式保持不设，由主窗口 win.setIcon() 的自定义图标接管任务栏。
// 若打包后仍显示旧图标，说明机器残留旧安装（D:\DeepSeek）的同名快捷方式，卸载旧安装再装本版即可刷新。
if (process.platform === 'win32' && app.isPackaged) {
  try { app.setAppUserModelId('com.deepseek.desktop'); } catch (e) { /* 忽略 */ }
}

// 伪装为 Microsoft Edge（实验：根治 DeepSeek「使用环境异常」风险弹窗）。
// DeepSeek 前端通过浏览器指纹识别 Electron 环境（UA 含 Electron/ 字样、自动化标志等）而弹风险提示。
// 设置纯净 Edge UA + 移除自动化标志后，指纹与真实 Edge 一致，风险弹窗不再触发。
// ⚠️ 实验性质：若触发 DeepSeek 风控（验证码/登录校验）可整体注释回退。
app.userAgentFallback =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// 禁用硬件加速 + GPU 进程内联：chat.deepseek.com 无 3D/视频等 GPU 强需求；
// 且本机 GPU 进程曾持续崩溃（gpu_data_manager "GPU process isn't usable" FATAL），
// in-process-gpu 让 GPU 逻辑跑在主进程内，绕过独立 GPU 进程崩溃，启动更稳。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');

// 全局可变引用（在 whenReady 中初始化）
let config: ConfigStore;
let windows: WindowManager;
let shortcuts: ShortcutManager;
let tray: TrayManager;
let theme: ThemeManager;
let screenshot: ScreenshotManager;
let injector: Injector;
let templates: PromptTemplates;
let settings: SettingsWindow;
let globalInputHook: GlobalInputHook;
let screenShare: ScreenShareManager;
let update: UpdateChecker;
let updatePrompt: UpdatePromptWindow;
let modeReminder: ModeReminderWindow;
let wps: WpsDocManager;
let firstRunDialog: FirstRunDialog;
let answerReminder: AnswerReminder;
let blacklist: BlacklistManager;

/** 应用代理配置（若启用）。 */
function applyProxy(): void {
  if (config.get('proxyEnabled') && config.get('proxyUrl')) {
    session.defaultSession
      .setProxy({ proxyRules: config.get('proxyUrl') })
      .catch((e) => console.error('[main] 代理设置失败:', e));
  }
}

/**
 * 自动检查更新：发现新版本时，不再弹更新窗口，
 * 而是通知主窗口标题栏显示「更新」图标（点击跳转设置更新板块）。
 */
async function autoCheckUpdate(): Promise<void> {
  const info = await update.check(false);
  if (!info.hasUpdate || !info.latestVersion) return;
  // 用户点过「暂不更新」的版本不再提醒，等待下一个版本
  if (info.latestVersion === config.get('ignoredUpdateVersion')) return;
  // 无安装包资产（仅发文字版更新说明）时不显示图标，由设置面板手动处理
  if (!update.findInstaller()) return;
  while (firstRunDialog?.isOpen()) {
    await new Promise((r) => setTimeout(r, 500));
  }
  notifyUpdateAvailable(info);
}

/** 通知主窗口标题栏显示「发现新版本」更新图标（替代原自动弹窗）。 */
function notifyUpdateAvailable(info: UpdateInfo): void {
  try {
    const main = windows.getMainWindow();
    if (!main || !main.win || main.win.isDestroyed()) return;
    const wc = main.win.webContents; // 标题栏是主窗口自身 webContents
    if (wc && !wc.isDestroyed()) {
      wc.send(IPC.UPDATE_AVAILABLE, { latestVersion: info.latestVersion ?? '' });
    }
  } catch (e) {
    console.error('[main] 通知更新图标失败:', e);
  }
}

/**
 * 首次运行流程：首次安装弹出「登录引导 / 用户须知」说明弹窗。
 *   - 仅第一次（firstRunNoticeShown=false）触发；点「我已知晓」或直接关闭后才不再弹。
 *   - 与该弹窗解耦后不再触发任何「使用说明引导动画」（该功能已移除）。
 */
function startFirstRunFlow(): void {
  if (config.get('firstRunNoticeShown')) return;
  const main = windows.getMainWindow();
  if (!main || !main.win || main.win.isDestroyed()) return;
  const run = (): void => {
    setTimeout(() => {
      if (config.get('firstRunNoticeShown')) return;
      // 点「我已知晓」（或任意关闭）：记录已展示，下次启动不再弹
      firstRunDialog.open(() => {
        config.set('firstRunNoticeShown', true);
      });
    }, 500);
  };
  if (main.win.isVisible()) run();
  else main.win.once('show', run);
}

app.whenReady().then(() => {
  // 移除默认 Electron 菜单栏：默认菜单的 reload 加速器指向的是标题栏 webContents
  // （frame: false 无框窗口），而非 WebContentsView 中的 DeepSeek 页面，导致 Ctrl+R
  // 无实际效果；且菜单栏在无框窗口中显示为白色，破坏深色模式一致性。
  Menu.setApplicationMenu(null);

  config = new ConfigStore();
  templates = new PromptTemplates(config);
  injector = new Injector(templates);
  screenshot = new ScreenshotManager(config);
  theme = new ThemeManager();
  windows = new WindowManager(config);
  windows.setInjector(injector);
  screenshot.setWindowManager(windows);
  settings = new SettingsWindow(() => windows.getMainWindow(), () => theme.getCssVars()['--ds-bg']);
  screenShare = new ScreenShareManager(config);
  screenShare.setDependencies(windows, injector);
  windows.setScreenShare(screenShare);
  update = new UpdateChecker();
  updatePrompt = new UpdatePromptWindow(config, windows, update);
  modeReminder = new ModeReminderWindow(windows);
  wps = new WpsDocManager();
  firstRunDialog = new FirstRunDialog(windows);
  answerReminder = new AnswerReminder(config, windows);
  // 黑名单管理：任一黑名单进程运行时临时停用快捷键 / 划词 / 系统通知；退出后自动恢复。
  // 回调在 blacklist.start() 之前注入，使启动后第一次检测的暂停态变化也能被正确处理。
  blacklist = new BlacklistManager(config);
  blacklist.onEnterPause = () => {
    console.log('[blacklist] 进入暂停：停用快捷键与划词');
    shortcuts?.unregisterAll();
    globalInputHook?.stop();
  };
  blacklist.onExitPause = () => {
    console.log('[blacklist] 退出暂停：恢复快捷键与划词');
    // 恢复所有快捷键（applyFromConfig 内部先 unregisterAll 再按配置重新注册）
    shortcuts?.applyFromConfig(config.getAll());
    globalInputHook?.start();
  };
  blacklist.start();
  // 内置浏览器窗口管理器（链接打开方式 = 内置时承载所有外部链接，多标签）
  initBrowserWindowManager(config);

  // 网页内对话视图就绪后注入剪刀截图按钮（I-01）。
  // 必须在 createMainWindow 之前设置，确保首个主窗口也能注入。
  // B类窗口不注入加号按钮（只需要主窗口和副窗口有）。
  // 页面首次就绪后按设置默认值同步深度思考 / 智能搜索（两者是网页原生开关，须保持同步）。
  let startupToggleSyncDone = false;
  windows.setWebViewReadyHook((wc: Electron.WebContents, type: string) => {
    // B 类窗口（划词/截图小窗）不注入加号按钮。
    injector.injectScissorsButton(wc, () => screenshot.startCapture(), type !== 'bwindow');
    if (windows.isBWindowWebContents(wc)) return;
    // 深度思考 / 智能搜索是网页原生开关：整页刷新（Ctrl+R / reload）后 SPA 会重置为网页自身默认值，
    // 须按设置面板的默认值重新同步，避免刷新后开关漂移。
    const syncToggles = (): void => {
      if (wc.isDestroyed()) return;
      injector.setDeepThink(wc, config.get('deepThinkEnabled') === true).catch(() => {});
      injector.setSmartSearch(wc, config.get('smartSearchEnabled') === true).catch(() => {});
    };
    if (!startupToggleSyncDone) {
      startupToggleSyncDone = true;
      // SPA 启动早期开关按钮可能数秒后才渲染，立即同步一版后再在稳定期复核一次。
      setTimeout(syncToggles, 3000);
    }
    syncToggles();
  });

  // 创建主窗口
  windows.createMainWindow();

  // 应用代理
  applyProxy();

  // 开机自启
  setLoginItem(config.get('startAtLogin'));

  // 快捷键
  shortcuts = new ShortcutManager();
  // 若黑名单已在暂停态（黑名单进程在本进程启动前就在运行），立即停用快捷键；
  // 否则 onEnterPause 在 shortcuts 初始化“之前”触发时会对未初始化的 shortcuts 空转。
  if (blacklist.isPaused()) shortcuts.unregisterAll();
  shortcuts.onScreenshot = () => {
    // 截图快捷键：非窗口内触发，按用户要求「发送到新对话」固定发到副窗口（origin='sub'）
    screenshot.startCapture(undefined, 'sub');
  };
  shortcuts.onSummonSub = () => windows.toggleSubWindow();
  shortcuts.onToggleTextSelection = () => {
    const current = config.get('textSelectionEnabled');
    config.set('textSelectionEnabled', !current);
    // 黑名单暂停态（黑名单进程在运行）时不弹系统通知
    if (isBlacklistPaused()) return;
    try {
      new Notification({ title: '划词功能', body: !current ? '已开启' : '已关闭' }).show();
    } catch { /* 个别环境无通知权限则静默 */ }
  };
  // 一键开关屏幕共享：开启时自动在「副窗口」执行共享（没有则先打开副窗口）；再次按下关闭共享。
  // 模型模式已统一（支持上传/识图），无需再切换识图模式。
  shortcuts.onToggleScreenShare = async () => {
    if (screenShare.isActive()) {
      screenShare.stop();
      return;
    }
    // 目标窗口：副窗口（没有则新建并打开；已有但隐藏也先显示——共享应在当前对话窗口执行）。
    const subId = windows.ensureSubWindowVisible();
    const subWc = subId ? windows.getViewWebContents(subId) : null;
    if (subWc && !subWc.isDestroyed()) {
      // 新建副窗口首次加载较慢：等页面就绪后再进入共享
      try { await injector.waitForAppReady(subWc); } catch { /* 超时则继续尝试 */ }
    }
    screenShare.start();
  };
  // 一键共享文档：呼出「共享WPS文档」选择器（与加号菜单同一入口）
  shortcuts.onToggleDocShare = () => {
    const trigger = getDocShareAllTrigger();
    if (trigger) trigger();
  };
  // 划词开关快捷键：旧配置里可能存了 ''（默认值为空时遗留），统一迁移为默认 Alt+V，
  // 否则 applyFromConfig 读到空会跳过注册导致快捷键没反应。
  if (!config.get('textSelectionShortcut')) config.set('textSelectionShortcut', 'Alt+V');
  shortcuts.applyFromConfig(config.getAll());

  // 划词功能：全局输入钩子检测鼠标拖拽选中文本（无需快捷键，选中后即自动触发）
  const onTextSelected = (text: string, mouseDownPos?: { x: number; y: number }, mouseUpPos?: { x: number; y: number }, selPos?: { startTop: { x: number; y: number }; endBottom: { x: number; y: number }; posLevel: number }) => {
    if (!config.get('textSelectionEnabled')) return;
    // 如果工具栏已经显示，不再重复弹出
    const { hasToolbarWindow, showToolbarAt, setToolbarSourceChat } = require('./windows/textSelectionWindow');
    if (hasToolbarWindow()) return;
    // 同步取词基线，避免重复触发
    globalInputHook?.pauseOne();
    const cursorPos = screen.getCursorScreenPoint();
    // 计算工具栏「左上角」锚点（DIP）。
    // 优先用选区包围盒：放在选区第一行上方固定距离（豆包/Cherry 行为，不遮字）；
    // 屏幕顶边放不下时翻到选区下方。仅在无包围盒时兜底用鼠标起终点。
    const TOOLBAR_H = 34;
    const GAP = 8;
    let anchorX = cursorPos.x;
    let anchorY = cursorPos.y - TOOLBAR_H - GAP;
    if (selPos && selPos.startTop && selPos.endBottom) {
      const st = screen.screenToDipPoint({ x: selPos.startTop.x, y: selPos.startTop.y });
      const eb = screen.screenToDipPoint({ x: selPos.endBottom.x, y: selPos.endBottom.y });
      const wa = screen.getDisplayNearestPoint(eb).workArea; // DIP
      const left = Math.min(st.x, eb.x);
      const aboveTop = st.y - GAP - TOOLBAR_H;
      if (aboveTop >= wa.y + 4) {
        anchorX = left;
        anchorY = aboveTop; // 选区上方（默认，豆包同款）
      } else {
        anchorX = left;
        anchorY = eb.y + GAP; // 顶边放不下 → 选区下方
      }
    } else if (mouseDownPos && mouseUpPos) {
      const a = screen.screenToDipPoint(mouseDownPos);
      const b = screen.screenToDipPoint(mouseUpPos);
      anchorX = Math.min(a.x, b.x);
      anchorY = Math.min(a.y, b.y) - TOOLBAR_H - GAP;
    }
    // 选中文本的屏幕区域（拖拽起点→终点）：供 B 类窗口定位在文本旁而非工具栏旁。
    let selRect: Electron.Rectangle | null = null;
    if (mouseDownPos && mouseUpPos) {
      const a = screen.screenToDipPoint(mouseDownPos);
      const b = screen.screenToDipPoint(mouseUpPos);
      selRect = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.max(Math.abs(b.x - a.x), 8),
        height: Math.max(Math.abs(b.y - a.y), 8),
      };
    }
    const buttonsRaw = config.get('textSelectionButtons');
    let buttons: { label: string; prompt: string; type?: string }[] = [];
    try { buttons = JSON.parse(buttonsRaw); } catch { buttons = []; }
    if (buttons.length === 0) return;
    // 判断划词是否发生在本软件某个 DeepSeek 对话窗口内（以「聚焦窗口」为准，避免最大化误判）：
    // 若在 → 「问问DeepSeek」首按钮变「引用」，点击注入当前输入框并呈引用格式（参考 better-deepseek）。
    const srcChat = windows.getFocusedChatWebContents();
    setToolbarSourceChat(srcChat);
    if (srcChat) {
      buttons = buttons.map((b) => (b.type === 'quote' ? Object.assign({}, b, { label: '引用' }) : b));
    }
    showToolbarAt(anchorX, anchorY, buttons, text, selRect);
  };

  globalInputHook = new GlobalInputHook();
  globalInputHook.onTextSelected = onTextSelected;
  // WPS 划词自研通道：selection-hook 对 WPS 禁用剪贴板回退后不再发 text-selection，
  // 改由拖选事件 + 「只复制读取、不恢复」自研取词（见 textSelection/WpsWordHook）。
  globalInputHook.onDragEnd = (down, up) => {
    try {
      require('./textSelection/WpsWordHook').tryExtractWpsSelection(down, up, onTextSelected);
    } catch (e) {
      console.error('[划词] WPS 自研取词抛错:', e);
    }
  };
  // 划词钩子启动时机：不再在 whenReady 早期立即挂载，而是延迟到启动风暴平息后再投入服务。
  // 原因：启动初期主进程要创建主窗口、加载 WebContentsView、装配托盘/各 Manager，事件循环繁忙，
  // 且首次对前台进程的 UIA 跨进程连接较慢；此时急用会触发 selection-hook 的取词门控长时间占用，
  // 导致"启动后前几次划词取不到、悬浮窗不显示，多划几次才正常"。延迟约 1.2s 待负载落定再启动即可避开。
  const startGlobalInputHook = () => {
    // 若黑名单已在暂停态（黑名单进程在本进程启动前就在运行），不再拉起钩子。
    if (blacklist.isPaused()) { globalInputHook.stop(); return; }
    try { globalInputHook.start(); } catch (e) { console.error('[划词] globalInputHook.start 抛错:', e); }
  };
  // 若黑名单已在暂停态，立即停用划词，否则延迟启动仍会把它拉起。
  if (blacklist.isPaused()) globalInputHook.stop();
  setTimeout(startGlobalInputHook, 1200);

  // 全局鼠标按下检测：若点击位置在工具栏外部则关闭
  globalInputHook.onAnyMouseDown = (e) => {
    const { hasToolbarWindow, closeToolbarWindow, getToolbarBounds } = require('./windows/textSelectionWindow');
    if (!hasToolbarWindow()) return;
    const bounds = getToolbarBounds();
    if (bounds.width === 0) return;
    // uIOhook 坐标是物理像素，转 DIP 后比较
    const dip = screen.screenToDipPoint({ x: e.x, y: e.y });
    if (
      dip.x < bounds.x || dip.x > bounds.x + bounds.width ||
      dip.y < bounds.y || dip.y > bounds.y + bounds.height
    ) {
      closeToolbarWindow();
    }
  };
  // 滚轮滚动：直接关闭工具栏
  globalInputHook.onWheel = () => {
    const { hasToolbarWindow, closeToolbarWindow } = require('./windows/textSelectionWindow');
    if (!hasToolbarWindow()) return;
    closeToolbarWindow();
  };
  // 按下任意键盘按键：悬浮框立即消失
  globalInputHook.onAnyKeyDown = (e) => {
    const { hasToolbarWindow, closeToolbarWindow } = require('./windows/textSelectionWindow');
    if (hasToolbarWindow()) closeToolbarWindow();
    // Win+V 系统剪贴板历史：点选历史项是普通单击（无拖拽），不会触发划词。
    // selection-hook 键盘事件里 vkCode=0x5B/0x5C 为 Win 键、0x56 为 V；sys 表示有修饰键按下。
    if (e && e.sys && (e.vkCode === 0x56)) {
      globalInputHook?.pauseOne();
    }
  };

  // 划词工具栏复制前同步基线，避免复制后重复弹窗
  ipcMain.on('textSelection:beforeCopy', () => {
    globalInputHook?.pauseOne();
  });

  // 托盘（右键菜单：设置 / 退出；单击托盘显隐主窗口）
  tray = new TrayManager(config, {
    onToggle: () => windows.toggleMainWindow(),
    onOpenSettings: () => {
      // 确保主窗口可见后再挂载设置面板（托盘驻留时主窗口可能已隐藏）；
      // 用 showMainWindow 显示并可靠置前，避免从托盘打开设置时主窗口被压在底层。
      windows.showMainWindow();
      settings.open();
    },
    onQuit: () => {
      windows.setQuitting(true);
      app.quit();
    },
  });
  tray.rebuild();

  // 统一注册 IPC（必须在首次 applyTheme 之前，确保 broadcaster 已注入，
  // 首帧主题广播不丢失 —— 修复启动白屏，见 I-02）。
  registerHandlers({ config, windows, injector, screenshot, theme, tray, shortcuts, templates, settings, screenShare, update, updatePrompt, modeReminder, wps, firstRunDialog, answerReminder, startFirstRunFlow, blacklist });

  // 主题（broadcaster 已在 registerHandlers 内注入，首帧即正确）
  theme.applyTheme(config.get('theme'));

  // 快捷键占用检测：启动时若有快捷键被系统/其他软件占用，主界面弹覆盖窗提示（点「我知道了」消失）
  const failedShortcuts = shortcuts.getFailedShortcuts();
  if (failedShortcuts.length > 0) {
    setTimeout(() => {
      const main = windows.getMainWindow();
      if (main && main.win && !main.win.isDestroyed() && main.win.isVisible()) {
        modeReminder.openNotice({
          title: '快捷键提示',
          message: '以下快捷键已被系统或其他软件占用，暂时无法使用：\n' + failedShortcuts.map((s) => '• ' + s).join('\n'),
          detail: '可在 设置 → 板块 → 快捷键 中修改后重新生效。',
          hideNever: true,
        });
      }
    }, 2000);
  }

  // 首次运行流程（主窗口首次显示时触发，兼容「启动最小化到托盘」场景；
  // 「清除本地配置数据」后也会重新触发，见 CONFIG_FACTORY_RESET 处理器）。
  startFirstRunFlow();

  // 启动自动检查更新（可在设置中关闭，默认开启）：发现新版本时标题栏显示更新图标，不再弹窗。
  if (config.get('autoCheckUpdate')) {
    setTimeout(() => {
      autoCheckUpdate().catch(() => {});
    }, 8000);
  }
});

// 退出前：停止黑名单监测。
app.on('quit', () => {
  blacklist?.stop();
});

// 所有窗口关闭：若启用托盘或关闭到托盘，则保持进程（由托盘退出）；否则退出。
app.on('window-all-closed', () => {
  if (!(config?.get('trayEnabled') || config?.get('closeToTray'))) {
    app.quit();
  }
});

// 退出前：标记正在退出（放行窗口 close 拦截），清理快捷键。
// 存在无痕对话时先删除对话记录再退出（before-quit preventDefault + 异步清理 + 再次 quit）。
let quittingAfterIncognitoFlush = false;
app.on('before-quit', (e) => {
  if (quittingAfterIncognitoFlush) return; // 无痕清理完成后第二次触发：放行退出
  if (windows?.hasIncognito()) {
    e.preventDefault();
    quittingAfterIncognitoFlush = true;
    windows
      .flushAllIncognito()
      .catch(() => {})
      .finally(() => {
        windows?.setQuitting(true);
        shortcuts?.unregisterAll();
        globalInputHook?.stop();
        app.quit();
      });
    return;
  }
  windows?.setQuitting(true);
  shortcuts?.unregisterAll();
  globalInputHook?.stop();
});

// 命令行 Ctrl+C：直接退出，不再弹系统「结束进程」确认对话框。
// Windows 上 GUI 进程默认对控制台 Ctrl+C 弹确认框（因为没注册控制台 Ctrl 处理器），
// 显式接管 SIGINT 即可消除该确认并干净退出。
process.on('SIGINT', () => {
  windows?.setQuitting(true);
  app.quit();
});

// 单实例（避免重复启动）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windows?.showMainWindow();
  });
}
