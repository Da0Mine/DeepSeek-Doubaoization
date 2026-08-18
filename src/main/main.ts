/**
 * 主进程入口：装配各模块、注册 IPC、处理生命周期。
 * 锁定决策：
 *  - Electron + WebContentsView 内嵌 chat.deepseek.com（配置存 %APPDATA%/DeepSeek/config.json）
 *  - 嵌入网页版：截图/提示词经 Injector 注入网页对话框
 *  - 手动登录：用户在 WebContentsView 登录，session 由 Electron 持久化到磁盘
 */
import { app, ipcMain, Menu, screen, session } from 'electron';
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
import { OnboardingManager } from './onboarding/OnboardingManager';
import { FirstRunDialog } from './firstRun/FirstRunDialog';
import { AnswerReminder } from './reminder/AnswerReminder';
import { initBrowserWindowManager } from './windows/browserWindow';
import { setLoginItem } from './loginItem';
import type { UpdateInfo } from '../shared/types';

app.setName('DeepSeek');

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
let onboarding: OnboardingManager;
let firstRunDialog: FirstRunDialog;
let answerReminder: AnswerReminder;

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
  while (firstRunDialog?.isOpen() || onboarding?.isOpen()) {
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
 * 等待用户登录成功后自动弹出使用说明引导（每秒检测一次登录态）。
 * 仅在使用说明尚未完成时调用；主窗口关闭（应用退出）即停止。
 */
function waitForLoginThenOnboarding(): void {
  const tick = (): void => {
    if (onboarding?.isOpen()) return;
    const main = windows.getMainWindow();
    if (!main || main.win.isDestroyed()) return; // 主窗口已销毁（应用退出）→ 停止
    const wc = windows.getViewWebContents('main');
    if (!wc || wc.isDestroyed()) return;
    injector
      .detectLogin(wc)
      .then((loggedIn) => {
        if (onboarding?.isOpen()) return;
        if (loggedIn) {
          // 登录成功：记录已登录，之后不再弹「登录引导 / 用户须知」
          config.set('firstRunNoticeShown', true);
          onboarding?.open();
          return;
        }
        setTimeout(tick, 1000);
      })
      .catch(() => setTimeout(tick, 1000));
  };
  tick();
}

/**
 * 首次运行流程：使用说明未完成时触发。
 *   1) 未登录（firstRunNoticeShown=false）→ 弹「登录引导 / 用户须知」；
 *      关闭弹窗后开始每秒检测登录态，登录成功后才置 firstRunNoticeShown=true——
 *      即：未登录就关闭应用，下次启动仍会再弹；
 *   2) 已登录（firstRunNoticeShown=true）→ 直接等待并弹出使用说明引导。
 * 启动时主窗口首次显示调用；「清除本地配置数据」重置后也会立即调用（无需重启）。
 */
function startFirstRunFlow(): void {
  if (config.get('onboardingCompleted')) return;
  const main = windows.getMainWindow();
  if (!main || !main.win || main.win.isDestroyed()) return;
  const run = (): void => {
    setTimeout(() => {
      if (!config.get('firstRunNoticeShown')) {
        firstRunDialog.open(() => {
          waitForLoginThenOnboarding();
        });
      } else {
        waitForLoginThenOnboarding();
      }
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
  onboarding = new OnboardingManager(config, windows);
  firstRunDialog = new FirstRunDialog(windows);
  answerReminder = new AnswerReminder(config, windows);
  // 内置浏览器窗口管理器（链接打开方式 = 内置时承载所有外部链接，多标签）
  initBrowserWindowManager(config);

  // 网页内对话视图就绪后注入剪刀截图按钮（I-01）。
  // 必须在 createMainWindow 之前设置，确保首个主窗口也能注入。
  // B类窗口不注入加号按钮（只需要主窗口和副窗口有）。
  windows.setWebViewReadyHook((wc: Electron.WebContents, type: string) => {
    injector.injectScissorsButton(wc, () => screenshot.startCapture(), type !== 'bwindow');
  });

  // 创建主窗口
  windows.createMainWindow();

  // 应用代理
  applyProxy();

  // 开机自启
  setLoginItem(config.get('startAtLogin'));

  // 快捷键
  shortcuts = new ShortcutManager();
  shortcuts.onScreenshot = () => {
    // 截图快捷键：非窗口内触发，按用户要求「发送到新对话」固定发到副窗口（origin='sub'）
    screenshot.startCapture(undefined, 'sub');
  };
  shortcuts.onSummonSub = () => windows.toggleSubWindow();
  shortcuts.onToggleTextSelection = () => {
    const current = config.get('textSelectionEnabled');
    config.set('textSelectionEnabled', !current);
  };
  // 一键开关屏幕共享：开启时自动在「副窗口」执行共享（没有则先打开副窗口），
  // 并按需切换识图模式（专家模式等无法切换时自动新建对话切换）；再次按下关闭共享。
  shortcuts.onToggleScreenShare = async () => {
    if (screenShare.isActive()) {
      screenShare.stop();
      return;
    }
    // 在指定 webContents 上执行「共享屏幕前置准备」：能切识图就切，切不了就新建对话再切。
    const prepareIn = async (wc: Electron.WebContents): Promise<void> => {
      if (!wc || wc.isDestroyed()) return;
      const mode = await injector.getCurrentModelMode(wc);
      if (mode === 'vision') {
        screenShare.start('vision');
        return;
      }
      const canSwitch = await injector.canSwitchModel(wc);
      if (canSwitch && config.get('screenShareSwitchVision')) {
        const ok = await injector.switchToVisionModel(wc, { allowNewConversation: false });
        if (ok) {
          screenShare.start('vision');
          return;
        }
      }
      // 无法直接切换（如已有对话后模型选择器被卸载 / 专家模式）：
      // 按用户要求自动「新建对话」并切换到识图模式。
      // 新建对话会触发 applyDefaultModelMode（可能切到默认模型），需临时抑制避免竞争。
      let ok2 = false;
      await windows.suppressDefaultModelFor(wc.id, async () => {
        ok2 = await injector.switchToVisionModel(wc, { allowNewConversation: true });
      });
      if (ok2) {
        screenShare.start('vision');
        return;
      }
      // 彻底失败：按当前模式提示
      if (mode === 'expert') {
        if (config.get('screenShareModeReminder')) modeReminder.open('expert');
        return;
      }
      if (mode === 'simple') {
        if (config.get('screenShareModeReminder')) modeReminder.open('simple');
        screenShare.start('simple');
        return;
      }
      screenShare.start('unknown');
    };
    // 目标窗口：副窗口（没有则新建并打开；已有但隐藏也先显示——共享应在当前对话窗口执行）。
    const subId = windows.ensureSubWindowVisible();
    const subWc = subId ? windows.getViewWebContents(subId) : null;
    if (subWc && !subWc.isDestroyed()) {
      // 新建副窗口首次加载较慢：等页面就绪后再切换识图模式
      try { await injector.waitForAppReady(subWc); } catch { /* 超时则继续尝试 */ }
      await prepareIn(subWc);
      return;
    }
    // 兜底：副窗口不可用时退回当前活动窗口
    const activeWc = windows.getActiveWebContents();
    if (activeWc && !activeWc.isDestroyed()) {
      await prepareIn(activeWc);
    }
  };
  // 一键共享文档：呼出「共享WPS文档」选择器（与加号菜单同一入口）
  shortcuts.onToggleDocShare = () => {
    const trigger = getDocShareAllTrigger();
    if (trigger) trigger();
  };
  shortcuts.applyFromConfig(config.getAll());

  // 划词功能：全局输入钩子检测鼠标拖拽选中文本（无需快捷键，选中后即自动触发）
  const onTextSelected = (text: string, mouseDownPos?: { x: number; y: number }, mouseUpPos?: { x: number; y: number }) => {
    if (!config.get('textSelectionEnabled')) return;
    // 如果工具栏已经显示，不再重复弹出
    const { hasToolbarWindow, showToolbarAt } = require('./windows/textSelectionWindow');
    if (hasToolbarWindow()) return;
    // 同步取词基线，避免重复触发
    globalInputHook?.pauseOne();
    const cursorPos = screen.getCursorScreenPoint();
    // 优先使用鼠标按下位置（选中起点），uIOhook 坐标是物理像素，需转 DIP
    let posX = cursorPos.x;
    let posY = cursorPos.y;
    if (mouseDownPos) {
      const dip = screen.screenToDipPoint(mouseDownPos);
      posX = dip.x;
      posY = dip.y;
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
    let buttons: { label: string; prompt: string }[] = [];
    try { buttons = JSON.parse(buttonsRaw); } catch { buttons = []; }
    if (buttons.length === 0) return;
    showToolbarAt(posX, posY, buttons, text, selRect);
  };

  globalInputHook = new GlobalInputHook();
  globalInputHook.onTextSelected = onTextSelected;
  globalInputHook.start();

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
    // 顺带同步取词基线，防止后续操作误判。
    if (e && e.metaKey && e.keycode === 86) {
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
  registerHandlers({ config, windows, injector, screenshot, theme, tray, shortcuts, templates, settings, screenShare, update, updatePrompt, modeReminder, wps, onboarding, firstRunDialog, answerReminder, startFirstRunFlow });

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
          detail: '可在 设置 → 应用 → 快捷键 中修改后重新生效。',
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
