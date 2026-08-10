/**
 * 窗口注册表 + 主/副窗口创建、复制、置顶、显隐切换。
 * 维护 Map<id, WindowEntry>，提供 getActiveWebContents 供注入使用。
 */
import { BrowserWindow, WebContents, WebContentsView, screen, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ConfigStore } from '../config/ConfigStore';
import type { DefaultModelMode, ScreenshotRect, SubWindowRole, WindowType } from '../../shared/types';
import { WEBVIEW_PRELOAD, DEEPSEEK_URL } from '../constants';
import { createMainWindow, layoutView, createChatView } from './mainWindow';
import { createSubWindow } from './subWindow';
import { createBWindow as createBWindowFactory } from './bWindow';
import { IPC } from '../ipc/channels';
import { applyThinkCollapse } from '../inject/thinkCollapse';
import type { Injector } from '../inject/Injector';
import type { ScreenShareManager } from '../screenShare/ScreenShareManager';
import { installLinkOpenHandler } from './browserWindow';
import { logf } from '../logger';

/** 调试日志开关：项目根目录存在 .debug-autolog 时，终端才打印注入脚本的诊断 dump
 * （[Injector-DUMP] / [ThinkCollapse] / [Injector] 等）。默认静默，避免刷屏
 * （用户偏好：日志自读不给用户看）。 */
const DEBUG_AUTOLOG = (() => {
  try {
    return (
      fs.existsSync(path.join(app.getAppPath(), '.debug-autolog')) ||
      fs.existsSync(path.join(process.cwd(), '.debug-autolog'))
    );
  } catch {
    return false;
  }
})();

interface WindowEntry {
  id: string;
  type: WindowType;
  win: BrowserWindow;
  view: WebContentsView | null;
  role?: SubWindowRole;
  /** B 类临时窗口：关闭即销毁（不隐藏、不进托盘）。 */
  transient?: boolean;
  /** 标记该窗口不应自动应用默认模型（如「截图发送到新对话」窗口，用户要求只附图不切模型）。 */
  skipDefaultModel?: boolean;
}

export class WindowManager {
  private readonly entries: Map<string, WindowEntry> = new Map();
  private activeId: string | null = null;
  private counter = 0;
  private currentSubId: string | null = null;
  private currentBId: string | null = null;
  /** 上一个「截图发送到新对话」创建的副窗口 id（用于复用/关闭，避免堆积与竞态）。 */
  private lastSendNewId: string | null = null;
  /** 截图期间被隐藏的窗口及其原可见性，用于恢复。 */
  private screenshotHidden: { id: string; visible: boolean }[] = [];
  /** B 窗口创建前主窗口是否可见：B 窗口关闭后按此恢复主窗口（截图呼出 B 窗口会最小化/隐藏主窗口）。 */
  private mainVisibleBeforeB = false;
  /** 对话当前是否在副窗口（true=在副窗口，false=在主窗口）。驱动「主副切换」的隐藏方向。 */
  private conversationInSub = false;
  /** 正在执行模型切换的 webContents id 集合：防止同一会话并发多次点击 radio 互相打断（问题 1 根因）。 */
  private switchingWc = new Set<number>();
  /** 各 webContents 上次应用默认模型的时间戳：用于去抖，避免一次「新建对话」被重复触发。 */
  private lastDefaultModelAt = new Map<number, number>();
  /** 各 webContents 上次记录的 chat URL：用于检测「从历史会话切回新建对话」的路由方向变化（Bug1 修复）。 */
  private lastUrlByWc = new Map<number, string>();
  /** 各 webContents 上次同步「深度思考/智能搜索」开关的时间戳：去抖，避免同一次会话变化重复执行。 */
  private lastToggleSyncAt = new Map<number, number>();
  private onWebViewReady: ((wc: WebContents, type: WindowType) => void) | null = null;
  private injector: Injector | null = null;
  private screenShare: ScreenShareManager | null = null;
  /** 正在退出标志：置 true 后所有窗口的 close 拦截放行，使 app.quit() 能真正关闭窗口。 */
  private quitting = false;
  /** 已接线 webContents 集合：防止 attachWebViewReady 被重复调用时叠加事件监听器（内存泄漏）。 */
  private wiredWebContents = new WeakSet<WebContents>();

  constructor(private readonly config: ConfigStore) {}

  /** 注入器 setter（用于新建对话窗口后自动切换默认模型）。 */
  public setInjector(injector: Injector): void {
    this.injector = injector;
  }

  /** 共享屏幕管理器 setter（用于主副窗口切换时重新绑定拦截器）。 */
  public setScreenShare(screenShare: ScreenShareManager): void {
    this.screenShare = screenShare;
  }

  /** 标记应用正在退出（托盘退出前调用），放行窗口 close 拦截。 */
  public setQuitting(v: boolean): void {
    this.quitting = v;
  }

  /** 设置网页对话视图就绪回调（用于在 chat 视图注入剪刀按钮等）。 */
  public setWebViewReadyHook(fn: (wc: WebContents, type: WindowType) => void): void {
    this.onWebViewReady = fn;
  }

  /** 创建主窗口并登记。 */
  public createMainWindow(): string {
    const { win, view } = createMainWindow(
      this.config,
      { isQuitting: () => this.quitting },
      () => this.entries.get('main')?.view ?? null
    );
    const id = 'main';
    this.entries.set(id, { id, type: 'main', win, view, role: 'main' });
    this.trackActive(win, id);
    this.trackClosed(win, id);
    this.bindCloseToTray(win, id);
    this.attachWebViewReady(view, 'main');
    return id;
  }

  /** 创建副窗口（sub/vision/translate/explain/extract）。
   * @param showOnReady 为 false 时由调用方在页面就绪后再 revealWindow（避免白屏）。
   * @param skipDefaultModel 标记该窗口不自动应用默认模型（如截图 sendNew 窗口，用户要求只附图不切模型）。
   *   在注入「新建对话」watcher 之前即置位，attachWebViewReady 据此跳过无用注入。 */
  public createSubWindow(type: WindowType, showOnReady = true, skipDefaultModel = false): string {
    const id = `${type}-${++this.counter}`;
    const { win, view } = createSubWindow(
      type,
      this.config,
      { isQuitting: () => this.quitting },
      () => this.entries.get(id)?.view ?? null,
      showOnReady
    );
    this.entries.set(id, { id, type, win, view, role: 'sub', skipDefaultModel });
    this.trackActive(win, id);
    this.trackClosed(win, id);
    this.bindCloseToTray(win, id);
    this.attachWebViewReady(view, type, true, skipDefaultModel);
    return id;
  }

  /** 在 chat 视图加载完成 / 导航后触发就绪回调（用于注入剪刀按钮）。
   * @param type 窗口类型，用于在新建对话时自动应用默认模型模式。
   * @param applyDefaultModel 是否在加载完成 / 导航时应用默认模型模式（B 窗口传 false，由截图流程强制 vision）。
   * @param skipDefaultModel 是否跳过「新建对话」watcher 注入（如截图 sendNew 窗口，其默认模型由 skip 标志在 applyDefaultModelMode 兜底，此处直接不注入更干净）。 */
  private attachWebViewReady(
    view: WebContentsView | null,
    type: WindowType = 'sub',
    applyDefaultModel = true,
    skipDefaultModel = false
  ): void {
    if (!view) return;
    // 幂等守卫：同一 webContents 只接线一次，避免「主副切换 / 迁移重接 / 反复创建副窗口」
    // 反复调用时叠加 did-finish-load / console-message 等监听器，触发
    // MaxListenersExceededWarning（潜在的 EventEmitter 内存泄漏）。
    if (view.webContents && this.wiredWebContents.has(view.webContents)) return;
    if (view.webContents) this.wiredWebContents.add(view.webContents);
    const fire = () => this.onWebViewReady?.(view.webContents, type);
    const applyDefaultMode = (): Promise<void> => this.applyDefaultModelMode(view.webContents);
    /**
     * URL 方向检测（Bug1 修复）：DeepSeek 是 SPA，点「新建对话」多走 pushState（did-navigate-in-page），
     * 而「点进历史会话」会带上会话 id（/a/chat/<uuid>）。当 URL 从历史会话（带 id）变回根路由 /a/chat（无 id）
     * 时，判定为「进入新建对话」，触发 applyDefaultMode 把模型切回默认（否则默认模型不会在 SPA 路由切换时应用）。
     * 仅在「真正方向变化（历史→新建）」时触发，避免每次路由事件都触发；切换本身由 applyDefaultModelMode
     * 的去抖 / 串行锁兜底，不会重复点击 radio。
     */
    const detectConversationChange = (): void => {
      try {
        const url = view.webContents.getURL();
        const wcId = view.webContents.id;
        const prev = this.lastUrlByWc.get(wcId) ?? '';
        // Bug1 修复：会话 id 未必是严格 uuid（可能含其它字符 / 无连字符），
        // 故放宽为「/a/chat/ 之后还有任意非空片段即视为历史会话」，避免漏判。
        const prevHasId = /\/a\/chat\/.+/.test(prev);
        // 关键修正：DeepSeek 点「新建对话」后 URL 实际回到根域名（如 https://chat.deepseek.com/），
        // 并不带 /a/chat 后缀，故「新建对话」应判定为「当前 URL 不是历史会话」而非「以 /a/chat 结尾」。
        // 用 curHasId = 是否带会话 id 来定义：从历史会话(prevHasId)回到无 id 页面(curHasId=false)即触发。
        const curNoHash = url.split('#')[0];
        const curHasId = /\/a\/chat\/.+/.test(curNoHash);
        // 会话 id 片段：用于检测「新建对话 / 切换历史会话 / 历史→新建」等任意会话变化
        const prevId = (prev.match(/\/a\/chat\/([^/?#]+)/) || [])[1] || null;
        const curId = (curNoHash.match(/\/a\/chat\/([^/?#]+)/) || [])[1] || null;
        const idChanged = prevId !== curId;
        logf(
          'convChange',
          `prev=${prev || '(空)'} cur=${url} prevHasId=${prevHasId} curHasId=${curHasId} idChanged=${idChanged}`
        );
        // 任何会话变化（新建 / 切换历史会话）都按设置重新同步「深度思考 / 智能搜索」开关，
        // 覆盖网页记住的手动开关状态（B 类窗口 applyDefaultModel=false 不参与）。
        if (idChanged && applyDefaultModel) {
          this.syncChatToggles(view.webContents).catch(() => {});
        }
        if (prevHasId && !curHasId) {
          logf('convChange', '检测到「历史会话 → 新建对话」路由变化，应用默认模型模式');
          if (applyDefaultModel) applyDefaultMode().catch(() => {});
        }
        this.lastUrlByWc.set(wcId, url);
      } catch {
        /* 读取 URL 失败则忽略，下一事件再试 */
      }
    };
    view.webContents.on('did-finish-load', () => {
      fire();
      // 全局字号：对网页视图应用缩放（同步网页字体大小）
      this.applyFontZoom(view.webContents, this.config.get('fontSize') || 0);
      // 视图就绪后按当前设置应用折叠思考过程（I-新增：默认折叠模型思考）
      applyThinkCollapse(view.webContents, this.config.get('collapseThinking'));
      // 新建对话窗口自动应用默认模型模式（B类窗口跳过）
      if (applyDefaultModel) applyDefaultMode().catch(() => {});
      injectAnswerWatch();
      detectConversationChange();
    });
    view.webContents.on('did-navigate-in-page', () => {
      fire();
      applyThinkCollapse(view.webContents, this.config.get('collapseThinking'));
      // SPA 路由变化（含「历史会话 → 新建对话」）需据 URL 方向检测以应用默认模型
      detectConversationChange();
    });
    view.webContents.on('did-navigate', () => {
      fire();
      this.applyFontZoom(view.webContents, this.config.get('fontSize') || 0);
      applyThinkCollapse(view.webContents, this.config.get('collapseThinking'));
      if (applyDefaultModel) applyDefaultMode().catch(() => {});
      detectConversationChange();
      // 完整导航会重建 document，页内点击监听可能丢失，重新注入一次（flag 防重复）
      injectWatcher();
      injectAnswerWatch();
    });
    // 注入「新建对话」监听（Bug2 修复）：点击新建对话后由页面经 IPC 通知主进程自动切换默认模型。
    // 仅对带模型选择器的对话窗口（main/sub/vision）注入；translate/explain/extract/B 窗口、
    // 以及 skipDefaultModel 窗口（如截图 sendNew，用户要求只附图不切模型）跳过，避免无用注入。
    // 抽成 injectWatcher() 以便在「新建对话」触发完整导航（did-navigate）后重新注入——
    // 完整导航会重建 document、使页内点击监听丢失，必须补注入一次；页内 listener 自身有 flag 防重复绑定。
    const injectWatcher = (): void => {
      if (
        this.injector &&
        applyDefaultModel &&
        !skipDefaultModel &&
        type !== 'translate' &&
        type !== 'explain' &&
        type !== 'extract'
      ) {
        this.injector.injectNewConversationWatcher(view.webContents)
          .then((ok) => logf('inject', `注入新建对话监听 wcId=${view.webContents.id} ok=${ok} type=${type}`))
          .catch(() => logf('inject', `注入新建对话监听失败 wcId=${view.webContents.id}`));
      }
    };
    // 注入「回答生成状态」监听（回答完成提醒功能）：did-finish-load / did-navigate 页面重建后均需重注入
    const injectAnswerWatch = (): void => {
      if (!this.injector) return;
      this.injector
        .injectAnswerWatcher(view.webContents)
        .then((ok) => logf('inject', `注入回答状态监听 wcId=${view.webContents.id} ok=${ok} type=${type}`))
        .catch(() => logf('inject', `注入回答状态监听失败 wcId=${view.webContents.id}`));
    };
    injectWatcher();
    injectAnswerWatch();
    this.attachWebConsole(view);
  }

  /**
   * 在指定对话 webContents 上应用「默认模型模式」（用于页面加载完成 / 新建对话后自动切换）。
   *   - simple：页面默认，无需切换；
   *   - expert / vision：经 Injector 点击对应 radio 切换；
   *   - 翻译 / 解释 / 提取 / B 类临时窗口 / 截图 sendNew 窗口：无模型选择器或用户要求不切，跳过；
   * 若未配置注入器 / wc 已销毁 / 默认模式为 simple，则直接返回。
   *
   * 串行 + 去抖保护（问题 1 根因修复）：
   *   旧实现下，一次「新建对话」会经「按钮点击」与「hashchange」被上报两次，且切到旧会话再新建时
   *   也易并发触发；多个 switchModelMode 同时点击 radio 会互相打断、把模型选择器搞乱（留下半开下拉 /
   *   找不到按钮）。现保证同一 webContents 在 1.2s 内只切换一次，且切换进行中不再接受新的并发切换。
   */
  public async applyDefaultModelMode(wc: WebContents): Promise<void> {
    if (!this.injector || !wc || wc.isDestroyed()) return;
    const id = this.findIdByWebContents(wc);
    const entryType = id ? this.entries.get(id)?.type : undefined;
    if (id) {
      const entry = this.entries.get(id);
      if (
        entry &&
        (entry.type === 'translate' ||
          entry.type === 'explain' ||
          entry.type === 'extract' ||
          entry.transient ||
          entry.skipDefaultModel)
      ) {
        logf('applyDefault', `跳过：id=${id} type=${entry.type} transient=${!!entry.transient} skip=${!!entry.skipDefaultModel}`);
        return;
      }
    }
    const mode = this.config.get('defaultModelMode') as DefaultModelMode;
    if (mode === 'simple') {
      // 简单模式是页面默认，无需切换模型；但「深度思考 / 智能搜索」仍按设置同步
      logf('applyDefault', `跳过模型切换（simple），同步深度思考/智能搜索 id=${id} type=${entryType}`);
      this.syncChatToggles(wc).catch(() => {});
      return;
    }

    const wcId = wc.id;
    const now = Date.now();
    const last = this.lastDefaultModelAt.get(wcId) ?? 0;
    if (now - last < 800) {
      logf('applyDefault', `去抖跳过：距上次 ${now - last}ms < 800ms, wcId=${wcId} mode=${mode}`);
      return; // 去抖：同一会话 0.8s 内只切换一次
    }
    if (this.switchingWc.has(wcId)) {
      logf('applyDefault', `串行跳过：正在切换中 wcId=${wcId} mode=${mode}`);
      return; // 串行：正在切换则跳过，避免并发点击 radio
    }

    logf('applyDefault', `开始切换：wcId=${wcId} id=${id} type=${entryType} targetMode=${mode} deepThink=${this.config.get('deepThinkEnabled') === true}`);
    this.switchingWc.add(wcId);
    try {
      const ok = await this.injector.switchModelMode(wc, mode).catch(() => false);
      logf('applyDefault', `switchModelMode(${mode}) 结果=${ok}`);
      // Bug3 修复：setDeepThink 已实现但此前从未被调用。切换默认模型后，按设置同步「深度思考」开关，
      // 使「默认深度思考」设置真正生效（新建对话 / 从托盘唤出主窗口后均会走到这里）。
      if (this.injector) {
        const dtOk = await this.injector.setDeepThink(wc, this.config.get('deepThinkEnabled') === true).catch(() => false);
        logf('applyDefault', `setDeepThink(${this.config.get('deepThinkEnabled') === true}) 结果=${dtOk}`);
      }
      // 智能搜索：新建对话/窗口就绪时按设置同步（默认开启）。
      if (this.injector) {
        await this.injector.setSmartSearch(wc, this.config.get('smartSearchEnabled') === true).catch(() => {});
      }
    } finally {
      this.switchingWc.delete(wcId);
      // 切换「完成」后才记录时间戳：避免把「紧邻的两次真实新建对话」误去抖掉
      this.lastDefaultModelAt.set(wcId, Date.now());
    }
  }

  /**
   * 按设置同步对话页的「深度思考 / 智能搜索」开关（true=开启，false=关闭）。
   * 每次会话切换 / 新建对话时调用，强制覆盖网页记住的手动开关状态，
   * 使设置面板的默认值真正生效。自带 400ms 去抖，避免同一次事件流重复执行。
   * B 类临时窗口 / 截图 sendNew 窗口不参与（其开关由各自流程控制）。
   */
  public async syncChatToggles(wc: WebContents): Promise<void> {
    if (!this.injector || !wc || wc.isDestroyed()) return;
    const id = this.findIdByWebContents(wc);
    const entry = id ? this.entries.get(id) : undefined;
    if (entry && (entry.transient || entry.skipDefaultModel)) return;

    const wcId = wc.id;
    const now = Date.now();
    const last = this.lastToggleSyncAt.get(wcId) ?? 0;
    if (now - last < 400) {
      logf('syncToggle', `去抖跳过 wcId=${wcId} 距上次 ${now - last}ms`);
      return;
    }
    this.lastToggleSyncAt.set(wcId, now);
    const deepThink = this.config.get('deepThinkEnabled') === true;
    const smartSearch = this.config.get('smartSearchEnabled') === true;
    await this.injector.setDeepThink(wc, deepThink).catch(() => {});
    await this.injector.setSmartSearch(wc, smartSearch).catch(() => {});
    logf('syncToggle', `同步开关 wcId=${wcId} deepThink=${deepThink} smartSearch=${smartSearch}`);
  }

  /** 返回所有对话 webContents（用于配置变更时批量应用副作用，如折叠思考）。 */
  public getAllChatWebContents(): WebContents[] {
    const list: WebContents[] = [];
    for (const entry of this.entries.values()) {
      // 排除 B 类临时窗口（transient），其对话设置不应受用户配置影响
      if (entry.view && !entry.view.webContents.isDestroyed() && !entry.transient) {
        list.push(entry.view.webContents);
      }
    }
    return list;
  }

  /** 将网页视图的控制台日志转发到主进程终端，便于注入脚本诊断（如 [Injector] 日志）。 */
  private attachWebConsole(view: WebContentsView | null): void {
    if (!view) return;
    view.webContents.on('console-message', (_e, level, message) => {
      // 注入脚本的诊断 dump（[Injector-DUMP]/[ThinkCollapse]/[Injector]/[Page-NewConv]/[Tray-] 等）
      // 默认静默，仅在项目根存在 .debug-autolog 调试标记时才打印到终端，避免刷屏
      // （用户偏好：日志自读不给用户看）。仍照常落盘供主理人自检。
      const isInjectorDiag = /^\[(Injector-DUMP|ThinkCollapse|Injector|Page-NewConv|Tray-)/.test(message);
      if (isInjectorDiag && !DEBUG_AUTOLOG) {
        logf('web:dbg', message);
        return;
      }
      const tag = level === 2 ? 'ERR' : level === 1 ? 'WARN' : 'LOG';
      console.log(`[web:${tag}] ${message}`);
      // 网页内日志（含注入脚本的 [PAGE-NEWCONV*] 诊断）一并落盘，便于主理人自检
      logf(`web:${tag}`, message);
    });

    // 隐藏 webContents 自带的所有滚动条：DeepSeek 整个 SPA 页面渲染为 12000+ 像素高，
    // 会让外壳 window 出现超长滚动条。直接隐藏 webkit 滚动条即可消除视觉干扰，不修改
    // DeepSeek 内部布局（之前在 preload 注入 html/body overflow:hidden 的方案会破坏
    // fixed/absolute 定位元素，导致主内容区消失、消息区卡死）。
    // 根因 CSS 修复 + 滚动条隐藏。
    //
    // 根因：DeepSeek 主页加载 1.5s 后，sidebar 容器（class c3ecdb44 / dc04ec1d / b8812f16）
    // 会被内部历史列表（多个 _3098d02 分组）撑到 17000+ 像素高，进而把整页（html 元素）撑到 17452
    // 像素。但主内容（_7780f2e）使用 absolute 定位在 y=204，结果被推到 y=8565。视口（0-731）只能
    // 看到中间空 + 底部 fixed 输入框，看起来就像"渲染到下面去了"。
    //
    // 修复：仅把侧栏内部滚动区（.ds-scroll-area）上限锁在视口高度内，由其自己滚动。
    // 注意：不能像旧方案那样把整个 sidebar 容器焊死为 height:100vh + overflow:hidden（!important），
    // 那会破坏 DeepSeek 原生侧栏开关——宽屏下原生开关随容器一起失效/失踪（官网正常、我们这没有）。
    // 只限滚动区即可让容器高度受内容约束、页面保持有界，且不碰原生按钮。
    const HIDE_SCROLLBAR_CSS = `
      /* Hide native scrollbars while keeping the chat viewport bounded. */
      ::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      ::-webkit-scrollbar-thumb { background: transparent !important; }
      ::-webkit-scrollbar-track { background: transparent !important; }

      /* The history sidebar can grow to thousands of pixels and stretch the root flex row.
         Cap only the inner scroll area so the page stays bounded without locking the sidebar
         container (which breaks DeepSeek's native sidebar toggle at desktop widths). */
      .dc04ec1d .ds-scroll-area,
      .b8812f16.a2f3d50e .ds-scroll-area {
        max-height: calc(100vh - 134px) !important;
        overflow-y: auto !important;
      }

      /* 屏蔽 DeepSeek 页面自带的蓝色键盘聚焦/引导圆环：
         页面获得焦点时会在左上角搜索按钮等元素上短暂套一个蓝色圆环（ds-button__background::after
         的 box-shadow），启动时尤其明显（约 2s 出现、随后自动消失），用户要求去掉。
         本应用以鼠标操作为主，隐藏聚焦环不影响使用。 */
      .ds-focus-ring,
      .ds-button__background::after,
      .ds-button__icon::after {
        box-shadow: none !important;
      }
      .ds-focus-ring {
        opacity: 0 !important;
      }
    `;
    // 每次页面加载完成后重新注入（DeepSeek 是 SPA，路由切换可能丢失样式）
    const injectHideScrollbar = (): void => {
      if (view.webContents.isDestroyed()) return;
      view.webContents.insertCSS(HIDE_SCROLLBAR_CSS).catch(() => {
        /* 忽略注入失败 */
      });
    };
    injectHideScrollbar();
    view.webContents.on('did-finish-load', injectHideScrollbar);

    // 完整 DOM 探测脚本：把页面布局关键信息打到主进程日志，便于诊断"主内容区不显示"问题。
    // 列出 viewport、所有 left=0..1300 范围内、width>=100 的 div，含 position / fixed 标志。
    // 同时列出所有 overflow:auto/scroll 容器（DeepSeek 的真正滚动容器可能嵌套在这里）。
    const DOM_PROBE = `
      (() => {
        try {
          const out = {
            vw: window.innerWidth, vh: window.innerHeight,
            scrollY: window.scrollY,
            bodyHeight: document.body ? document.body.scrollHeight : 0,
            htmlHeight: document.documentElement ? document.documentElement.scrollHeight : 0,
            candidates: [],
            scrollContainers: []
          };
          const all = document.querySelectorAll('div, aside, main, section, header, footer');
          for (const el of all) {
            try {
              const r = el.getBoundingClientRect();
              if (r.left < 0 || r.left > 1300) continue;
              if (r.width < 100 || r.width > 2000) continue;
              if (r.height < 50) continue;
              const cs = window.getComputedStyle(el);
              out.candidates.push({
                tag: el.tagName,
                cls: (el.className || '').slice(0, 32),
                id: el.id || '',
                pos: cs.position,
                left: Math.round(r.left), top: Math.round(r.top),
                w: Math.round(r.width), h: Math.round(r.height),
                z: cs.zIndex,
                vis: cs.visibility,
                disp: cs.display
              });
            } catch (e) { /* 单个元素出错不影响整体 */ }
          }
          // 找所有 overflow:auto/scroll 的容器（真正滚动的元素）
          for (const el of all) {
            try {
              const cs = window.getComputedStyle(el);
              const ovX = cs.overflowX;
              const ovY = cs.overflowY;
              if (!/(auto|scroll|overlay)/.test(ovY) && !/(auto|scroll|overlay)/.test(ovX)) continue;
              if (el.scrollHeight <= el.clientHeight + 10 && el.scrollWidth <= el.clientWidth + 10) continue;
              out.scrollContainers.push({
                tag: el.tagName,
                cls: (el.className || '').slice(0, 40),
                ovX, ovY,
                scrollTop: el.scrollTop,
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
                scrollLeft: el.scrollLeft,
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                canScroll: el.scrollHeight > el.clientHeight + 5 ? 'vert' : (el.scrollWidth > el.clientWidth + 5 ? 'horz' : 'none')
              });
            } catch (e) { /* ignore */ }
          }
          out.bodyChildren = [];
          if (document.body) {
            for (const c of document.body.children) {
              try {
                const r = c.getBoundingClientRect();
                const cs = window.getComputedStyle(c);
                out.bodyChildren.push({
                  tag: c.tagName,
                  cls: (c.className || '').slice(0, 32),
                  pos: cs.position,
                  left: Math.round(r.left), top: Math.round(r.top),
                  w: Math.round(r.width), h: Math.round(r.height)
                });
              } catch (e) { /* ignore */ }
            }
          }
          return out;
        } catch (e) {
          return { error: String(e) };
        }
      })()
    `;
    const probeAndLog = (): void => {
      // 多重守卫：view / view.webContents / isDestroyed() 任何一环失败都安全退出
      try {
        if (!view || view.webContents.isDestroyed()) return;
        const wc = view.webContents;
        wc.executeJavaScript(DOM_PROBE, true)
          .then((res) => {
            try {
              const r = res as { vw?: number; vh?: number; scrollY?: number; bodyHeight?: number; htmlHeight?: number; candidates?: Array<Record<string, unknown>>; bodyChildren?: Array<Record<string, unknown>>; scrollContainers?: Array<Record<string, unknown>>; error?: string };
              if (r.error) {
                logf('dom-probe', 'error', r.error);
                return;
              }
              logf('dom-probe', 'viewport/scroll', { vw: r.vw, vh: r.vh, scrollY: r.scrollY, bodyH: r.bodyHeight, htmlH: r.htmlHeight });
              if (r.bodyChildren) logf('dom-probe', 'bodyChildren', r.bodyChildren);
              if (r.scrollContainers && r.scrollContainers.length) {
                logf('dom-probe', 'scrollContainers', r.scrollContainers);
              } else {
                logf('dom-probe', 'scrollContainers', 'NONE');
              }
              const cands = r.candidates || [];
              const chunks: Array<Record<string, unknown>[]> = [];
              for (let i = 0; i < cands.length; i += 8) chunks.push(cands.slice(i, i + 8));
              chunks.forEach((c, idx) => logf('dom-probe', `candidates[${idx}]`, c));
            } catch (e) {
              /* 忽略 */
            }
          })
          .catch(() => {
            /* 忽略 */
          });
      } catch (e) {
        /* 守卫：view 或 view.webContents 不可用时安全吞掉 */
      }
    };
    // 延迟 1.5s 探测（等 DeepSeek 渲染完成）；之后每次 did-finish-load 也探测
    setTimeout(probeAndLog, 1500);
    view.webContents.on('did-finish-load', () => setTimeout(probeAndLog, 1500));

    // 强制把页面滚到顶部：DeepSeek 整个 body 高度 12000+，浏览器记忆的滚动位置可能在中间，
    // 导致用户看到的是"中间的空内容 + 底部的输入框"而不是页面顶部。每次 did-finish-load
    // 把页面滚到 0，且禁用 history 的滚动记忆。同时多重延迟重试，覆盖 SPA 路由切换后
    // scrollY 又被恢复的情况。
    const SCROLL_TO_TOP_JS = `
      (() => {
        try {
          window.scrollTo(0, 0);
          if (document.documentElement) document.documentElement.scrollTop = 0;
          if (document.body) document.body.scrollTop = 0;
          if (history && history.scrollRestoration) history.scrollRestoration = 'manual';
          return window.scrollY;
        } catch (e) { return -1; }
      })()
    `;
    const scrollToTop = (): void => {
      try {
        if (!view || view.webContents.isDestroyed()) return;
        const wc = view.webContents;
        // 立即 + 200ms + 1s + 3s 四次重试，覆盖 React 重渲染可能把 scrollY 恢复的情况
        const tryOnce = (): void => {
          wc.executeJavaScript(SCROLL_TO_TOP_JS, true).catch(() => { /* 忽略 */ });
        };
        tryOnce();
        setTimeout(tryOnce, 200);
        setTimeout(tryOnce, 1000);
        setTimeout(tryOnce, 3000);
      } catch (e) {
        /* 守卫 */
      }
    };
    scrollToTop();
    view.webContents.on('did-finish-load', () => {
      scrollToTop();
      // 路由切换后再次滚回顶部
      setTimeout(scrollToTop, 1000);
    });
  }

  /**
   * 创建 B 类临时窗口（I-07）：比副窗口更小的 9:16 窗口，出现在选区旁，
   * 内嵌 chat.deepseek.com（共享 session），无主副切换，用完即关，不进托盘。
   * @returns B 窗口 id；若创建失败返回 null。
   */
  public createBWindow(sourceRect: ScreenshotRect): string | null {
    // 用完即关：先关闭已有 B 窗口。
    if (this.currentBId) {
      const prev = this.entries.get(this.currentBId);
      if (prev && !prev.win.isDestroyed()) prev.win.close();
      this.entries.delete(this.currentBId);
      this.currentBId = null;
    }

    const { win, view } = createBWindowFactory(sourceRect, this.config);
    const id = `b-${++this.counter}`;
    this.entries.set(id, { id, type: 'sub', win, view, role: 'sub', transient: true });
    this.trackActive(win, id);
    this.trackClosed(win, id);
    // 可选：关闭 B 窗口时自动删除对话记录
    if (this.config.get('cleanBWindowHistory') && this.injector) {
      const wc = view.webContents;
      win.on('close', (e) => {
        if (wc.isDestroyed()) return;
        e.preventDefault();
        win.hide();
        this.injector!.deleteConversation(wc).catch(() => {}).finally(() => {
          if (!win.isDestroyed()) win.destroy();
        });
      });
    }
    this.attachWebViewReady(view, 'sub', false);
    // B 类窗口：页面渲染后需要显式关闭联网搜索和深度思考（网页默认开启）
    // 使用 did-finish-load 配合 retry，因为 React 渲染可能延迟
    const disableBWindowToggles = async (): Promise<void> => {
      if (!this.injector) return;
      for (let i = 0; i < 30; i++) {
        if (view.webContents.isDestroyed()) return;
        const smartOk = await this.injector.setSmartSearch(view.webContents, false).catch(() => false);
        const deepOk = await this.injector.setDeepThink(view.webContents, false).catch(() => false);
        if (smartOk && deepOk) return;
        await new Promise(r => setTimeout(r, 500));
      }
    };
    view.webContents.on('did-finish-load', () => { disableBWindowToggles(); });
    this.currentBId = id;
    // 截图呼出 B 窗口时最小化主窗口，避免主窗口遮挡 B 窗口。
    // 放在 createBWindow 内而非 handler 中，确保所有途径创建 B 窗口都触发。
    this.minimizeMainWindow();
    // B 窗口关闭后恢复主窗口（截图时主窗口被最小化/隐藏，关闭后应还原，避免主窗口一直处于隐藏/底层）。
    win.on('closed', () => {
      if (!this.mainVisibleBeforeB) return;
      const main = this.entries.get('main');
      if (main && main.win && !main.win.isDestroyed() && !main.win.isVisible()) {
        this.showMainWindowRaised();
      }
    });
    return id;
  }

  /** 呼出 / 聚焦常驻副窗口（Alt+Q 或标题栏按钮）。无则创建，有则聚焦。 */
  public summonSubWindow(): string {
    const keepOnTop = this.config.get('alwaysOnTop') === true;
    if (this.currentSubId) {
      const e = this.entries.get(this.currentSubId);
      if (e && !e.win.isDestroyed()) {
        e.win.setAlwaysOnTop(keepOnTop, keepOnTop ? 'screen-saver' : 'normal');
        e.win.show();
        try { e.win.moveTop(); } catch { /* 个别平台不支持，忽略 */ }
        e.win.focus();
        return this.currentSubId;
      }
    }
    const id = this.createSubWindow('sub');
    this.currentSubId = id;
    // 副窗口默认摆在屏幕右侧（用户要求）：优先贴主窗口右侧，空间不足则贴屏幕右边缘。
    const main = this.entries.get('main');
    const sub = this.entries.get(id);
    if (main && sub && !main.win.isDestroyed() && !sub.win.isDestroyed()) {
      this.placeSubWindowRight(sub.win, main.win);
      sub.win.setAlwaysOnTop(keepOnTop, keepOnTop ? 'screen-saver' : 'normal');
    }
    return id;
  }

  /**
   * 副窗口快捷键 toggle（Bug5 修复）：再按一次应隐藏，循环。
   *   - 已存在且可见 → 隐藏；
   *   - 已存在但不可见 → 重新定位到屏幕右侧再显示并聚焦；
   *   - 不存在 → 新建并靠右显示。
   * 用于替代原 summonSubWindow（仅显示/新建、无隐藏）。
   */
  public toggleSubWindow(): string | null {
    const keepOnTop = this.config.get('alwaysOnTop') === true;
    if (this.currentSubId) {
      const e = this.entries.get(this.currentSubId);
      if (e && !e.win.isDestroyed()) {
        if (e.win.isVisible()) {
          e.win.hide();
          return this.currentSubId;
        }
        // 不可见：重新定位到右侧再显示（避免停留上次被移走的异常位置）
        this.placeSubWindowRight(e.win);
        e.win.setAlwaysOnTop(keepOnTop, keepOnTop ? 'screen-saver' : 'normal');
        e.win.show();
        try { e.win.moveTop(); } catch { /* 忽略 */ }
        e.win.focus();
        return this.currentSubId;
      }
    }
    // 未创建则新建并靠右
    const id = this.createSubWindow('sub');
    this.currentSubId = id;
    const sub = this.entries.get(id);
    if (sub && !sub.win.isDestroyed()) {
      this.placeSubWindowRight(sub.win);
      sub.win.setAlwaysOnTop(keepOnTop, keepOnTop ? 'screen-saver' : 'normal');
    }
    return id;
  }

  /**
   * 主副切换（I-08）：把当前对话在主窗口与指定副窗口之间迁移，
   * 并隐藏「迁出」的那个窗口（对话搬到哪、哪就显示，另一个隐藏）。
   * 不交换窗口身份/标题，main 始终是大窗、sub 始终是 9:16 小窗。
   *
   * 关键修复（Bug1）：旧实现把「同一个 WebContentsView」在多个窗口间反复 removeChildView/addChildView，
   * 多次切换后 Electron 渲染面丢失导致黑屏。现改为「原地重建目标窗口视图并载入相同会话 URL」，
   * 任何窗口的视图对象都不再跨窗口搬移，彻底规避 WebContentsView 生命周期问题；
   * 同时每个窗口始终持有自己的视图，不会产生幽灵视图或重复副窗口。
   *
   * @param subId 要交换的副窗口 id；缺省时回退为 currentSubId（快捷键等场景）。
   */
  public async swapMainSub(subId?: string): Promise<boolean> {
    // 主副切换总开关（enableRoleSwap）已移除，固定为始终启用。
    const main = this.entries.get('main');
    if (!main || !main.view || main.win.isDestroyed()) return false;

    // 发起者若是主窗口（或无法确定副窗口），则使用/创建常驻副窗口来承载对话
    let targetId = subId;
    if (!targetId || targetId === 'main' || !this.entries.get(targetId) || this.entries.get(targetId)!.win.isDestroyed()) {
      targetId = this.currentSubId || undefined;
    }
    if (!targetId || !this.entries.get(targetId) || this.entries.get(targetId)!.win.isDestroyed()) {
      this.summonSubWindow();
      targetId = this.currentSubId ?? undefined;
    }
    if (!targetId) return false;
    const sub = this.entries.get(targetId);
    if (!sub || !sub.view || sub.win.isDestroyed()) return false;
    // 锁定本次交换的副窗口（后续切换仍针对该窗口）
    this.currentSubId = targetId;

    // 以「重建目标窗口视图」的方式迁移对话（不移动同一个 WebContentsView 对象）
    try {
      const srcEntry = this.conversationInSub ? sub : main;
      const dstEntry = this.conversationInSub ? main : sub;

      // 迁移前，记住源窗口输入框的文字（迁移后页面重建会丢失）
      let draftText = '';
      if (this.injector && srcEntry.view && !srcEntry.view.webContents.isDestroyed()) {
        draftText = await this.injector.readInputText(srcEntry.view.webContents).catch(() => '');
      }

      this.migrateConversationToWindow(dstEntry, srcEntry);

      // 迁移后，源窗口的旧视图不再需要保留对话——重置为全新对话（DEEPSEEK_URL），
      // 避免切到副窗口后点击托盘唤出主窗口时主窗口仍显示旧对话（用户要求）。
      const srcView = srcEntry.view;
      if (srcView && !srcView.webContents.isDestroyed()) {
        srcView.webContents.loadURL(DEEPSEEK_URL).catch(() => {});
      }

      // 把源窗口的输入框文字同步到目标窗口
      if (draftText && this.injector && dstEntry.view && !dstEntry.view.webContents.isDestroyed()) {
        this.injector.setInputText(dstEntry.view.webContents, draftText).catch(() => {});
      }
    } catch (e) {
      console.error('[WindowManager] swapMainSub 对话迁移失败:', e);
      return false;
    }

    if (!this.conversationInSub) {
      // 对话搬到副窗口：隐藏主窗口，只留副窗口显示对话
      main.win.hide();
      sub.win.show();
      sub.win.focus();
      this.conversationInSub = true;
    } else {
      // 对话搬回主窗口：隐藏副窗口，显示主窗口并可靠置前（主窗口永不置顶，避免 Windows Z 序置底）
      sub.win.hide();
      this.showMainWindowRaised();
      this.conversationInSub = false;
    }
    
    // 主副窗口切换后，如果共享屏幕模式激活，重新绑定拦截器到新活跃窗口
    if (this.screenShare && this.screenShare.isActive()) {
      setTimeout(() => {
        this.screenShare?.rebindInterceptor();
      }, 500);
    }
    
    return true;
  }

  /**
   * 把 src 窗口当前对话「迁移」到 dst 窗口：在 dst 窗口原位销毁旧视图并重建一个全新
   * WebContentsView，载入 src 当前会话 URL（共享 session，登录态一致），再重新接线就绪钩子
   * 与默认模型。目标窗口若已显示同一会话（URL 一致）则跳过重建，避免无谓重载闪烁。
   * 这样任何窗口的视图对象都只存活于所属窗口内，解决反复搬移导致的黑屏（Bug1）。
   */
  private migrateConversationToWindow(dst: WindowEntry, src: WindowEntry): void {
    let url: string | null = null;
    try {
      if (src.view && !src.view.webContents.isDestroyed()) {
        url = src.view.webContents.getURL();
      }
    } catch {
      url = null;
    }

    // 目标窗口已显示同一会话（URL 一致）则无需重建，避免无谓重载闪烁。
    if (dst.view && !dst.view.webContents.isDestroyed()) {
      try {
        if (url && dst.view.webContents.getURL() === url) {
          return;
        }
      } catch {
        /* 读取失败则继续重建 */
      }
    }

    // 销毁目标窗口旧视图（避免视图叠加 / 幽灵视图），并在原位重建新视图。
    if (dst.view) {
      try {
        dst.win.contentView.removeChildView(dst.view);
      } catch {
        /* 视图可能已 detach，忽略 */
      }
      try {
        dst.view.webContents.close();
      } catch {
        /* 忽略 */
      }
      dst.view = null;
    }

    const view = new WebContentsView({
      webPreferences: {
        preload: WEBVIEW_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    dst.win.contentView.addChildView(view);
    const target = url && url.length > 0 && url !== DEEPSEEK_URL ? url : DEEPSEEK_URL;
    view.webContents
      .loadURL(target)
      .catch(() => {
        try {
          view.webContents.loadURL(DEEPSEEK_URL);
        } catch {
          /* 忽略 */
        }
      });
    layoutView(dst.win, view);
    // 重新接线：剪刀按钮 / 新建对话监听 / 默认模型（did-finish-load 时自动应用）
    this.attachWebViewReady(view, dst.type);
    // 链接打开方式（内置浏览器窗口 / 系统默认浏览器）
    installLinkOpenHandler(view.webContents);
    dst.view = view;
  }

  /** 返回当前截图动作目标的 webContents（优先 B 窗口视图，否则活动窗口）。 */
  public getScreenshotTarget(): WebContents | null {
    if (this.currentBId) {
      const e = this.entries.get(this.currentBId);
      if (e && !e.win.isDestroyed() && e.view) return e.view.webContents;
    }
    return this.getActiveWebContents();
  }

  /**
   * 最小化主窗口（截图呼出 B 窗口时调用，避免主窗口遮挡 B 窗口）。
   * 同时从 screenshotHidden 中移除主窗口，防止 restoreChatWindowsAfterScreenshot()
   * 在 overlay 关闭后异步恢复主窗口（见 ScreenshotManager 的 onOverlayClosed → restoreChatWindowsAfterScreenshot 注册）。
   * 先用 entries 找，兜底用 BrowserWindow.getAllWindows 扫一遍。
   * 某些平台 minimize() 不生效时 fallback 到 hide()，确保主窗口消失。
   */
  public minimizeMainWindow(): void {
    // 从截图恢复列表中移除主窗口，防止 overlay 关闭后 restoreChatWindowsAfterScreenshot 恢复它
    this.screenshotHidden = this.screenshotHidden.filter((rec) => rec.id !== 'main');

    const main = this.entries.get('main');
    if (main && !main.win.isDestroyed()) {
      // 仅当主窗口当前可见才记为「B 窗口关闭后需要恢复」（重复调用不覆盖标记）
      if (main.win.isVisible()) this.mainVisibleBeforeB = true;
      main.win.minimize();
      // minimize 后窗口若仍可见（某些窗口管理器/OS 不响应），fallback 到 hide
      if (main.win.isVisible()) {
        main.win.hide();
      }
      return;
    }
    // 兜底：遍历所有窗口，按尺寸判断主窗口（主窗口宽屏 800+，副窗口 ~400）
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      const [width] = w.getSize();
      if (width >= 800) {
        w.minimize();
        if (w.isVisible()) w.hide();
        return;
      }
    }
  }

  /**
   * 设置当前 B 窗口的翻译语言，显示语言栏，调整视图布局。
   * 由 handler 在截图翻译动作创建 B 窗口后调用。
   */
  public sendTranslateSetLang(lang: string): void {
    if (!this.currentBId) return;
    const e = this.entries.get(this.currentBId);
    if (!e || e.win.isDestroyed()) return;
    // 向 B 窗口外壳发送 TRANSLATE_SET_LANG → 显示语言下拉框 + 设置选中语言
    // 下拉框在标题栏内（36px），无需调整视图偏移
    e.win.webContents.send(IPC.TRANSLATE_SET_LANG, lang);
  }

  /** 按 id 取窗口内嵌对话视图的 webContents（用于「发送到新对话」取新建副窗口视图）。 */
  public getViewWebContents(id: string): WebContents | null {
    const e = this.entries.get(id);
    if (e && e.view && !e.view.webContents.isDestroyed()) return e.view.webContents;
    return null;
  }

  /**
   * 前置显示并聚焦指定窗口（用于「发送到新对话」把新建副窗口带到前台）。
   * 问题 3 修复（对齐参考项目 showAndFocusTargetWindow）：
   *   - 若被最小化则先 restore；
   *   - 以最高层级 'screen-saver' 置顶（macOS 上为最高 z-order；Windows 上等价于 alwaysOnTop，
   *     确保不被主窗口抢焦点压在底层）；
   *   - show() + focus() + moveTop() 组合，保证窗口必然显示且置于最前，
   *     不再「唤不出 / 卡最底层」。
   * 短暂延时后回落到配置要求的置顶层级（默认关闭则不再常驻置顶，避免永久遮挡其它应用），
   * 但首次 reveal 一定以最高层级夺到前台。
   */
  public revealWindow(id: string): void {
    const e = this.entries.get(id);
    if (e && !e.win.isDestroyed()) {
      if (e.win.isMinimized()) e.win.restore();
      // 立即以最高层级置顶，确保不被主窗口/其它窗口盖在底层
      e.win.setAlwaysOnTop(true, 'screen-saver');
      if (!e.win.isVisible()) e.win.show();
      try {
        e.win.moveTop();
      } catch {
        /* 个别平台不支持，忽略 */
      }
      e.win.focus();
      // 回落到配置要求的置顶层级（避免永久遮挡），但已先以最高层级夺到前台
      const keepOnTop = this.config.get('alwaysOnTop') === true;
      setTimeout(() => {
        if (e.win.isDestroyed()) return;
        e.win.setAlwaysOnTop(keepOnTop, keepOnTop ? 'screen-saver' : 'normal');
        // 非置顶时 setAlwaysOnTop(false) 会把窗口移到 Z 序最底，双重切换强制复位
        if (!keepOnTop) this.bringToFront(e.win);
      }, 1500);
    }
  }

  /**
   * 截图「发送到新对话」专用：关闭上一个 sendNew 创建的副窗口（避免堆积与竞态），
   * 新建一个副窗口并默认摆在屏幕右侧（用户要求），返回其 id。
   * 新窗口采用 showOnReady=false，由调用方等页面就绪后再 revealWindow，杜绝白屏；
   * 同时挂一个「视图加载完成即显示」的兜底，保证任何情况下副窗口都能被唤出（问题 3）。
   * 该窗口标 skipDefaultModel：用户要求「只上传原图，不切换模型、不自动点击发送」。
   */
  public createSendNewSubWindow(): string {
    if (this.lastSendNewId) {
      const prev = this.entries.get(this.lastSendNewId);
      if (prev && !prev.win.isDestroyed()) {
        try {
          // 用 destroy 而非 close：closeToTray 开启时 close 只会隐藏而非销毁，
          // 会导致隐藏窗口堆积（竞态/资源泄漏）。destroy 立即释放。
          prev.win.destroy();
        } catch {
          /* 忽略 */
        }
      }
      this.entries.delete(this.lastSendNewId);
      this.lastSendNewId = null;
    }
    const id = this.createSubWindow('sub', true, true);
    this.lastSendNewId = id;
    const e = this.entries.get(id);
    if (e && !e.win.isDestroyed()) {
      this.placeSubWindowRight(e.win);
    }
    return id;
  }

  /**
   * 创建「问问 AI」说明书专用 B 类临时窗口：完整复刻 B 类窗口逻辑
   * （用完即关、关闭时按 cleanBWindowHistory 设置自动删除该对话记录、ready-to-show 即显示），
   * 位置在屏幕右侧。
   */
  public createManualAskBWindow(): string | null {
    try {
      const workArea = screen.getPrimaryDisplay().workArea;
      // 合成屏幕右侧的选区，使 B 窗口出现在右边缘内侧
      const sourceRect: ScreenshotRect = {
        x: workArea.x + workArea.width - 40,
        y: workArea.y + Math.round(workArea.height / 2),
        width: 20,
        height: 20,
      };
      return this.createBWindow(sourceRect);
    } catch {
      return null;
    }
  }

  /**
   * 把副窗口摆到屏幕右侧（Bug6 修复：副窗口应默认出现在屏幕右边）。
   * 使用 safeSetBounds：先 unmaximize 再 setBounds，避免窗口处于最大化态时 setBounds 被忽略。
   * 位置恒为右边缘内侧（workArea.x + workArea.width - w - margin）；居中于垂直方向。
   */
  private placeSubWindowRight(win: BrowserWindow, _main?: BrowserWindow): void {
    try {
      const workArea = screen.getPrimaryDisplay().workArea;
      const [w, h] = win.getSize();
      const margin = Math.max(20, Math.round(workArea.width * 0.02));
      const x = workArea.x + workArea.width - w - margin;
      const y = Math.max(workArea.y, Math.round(workArea.y + (workArea.height - h) / 2));
      const bounds = { x: Math.round(x), y: Math.round(y), width: w, height: h };
      // safeSetBounds：先取消最大化，再定位，避免最大化态下 setBounds 不生效
      if (typeof win.unmaximize === 'function' && win.isMaximized()) {
        win.unmaximize();
      }
      win.setBounds(bounds);
    } catch {
      /* 忽略定位异常 */
    }
  }

  /** 取当前常驻副窗口 id（供标题栏判断按钮可用性）。 */
  public getCurrentSubId(): string | null {
    return this.currentSubId;
  }

  /** 获取主窗口（未创建或已销毁则 null）。设置面板内嵌等场景使用。 */
  public getMainWindow(): { win: BrowserWindow; view: WebContentsView | null } | null {
    const main = this.entries.get('main');
    if (!main || main.win.isDestroyed()) return null;
    return { win: main.win, view: main.view };
  }

  /** 复制指定窗口（同类型、偏移位置的新窗口）。 */
  public copyWindow(id: string): string | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.type === 'translate') {
      return this.createSubWindow('translate');
    }
    const newId = this.createSubWindow(entry.type);
    const newEntry = this.entries.get(newId);
    if (newEntry) {
      const [x, y] = entry.win.getPosition();
      newEntry.win.setPosition(x + 40, y + 40);
    }
    return newId;
  }

  /** 设置窗口置顶（仅副窗口和 B 类窗口，主窗口不参与——用户要求主窗口不要长时间置顶）。 */
  public setAlwaysOnTop(id: string, on: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.type === 'main') return; // 主窗口不参与置顶
    entry.win.setAlwaysOnTop(on, on ? 'screen-saver' : 'normal');
    if (on && entry.win.isVisible()) {
      try { entry.win.moveTop(); } catch { /* 个别平台不支持，忽略 */ }
      entry.win.focus();
    } else if (!on && entry.win.isVisible()) {
      // Windows：setAlwaysOnTop(false) 后窗口掉到 Z 序最底且 moveTop 无效，需强制复位
      this.bringToFront(entry.win);
    }
  }

  /**
   * Windows 可靠地把（非置顶）窗口恢复到普通窗口波段最前。
   * 背景：setAlwaysOnTop(false) 后 Windows 会把窗口扔到 Z 序最底，且 moveTop() 在此场景下无效
   * （electron#45024 / #48169）。改用「重新置顶 → 立即取消置顶」的双重切换强制 Windows
   * 重新计算 Z 序，使窗口落到普通窗口顶部，再 moveTop + focus 兜底。
   */
  private bringToFront(win: BrowserWindow): void {
    if (!win || win.isDestroyed()) return;
    try {
      win.setAlwaysOnTop(true);
      win.setAlwaysOnTop(false);
    } catch { /* 忽略 */ }
    if (win.isVisible()) {
      try { win.moveTop(); } catch { /* 个别平台不支持，忽略 */ }
      win.focus();
    }
  }

  /** 切换主窗口显示/隐藏。 */
  public toggleMainWindow(): void {
    const entry = this.entries.get('main');
    if (!entry || entry.win.isDestroyed()) {
      if (!entry) this.createMainWindow();
      return;
    }
    if (entry.win.isVisible()) {
      entry.win.hide();
    } else {
      this.showMainWindowRaised();
    }
  }

  /**
   * 显示主窗口并可靠置前（主窗口永不置顶）。
   * 与副窗口「置顶关闭」时的唤出方式完全一致：setAlwaysOnTop(false) → show()（重新断言 Z 序）
   * → moveTop + focus。不使用「临时置顶 + 500ms 回落」——那个延迟回落正是主窗口被 Windows
   * 压到 Z 序最底的根因；也绝不长时间置顶（用户要求）。
   */
  private showMainWindowRaised(): void {
    const main = this.entries.get('main');
    if (!main || main.win.isDestroyed()) return;
    try {
      main.win.setAlwaysOnTop(false, 'normal');
    } catch { /* 忽略 */ }
    main.win.show();
    try { main.win.moveTop(); } catch { /* 忽略 */ }
    main.win.focus();
  }

  /** 隐藏主窗口。 */
  public hideMainWindow(): void {
    const entry = this.entries.get('main');
    if (entry && !entry.win.isDestroyed()) entry.win.hide();
  }

  /** 显示主窗口（永不置顶，可靠置前）。 */
  public showMainWindow(): void {
    this.showMainWindowRaised();
  }

  /**
   * 截图期间隐藏所有应用聊天窗口（主/副/翻译，B 窗口在选区完成后才创建故此时不存在），
   * 记录原可见性，避免它们被截进截图里。截图结束（遮罩关闭）后由 restore 恢复。
   */
  public hideChatWindowsForScreenshot(): void {
    this.screenshotHidden = [];
    for (const [id, entry] of this.entries) {
      if (!entry.win || entry.win.isDestroyed()) continue;
      const visible = entry.win.isVisible();
      this.screenshotHidden.push({ id, visible });
      if (visible) entry.win.hide();
    }
  }

  /**
   * 清空截图期间隐藏记录（「截图时保留窗口」开启时调用）：
   * 窗口未被隐藏，恢复逻辑不应做任何事，避免遮罩关闭后误触发恢复。
   */
  public clearScreenshotHidden(): void {
    this.screenshotHidden = [];
  }

  /** 截图结束后恢复被隐藏窗口到截图前的可见性（保持主副切换状态）。 */
  public restoreChatWindowsAfterScreenshot(): void {
    let mainWasVisible = false;
    for (const rec of this.screenshotHidden) {
      const entry = this.entries.get(rec.id);
      if (entry && !entry.win.isDestroyed() && rec.visible) {
        entry.win.show();
        if (rec.id === 'main') mainWasVisible = true;
      }
    }
    this.screenshotHidden = [];
    // 截图后主窗口用 show() 只恢复显示、不提升 Z 序，可能被压在其他窗口之下；
    // 若主窗口截图前可见，则恢复到普通窗口最前（置顶的副窗口/B 窗口仍可覆盖它）。
    if (mainWasVisible) {
      this.showMainWindowRaised();
    }
  }

  /** 获取当前活动窗口的对话 webContents（无则回退主窗口）。 */
  public getActiveWebContents(): WebContents | null {
    let entry = this.activeId ? this.entries.get(this.activeId) : undefined;
    if (!entry || entry.win.isDestroyed()) {
      entry = this.entries.get('main');
    }
    if (!entry) return null;
    if (entry.view) return entry.view.webContents;
    // 翻译窗口无内嵌对话，回退主窗口
    const main = this.entries.get('main');
    return main && main.view ? main.view.webContents : null;
  }

  /** 通过 webContents 反查窗口 id（用于 IPC 处理时定位来源窗口）。 */
  public findIdByWebContents(wc: WebContents): string | null {
    for (const [id, entry] of this.entries) {
      if (entry.win.webContents === wc) return id;
      if (entry.view && entry.view.webContents === wc) return id;
    }
    return null;
  }

  /** 通过 webContents 反查宿主 BrowserWindow（兼容 WebContentsView 的 chat 视图）。 */
  public getWinByWebContents(wc: WebContents): BrowserWindow | null {
    const id = this.findIdByWebContents(wc);
    if (!id) return null;
    const entry = this.entries.get(id);
    return entry && entry.win && !entry.win.isDestroyed() ? entry.win : null;
  }

  /** 返回所有外壳窗口（BrowserWindow 自身 webContents）列表，用于统一广播（如主题变量）。 */
  public getShellWebContentsList(): WebContents[] {
    const list: WebContents[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.win.isDestroyed()) list.push(entry.win.webContents);
    }
    return list;
  }

  /** 依据全局字号偏移对指定对话视图设置页面缩放（同步网页字体大小）。 */
  public applyFontZoom(wc: WebContents, offset: number): void {
    if (!wc || wc.isDestroyed()) return;
    try {
      // 全局字号整体放大一号：缩放基础 1.0 → 1.05（网页视图字体跟随，设置界面除外）
      wc.setZoomFactor(1.05 + (Number(offset) || 0) * 0.05);
    } catch {
      /* 平台不支持则忽略 */
    }
  }

  /** 对所有对话视图应用全局字号缩放（字号设置变化时调用）。 */
  public applyFontZoomAll(offset: number): void {
    for (const entry of this.entries.values()) {
      if (entry.view && entry.view.webContents && !entry.view.webContents.isDestroyed()) {
        this.applyFontZoom(entry.view.webContents, offset);
      }
    }
  }

  private trackActive(win: BrowserWindow, id: string): void {
    win.on('focus', () => {
      this.activeId = id;
    });
  }

  private trackClosed(win: BrowserWindow, id: string): void {
    win.on('closed', () => {
      this.entries.delete(id);
      if (this.activeId === id) this.activeId = null;
      if (this.currentSubId === id) {
        this.currentSubId = null;
        this.conversationInSub = false;
      }
      if (this.currentBId === id) this.currentBId = null;
    });
  }

  private bindCloseToTray(win: BrowserWindow, id: string): void {
    win.on('close', (e: Electron.Event) => {
      if (this.config.get('closeToTray') && id === 'main') {
        // 主窗口关闭已由 mainWindow 处理，这里避免重复。副窗口隐藏。
        if (!this.config.get('closeToTray')) return;
      }
    });
  }
}
