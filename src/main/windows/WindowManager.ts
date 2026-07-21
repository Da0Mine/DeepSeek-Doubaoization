/**
 * 窗口注册表 + 主/副窗口创建、复制、置顶、显隐切换。
 * 维护 Map<id, WindowEntry>，提供 getActiveWebContents 供注入使用。
 */
import { BrowserWindow, WebContents, WebContentsView, screen } from 'electron';
import type { ConfigStore } from '../config/ConfigStore';
import type { DefaultModelMode, ScreenshotRect, SubWindowRole, WindowType } from '../../shared/types';
import { WEBVIEW_PRELOAD, DEEPSEEK_URL } from '../constants';
import { createMainWindow, layoutView, createChatView } from './mainWindow';
import { createSubWindow } from './subWindow';
import { createBWindow as createBWindowFactory } from './bWindow';
import { applyThinkCollapse } from '../inject/thinkCollapse';
import type { Injector } from '../inject/Injector';
import { logf } from '../logger';

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
  /** 对话当前是否在副窗口（true=在副窗口，false=在主窗口）。驱动「主副切换」的隐藏方向。 */
  private conversationInSub = false;
  /** 正在执行模型切换的 webContents id 集合：防止同一会话并发多次点击 radio 互相打断（问题 1 根因）。 */
  private switchingWc = new Set<number>();
  /** 各 webContents 上次应用默认模型的时间戳：用于去抖，避免一次「新建对话」被重复触发。 */
  private lastDefaultModelAt = new Map<number, number>();
  /** 各 webContents 上次记录的 chat URL：用于检测「从历史会话切回新建对话」的路由方向变化（Bug1 修复）。 */
  private lastUrlByWc = new Map<number, string>();
  private onWebViewReady: ((wc: WebContents) => void) | null = null;
  private injector: Injector | null = null;
  /** 正在退出标志：置 true 后所有窗口的 close 拦截放行，使 app.quit() 能真正关闭窗口。 */
  private quitting = false;

  constructor(private readonly config: ConfigStore) {}

  /** 注入器 setter（用于新建对话窗口后自动切换默认模型）。 */
  public setInjector(injector: Injector): void {
    this.injector = injector;
  }

  /** 标记应用正在退出（托盘退出前调用），放行窗口 close 拦截。 */
  public setQuitting(v: boolean): void {
    this.quitting = v;
  }

  /** 设置网页对话视图就绪回调（用于在 chat 视图注入剪刀按钮等）。 */
  public setWebViewReadyHook(fn: (wc: WebContents) => void): void {
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
    const fire = () => this.onWebViewReady?.(view.webContents);
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
        const curHasId = /\/a\/chat\/.+/.test(url.split('#')[0]);
        logf(
          'convChange',
          `prev=${prev || '(空)'} cur=${url} prevHasId=${prevHasId} curHasId=${curHasId} triggered=${prevHasId && !curHasId}`
        );
        if (prevHasId && !curHasId) {
          logf('convChange', '检测到「历史会话 → 新建对话」路由变化，应用默认模型模式');
          applyDefaultMode().catch(() => {});
        }
        this.lastUrlByWc.set(wcId, url);
      } catch {
        /* 读取 URL 失败则忽略，下一事件再试 */
      }
    };
    view.webContents.on('did-finish-load', () => {
      fire();
      // 视图就绪后按当前设置应用折叠思考过程（I-新增：默认折叠模型思考）
      applyThinkCollapse(view.webContents, this.config.get('collapseThinking'));
      // 新建对话窗口自动应用默认模型模式（简单模式无需处理）
      applyDefaultMode().catch(() => {});
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
      applyThinkCollapse(view.webContents, this.config.get('collapseThinking'));
      applyDefaultMode().catch(() => {});
      detectConversationChange();
      // 完整导航会重建 document，页内点击监听可能丢失，重新注入一次（flag 防重复）
      injectWatcher();
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
    injectWatcher();
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
      logf('applyDefault', `跳过：默认模式为 simple（页面默认，无需切换） id=${id} type=${entryType}`);
      return; // 简单模式是页面默认，无需切换
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

  /** 返回所有对话 webContents（用于配置变更时批量应用副作用，如折叠思考）。 */
  public getAllChatWebContents(): WebContents[] {
    const list: WebContents[] = [];
    for (const entry of this.entries.values()) {
      if (entry.view && !entry.view.webContents.isDestroyed()) {
        list.push(entry.view.webContents);
      }
    }
    return list;
  }

  /** 将网页视图的控制台日志转发到主进程终端，便于注入脚本诊断（如 [Injector] 日志）。 */
  private attachWebConsole(view: WebContentsView | null): void {
    if (!view) return;
    view.webContents.on('console-message', (_e, level, message) => {
      const tag = level === 2 ? 'ERR' : level === 1 ? 'WARN' : 'LOG';
      console.log(`[web:${tag}] ${message}`);
      // 网页内日志（含注入脚本的 [PAGE-NEWCONV*] 诊断）一并落盘，便于主理人自检
      logf(`web:${tag}`, message);
    });

    // 隐藏 webContents 自带的所有滚动条：DeepSeek 整个 SPA 页面渲染为 12000+ 像素高，
    // 会让外壳 window 出现超长滚动条。直接隐藏 webkit 滚动条即可消除视觉干扰，不修改
    // DeepSeek 内部布局（之前在 preload 注入 html/body overflow:hidden 的方案会破坏
    // fixed/absolute 定位元素，导致主内容区消失、消息区卡死）。
    const HIDE_SCROLLBAR_CSS = `
      /* 隐藏 webContents 主滚动条（垂直+水平） */
      ::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      /* 内部容器的滚动条也隐藏（DeepSeek 内部各 ds-scroll-area 仍可滚动，只是不显示滚动条） */
      ::-webkit-scrollbar-thumb { background: transparent !important; }
      ::-webkit-scrollbar-track { background: transparent !important; }
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

    // 强制把页面滚到顶部：DeepSeek 整个 body 高度 12000+，浏览器记忆的滚动位置可能在中间，
    // 导致用户看到的是"中间的空内容 + 底部的输入框"而不是页面顶部。每次 did-finish-load
    // 把页面滚到 0，且禁用 history 的滚动记忆。
    const scrollToTop = (): void => {
      if (view.webContents.isDestroyed()) return;
      view.webContents
        .executeJavaScript(
          'try { window.scrollTo(0, 0); if (history.scrollRestoration) history.scrollRestoration = "manual"; } catch (e) {}',
          true
        )
        .catch(() => {
          /* 忽略执行失败 */
        });
    };
    scrollToTop();
    view.webContents.on('did-finish-load', scrollToTop);
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
    this.attachWebViewReady(view, 'sub', false);
    this.currentBId = id;
    return id;
  }

  /** 呼出 / 聚焦常驻副窗口（Alt+Q 或标题栏按钮）。无则创建，有则聚焦。 */
  public summonSubWindow(): string {
    if (this.currentSubId) {
      const e = this.entries.get(this.currentSubId);
      if (e && !e.win.isDestroyed()) {
        e.win.setAlwaysOnTop(true);
        e.win.show();
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
      sub.win.setAlwaysOnTop(true);
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
    if (this.currentSubId) {
      const e = this.entries.get(this.currentSubId);
      if (e && !e.win.isDestroyed()) {
        if (e.win.isVisible()) {
          e.win.hide();
          return this.currentSubId;
        }
        // 不可见：重新定位到右侧再显示（避免停留上次被移走的异常位置）
        this.placeSubWindowRight(e.win);
        e.win.setAlwaysOnTop(true);
        e.win.show();
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
      sub.win.setAlwaysOnTop(true);
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
  public swapMainSub(subId?: string): boolean {
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
      this.migrateConversationToWindow(dstEntry, srcEntry);
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
      // 对话搬回主窗口：隐藏副窗口，显示主窗口
      sub.win.hide();
      main.win.show();
      main.win.focus();
      this.conversationInSub = false;
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
    const id = this.createSubWindow('sub', false, true);
    this.lastSendNewId = id;
    const e = this.entries.get(id);
    if (e && !e.win.isDestroyed()) {
      this.placeSubWindowRight(e.win);
      // 兜底：视图（chat.deepseek.com）加载完成即重新靠右定位并显示窗口，避免任何情况下副窗口唤不出 / 出现在左侧。
      // 与调用方 revealWindow 互补：即便等待就绪的逻辑异常，窗口也会在加载完成后出现且位于右侧。
      e.view?.webContents.once('did-finish-load', () => {
        this.placeSubWindowRight(e.win);
        this.revealWindow(id);
      });
    }
    return id;
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

  /** 设置窗口置顶。 */
  public setAlwaysOnTop(id: string, on: boolean): void {
    const entry = this.entries.get(id);
    if (entry) entry.win.setAlwaysOnTop(on);
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
      entry.win.show();
      entry.win.focus();
    }
  }

  /** 隐藏主窗口。 */
  public hideMainWindow(): void {
    const entry = this.entries.get('main');
    if (entry && !entry.win.isDestroyed()) entry.win.hide();
  }

  /** 显示主窗口。 */
  public showMainWindow(): void {
    const entry = this.entries.get('main');
    if (entry && !entry.win.isDestroyed()) {
      entry.win.show();
      entry.win.focus();
    }
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

  /** 截图结束后恢复被隐藏窗口到截图前的可见性（保持主副切换状态）。 */
  public restoreChatWindowsAfterScreenshot(): void {
    for (const rec of this.screenshotHidden) {
      const entry = this.entries.get(rec.id);
      if (entry && !entry.win.isDestroyed() && rec.visible) {
        entry.win.show();
      }
    }
    this.screenshotHidden = [];
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

  /** 返回所有外壳窗口（BrowserWindow 自身 webContents）列表，用于统一广播（如主题变量）。 */
  public getShellWebContentsList(): WebContents[] {
    const list: WebContents[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.win.isDestroyed()) list.push(entry.win.webContents);
    }
    return list;
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
