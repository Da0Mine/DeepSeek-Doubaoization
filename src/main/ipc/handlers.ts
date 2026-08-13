/**
 * 主进程 IPC 处理器注册入口（唯一注册点）。
 * 所有通道名来自 channels.ts，与预加载脚本对称。
 */
import { BrowserWindow, Notification, app, dialog, ipcMain, session } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
import type { ScreenShareManager } from '../screenShare/ScreenShareManager';
import { applyThinkCollapse } from '../inject/thinkCollapse';
import { logf } from '../logger';
import type {
  Annotation,
  ConfigKey,
  LoginStatusPayload,
  NotificationType,
  ScreenshotAction,
  ScreenshotRect,
  ThemeMode,
  ThemeVars,
  TranslateSyncPayload,
} from '../../shared/types';
import { getOverlayWebContents } from '../windows/screenshotOverlay';
import { getBrowserWindowManager } from '../windows/browserWindow';
import { DEEPSEEK_URL } from '../constants';
import type { UpdateChecker } from '../update/UpdateChecker';
import type { UpdatePromptWindow } from '../update/UpdatePromptWindow';
import type { ModeReminderWindow } from '../modeReminder/ModeReminderWindow';
import type { WpsDocManager } from '../wps/WpsDocManager';
import type { OnboardingManager } from '../onboarding/OnboardingManager';
import type { FirstRunDialog } from '../firstRun/FirstRunDialog';
import type { AnswerReminder } from '../reminder/AnswerReminder';
import { setLoginItem } from '../loginItem';

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
  screenShare: ScreenShareManager;
  update: UpdateChecker;
  updatePrompt: UpdatePromptWindow;
  modeReminder: ModeReminderWindow;
  wps: WpsDocManager;
  onboarding: OnboardingManager;
  firstRunDialog: FirstRunDialog;
  answerReminder: AnswerReminder;
  /** 首次运行流程（未完成使用说明引导时触发）：弹登录引导 → 检测登录 → 弹使用说明。 */
  startFirstRunFlow: () => void;
}

export function registerHandlers(ctx: HandlerCtx): void {
  const { config, windows, injector, screenshot, theme, tray, shortcuts, templates, settings, screenShare, update, updatePrompt, modeReminder, wps, onboarding, firstRunDialog, answerReminder, startFirstRunFlow } = ctx;

  /** 向所有外壳窗口广播主题 CSS 变量（含字号）。 */
  const broadcastTheme = (vars?: ThemeVars): void => {
    const v: ThemeVars = { ...(vars ?? theme.getCssVars()) };
    v['--ds-font-size'] = `${15 + (config.get('fontSize') || 0)}px`;
    v['--ds-font-offset'] = String(config.get('fontSize') || 0);
    const list = [...windows.getShellWebContentsList()];
    const settingsWc = settings.getWebContents();
    if (settingsWc && !settingsWc.isDestroyed()) list.push(settingsWc);
    // 内置浏览器窗口外壳也要跟随主题（深色模式下标签栏同步变色）
    const browserShell = getBrowserWindowManager()?.getShellWebContents();
    if (browserShell && !browserShell.isDestroyed()) list.push(browserShell);
    for (const wc of list) {
      if (!wc.isDestroyed()) wc.send(IPC.THEME_VARS, v);
    }
  };
  theme.setBroadcaster(broadcastTheme);
  theme.onSystemThemeChange(() => broadcastTheme());

  // 设置窗口就绪后立刻下发当前主题（新窗口首帧）。
  settings.onReady = () => broadcastTheme();

  const notify = (title: string, body: string, type: NotificationType = 'operation'): void => {
    if (!config.get('notificationEnabled')) return;
    // 按通知分类检查对应开关（总开关已在上方判断）
    const keyByType: Record<NotificationType, ConfigKey> = {
      screenshot: 'notificationScreenshot',
      operation: 'notificationOperation',
      textSelection: 'notificationTextSelection',
      shortcut: 'notificationShortcut',
      replyDone: 'notificationReplyDone',
    };
    if (!config.get(keyByType[type])) return;
    try {
      new Notification({ title, body }).show();
    } catch (e) {
      console.error('[handlers] 通知失败:', e);
    }
  };

  shortcuts.onError = (msg) => notify('快捷键', msg, 'shortcut');

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
    if (win && !win.isDestroyed()) {
      const next = !win.isAlwaysOnTop();
      // 置顶时用 'screen-saver' 层级（macOS 上压过其他 always-on-top 窗口；Windows 上层级参数忽略）。
      // 取消置顶时用 'normal' 层级（恢复普通窗口层级）。
      win.setAlwaysOnTop(next, next ? 'screen-saver' : 'normal');
      // 置顶时立即 moveTop + focus，确保窗口在 always-on-top 组内到最前（用户反馈「没实现置顶功能」）。
      // 不只是切换 alwaysOnTop 标志，还要把窗口实际带到 z-order 顶部。
      if (next) {
        try { win.moveTop(); } catch { /* 个别平台不支持，忽略 */ }
        win.focus();
      } else if (win.isVisible()) {
        // Windows：setAlwaysOnTop(false) 后窗口会被移到 Z 序最底且 moveTop 无效（electron#45024），
        // 用「重新置顶 → 立即取消置顶」双重切换强制 Windows 重算 Z 序，恢复正常层级最前。
        try {
          win.setAlwaysOnTop(true);
          win.setAlwaysOnTop(false);
        } catch { /* 忽略 */ }
        try { win.moveTop(); } catch { /* 个别平台不支持，忽略 */ }
        win.focus();
      }
      // 把状态同步回该窗口外壳，使按钮图标随置顶状态切换（实心/空心）
      if (!e.sender.isDestroyed()) {
        e.sender.send(IPC.WIN_ALWAYS_ON_TOP_STATE, next);
      }
    }
  });

  // 查询当前窗口置顶状态（标题栏初始化时同步图标）
  ipcMain.handle(IPC.WIN_IS_ALWAYS_ON_TOP, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return !!(win && !win.isDestroyed() && win.isAlwaysOnTop());
  });

  // ---------------- 截图 ----------------
  ipcMain.on(IPC.SCREENSHOT_START, (e) => screenshot.startCapture(undefined, windows.findIdByWebContents(e.sender)));

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

  // overlay 渲染进程就绪（监听器已注册）后，才下发全屏截图背景图。
  // 避免 startCapture 在 showOverlay 的异步 loadFile 尚未完成、监听未注册时就 send 导致消息被丢弃（黑屏竞态）。
  ipcMain.on(IPC.OVERLAY_READY, () => screenshot.sendOverlayBackground());

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
        notify('截图失败', '无法生成截图', 'screenshot');
        return;
      }
      try {
        switch (action) {
          case 'clipboard':
            screenshot.copyToClipboard(img);
            notify('截图已复制', '已复制到剪贴板，可直接粘贴', 'screenshot');
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
            // Bug 修复：截图发送到当前对话时，若该窗口不在前台（被最小化/隐藏在后台），
            // 先把承载该对话的窗口呼出到前台并显示，确保用户能看到发送结果，而不是「发完就完」。
            const targetId = windows.findIdByWebContents(wc);
            if (targetId) windows.revealWindow(targetId);
            // 发送到副窗口时同步「对话当前在副窗口」状态，避免之后主副切换方向错误
            // （对话在副窗口却按主→副方向切换，把主窗口空视图覆盖到副窗口上）。
            if (targetId && targetId !== 'main') windows.markConversationInSub(targetId);
            await injector.waitForAppReady(wc);
            await injector.uploadImageOnly(wc, screenshot.writeTempImage(img));
            break;
          }
          case 'sendNew': {
            // 哪里截图发哪里：窗口内触发（剪刀按钮）→ 发送到该窗口的新对话（主窗口 → 主窗口，
            // 副窗口 → 副窗口）；截图快捷键 → 固定发送到副窗口。原实现固定新建一个副窗口承载截图。
            // 用户要求：只上传原图，不自动点击发送。
            const targetId = windows.resolveSendNewTarget(screenshot.getCaptureOrigin());
            const wc = windows.getViewWebContents(targetId);
            if (!wc) {
              notify('无法创建新对话', '请重试');
              return;
            }
            // 发送目标是副窗口时，登记「对话当前在副窗口」，保证主副切换按钮方向正确
            if (targetId !== 'main') windows.markConversationInSub(targetId);
            // 截图发送新对话期间抑制默认模型自动应用（applyDefaultModelMode），
            // 避免点击「新建对话」把模型抢先切走（如默认 expert 不支持图片），
            // 与下方按截图设置显式切换模型竞争。
            await windows.suppressDefaultModelFor(wc.id, async () => {
              // 先等待 chat 视图 DOM 挂载（文件框 + 输入框出现）。
              await injector.waitForAppReady(wc);
              // 确保进入新对话：点击「新建对话」按钮（已在新建对话页时点击也幂等无害）。
              const clickedNew = await injector.clickNewConversationButton(wc).catch(() => false);
              if (clickedNew) {
                // 点击后等 SPA 切到新对话页（URL 回到根路由）；点击未生效则跳过等待
                await injector.waitForNewConversation(wc).catch(() => {});
              }
              // 等待新对话页面 DOM 就绪（文件框 + 输入框重新出现）。
              await injector.waitForAppReady(wc);
              // 截图「发送到新对话」的模型模式由设置控制（默认识图模式，可改为快速模式）。
              if (config.get('screenshotSendNewMode') === 'vision') {
                await injector.switchModelMode(wc, 'vision').catch(() => {});
              } else {
                await injector.switchModelMode(wc, 'simple').catch(() => {});
              }
              // 同步「深度思考」开关到当前设置（只读默认，不强行开启）
              await injector.setDeepThink(wc, config.get('deepThinkEnabled') === true).catch(() => {});
              // 呼出目标窗口到前台（截图期间窗口被隐藏，这里恢复并聚焦，确保用户看到发送结果）
              windows.revealWindow(targetId);
              // 只上传原图（不自动点击发送）
              await injector.uploadImageOnly(wc, screenshot.writeTempImage(img));
            });
            break;
          }
          case 'extract':
          case 'translate':
          case 'explain': {
            // 弹出 B 类临时窗口（9:16 选区旁开）作为注入目标（I-07）
            windows.createBWindow(rect);
            // 截图呼出 B 窗口时最小化主窗口，避免主窗口遮挡 B 窗口（双重保障：WindowManager.createBWindow 内也调用了此方法）
            try { windows.minimizeMainWindow(); } catch {};
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
              // 使用配置的默认翻译语言（设置 → 交互与通知 → 默认翻译语言），
              // 不再硬编码 'English'。同时向 B 窗口外壳发送 TRANSLATE_SET_LANG
              // 显示语言栏并设置当前选中语言。
              const lang = config.get('defaultTranslateLang') || 'English';
              windows.sendTranslateSetLang(lang);
              const prompt = templates.render(templates.translatePrompt(lang), { content: '' });
              await injector.submitToChat(wc, prompt, tmp);
            } else {
              const prompt = templates.render(templates.explainPrompt(), { content: '' });
              await injector.submitToChat(wc, prompt, tmp);
            }
            break;
          }
          default:
            notify('无法识别的截图操作', String(action), 'screenshot');
        }
      } catch (err) {
        console.error('[handlers] 截图动作执行失败:', err);
      }
    }
  );

  // ---------------- 设置 / 副窗口 / 剪刀 ----------------
  ipcMain.on(IPC.SETTINGS_OPEN, () => settings.open());
  ipcMain.on(IPC.SETTINGS_CLOSE, () => settings.close());

  // 标题栏更新图标 -> 打开设置并跳转到「更新」板块。
  // 设置视图可能尚未加载完（监听未注册），此时先缓存，待 did-finish-load（settings.onReady）后补发。
  let pendingSettingsGoto: { top: string; sub: string } | null = null;
  const flushSettingsGoto = (): void => {
    const wc = settings.getWebContents();
    if (pendingSettingsGoto && wc && !wc.isDestroyed() && settings.isReady) {
      wc.send(IPC.SETTINGS_GOTO, pendingSettingsGoto);
      pendingSettingsGoto = null;
    }
  };
  settings.onReady = flushSettingsGoto;
  ipcMain.handle(IPC.UPDATE_OPEN_SETTINGS, () => {
    windows.showMainWindow();
    settings.open();
    pendingSettingsGoto = { top: '应用', sub: '更新' };
    flushSettingsGoto();
    return true;
  });

  // ---- 内置浏览器窗口（多标签） ----
  ipcMain.handle(IPC.BROWSER_GET_STATE, () => getBrowserWindowManager()?.getState() ?? { tabs: [], visible: false });
  ipcMain.on(IPC.BROWSER_SWITCH_TAB, (_e, { id }: { id: number }) => {
    getBrowserWindowManager()?.switchTab(id);
  });
  ipcMain.on(IPC.BROWSER_CLOSE_TAB, (_e, { id }: { id: number }) => {
    getBrowserWindowManager()?.closeTab(id);
  });
  ipcMain.on(IPC.BROWSER_NEW_TAB, (_e, { url }: { url?: string }) => {
    getBrowserWindowManager()?.newTab(url);
  });
  ipcMain.on(IPC.BROWSER_CLOSE, () => {
    getBrowserWindowManager()?.closeWindow();
  });
  // Bug5 修复：副窗口快捷键改为 toggle（按一次显示/再按一次隐藏，循环）
  ipcMain.on(IPC.SUB_SUMMON, () => windows.toggleSubWindow());
  ipcMain.on(IPC.SUB_SWAP, (e) => {
    const id = windows.findIdByWebContents(e.sender);
    // 如果发送者不是已登记的窗口（例如来自 preload 的某个独立 webContents），回退旧行为。
    windows.swapMainSub(id || undefined).catch(() => {});
  });
  ipcMain.on(IPC.NEW_CONVERSATION, (e) => {
    // 网页内「新建对话」被触发：自动把当前对话窗口切换到设置的默认模型模式（Bug2 修复）。
    logf('NEW_CONV', `收到网页新建对话事件 senderId=${e.sender?.id}`);
    windows.applyDefaultModelMode(e.sender);
  });
  // 网页内剪刀按钮 → 截图：origin = 发起截图的窗口（主窗口/副窗口，哪里截图发哪里）
  ipcMain.on(IPC.SCISSORS_TRIGGER, (e) => screenshot.startCapture(undefined, windows.findIdByWebContents(e.sender)));

  // 网页内「+」按钮→截图提问（简化模式，仅发送到当前对话）
  ipcMain.on(IPC.PLUS_SCREENSHOT_Q, (e) => screenshot.startCapture('question', windows.findIdByWebContents(e.sender)));

  // 网页内「+」按钮→上传文件
  ipcMain.on(IPC.PLUS_UPLOAD_FILE, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择文件上传',
      properties: ['openFile'],
      filters: [
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (canceled || filePaths.length === 0) return;
    const filePath = filePaths[0];
    const wc = windows.getActiveWebContents();
    if (!wc) {
      notify('上传失败', '没有活跃的对话窗口');
      return;
    }
    try {
      await injector.waitForAppReady(wc);
      const ok = await injector.uploadImageOnly(wc, filePath);
      if (!ok) {
        notify('上传失败', '无法上传文件，请确认已登录');
      }
    } catch (err) {
      console.error('[handlers] 上传文件失败:', err);
      notify('上传失败', '文件上传出错');
    }
  });

  // 网页内「+」按钮→共享屏幕（切换）
  ipcMain.on(IPC.PLUS_SHARE_SCREEN, async () => {
    if (screenShare.isActive()) {
      screenShare.stop();
      return;
    }
    await prepareScreenShare();
  });

  /**
   * 共享屏幕进入前置检查：
   *  - 设置「共享屏幕自动切识图模式」开启时，先尝试把当前对话切换到识图模式（新建对话可切）；
   *  - 若当前对话已无法切换模型（已有对话，模型选择器被页面卸载）且不是识图模式，则按当前模式提示：
   *      快速模式：提示「只支持 OCR 识别，可能不精准」，仍开启共享；
   *      专家模式：提示「不支持上传图片」，且不开启共享屏幕。
   */
  const prepareScreenShare = async (): Promise<void> => {
    const wc = windows.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return;

    // 当前对话模型模式（快速/专家/识图/未知）
    const mode = await injector.getCurrentModelMode(wc);
    if (mode === 'vision') {
      screenShare.start('vision');
      return;
    }

    // 模型选择器是否可用（新建对话可切；已有对话后 radio 被卸载）
    const canSwitch = await injector.canSwitchModel(wc);
    if (canSwitch && config.get('screenShareSwitchVision')) {
      // 自动切换到识图模式（禁止点「新建对话」，避免破坏当前对话）
      const ok = await injector.switchToVisionModel(wc, { allowNewConversation: false });
      if (ok) {
        screenShare.start('vision');
        return;
      }
    }

    // 无法切换模型或自动切换关闭：按当前模式提示（覆盖式 HTML 弹框，非系统弹窗）
    if (mode === 'expert') {
      // 专家模式不支持上传图片：弹提示，且不打开共享屏幕
      if (config.get('screenShareModeReminder')) modeReminder.open('expert');
      return;
    }
    if (mode === 'simple') {
      // 快速模式仅支持 OCR 识别：弹提示，仍开启共享（任务栏按钮置黄提示「当前非识图模式」）
      if (config.get('screenShareModeReminder')) modeReminder.open('simple');
      screenShare.start('simple');
      return;
    }
    // 模式未知：保守开启，不阻断功能
    screenShare.start('unknown');
  };

  // ---- 共享屏幕模式提示弹框 ----
  // 「我知道了」仅关闭弹窗；「不再提醒」关闭弹窗并永久关闭该提示（可在设置中重新开启）
  ipcMain.on(IPC.MODE_REMINDER_ACTION, (_e, { action }: { action: 'ok' | 'never' }) => {
    if (action === 'never') {
      config.set('screenShareModeReminder', false);
    }
    modeReminder.close();
  });

  // 共享屏幕模式下 Enter 键被拦截：截屏+上传+发送
  ipcMain.on(IPC.SCREEN_SHARE_ENTER, async (_e, { text }: { text: string }) => {
    await screenShare.handleEnterPressed(text);
  });

  // 退出共享屏幕模式（任务栏按钮或加号按钮）
  ipcMain.on(IPC.SCREEN_SHARE_STOP, () => {
    screenShare.stop();
  });

  // ---------------- 共享WPS 文档（Word / Excel） ----------------
  // 点击「+」→「共享WPS Word」：枚举打开的 WPS 文档并注入下拉框浮层
  ipcMain.on(IPC.PLUS_SHARE_DOC, async () => {
    const wc = windows.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return;
    const docs = await wps.listDocuments();
    await injector.injectDocSharePicker(wc, docs, 'word');
    startDocShareIdleTimer('word');
  });

  // 点击「+」→「共享WPS Excel」：枚举打开的 WPS 表格工作簿并注入下拉框浮层
  ipcMain.on(IPC.PLUS_SHARE_EXCEL, async () => {
    const wc = windows.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return;
    const docs = await wps.listExcelDocuments();
    await injector.injectDocSharePicker(wc, docs, 'excel');
    startDocShareIdleTimer('excel');
  });

  // 点击「+」→「共享WPS PDF」：枚举打开的 WPS PDF 文档并注入下拉框浮层
  ipcMain.on(IPC.PLUS_SHARE_PDF, async () => {
    const wc = windows.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return;
    const docs = await wps.listPdfDocuments();
    await injector.injectDocSharePicker(wc, docs, 'pdf');
    startDocShareIdleTimer('pdf');
  });

  // 共享期间定时刷新：按 mode 重新枚举打开的文档/工作簿/PDF，推送给浮层更新下拉列表。
  // 结果带 mode：页面侧按模式过滤，避免某一格式的刷新结果被其他格式的悬浮框回调误用
  // （旧注入的定时器残留时，会造成「另一种格式一直抢着更新下拉列表/选中项」的切换卡顿）。
  ipcMain.on(IPC.DOC_SHARE_REFRESH, async (e, { mode }: { mode?: 'word' | 'excel' | 'pdf' }) => {
    if (e.sender.isDestroyed()) return;
    const m = mode === 'excel' ? 'excel' : mode === 'pdf' ? 'pdf' : 'word';
    const docs = m === 'excel' ? await wps.listExcelDocuments() : m === 'pdf' ? await wps.listPdfDocuments() : await wps.listDocuments();
    if (!e.sender.isDestroyed()) {
      e.sender.send(IPC.DOC_SHARE_REFRESH_RESULT, { mode: m, names: docs.map((d) => d.name) });
    }
  });

  // ---------------- 智能重复提交（Word / Excel / PDF 各自独立跟踪） ----------------
  // 同一对话内，文档提交后按「文档大小分档的轮数」重新提交最新版；
  // 一旦检测到文档被改动，下一次发送立即重新提交并重新计算轮数。
  const makeTrack = () => ({
    active: false, // 共享文档模式是否激活
    trackName: '', // 当前跟踪的文档
    roundCount: 0, // 用户已发送轮数
    lastCommitRound: -1, // 上次带文档提交的轮数（-1=尚未提交过）
    lastHash: '', // 上次提交时的文档内容哈希
    size: 0, // 文档大小（字符数）
    changed: false, // 轮询是否检测到文档改动
    idleTimer: null as ReturnType<typeof setTimeout> | null, // 空闲自动退出计时器
  });
  const docShareTracks = { word: makeTrack(), excel: makeTrack(), pdf: makeTrack() };

  // 共享文档空闲自动退出：长时间不发送消息自动退出共享文档状态（shareIdleTimeout 分钟，0=不自动退出）。
  // 退出动作：重置跟踪状态 + 关闭页面浮层（若存在，__dsDocShareStop 会发 docShare:stop 再重置一次，幂等）。
  const startDocShareIdleTimer = (m: 'word' | 'excel' | 'pdf'): void => {
    const t = docShareTracks[m];
    if (t.idleTimer) {
      clearTimeout(t.idleTimer);
      t.idleTimer = null;
    }
    const minutes = config.get('shareIdleTimeout');
    if (!minutes || minutes <= 0) return;
    t.idleTimer = setTimeout(() => {
      t.idleTimer = null;
      t.active = false;
      t.trackName = '';
      t.roundCount = 0;
      t.lastCommitRound = -1;
      t.lastHash = '';
      t.size = 0;
      t.changed = false;
      const wc = windows.getActiveWebContents();
      if (wc && !wc.isDestroyed()) {
        wc.executeJavaScript(`if (window.__dsDocShareStop) { window.__dsDocShareStop(); }`).catch(() => {});
      }
      notify('共享文档', `已 ${minutes} 分钟未发送消息，自动退出共享文档`);
    }, minutes * 60 * 1000);
  };
  const clearDocShareIdleTimer = (m: 'word' | 'excel' | 'pdf'): void => {
    const t = docShareTracks[m];
    if (t.idleTimer) {
      clearTimeout(t.idleTimer);
      t.idleTimer = null;
    }
  };
  // 上一次对 PDF 做「保存式检测」的时刻（按 docSharePdfSaveInterval 控制频率；0=仅发送时保存，轮询纯读取）
  let lastPdfSaveCheckAt = 0;
  // 每 10s 轮询检测三种文档是否被改动
  const docSharePollTimer = setInterval(async () => {
    for (const m of ['word', 'excel', 'pdf'] as const) {
      const t = docShareTracks[m];
      if (!t.active || !t.trackName) continue;
      if (m === 'pdf') {
        // PDF：感知未保存修改必须 Save() 落盘（kpdf COM 无内存内容读取接口）。
        // 间隔设置 0=仅发送时保存：轮询纯读取，只能感知已落盘的改动；
        // 间隔 >0：按该间隔做一次「保存式检测」。
        const iv = config.get('docSharePdfSaveInterval');
        if (iv > 0) {
          if (Date.now() - lastPdfSaveCheckAt < iv * 1000) continue;
          lastPdfSaveCheckAt = Date.now();
        }
        const d = await wps.getPdfDocumentDigest(t.trackName, iv > 0);
        if (!d) continue;
        t.size = d.size;
        if (t.lastHash && d.hash !== t.lastHash) t.changed = true;
        continue;
      }
      const d = m === 'excel' ? await wps.getExcelDocumentDigest(t.trackName) : await wps.getDocumentDigest(t.trackName);
      if (!d) continue;
      t.size = d.size;
      if (t.lastHash && d.hash !== t.lastHash) {
        t.changed = true; // 检测到改动：下一次发送立即重新提交
      }
    }
  }, 10000);
  docSharePollTimer.unref?.();

  /** 按模式与文档大小取提交轮数：
   *  - word：超过设置阈值（默认70万字）用设置的可调轮数（默认 15）；未超阈值不因轮数重复提交（返回 null，仅首次/检测到改动时提交）。
   *  - excel：超过设置阈值（默认10万字）用设置的可调轮数（默认 15）；未超阈值不因轮数重复提交。
   *  - pdf：超过设置阈值（默认20万字节，近似字符数）用设置的可调轮数（默认 15）；未超阈值不因轮数重复提交。 */
  const roundsForSize = (size: number, mode: 'word' | 'excel' | 'pdf'): number | null => {
    if (mode === 'excel') {
      if (size > config.get('docShareWpsExcelLargeThreshold')) return Math.max(1, config.get('docShareWpsExcelLargeRounds'));
      return null;
    }
    if (mode === 'pdf') {
      if (size > config.get('docSharePdfLargeThreshold')) return Math.max(1, config.get('docSharePdfLargeRounds'));
      return null;
    }
    if (size > config.get('docShareWpsWordLargeThreshold')) return Math.max(1, config.get('docShareWpsWordLargeRounds'));
    return null;
  };

  // 共享文档模式下发送：未到轮数且文档未改动时只发文字；
  // 满轮数或检测到改动时，实时保存文档最新版作为附件连同文字一起发送，并重新计算轮数
  ipcMain.on(IPC.DOC_SHARE_SEND, async (_e, { text, docName, mode }: { text: string; docName: string; mode?: 'word' | 'excel' | 'pdf' }) => {
    const wc = windows.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return;
    const m = mode === 'excel' ? 'excel' : mode === 'pdf' ? 'pdf' : 'word';
    const track = docShareTracks[m];
    track.active = true;
    track.trackName = docName;
    track.roundCount++;
    // 发送消息视为一次对话：重置空闲自动退出计时
    startDocShareIdleTimer(m);
    console.log('[DocShare:' + m + '] 收到发送 round=' + track.roundCount + ' text="' + String(text || '').slice(0, 20) + '" lastHash=' + (track.lastHash || '').slice(0, 12));
    // PDF：无条件先读取一次最新（此刻 Save() 落盘内存未保存修改），保证发送时一定读上 PDF；
    // 据此与上次提交的签名对比，判断是否需要重新提交。
    let pendingDoc = null;
    if (m === 'pdf') {
      pendingDoc = await wps.getPdfDocumentFile(track.trackName);
      console.log(
        '[DocShare:pdf] 读取结果 pendingDoc=' + (pendingDoc ? pendingDoc.hash.slice(0, 12) : 'null') +
        ' size=' + (pendingDoc ? pendingDoc.size : '?') + ' src=' + (pendingDoc && pendingDoc.src ? pendingDoc.src : '?') +
        ' dirtyBefore=' + (pendingDoc && pendingDoc.dirtyBefore !== undefined ? pendingDoc.dirtyBefore : '?') +
        ' dirty=' + (pendingDoc && pendingDoc.dirty !== undefined ? pendingDoc.dirty : '?') +
        ' lastHash=' + (track.lastHash || '').slice(0, 12)
      );
      if (!pendingDoc) {
        // 读取最新 PDF 失败：无法确认是否改动，保守重新提交一次（宁可多传，不可漏传）
        track.changed = true;
        console.log('[DocShare:pdf] 获取最新 PDF 失败，保守重新提交');
      } else {
        track.size = pendingDoc.size;
        if (track.lastHash && pendingDoc.hash !== track.lastHash) {
          track.changed = true;
          console.log('[DocShare:pdf] 检测到改动（签名不一致），将重新提交');
        }
      }
    } else if (track.lastHash) {
      const cur = m === 'excel' ? await wps.getExcelDocumentDigest(track.trackName) : await wps.getDocumentDigest(track.trackName);
      if (cur && cur.hash !== track.lastHash) {
        track.changed = true;
        track.size = cur.size;
        console.log('[DocShare:' + m + '] 发送前实时检测到文档改动');
      }
    }
    const roundsSince = track.lastCommitRound < 0 ? 9999 : track.roundCount - track.lastCommitRound;
    const rounds = roundsForSize(track.size, m);
    const shouldCommit = track.changed || track.lastCommitRound < 0 || (rounds !== null && roundsSince >= rounds);
    if (!shouldCommit) {
      // 未满轮数且无改动：正常发送用户文字（不带文档）
      if (!text.trim()) return;
      console.log('[DocShare:' + m + '] 轮内普通发送（不带文档）round=' + track.roundCount + ' since=' + roundsSince);
      const ok = await injector.fillTextAndSend(wc, text);
      if (!ok) notify('共享文档', '发送失败');
      wc.executeJavaScript(`window.__dsDocShareProcessing = false; if (window.__dsDocPickerShow) window.__dsDocPickerShow();`).catch(() => {});
      return;
    }
    console.log('[DocShare:' + m + '] 重新提交文档（changed=' + track.changed + ' since=' + roundsSince + '）docName=' + docName);
    // 图片式 PDF（扫描件/纯图片，无文本层）：自动切换到识图模式，否则上传后无法解析内容
    if (m === 'pdf') {
      const ptype = await wps.detectPdfType(docName);
      if (ptype === 'image') {
        const curMode = await injector.getCurrentModelMode(wc);
        if (curMode !== 'vision') {
          const canSwitch = await injector.canSwitchModel(wc);
          if (canSwitch) {
            console.log('[DocShare:pdf] 图片式 PDF，自动切换到识图模式');
            await injector.switchToVisionModel(wc, { allowNewConversation: false });
          } else {
            notify('共享文档', '图片式 PDF 需要识图模式，但当前对话无法切换模型');
          }
        }
      }
    }
    const doc = pendingDoc || (m === 'excel' ? await wps.getExcelDocumentFile(docName) : m === 'pdf' ? await wps.getPdfDocumentFile(docName) : await wps.getDocumentFile(docName));
    if (!doc || !doc.full) {
      console.log('[DocShare:' + m + '] 获取文档失败');
      notify('共享文档', '读取文档失败，请确认文档仍在 WPS 中打开');
      wc.executeJavaScript(`window.__dsDocShareProcessing = false; if (window.__dsDocPickerShow) window.__dsDocPickerShow();`).catch(() => {});
      return;
    }
    track.lastHash = doc.hash || '';
    track.size = doc.size || 0;
    track.lastCommitRound = track.roundCount;
    track.changed = false;
    const msg = text && text.trim() ? text : '请阅读我共享的文档。';
    // 大附件上传/解析需要时间：发送按钮可用轮询放宽到 20s
    const ok = await injector.submitToChat(wc, msg, doc.full, 200);
    console.log('[DocShare:' + m + '] 发送结果 ok=' + ok);
    if (!ok) notify('共享文档', '发送失败');
    wc.executeJavaScript(`window.__dsDocShareProcessing = false; if (window.__dsDocPickerShow) window.__dsDocPickerShow();`).catch(() => {});
  });

  // 取消共享文档：重置对应模式的智能提交跟踪状态
  ipcMain.on(IPC.DOC_SHARE_STOP, (_e, { mode }: { mode?: 'word' | 'excel' | 'pdf' }) => {
    const m = mode === 'excel' ? 'excel' : mode === 'pdf' ? 'pdf' : 'word';
    clearDocShareIdleTimer(m);
    const t = docShareTracks[m];
    t.active = false;
    t.trackName = '';
    t.roundCount = 0;
    t.lastCommitRound = -1;
    t.lastHash = '';
    t.size = 0;
    t.changed = false;
  });

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
      if (id) {
        windows.setAlwaysOnTop(id, config.get('alwaysOnTop'));
        if (!wc.isDestroyed()) {
          wc.send(IPC.WIN_ALWAYS_ON_TOP_STATE, config.get('alwaysOnTop'));
        }
      }
    }
    broadcastTheme();
    return true;
  });

  // 重置部分配置键到默认值（分板块重置）
  ipcMain.handle(IPC.CONFIG_RESET_KEYS, (_e, { keys }: { keys: ConfigKey[] }) => {
    config.resetKeys(keys);
    // 应用受影响配置的副作用
    for (const k of keys) {
      try { applyConfigSideEffects(k, config.get(k)); } catch {}
    }
    broadcastTheme();
    return true;
  });

  // 清除本地配置数据：软件回到最初状态（退出登录 + 恢复默认配置 + 关闭设置面板）。
  // 所有对话视图重载到 DeepSeek 首页呈现未登录态；下次启动重新走首次运行引导。
  ipcMain.handle(IPC.CONFIG_FACTORY_RESET, async () => {
    try {
      // 1) 清除登录态（cookie / localStorage 等会话数据）
      await session.fromPartition('').clearStorageData();
      // 2) 恢复全部配置为默认值（含首次运行标记）
      config.reset();
      theme.applyTheme(config.get('theme'));
      shortcuts.applyFromConfig(config.getAll());
      tray.rebuild();
      for (const wc of windows.getShellWebContentsList()) {
        const id = windows.findIdByWebContents(wc);
        if (id) windows.setAlwaysOnTop(id, config.get('alwaysOnTop'));
        if (!wc.isDestroyed()) wc.send(IPC.WIN_ALWAYS_ON_TOP_STATE, config.get('alwaysOnTop'));
      }
      broadcastTheme();
      // 3) 关闭设置面板，并重载所有对话视图到 DeepSeek 首页（呈现未登录状态）
      settings.close();
      for (const wc of windows.getAllChatWebContents()) {
        try {
          if (!wc.isDestroyed()) wc.loadURL(DEEPSEEK_URL);
        } catch {
          /* 忽略单个视图重载失败 */
        }
      }
      // 4) 立即重新触发首次运行流程：弹「登录引导 / 用户须知」→ 登录成功后弹使用说明。
      //    避免必须重启应用才出现提示（config 已重置为未完成状态）。
      try {
        startFirstRunFlow();
      } catch (e) {
        console.error('[handlers] factoryReset 后触发首次运行流程失败:', e);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  /** 配置变更后的副作用（真正作用于对应功能）。 */
  const applyConfigSideEffects = (key: ConfigKey, value: unknown): void => {
    switch (key) {
      case 'fontSize':
        // 全局字号：广播主题变量（外壳/设置面板字体跟随），并同步所有网页视图缩放
        broadcastTheme();
        windows.applyFontZoomAll(Number(value) || 0);
        break;
      case 'theme':
        theme.applyTheme(value as ThemeMode);
        break;
      case 'trayEnabled':
        tray.rebuild();
        break;
      case 'screenshotShortcut':
      case 'subWindowShortcut':
      case 'textSelectionShortcut':
        shortcuts.applyFromConfig(config.getAll());
        break;
      case 'textSelectionEnabled':
        // 启停剪贴板检测由主进程 TextSelectionWatcher 直接响应
        break;
      case 'alwaysOnTop':
        for (const wc of windows.getShellWebContentsList()) {
          const id = windows.findIdByWebContents(wc);
          if (id) {
            windows.setAlwaysOnTop(id, Boolean(value));
            // 通知渲染进程更新窗口置顶图标（设置面板切换时，手动点 pin 按钮已有 IPC 通知）
            if (!wc.isDestroyed()) {
              wc.send(IPC.WIN_ALWAYS_ON_TOP_STATE, Boolean(value));
            }
          }
        }
        break;
      case 'annotationColors':
        // 仅设置面板使用，下次截图时由 overlay 读取，无需即时副作用
        break;
      case 'deepThinkEnabled': {
        // Bug3 修复：setDeepThink 实现后此前从未被调用。现设置变更时即时对全部对话窗口应用开关，
        // 并同步在新建对话 / 应用默认模型时（applyDefaultModelMode）生效，使「默认深度思考」真正落地。
        // 注：不再弹出 toast 通知（用户要求：每次改设置都弹通知太烦）。
        const enabled = Boolean(value);
        for (const wc of windows.getAllChatWebContents()) {
          injector.setDeepThink(wc, enabled).catch(() => {});
        }
        break;
      }
      case 'smartSearchEnabled': {
        const enabled = Boolean(value);
        // 注：不再弹出 toast 通知（用户要求：每次改设置都弹通知太烦）。
        for (const wc of windows.getAllChatWebContents()) {
          injector.setSmartSearch(wc, enabled).catch(() => {});
        }
        break;
      }
      case 'collapseThinking':
        // 实时对当前所有对话窗口应用/取消折叠思考过程
        for (const wc of windows.getAllChatWebContents()) {
          applyThinkCollapse(wc, Boolean(value));
        }
        break;
      case 'answerScrollMode': {
        // 回答滚动方式（跟随回答 / 停留开头）：实时同步到所有对话窗口
        const mode = (value === 'follow' ? 'follow' : 'stay') as 'stay' | 'follow';
        for (const wc of windows.getAllChatWebContents()) {
          injector.updateAnswerScrollMode(wc, mode).catch(() => {});
        }
        break;
      }
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
        setLoginItem(Boolean(value));
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
    v['--ds-font-size'] = `${15 + (config.get('fontSize') || 0)}px`;
    return v;
  });

  // ---------------- 翻译实时同步 ----------------
  // 注：realTimeTranslateSync 配置项已移除，翻译同步功能固定为「始终启用」（不再提供开关）。
  // 原 `if (config.get('realTimeTranslateSync')) { ... }` 条件判断已移除，下方代码无条件执行。
  ipcMain.on(IPC.TRANSLATE_SYNC, (e, payload: TranslateSyncPayload) => {
    const wc = windows.getActiveWebContents();
    if (!wc) return;
    // 目标语言优先取译文窗口选择，兜底使用配置的默认翻译语言。
    const lang = payload.targetLang || config.get('defaultTranslateLang') || 'English';
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

  // ---------------- B 窗口翻译语言切换（重新翻译） ----------------
  ipcMain.on(IPC.TRANSLATE_CHANGE_LANG, (e, { lang }: { lang: string }) => {
    // 用户切换 B 窗口语言栏 → 读取上次 AI 回复 → 要求 AI 以新语言重新翻译
    const wc = windows.getScreenshotTarget();
    if (!wc) return;
    console.log('[handlers] TRANSLATE_CHANGE_LANG ->', lang);
    injector.readLatestResponse(wc).then((lastResponse) => {
      if (!lastResponse) {
        // 还没有 AI 回复，静默忽略（首次翻译尚未完成）
        return;
      }
      // 使用新语言重新翻译上次回复内容
      injector.translate(wc, lastResponse, lang).catch(() => {
        console.log('[handlers] 重新翻译失败');
      });
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

  // ---------------- 回答完成提醒 ----------------
  ipcMain.on(IPC.ANSWER_STATUS, (e, payload: { started: boolean; switched: boolean }) => {
    answerReminder.handleStatus(e.sender, !!payload?.started, !!payload?.switched);
  });

  // ---------------- 划词功能（I-12） ----------------
  // 用户从划词工具栏点击了某个按钮
  ipcMain.on(IPC.TEXT_SELECTION_ACTION, async (_e, { action, text }: { action: string; text: string }) => {
    if (action === 'copy') {
      // 复制到剪贴板 - 已由工具栏自身完成，无需额外操作
      return;
    }
    // 获取按钮列表，查找对应 action 的 prompt
    const buttonsRaw = config.get('textSelectionButtons');
    let buttons: { label: string; prompt: string; type?: string }[] = [];
    try { buttons = JSON.parse(buttonsRaw); } catch { buttons = []; }
    const btn = buttons.find((b: { label: string; prompt: string; type?: string }) => b.label === action);
    if (!btn) return;
    if (!text) {
      notify('划词失败', '未检测到选中文本', 'textSelection');
      return;
    }

    // 问问DeepSeek：引用模式，打开副窗口并填入引用文本
    if (btn.type === 'quote') {
      // 确保副窗口打开（已开启时保持，不触发 toggle 关闭）
      const subId = windows.ensureSubWindowVisible();
      if (!subId) {
        notify('无法创建副窗口', '请重试');
        return;
      }
      const wc = windows.getViewWebContents(subId);
      if (!wc) {
        notify('副窗口未就绪', '请稍后重试');
        return;
      }
      await injector.waitForAppReady(wc);
      // 将选中文本用括号括起来填入输入框，光标停在括号后
      const ok = await injector.setInputText(wc, `（${text}）`);
      if (!ok) {
        notify('引用失败', '无法找到对话输入框，请确认已登录');
      }
      return;
    }

    // 创建 B 类临时窗口并注入文本
    const rect = { x: 0, y: 0, width: 400, height: 700 };
    windows.createBWindow(rect);
    try { windows.minimizeMainWindow(); } catch {}
    const wc = windows.getScreenshotTarget();
    if (!wc) {
      notify('没有对话窗口', '请先登录 DeepSeek');
      return;
    }
    await injector.waitForAppReady(wc);
    await injector.setDeepThink(wc, false);
    // 替换 prompt 中的 {content} 占位符
    let prompt = btn.prompt.replace(/\{content\}/g, text);
    // 如果有 {targetLang}，用默认翻译语言替换
    prompt = prompt.replace(/\{targetLang\}/g, config.get('defaultTranslateLang') || '简体中文');
    await injector.submitToChat(wc, prompt);
  });

  // 工具栏关闭
  ipcMain.on(IPC.TEXT_SELECTION_CLOSE, () => {
    // 无需额外处理，工具栏窗口自行关闭
  });

  // ---- 账号管理 ----
  ipcMain.handle(IPC.ACCOUNT_GET_STATUS, async () => {
    const wc = windows.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return { loggedIn: false, error: '无对话窗口' };
    try {
      const loggedIn = await injector.detectLogin(wc);
      return { loggedIn };
    } catch {
      return { loggedIn: false, error: '检测失败' };
    }
  });

  ipcMain.handle(IPC.ACCOUNT_LOGOUT, async () => {
    const wc = windows.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return { ok: false, error: '无对话窗口' };
    try {
      await session.fromPartition('').clearStorageData();
      wc.loadURL(DEEPSEEK_URL);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- 数据管理 ----
  ipcMain.handle(IPC.DATA_CLEAR_CONVERSATIONS, async () => {
    const wc = windows.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return { ok: false, error: '无对话窗口' };
    try {
      const ok = await injector.deleteConversation(wc);
      return { ok };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.DATA_EXPORT, async () => {
    const wc = windows.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return { ok: false, error: '无对话窗口' };
    try {
      // 读取所有对话内容并导出为文本文件
      const count = await wc.executeJavaScript(`(() => {
        const items = document.querySelectorAll('[class*="conversation"], [class*="chat-item"], [data-testid*="conversation"]');
        return items.length;
      })()`);
      const text = `共 ${count} 条对话\n\n请打开 DeepSeek 网页版，在设置中选择「导出数据」以获取完整数据。`;
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: '导出对话数据',
        defaultPath: 'deepseek-chat-export.txt',
        filters: [{ name: '文本文件', extensions: ['txt'] }],
      });
      if (canceled || !filePath) return { ok: false, reason: '已取消' };
      const fs = require('fs');
      fs.writeFileSync(filePath, text, 'utf-8');
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- 更新 ----
  // 检查更新：force=false 时优先返回 10 分钟内的缓存结果。
  ipcMain.handle(IPC.UPDATE_CHECK, (_e, { force }: { force?: boolean }) => {
    return update.check(!!force);
  });

  // 在默认浏览器打开 GitHub Release 页面。
  ipcMain.handle(IPC.UPDATE_OPEN_RELEASES, () => {
    update.openReleasesPage();
    return true;
  });

  // 下载最新安装包：优先加速链接，失败回退 GitHub 直连；进度实时推送到发起者窗口。
  ipcMain.handle(IPC.UPDATE_DOWNLOAD, async (e) => {
    const asset = update.findInstaller();
    if (!asset) {
      return { ok: false, error: 'Release 中未找到适用于当前系统的安装包，请前往 Release 页面手动下载' };
    }
    try {
      const sender = e.sender;
      const localPath = await update.downloadInstaller(asset, (p) => {
        if (!sender.isDestroyed()) sender.send(IPC.UPDATE_DOWNLOAD_PROGRESS, p);
      });
      return { ok: true, path: localPath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  });

  // 唤起本地安装程序并自动退出应用（返回空字符串表示成功；应用将在安装程序启动后自动退出，无需手动关闭）。
  ipcMain.handle(IPC.UPDATE_LAUNCH, async (_e, { path: p }: { path: string }) => {
    const err = await update.launchInstallerAndQuit(p);
    return { ok: !err, error: err || undefined };
  });

  // ---- 使用说明引导 ----
  // 打开引导（设置面板入口）：先关闭设置面板，再在主窗口内展示引导。
  ipcMain.on(IPC.ONBOARDING_OPEN, () => {
    settings.close();
    onboarding.open();
  });
  ipcMain.on(IPC.ONBOARDING_CLOSE, () => onboarding.close());
  ipcMain.on(IPC.ONBOARDING_STEP, (_e, { dir }: { dir: number }) => {
    if (dir > 0) onboarding.next();
    else onboarding.prev();
  });
  ipcMain.on(IPC.ONBOARDING_SET_INTERACTIVE, (_e, interactive: boolean) => {
    onboarding.setInteractive(!!interactive);
  });

  // ---- 首次运行登录引导 / 用户须知 ----
  ipcMain.on(IPC.FIRST_RUN_ACTION, (_e, { action }: { action: 'done' | 'close' }) => {
    firstRunDialog.handleAction(String(action || 'close'));
  });

  // ---- 详细说明书「问问 AI」----
  // 把说明书内容写成 .md 临时文件，以「上传文件附件」的形式提交到专用 B 类窗口的快速模式对话并发送，
  // 让 AI 帮忙解读说明书。该窗口即为 B 类临时窗口：关闭时按「删除 B 类窗口对话」设置自动删除对话记录。
  ipcMain.on(IPC.MANUAL_ASK_AI, async (_e, manualMd: string) => {
    try {
      if (!manualMd || !manualMd.trim()) return;
      // 1) 将说明书内容写入临时 .md 文件（作为附件上传）
      const manualPath = path.join(os.tmpdir(), 'DeepSeek桌面版详细说明书.md');
      fs.writeFileSync(manualPath, manualMd, 'utf8');
      // 2) 创建「问问 AI」专用 B 类临时窗口（受「删除 B 类窗口对话」设置控制：关闭自动删对话）
      const id = windows.createManualAskBWindow();
      if (!id) {
        notify('问问 AI', '无法打开窗口，请重试');
        return;
      }
      const wc = windows.getViewWebContents(id);
      if (!wc || wc.isDestroyed()) {
        notify('问问 AI', '无法打开窗口，请重试');
        return;
      }
      // 3) 等待页面就绪 → 显示窗口 → 确保快速模式
      const ready = await injector.waitForAppReady(wc);
      windows.revealWindow(id);
      if (!ready) {
        notify('问问 AI', '对话页面加载超时，请确认已登录 DeepSeek 后重试');
        return;
      }
      const cur = await injector.getCurrentModelMode(wc);
      if (cur !== 'simple') {
        const canSwitch = await injector.canSwitchModel(wc);
        if (canSwitch) {
          await injector.switchModelMode(wc, 'simple').catch(() => {});
        } else {
          await injector.clickNewConversationButton(wc).catch(() => {});
          await injector.waitForAppReady(wc);
          await injector.switchModelMode(wc, 'simple').catch(() => {});
        }
      }
      // 4) 上传 .md 说明书附件并点击发送
      const attached = await injector.uploadImage(wc, manualPath);
      await injector.waitForUploadSettle(wc);
      if (!attached) {
        notify('问问 AI', '说明书文件上传失败，请重试');
        return;
      }
      const sent = await injector.clickSend(wc);
      if (!sent) notify('问问 AI', '发送失败，请确认窗口已登录 DeepSeek');
    } catch (err) {
      console.error('[handlers] manual:askAi 失败:', err);
      notify('问问 AI', '操作失败，请重试');
    }
  });

  // ---- 更新提醒弹框 ----
  ipcMain.on(IPC.UPDATE_PROMPT_ACTION, (_e, { action }: { action: 'later' | 'install' }) => {
    if (action === 'later') {
      // 暂不更新：记录该版本，等待下一个版本再提醒
      const v = updatePrompt.getLatestVersion();
      if (v) config.set('ignoredUpdateVersion', v);
      updatePrompt.close();
    } else if (action === 'install') {
      // 立即更新：自动下载并唤起安装
      updatePrompt.startInstall();
    }
  });

  // 初始向已存在的窗口下发主题变量（新窗口在创建时由主进程再次 applyTheme 推送）。
  broadcastTheme();
}
