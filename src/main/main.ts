/**
 * 主进程入口：装配各模块、注册 IPC、处理生命周期。
 * 锁定决策：
 *  - Electron + WebContentsView 内嵌 chat.deepseek.com（配置存 %APPDATA%/DeepSeek/config.json）
 *  - 嵌入网页版：截图/提示词经 Injector 注入网页对话框
 *  - 手动登录：用户在 WebContentsView 登录，session 由 Electron 持久化到磁盘
 */
import { app, ipcMain, Menu, net, protocol, screen, session } from 'electron';
import { ConfigStore } from './config/ConfigStore';
import { WindowManager } from './windows/WindowManager';
import { ShortcutManager } from './shortcuts/ShortcutManager';
import { TrayManager } from './tray/TrayManager';

// DeepSeek++ 侧边栏自定义协议（须在 app ready 前注册）：把 dspp://sidepanel/ 根路径
// 服务到内置扩展目录，使 sidepanel.html 的 /chunks/...、/assets/... 绝对路径能加载其 React 资源。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'dspp',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);
import { ThemeManager } from './theme/ThemeManager';
import { ScreenshotManager } from './screenshot/ScreenshotManager';
import { Injector } from './inject/Injector';
import { PromptTemplates } from './prompts/promptTemplates';
import { SettingsWindow } from './windows/settingsWindow';
import { ExtensionsWindow } from './windows/extensionsWindow';
import { ExtensionManager } from './plugins/ExtensionManager';
import { ExtensionHost } from './extensions/ExtensionHost';
import { startLocalShellServer, stopLocalShellServer, setShellLocalEnabledForHost, killAllChildProcesses } from './extensions/LocalShellServer';
import { registerHandlers, getDocShareAllTrigger } from './ipc/handlers';
import { IPC } from './ipc/channels';
import { EXTENSIONS_BUILTIN_DIR, EXTENSIONS_BUILTIN_NAME } from './constants';
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
import type { UpdateInfo } from '../shared/types';

app.setName('DeepSeek');
// Windows 任务栏图标 / 通知需 AppUserModelID：设置后任务栏才用我们传给窗口的 .ico，
// 否则在开发模式下会退回到 Electron 默认图标。
// ⚠️ 用独立的 AppUserModelID（com.deepseek.desktop.desktop）：
// 旧版安装（D:\DeepSeek 打包件，蓝鲸鱼图标）登记了 com.deepseek.desktop 并与其图标关联，
// 运行时若复用该值，任务栏会被旧 exe 的图标盖掉 setIcon 的白鲸鱼。换新 ID 彻底避开旧登记。
if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.deepseek.desktop.desktop'); } catch (e) { /* 忽略 */ }
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
let extensionsWin: ExtensionsWindow;
let extensionManager: ExtensionManager;
let extensionHost: ExtensionHost;
let globalInputHook: GlobalInputHook;
let screenShare: ScreenShareManager;
let update: UpdateChecker;
let updatePrompt: UpdatePromptWindow;
let modeReminder: ModeReminderWindow;
let wps: WpsDocManager;
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
  extensionsWin = new ExtensionsWindow(() => windows.getMainWindow(), () => theme.getCssVars()['--ds-bg']);
  extensionManager = new ExtensionManager({ builtinDir: EXTENSIONS_BUILTIN_DIR, builtinName: EXTENSIONS_BUILTIN_NAME, getMainWin: () => windows.getMainWindow() });
  extensionHost = new ExtensionHost();
  // 内置 Shell Local 宿主：让 DeepSeek++ 的 python_exec / python_status 等本地工具在
  // Electron 里可用（原生 native messaging 不可用时，由本服务经本地 HTTP 代理解析）。
  startLocalShellServer();
  screenShare = new ScreenShareManager(config);
  screenShare.setDependencies(windows, injector);
  windows.setScreenShare(screenShare);
  update = new UpdateChecker();
  updatePrompt = new UpdatePromptWindow(config, windows, update);
  modeReminder = new ModeReminderWindow(windows);
  wps = new WpsDocManager();
  firstRunDialog = new FirstRunDialog(windows);
  answerReminder = new AnswerReminder(config, windows);
  // 内置浏览器窗口管理器（链接打开方式 = 内置时承载所有外部链接，多标签）
  initBrowserWindowManager(config);

  // 网页内对话视图就绪后注入剪刀截图按钮（I-01）。
  // 必须在 createMainWindow 之前设置，确保首个主窗口也能注入。
  // B类窗口不注入加号按钮（只需要主窗口和副窗口有）。
  const lastModeSyncAt = new WeakMap<object, number>();
  // 标记已挂载过 did-navigate 监听器（避免反复叠加）。
  // 全量刷新（Ctrl+R / reload，did-navigate）会重建 document，抹掉 window.__dsChatMode 与智能搜索状态，
  // 此时必须绕过 3s 节流强制重同步，否则刷新后偶发退回普通 / 智能搜索被页面默认重新打开。
  const navigateWired = new WeakSet<object>();
  // 应用启动后只做一次「模式复位为普通」。之后不再因 URL 无会话 id 强制回普通——
  // 否则发首条消息瞬间 URL 短暂无 id 会把任务/增强检索误复位成普通（Bug 修复）。
  // 复位只在「新建对话」或「重启软件」时发生，其余时刻如实保持当前模式。
  let chatModeStartupResetDone = false;
  // 把指定 webContents 切到指定模式（普通/增强搜索/任务）。用于「启动首帧」「新建对话复位」两处
  // 程序化套用设置的默认模式。逻辑与 handlers.switchMode 对齐（就地切，无需用户反馈）。
  const applyConfiguredModeToWc = (wc: Electron.WebContents, mode: 'normal' | 'online' | 'task'): Promise<boolean> => {
    if (!wc || wc.isDestroyed()) return Promise.resolve(false);
    if (mode === 'online' || mode === 'task') {
      const wsp = { search: config.get('webToolSearch') !== false, fetch: config.get('webToolFetch') !== false };
      extensionHost.setWebToolsAll(wsp.search, wsp.fetch);
      extensionManager.setWebSearchFetch(wsp.search, wsp.fetch).catch(() => {});
      if (mode === 'task') {
        const first = config.get('taskSkillAutoFirst') !== false;
        const every = config.get('taskSkillAutoEvery') !== false;
        extensionHost.setShellLocalEnabled(true);
        setShellLocalEnabledForHost(true);
        extensionHost.setSkillAutoFull(first, every);
        extensionManager.setSkillAutoFull(first, every).catch(() => {});
      } else {
        extensionHost.setShellLocalEnabled(false);
        setShellLocalEnabledForHost(false);
        extensionHost.setSkillAutoEnabled(false);
        extensionManager.setSkillAutoEnabled(false).catch(() => {});
      }
      injector.setSmartSearch(wc, false).catch(() => {});
      return injector.syncChatModeToPage(wc, mode).catch(() => true);
    }
    extensionHost.setWebToolsAll(false, false);
    extensionManager.setWebToolsEnabled(false).catch(() => {});
    extensionHost.setShellLocalEnabled(false);
    setShellLocalEnabledForHost(false);
    extensionManager.setSkillAutoEnabled(false).catch(() => {});
    return injector.syncChatModeToPage(wc, 'normal').catch(() => true);
  };
  // 读取设置的默认模式（normal/online/task），非法值一律兜底 normal。
  const defaultChatModeFor = (): 'normal' | 'online' | 'task' => {
    const v = config.get('defaultChatMode');
    return v === 'online' || v === 'task' ? v : 'normal';
  };
  // 改「默认模式」设置即对当前所有聊天窗口（主/副，非 B）即时生效，无需等到下次新建对话/重启。
  let appliedDefaultMode = defaultChatModeFor();
  config.onChange((cfg) => {
    try {
      const m = (cfg.defaultChatMode === 'online' || cfg.defaultChatMode === 'task') ? cfg.defaultChatMode : 'normal';
      if (m === appliedDefaultMode) return;
      appliedDefaultMode = m;
      const wcs = windows.getAllChatWebContents();
      for (const wc of wcs) {
        if (wc.isDestroyed()) continue;
        applyConfiguredModeToWc(wc, m);
      }
    } catch (err) {
      console.error('[default-mode] 应用默认模式到当前窗口失败', err);
    }
  });
  windows.setWebViewReadyHook((wc: Electron.WebContents, type: string) => {
    if (!navigateWired.has(wc)) {
      navigateWired.add(wc);
      wc.on('did-navigate', () => { lastModeSyncAt.set(wc, 0); }); // 全量刷新 → 清除节流，强制重同步
    }
    // 按窗口类型/无痕情形应用记忆：B 类窗口或开启无痕 → 记忆强制关；主窗口/副窗口普通/增强/任务按用户偏好。
    {
      const memForWc = (windows.isBWindowWebContents(wc) || windows.isIncognitoOn(wc)) ? false : (config.get('conversationMemory') === true);
      extensionHost.setMemoryOn(memForWc);
      extensionManager.setMemoryEnabled(memForWc).catch(() => {});
    }
    injector.injectScissorsButton(wc, () => screenshot.startCapture(), type !== 'bwindow');
    // 模式切换下拉（网页原生/增强检索） + token 悬浮块：B 类窗口不注入（小临时窗，无需模式切换与 token）。
    // 模式切换 UI 注入后会把当前联网状态同步到按钮/菜单高亮；SPA 切会话对同一 wc 3 秒内只同步一次。
    // type==='sub' 表示常驻副窗口：二级展开框改为「点击同位进入子菜单」而非悬浮侧栏（避免被窗口边缘截断）。
    // B 类窗口与副窗口在钩子里 type 都是 'sub'，以 isBWindowWebContents(entry id `b-` 前缀) 区分。
    if (windows.isBWindowWebContents(wc)) {
      // B 类窗口：不注入模式切换 UI / token 悬浮。记忆开关已按 B-窗口身份在上方强制关。
      // 仍走一次全局启动复位（默认普通：关联网 / Shell Local / skill 自动激活），确保默认态一致。
      if (!chatModeStartupResetDone) {
        chatModeStartupResetDone = true;
        extensionHost.setWebToolsAll(false, false);
        extensionManager.setWebToolsEnabled(false).catch(() => {});
        extensionHost.setShellLocalEnabled(false);
        setShellLocalEnabledForHost(false);
        extensionManager.setSkillAutoEnabled(false).catch(() => {});
      }
      return;
    }
    // 插件关闭：不注入模式切换按钮 / token 小窗 / 占位文字等基于插件的 UI，也不应用其默认模式。
    if (injector.isDsppEnabled() === false) return;
    // token 小窗独立注入（先于模式按钮）：即使模式按钮注入在专家等模式下异常跳过，token 也能正常显示。
    void injector.injectTokenWidget(wc);
    injector.injectChatModeSwitcher(wc, type === 'sub', false).then(() => {
      const last = lastModeSyncAt.get(wc) || 0;
      if (Date.now() - last < 3000) return;
      lastModeSyncAt.set(wc, Date.now());
      // 派生模式用 extensionHost 的**同步内存态**（CHAT_MODE_SET 点击后会立即 setLocal 落标），
      // 不能用 extensionManager.getWebToolsEnabled()（异步 extension 存储）：点击任务/增强检索后若
      // 存储写入尚未落到 SW，读回 false + shell 开着 → 被误判成「普通」把刚设的模式拉回（Bug 修复）。
      // 任务模式 = 联网开 + Shell Local 开；增强检索 = 联网开 + Shell Local 关；普通 = 均关。
      // 不能仅凭 web 开关判定（否则任务模式的 web 会被当成「增强」）。
      const on = extensionHost.getWebToolsState().web_search;
      const shell = extensionHost.getShellLocalEnabled();
      // 应用启动首次：按设置的「默认模式」复位（普通=全关；增强搜索=联网开；任务=联网+Shell Local）。
      if (!chatModeStartupResetDone) {
        chatModeStartupResetDone = true;
        return applyConfiguredModeToWc(wc, defaultChatModeFor());
      }
      const mode = on ? (shell ? 'task' : 'online') : 'normal';
      // 任务/增强检索模式下，网页刷新（Ctrl+R / 重新加载）会把原生「智能搜索」重置为页面默认开，
      // 必须在此再强制关闭，否则刷新后智能搜索又被打开、与模式不符（Bug 修复）。
      if (mode === 'online' || mode === 'task') {
        injector.setSmartSearch(wc, false).catch(() => {});
      }
      return injector.syncChatModeToPage(wc, mode);
    });
  });

  // 创建主窗口
  windows.createMainWindow();

  // 应用代理
  applyProxy();

  // 为内置 DeepSeek++ 扩展的 SW 跨域 fetch 补 CORS 头：
  // Electron 的 MV3 SW 未按 host_permissions 放行跨域 → 响应给 SW 是 opaque → web_search / web_fetch 取不到内容。
  // 只对「fetch 类」请求（扩展 SW 的搜索/取网页）补 ACAO，且响应本身已带 ACAO（任意大小写）时不动，
  // 排除 deepseek.com —— 这样不会碰 DeepSeek 页面自身的脚本/资源（避免 CORS 多值冲突）。
  try {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      try {
        const h = details.responseHeaders || ({} as Record<string, string[]>);
        const host = (() => { try { return new URL(details.url).hostname; } catch { return ''; } })();
        const isHttp = details.url.startsWith('http://') || details.url.startsWith('https://');
        const rt = details.resourceType || '';
        const isFetchLike = rt === 'xhr' || rt === 'other' || rt === 'ping';
        const alreadyHasAcao = Object.keys(h).some((k) => k.toLowerCase() === 'access-control-allow-origin');
        if (isHttp && isFetchLike && !host.endsWith('deepseek.com') && !alreadyHasAcao) {
          h['Access-Control-Allow-Origin'] = ['*'];
          h['Access-Control-Allow-Headers'] = ['*'];
        }
        callback({ responseHeaders: h });
      } catch {
        callback({});
      }
    });
  } catch {
    /* 忽略 */
  }

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
      // 彻底失败：按当前模式处理（不再弹覆盖式提醒窗口）
      if (mode === 'expert') {
        // 专家模式不支持上传图片：不打开共享屏幕
        return;
      }
      if (mode === 'simple') {
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
    const { hasToolbarWindow, showToolbarAt, setToolbarSourceChat } = require('./windows/textSelectionWindow');
    if (hasToolbarWindow()) return;
    // 同步取词基线，避免重复触发
    globalInputHook?.pauseOne();
    const cursorPos = screen.getCursorScreenPoint();
    // 优先使用选中区域的位置：工具栏与划词区域最左边对齐。
    // 无论从左往右还是从右往左划，x 都取选区左边界（min），y 取拖拽判定阈值内上沿（min）。
    let posX = cursorPos.x;
    let posY = cursorPos.y;
    if (mouseDownPos && mouseUpPos) {
      const a = screen.screenToDipPoint(mouseDownPos);
      const b = screen.screenToDipPoint(mouseUpPos);
      posX = Math.min(a.x, b.x);
      posY = Math.min(a.y, b.y);
    } else if (mouseDownPos) {
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
  registerHandlers({ config, windows, injector, screenshot, theme, tray, shortcuts, templates, settings, extensions: extensionsWin, extensionManager, extensionHost, screenShare, update, updatePrompt, modeReminder, wps, firstRunDialog, answerReminder, startFirstRunFlow });

  // 新建对话 → 把插件「模式」复位为设置的默认模式（普通 / 增强搜索 / 任务）。WindowManager 无权访问
  // 这些模块，故在此注入钩子，由 applyDefaultModelMode 进入新会话页时调用。
  windows.resetChatModeHook = (wc) => {
    if (!wc || wc.isDestroyed()) return;
    // 插件关闭：不应用「增强搜索 / 任务」默认模式（该模式依赖插件）。
    if (injector.isDsppEnabled() === false) return;
    applyConfiguredModeToWc(wc, defaultChatModeFor());
  };

  // 插件系统：尽早加载已启用的插件（使 content scripts 随 chat 首屏首批注入），
  // 不阻塞主流程，失败时静默（由插件面板查看状态）。
  // 内置插件启用状态同步给 Injector：关闭插件则断开模式切换按钮/token 等基于插件功能的注入。
  extensionManager.init().then(initDsppState, initDsppState);
  function initDsppState(): void {
    try {
      injector.setDsppEnabled(extensionManager.isBuiltinEnabled());
    } catch { /* ignore */ }
  }
  // ExtensionHost：注册 chrome 兼容层 IPC（storage/runtime），供页面注入的 DeepSeek++ content 调用。
  extensionHost.registerIpc();
  // 注册 dspp:// 协议（服务内置 sidepanel 资源），并支持“打开 DeepSeek++ 工作台”。
  extensionManager.registerDsppProtocol();

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

// 退出前：停止内置 Shell Local 宿主服务、统一 kill 活跃子进程、销毁扩展桥页面
app.on('quit', () => {
  killAllChildProcesses();
  stopLocalShellServer();
  try { extensionManager?.disposeWebToolsBridge(); } catch { /* 忽略 */ }
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
