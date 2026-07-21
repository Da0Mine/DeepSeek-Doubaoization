/**
 * 主进程 IPC 处理器注册入口（唯一注册点）。
 * 所有通道名来自 channels.ts，与预加载脚本对称。
 */
import { BrowserWindow, Notification, app, ipcMain, session } from 'electron';
import { IPC } from './channels';
import type { ConfigStore } from '../config/ConfigStore';
import type { WindowManager } from '../windows/WindowManager';
import type { Injector } from '../inject/Injector';
import type { ScreenshotManager } from '../screenshot/ScreenshotManager';
import type { ThemeManager } from '../theme/ThemeManager';
import type { TrayManager } from '../tray/TrayManager';
import type { ShortcutManager } from '../shortcuts/ShortcutManager';
import type { PromptTemplates } from '../prompts/promptTemplates';
import type { SettingsWindow } from '../windows/settingsWindow';
import { applyThinkCollapse } from '../inject/thinkCollapse';
import type {
  Annotation,
  ConfigKey,
  LoginStatusPayload,
  ScreenshotAction,
  ScreenshotRect,
  ThemeMode,
  ThemeVars,
  TranslateSyncPayload,
} from '../../shared/types';
import { getOverlayWebContents } from '../windows/screenshotOverlay';

export interface HandlerCtx {
  config: ConfigStore;
  windows: WindowManager;
  injector: Injector;
  screenshot: ScreenshotManager;
  theme: ThemeManager;
  tray: TrayManager;
  shortcuts: ShortcutManager;
  templates: PromptTemplates;
  settings: SettingsWindow;
}

export function registerHandlers(ctx: HandlerCtx): void {
  const { config, windows, injector, screenshot, theme, tray, shortcuts, templates, settings } = ctx;

  /** 向所有外壳窗口广播主题 CSS 变量（含字号）。 */
  const broadcastTheme = (vars?: ThemeVars): void => {
    const v: ThemeVars = { ...(vars ?? theme.getCssVars()) };
    v['--ds-font-size'] = `${config.get('fontSize')}px`;
    const list = [...windows.getShellWebContentsList()];
    const settingsWc = settings.getWebContents();
    if (settingsWc && !settingsWc.isDestroyed()) list.push(settingsWc);
    for (const wc of list) {
      if (!wc.isDestroyed()) wc.send(IPC.THEME_VARS, v);
    }
  };
  theme.setBroadcaster(broadcastTheme);
  theme.onSystemThemeChange(() => broadcastTheme());

  // 设置窗口就绪后立刻下发当前主题（新窗口首帧）。
  settings.onReady = () => broadcastTheme();

  const notify = (title: string, body: string): void => {
    if (!config.get('notificationEnabled')) return;
    try {
      new Notification({ title, body }).show();
    } catch (e) {
      console.error('[handlers] 通知失败:', e);
    }
  };

  shortcuts.onError = (msg) => notify('快捷键', msg);

  // ---------------- 窗口控制 ----------------
  ipcMain.on(IPC.WIN_TOGGLE, () => windows.toggleMainWindow());

  ipcMain.on(IPC.WIN_MIN, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !win.isDestroyed()) win.minimize();
  });

  ipcMain.on(IPC.WIN_MAX, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on(IPC.WIN_CLOSE, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  // 切换当前窗口置顶（标题栏「置顶」按钮）
  ipcMain.on(IPC.WIN_ALWAYS_ON_TOP, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(!win.isAlwaysOnTop());
  });

  // ---------------- 截图 ----------------
  ipcMain.on(IPC.SCREENSHOT_START, () => screenshot.startCapture());

  // 选区完成：裁剪对应屏截图并下发到遮罩用于冻结显示（I-03/I-04）
  ipcMain.on(IPC.OVERLAY_SELECT, (_e, rect: ScreenshotRect) => {
    const sf = screenshot.getScaleFactorForRect(rect);
    const img = screenshot.getImageData(rect, sf);
    const wc = getOverlayWebContents();
    if (img && wc && !wc.isDestroyed()) {
      wc.send(IPC.OVERLAY_SET_IMAGE, img.toDataURL());
    }
  });

  // 遮罩标注控制：主进程转发到 overlay 渲染层（保持 IPC 对称）
  const forwardToOverlay = (channel: string) => (e: Electron.IpcMainEvent, payload: unknown): void => {
    const wc = getOverlayWebContents();
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  };
  ipcMain.on(IPC.OVERLAY_SET_COLOR, forwardToOverlay(IPC.OVERLAY_SET_COLOR));
  ipcMain.on(IPC.OVERLAY_SET_TOOL, forwardToOverlay(IPC.OVERLAY_SET_TOOL));
  ipcMain.on(IPC.OVERLAY_UNDO, forwardToOverlay(IPC.OVERLAY_UNDO));
  ipcMain.on(IPC.OVERLAY_CLEAR, forwardToOverlay(IPC.OVERLAY_CLEAR));

  // overlay 合成结果回传 -> 唤醒 ScreenshotManager 的 composeAnnotated
  ipcMain.on(IPC.OVERLAY_COMPOSE_RESULT, (_e, dataUrl: string) => {
    screenshot.resolveCompose(dataUrl);
  });

  // 截图动作：停留 -> 标注合成 -> 选动作（I-04/I-05）
  ipcMain.on(
    IPC.SCREENSHOT_ACTION,
    async (_e, payload: { action: ScreenshotAction; rect: ScreenshotRect; annotations?: Annotation[] }) => {
      const { action, rect, annotations } = payload;
      const anns = annotations || [];
      let img = null as Electron.NativeImage | null;
      try {
        img = await screenshot.composeAnnotated(rect, anns);
      } catch (err) {
        console.error('[handlers] 标注合成失败:', err);
      }
      // 合成已结束，遮罩可关闭（截图停留至此，结果在 B 窗口/剪贴板）
      screenshot.hideOverlayNow();
      if (!img) {
        notify('截图失败', '无法生成截图');
        return;
      }
      try {
        switch (action) {
          case 'clipboard':
            screenshot.copyToClipboard(img);
            notify('已复制到剪贴板', '截图已写入剪贴板');
            break;
          case 'chat': {
            const wc = windows.getScreenshotTarget();
            if (!wc) {
              notify('没有对话窗口', '请先打开 DeepSeek 对话窗口');
              return;
            }
            await injector.submitToChat(wc, '', screenshot.writeTempImage(img));
            break;
          }
          case 'sendCurrent': {
            // 发送到「发起截图的当前对话窗口」：activeId 始终指向最后聚焦的对话窗口
            // （截图遮罩由 screenshotOverlay 独立管理，不会改写 activeId）。
            // 用户要求：只把原图附到该对话，不切换模型、不自动点击发送。
            const wc = windows.getActiveWebContents();
            if (!wc) {
              notify('没有对话窗口', '请先打开 DeepSeek 对话窗口');
              return;
            }
            await injector.waitForAppReady(wc);
            await injector.uploadImageOnly(wc, screenshot.writeTempImage(img));
            break;
          }
          case 'sendNew': {
            // 发送到一个「新开的副窗口」：每次新建一个 sub 窗口承载该截图对话。
            // 用户要求：只上传原图，不切换模型、不自动点击发送。
            // 问题 D 修复：复用/关闭上一个 sendNew 窗口避免竞态；先等页面真正就绪再显示，杜绝白屏。
            const id = windows.createSendNewSubWindow();
            if (!id) {
              notify('无法创建新对话', '请重试');
              return;
            }
            const wc = windows.getViewWebContents(id);
            if (!wc) {
              notify('无法创建新对话', '请重试');
              return;
            }
            // 先等待 chat 视图 DOM 挂载（文件框 + 输入框出现），再 reveal（置顶+显示+聚焦），
            // 避免窗口提前显示却仍是空白（白屏）。
            await injector.waitForAppReady(wc);
            // Bug4 修复：截图「发送到新对话」强制图片兼容模式。
            // 该窗口已标 skipDefaultModel（applyDefaultModelMode / 新建对话监听均不会动它），
            // 故专家模式截图时不应切到 expert（expert 不支持图片）；若默认模型为 expert，
            // 则映射到识图模式 vision（图片兼容模式，参考 B 窗口截图即切 vision），
            // 删除图片后也保持此模式、不会被切回 expert。
            if (config.get('defaultModelMode') === 'expert') {
              await injector.switchModelMode(wc, 'vision').catch(() => {});
            }
            // 同步「深度思考」开关到当前设置（只读默认，不强行开启）
            await injector.setDeepThink(wc, config.get('deepThinkEnabled') === true).catch(() => {});
            windows.revealWindow(id);
            await injector.uploadImageOnly(wc, screenshot.writeTempImage(img));
            break;
          }
          case 'extract':
          case 'translate':
          case 'explain': {
            // 弹出 B 类临时窗口（9:16 选区旁开）作为注入目标（I-07）
            windows.createBWindow(rect);
            const wc = windows.getScreenshotTarget();
            if (!wc) {
              notify('没有对话窗口', '请先登录 DeepSeek');
              return;
            }
            const tmp = screenshot.writeTempImage(img);
            // 不再固定等待 2.5s：轮询 B 窗口 chat 视图是否就绪（文件框 + 输入框出现即视为挂载完成），
            // 就绪即继续注入，消除明显的停顿卡顿（fillText/clickSend 内部仍有轮询重试兜底）。
            await injector.waitForAppReady(wc);
            // B 类临时窗口默认关闭深度思考（用户要求：B 类窗口一般不打开深度思考），页面就绪即关开关
            await injector.setDeepThink(wc, false);
            await injector.switchToVisionModel(wc);
            if (action === 'extract') {
              await injector.extractText(wc, tmp);
            } else if (action === 'translate') {
              const lang = config.get('defaultTranslateTargetLang');
              const prompt = templates.render(templates.translatePrompt(lang), { content: '' });
              await injector.submitToChat(wc, prompt, tmp);
            } else {
              const prompt = templates.render(templates.explainPrompt(), { content: '' });
              await injector.submitToChat(wc, prompt, tmp);
            }
            break;
          }
          default:
            notify('未知截图动作', String(action));
        }
      } catch (err) {
        console.error('[handlers] 截图动作执行失败:', err);
      }
    }
  );

  // ---------------- 设置 / 副窗口 / 剪刀 ----------------
  ipcMain.on(IPC.SETTINGS_OPEN, () => settings.open());
  // Bug5 修复：副窗口快捷键改为 toggle（按一次显示/再按一次隐藏，循环）
  ipcMain.on(IPC.SUB_SUMMON, () => windows.toggleSubWindow());
  ipcMain.on(IPC.SUB_SWAP, (e) => {
    const id = windows.findIdByWebContents(e.sender);
    // 如果发送者不是已登记的窗口（例如来自 preload 的某个独立 webContents），回退旧行为。
    windows.swapMainSub(id || undefined);
  });
  ipcMain.on(IPC.NEW_CONVERSATION, (e) => {
    // 网页内「新建对话」被触发：自动把当前对话窗口切换到设置的默认模型模式（Bug2 修复）。
    windows.applyDefaultModelMode(e.sender);
  });
  ipcMain.on(IPC.SCISSORS_TRIGGER, () => screenshot.startCapture());

  // ---------------- 配置 ----------------
  ipcMain.handle(IPC.CONFIG_GET, (_e, { key }: { key: ConfigKey }) => {
    return config.get(key);
  });

  ipcMain.handle(IPC.CONFIG_SET, (_e, { key, value }: { key: ConfigKey; value: unknown }) => {
    config.set(key, value as never);
    applyConfigSideEffects(key, value);
    return true;
  });

  ipcMain.handle(IPC.CONFIG_RESET, () => {
    config.reset();
    theme.applyTheme(config.get('theme'));
    shortcuts.applyFromConfig(config.getAll());
    tray.rebuild();
    for (const wc of windows.getShellWebContentsList()) {
      const id = windows.findIdByWebContents(wc);
      if (id) windows.setAlwaysOnTop(id, config.get('alwaysOnTop'));
    }
    broadcastTheme();
    return true;
  });

  /** 配置变更后的副作用（真正作用于对应功能）。 */
  const applyConfigSideEffects = (key: ConfigKey, value: unknown): void => {
    switch (key) {
      case 'theme':
        theme.applyTheme(value as ThemeMode);
        break;
      case 'trayEnabled':
        tray.rebuild();
        break;
      case 'screenshotShortcut':
      case 'subWindowShortcut':
        shortcuts.applyFromConfig(config.getAll());
        break;
      case 'alwaysOnTop':
        for (const wc of windows.getShellWebContentsList()) {
          const id = windows.findIdByWebContents(wc);
          if (id) windows.setAlwaysOnTop(id, Boolean(value));
        }
        break;
      case 'annotationColors':
        // 仅设置面板使用，下次截图时由 overlay 读取，无需即时副作用
        break;
      case 'deepThinkEnabled': {
        // Bug3 修复：setDeepThink 实现后此前从未被调用。现设置变更时即时对全部对话窗口应用开关，
        // 并同步在新建对话 / 应用默认模型时（applyDefaultModelMode）生效，使「默认深度思考」真正落地。
        const enabled = Boolean(value);
        notify('深度思考', enabled ? '已开启' : '已关闭');
        for (const wc of windows.getAllChatWebContents()) {
          injector.setDeepThink(wc, enabled).catch(() => {});
        }
        break;
      }
      case 'collapseThinking':
        // 实时对当前所有对话窗口应用/取消折叠思考过程
        for (const wc of windows.getAllChatWebContents()) {
          applyThinkCollapse(wc, Boolean(value));
        }
        break;
      case 'proxyEnabled':
      case 'proxyUrl':
        if (config.get('proxyEnabled') && config.get('proxyUrl')) {
          session.defaultSession
            .setProxy({ proxyRules: config.get('proxyUrl') })
            .catch((e) => console.error('[handlers] 代理设置失败:', e));
        } else {
          session.defaultSession.setProxy({ proxyRules: '' }).catch(() => {});
        }
        break;
      case 'startAtLogin':
        app.setLoginItemSettings({ openAtLogin: Boolean(value) });
        break;
      case 'fontSize':
        broadcastTheme();
        break;
      default:
        break;
    }
  };

  // ---------------- 主题 ----------------
  ipcMain.on(IPC.THEME_APPLY, (_e, { mode }: { mode: ThemeMode }) => {
    config.set('theme', mode);
    theme.applyTheme(mode);
  });

  ipcMain.handle(IPC.THEME_VARS_REQUEST, () => {
    const v = theme.getCssVars();
    v['--ds-font-size'] = `${config.get('fontSize')}px`;
    return v;
  });

  // ---------------- 翻译实时同步 ----------------
  ipcMain.on(IPC.TRANSLATE_SYNC, (e, payload: TranslateSyncPayload) => {
    if (!config.get('realTimeTranslateSync')) {
      return;
    }
    const wc = windows.getActiveWebContents();
    if (!wc) return;
    const lang = payload.targetLang || config.get('defaultTranslateTargetLang');
    injector.translate(wc, payload.text, lang).then((ok) => {
      if (!ok) {
        notify('翻译注入失败', '未找到对话输入框，请确认已登录');
        return;
      }
      setTimeout(async () => {
        const out = await injector.readLatestResponse(wc);
        if (out) {
          e.sender.send(IPC.TRANSLATE_RESULT, { ...payload, translated: out });
        }
      }, 2500);
    });
  });

  // ---------------- 登录态 ----------------
  ipcMain.on(IPC.LOGIN_DETECT, (_e, payload: LoginStatusPayload) => {
    for (const wc of windows.getShellWebContentsList()) {
      wc.send(IPC.LOGIN_STATUS, payload);
    }
  });

  // ---------------- 通知 ----------------
  ipcMain.on(IPC.NOTIFY, (_e, { title, body }: { title: string; body: string }) => {
    notify(title, body);
  });

  // 初始向已存在的窗口下发主题变量（新窗口在创建时由主进程再次 applyTheme 推送）。
  broadcastTheme();
}
