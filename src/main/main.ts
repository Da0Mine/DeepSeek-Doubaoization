/**
 * 主进程入口：装配各模块、注册 IPC、处理生命周期。
 * 锁定决策：
 *  - Electron + WebContentsView 内嵌 chat.deepseek.com（配置存 %APPDATA%/DeepSeek/config.json）
 *  - 嵌入网页版：截图/提示词经 Injector 注入网页对话框
 *  - 手动登录：用户在 WebContentsView 登录，session 由 Electron 持久化到磁盘
 */
import { app, session } from 'electron';
import { ConfigStore } from './config/ConfigStore';
import { WindowManager } from './windows/WindowManager';
import { ShortcutManager } from './shortcuts/ShortcutManager';
import { TrayManager } from './tray/TrayManager';
import { ThemeManager } from './theme/ThemeManager';
import { ScreenshotManager } from './screenshot/ScreenshotManager';
import { Injector } from './inject/Injector';
import { PromptTemplates } from './prompts/promptTemplates';
import { SettingsWindow } from './windows/settingsWindow';
import { registerHandlers } from './ipc/handlers';

app.setName('DeepSeek');

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

/** 应用代理配置（若启用）。 */
function applyProxy(): void {
  if (config.get('proxyEnabled') && config.get('proxyUrl')) {
    session.defaultSession
      .setProxy({ proxyRules: config.get('proxyUrl') })
      .catch((e) => console.error('[main] 代理设置失败:', e));
  }
}

app.whenReady().then(() => {
  config = new ConfigStore();
  templates = new PromptTemplates(config);
  injector = new Injector(templates);
  screenshot = new ScreenshotManager(config);
  theme = new ThemeManager();
  windows = new WindowManager(config);
  windows.setInjector(injector);
  screenshot.setWindowManager(windows);
  settings = new SettingsWindow();

  // 网页内对话视图就绪后注入剪刀截图按钮（I-01）。
  // 必须在 createMainWindow 之前设置，确保首个主窗口也能注入。
  windows.setWebViewReadyHook((wc: Electron.WebContents) => {
    injector.injectScissorsButton(wc, () => screenshot.startCapture());
  });

  // 创建主窗口
  windows.createMainWindow();

  // 应用代理
  applyProxy();

  // 开机自启
  app.setLoginItemSettings({ openAtLogin: config.get('startAtLogin') });

  // 快捷键
  shortcuts = new ShortcutManager();
  shortcuts.onScreenshot = () => {
    screenshot.startCapture();
  };
  shortcuts.onSummonSub = () => windows.summonSubWindow();
  shortcuts.applyFromConfig(config.getAll());

  // 托盘（右键菜单仅保留「退出」，单击托盘显隐主窗口）
  tray = new TrayManager(config, {
    onToggle: () => windows.toggleMainWindow(),
    onQuit: () => {
      windows.setQuitting(true);
      app.quit();
    },
  });
  tray.rebuild();

  // 统一注册 IPC（必须在首次 applyTheme 之前，确保 broadcaster 已注入，
  // 首帧主题广播不丢失 —— 修复启动白屏，见 I-02）。
  registerHandlers({ config, windows, injector, screenshot, theme, tray, shortcuts, templates, settings });

  // 主题（broadcaster 已在 registerHandlers 内注入，首帧即正确）
  theme.applyTheme(config.get('theme'));

  // 启动最小化到托盘
  if (config.get('minimizeToTrayOnStart') && config.get('trayEnabled')) {
    windows.hideMainWindow();
  }
});

// 所有窗口关闭：若启用托盘或关闭到托盘，则保持进程（由托盘退出）；否则退出。
app.on('window-all-closed', () => {
  if (!(config?.get('trayEnabled') || config?.get('closeToTray'))) {
    app.quit();
  }
});

// 退出前：标记正在退出（放行窗口 close 拦截），清理快捷键
app.on('before-quit', () => {
  windows?.setQuitting(true);
  shortcuts?.unregisterAll();
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
