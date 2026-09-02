/**
 * 插件管理器：负责在 session.defaultSession 上加载 / 卸载浏览器扩展，
 * 并以 userData/extensions.json 持久化「已安装 + 启用」状态，启动时自动重载启用的插件。
 * 扩展加载到 defaultSession（所有窗口共用），其 content scripts 即可作用于 chat.deepseek.com。
 * @note Electron 加载扩展对 MV2 完整、对 MV3 仅部分支持；本模块不校验 API 可用性，
 *       由 loadExtension 的返回/异常把结果交回 UI 层提示。
 */
import { app, session, BrowserWindow, protocol, net, WebContentsView, type Extension } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { DSPP_SIDEPANEL_PRELOAD, TITLEBAR_HEIGHT, ICON_DIR } from '../constants';
import { setSidebarPane } from './sidebarReservation';

/** 主窗口引用（内嵌侧边栏需要宿主窗口 + 其 chat 视图）。 */
export type MainWindowRef = { win: BrowserWindow; view: WebContentsView | null } | null;

/** 持久化的插件记录。 */
interface InstalledPlugin {
  /** 扩展绝对目录（unpacked 扩展源目录）。 */
  path: string;
  enabled: boolean;
}

/** 面板可展示的插件数据。 */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
  /** 图标绝对路径（manifest.icons 解析）或 null。 */
  iconPath: string | null;
  /** 是否为内置插件（随软件预装，不可删除）。 */
  builtin: boolean;
  /** 加载失败时的错误信息（仅异常时会闪存，正常展示为空）。 */
  error?: string;
}

/**
 * 内联 chrome 垫片（注入到 dspp:// 服务的 HTML 头部，早于 type="module" 脚本执行）。
 * 为 sidepanel React 提供 chrome.runtime / chrome.storage / chrome.i18n / chrome.extension /
 * chrome.permissions 兼容层，全部经 window.__ds 桥转发到主进程 ExtensionHost。
 */
const DSPP_CHROME_SHIM = `(function () {
  if (window.__dsppChromePatched) return;
  var b = window.__ds;
  if (!b || !b.extHostStorageGet) {
    setTimeout(function () { try { window.__dsppRetryPatch = true; } catch (e) {} }, 0);
    return;
  }
  function wrapStorage() {
    return {
      get: function (keys) { return Promise.resolve(b.extHostStorageGet(keys == null ? undefined : keys)).then(function (r) { return r || {}; }); },
      set: function (values) { return Promise.resolve(b.extHostStorageSet(values || {})).then(function () {}); },
      remove: function (keys) { return Promise.resolve(b.extHostStorageRemove(keys)).then(function () {}); },
      onChanged: { addListener: function () {}, removeListener: function () {} }
    };
  }
  function mkRuntime() {
    return {
      sendMessage: function (message) {
        return Promise.resolve(b.extHostRuntimeMessage(message ? JSON.parse(JSON.stringify(message)) : {})).then(function (r) { return r; });
      },
      onMessage: { addListener: function (fn) { window.__dsppRuntimeListener = fn; }, removeListener: function () {} },
      getManifest: function () { return { name: 'DeepSeek++', version: '1.14.0', manifest_version: 3 }; },
      id: '__dspp-host'
    };
  }
  function absUrl(p) {
    var s = p == null ? '' : String(p);
    if (s.charAt(0) === '/') s = s.slice(1);
    return 'dspp://sidepanel/' + s;
  }
  var existing = (typeof window.chrome === 'object' && window.chrome) || {};
  try {
    Object.defineProperty(window, 'chrome', {
      value: Object.assign({}, existing, {
        runtime: mkRuntime(),
        storage: {
          local: wrapStorage(),
          sync: wrapStorage(),
          onChanged: { addListener: function () {}, removeListener: function () {} }
        },
        i18n: {
          getUILanguage: function () { return 'zh-CN'; },
          getMessage: function (key) { return typeof key === 'string' ? key : ''; },
          detectLanguage: function (txt) { return Promise.resolve({ isReliable: true, languages: [] }); }
        },
        extension: {
          isAllowedIncognitoAccess: function (cb) { if (typeof cb === 'function') cb(false); return Promise.resolve(false); },
          getURL: absUrl
        },
        permissions: {
          contains: function (_o) {
            return Promise.resolve(b.extHostStorageGet('deepseek_pp_floating_chat_enabled'))
              .then(function (r) { return !(r && r.deepseek_pp_floating_chat_enabled === false); });
          },
          request: function (_o) { return Promise.resolve(true); },
          onAdded: { addListener: function () {}, removeListener: function () {} },
          onRemoved: { addListener: function () {}, removeListener: function () {} }
        }
      }),
      configurable: true,
      writable: true
    });
    window.__dsppChromePatched = true;
    try { window.__dspp_patch_source = 'inline'; console.log('[dspp] chrome-patch:OK storage=' + !!window.chrome.storage.local + ' runtime=' + !!window.chrome.runtime.sendMessage); } catch (e) {}
  } catch (e) {}
})();`;

export class ExtensionManager {
  private storePath = path.join(app.getPath('userData'), 'extensions.json');
  private installed = new Map<string, InstalledPlugin>(); // id -> 持久化记录
  private inited = false;
  /** 内置插件目录（预装的 DeepSeek++）：存在但默认不加载（避免坏后台拖慢），由用户在面板手动开启。 */
  private builtinDir: string | null;
  /** 内置插件展示用的逻辑 id（与 Electron 扩展真实 id 解耦，列表/固定/启停统一用它）。 */
  private readonly builtinShowId = 'builtin:deepseek-pp';
  /** 内置插件展示名（locale 解析后，回填为实际名称）。 */
  private builtinName = 'DeepSeek++';
  /** 内置插件原生加载后的 Electron 扩展 id（每次启动由 loadBuiltinNative 记录，供原生侧边栏 chrome-extension:// 加载）。 */
  private builtinExtId: string | null = null;
  /** 固定到工具栏的插件 id（持久化）。 */
  private pinned = new Set<string>();
  /** 内置插件是否启用。默认关闭：因其 MV3 service worker 在 Electron 不运行，会让日常发消息变慢，
   *  故默认不加载以恢复正常速度，用户可在插件面板手动开关（仍不可删除）。 */
  private builtinEnabled = false;
  /** 宿主主窗口提供者（内嵌侧边栏用）：返回主窗口 + 其 chat 视图。 */
  private getMainWin?: () => MainWindowRef;

  constructor(opts?: { builtinDir?: string; builtinName?: string; getMainWin?: () => MainWindowRef }) {
    this.builtinDir = opts?.builtinDir || null;
    if (opts?.builtinName) this.builtinName = opts.builtinName;
    this.getMainWin = opts?.getMainWin;
  }

  /**
   * 启动时调用：先加载内置插件（不可删除），再从磁盘恢复并自动加载用户已启用的插件。
   * 需在创建聊天视图之前/尽早调用，使 content scripts 能随页面首批注入。
   */
  public async init(): Promise<void> {
    if (this.inited) return;
    this.inited = true;
    await this.loadStore();
    // Electron 43 支持 MV3 service worker：内置插件改为「原生加载」，
    // 由 Electron 运行其后台 SW 并以真实隔离世界注入 content 脚本（替代旧的手动注入模式）。
    if (this.builtinDir && this.builtinEnabled) {
      await this.loadBuiltinNative();
    }
    // 用户插件：加载已启用的
    for (const rec of this.installed.values()) {
      if (rec.enabled) {
        try {
          await session.defaultSession.loadExtension(rec.path);
        } catch (e) {
          console.error('[ExtensionManager] 自动加载插件失败', rec.path, e);
        }
      }
    }
  }

  /** 原生加载内置 DeepSeek++ 扩展（Electron 43 运行 MV3 SW + 注入隔离世界 content）。结果落日志。 */
  private async loadBuiltinNative(): Promise<void> {
    const logPath = path.join(app.getPath('userData'), 'dspp-nativeload.log');
    const log = (line: string): void => {
      try {
        fs.appendFileSync(logPath, '[' + new Date().toISOString() + '] ' + line + '\n', 'utf-8');
      } catch { /* 忽略 */ }
    };
    if (!this.builtinDir) { log('NO_DIR'); return; }
    try {
      // 若已加载则先移除，确保重新加载最新
      const already = session.defaultSession.getAllExtensions()
        .find((e) => this.isBuiltinPath(e.path));
      if (already) {
        try { session.defaultSession.removeExtension(already.id); } catch { /* 忽略 */ }
      }
      const ext = await session.defaultSession.loadExtension(this.builtinDir);
      this.builtinExtId = ext.id;
      log('OK id=' + ext.id + ' name=' + ext.name + ' version=' + ext.version);
      console.log('[ExtensionManager] 原生加载内置插件成功', ext.id, ext.name, ext.version);
    } catch (e) {
      log('ERR ' + String((e as Error)?.message || e));
      console.error('[ExtensionManager] 原生加载内置插件失败', e);
    }
  }

  /** 列出当前已在 defaultSession 加载的扩展（含内置插件 + 持久化启停状态）。 */
  public async list(): Promise<PluginInfo[]> {
    const loaded = session.defaultSession.getAllExtensions();

    const merged = new Map<string, PluginInfo>();
    // 1) 内置插件：始终置顶展示（enabled 取持久化开关；默认关闭时未加载）
    if (this.builtinDir) {
      const loadedBuiltin = loaded.find((e) => this.isBuiltinPath(e.path)) || null;
      merged.set(this.builtinShowId, {
        id: this.builtinShowId,
        name: this.builtinName,
        version: loadedBuiltin?.version || this.readManifestVersion(this.builtinDir),
        path: this.builtinDir,
        enabled: this.builtinEnabled,
        iconPath: path.join(ICON_DIR, 'deepseek-whale-white.svg'),
        builtin: true,
      });
    }
    // 2) 其余已加载的扩展
    for (const ext of loaded) {
      if (this.isBuiltinPath(ext.path)) continue;
      merged.set(ext.id, {
        id: ext.id,
        name: ext.name,
        version: ext.version,
        path: ext.path,
        enabled: true,
        iconPath: this.resolveIcon(ext),
        builtin: false,
      });
    }
    // 3) 持久化里已启用但当前未加载的（启动加载失败等）也列出
    for (const [id, rec] of this.installed) {
      if (merged.has(id)) continue;
      merged.set(id, {
        id,
        name: this.readManifestName(rec.path),
        version: this.readManifestVersion(rec.path),
        path: rec.path,
        enabled: rec.enabled,
        iconPath: this.readManifestIcon(rec.path),
        builtin: false,
      });
    }
    return Array.from(merged.values());
  }

  /** 加载本地已解压扩展目录。成功则登记并持久化为启用。 */
  public async loadUnpacked(dir: string): Promise<PluginInfo> {
    const ext = await session.defaultSession.loadExtension(dir);
    this.installed.set(ext.id, { path: dir, enabled: true });
    await this.saveStore();
    return {
      id: ext.id,
      name: ext.name,
      version: ext.version,
      path: ext.path,
      enabled: true,
      iconPath: this.resolveIcon(ext),
      builtin: false,
    };
  }

  /** 启用 / 禁用某个插件。禁用=移除运行时加载；启用=重新从目录加载。
   *  内置插件走「注入模式」：不 loadExtension（避免双重注入），而是置 builtinEnabled 标志 +
   *  由 preload 在页面里注入其 content/main-world（使用 ExtensionHost 的 chrome）。 */
  public async setEnabled(id: string, enabled: boolean): Promise<void> {
    // 内置插件：仅更新标志，页面里由 preload 读取 builtinEnabled 决定是否注入
    if (this.isBuiltin(id)) {
      if (enabled === this.builtinEnabled || !this.builtinDir) return;
      this.builtinEnabled = enabled;
      await this.saveStore();
      return;
    }
    const rec = this.installed.get(id);
    if (enabled) {
      if (rec) {
        await session.defaultSession.loadExtension(rec.path);
        rec.enabled = true;
      } else {
        const ext = this.getLoaded(id);
        if (!ext) throw new Error('插件不存在');
        await session.defaultSession.loadExtension(ext.path);
        this.installed.set(id, { path: ext.path, enabled: true });
      }
    } else {
      const target = rec ? rec.path : this.getLoaded(id)?.path;
      if (!target) throw new Error('插件不存在');
      try {
        session.defaultSession.removeExtension(id);
      } catch (e) {
        console.error('[ExtensionManager] 移除扩展失败', id, e);
        throw e;
      }
      if (rec) rec.enabled = false;
      else this.installed.set(id, { path: target, enabled: false });
    }
    await this.saveStore();
  }

  /** 卸载（移除运行时 + 删除持久化记录）。内置插件不可删除。 */
  public async remove(id: string): Promise<void> {
    if (this.isBuiltin(id)) {
      throw new Error('内置插件不可删除');
    }
    try {
      session.defaultSession.removeExtension(id);
    } catch (e) {
      console.error('[ExtensionManager] 移除扩展失败', id, e);
    }
    this.installed.delete(id);
    await this.saveStore();
  }

  /** 是否内置插件（按目录判断，兜底内置扩展未被加载时的场景）。 */
  private isBuiltinPath(dir: string | null | undefined): boolean {
    if (!dir || !this.builtinDir) return false;
    return path.resolve(dir).toLowerCase() === path.resolve(this.builtinDir).toLowerCase();
  }

  // ---------------- 注入模式（切用软件注入管线，绕过 Electron 坏掉的 MV3 service worker） ----------------

  /**
   * 将内置 DeepSeek++ 的页面增强脚本（content + main-world）作为普通页面脚本注入到 chat 页，
   * 让它使用页面侧注入的 window.chrome（ExtensionHost）。这是“宿主方案”的核心——不再依赖
   * Electron 的扩展运行时。默认不自动调用（待消息协议适配后由宿主接入）。
   * @param wc DeepSeek chat 的 webContents
   * @returns 注入了哪些脚本（供诊断）
   */
  public async injectBuiltinPageEnhancement(wc: import('electron').WebContents): Promise<string[]> {
    if (!wc || wc.isDestroyed() || !this.builtinDir) return [];
    const out: string[] = [];
    const scriptCandidates: Array<[string, string]> = [
      ['main-world', 'content-scripts/main-world.js'], // 需 MAIN world：executeJavaScript 正是 MAIN world
      ['content', 'content-scripts/content.js'],
    ];
    for (const [tag, rel] of scriptCandidates) {
      const abs = path.join(this.builtinDir, rel);
      if (!fs.existsSync(abs)) continue;
      try {
        const code = fs.readFileSync(abs, 'utf-8');
        // 用全局标记幂等，避免重复注入
        await wc.executeJavaScript(
          `(function () { if (window['__dspp_injected_${tag}']) return 'skip'; window['__dspp_injected_${tag}'] = true; return 'run'; })()`
        ).catch(() => 'err');
        void wc.executeJavaScript(code).catch((e) => console.error('[ExtensionHost] 注入前检查失败'));
      } catch (e) {
        console.error('[ExtensionHost] 注入内置增强失败', tag, e);
      }
      out.push(tag);
    }
    return out;
  }

  // ---------------- 侧边栏（内嵌主窗口的 WebContentsView，宿主 DeepSeek++ sidepanel.html React 工作台） ----------------

  /** 侧边栏 WebContentsView（黏附在主窗口右侧，压缩 chat 视图让位）。 */
  private sidebarView: Electron.WebContentsView | null = null;
  /** 侧边栏宿主主窗口。 */
  private sidebarHost: BrowserWindow | null = null;
  /** 侧边栏显式打开状态（唯一开关依据，不依赖 webContents 健康）。
   *  渲染进程崩溃/被销毁时 webContents.isDestroyed() 可能长期为 false，
   *  若用它的健康态判断会导致「残留空边栏时再点变成重新打开而非关闭」。 */
  private sidebarOpen = false;
  /** 侧边栏固定宽度。 */
  private readonly SIDEPANEL_WIDTH = 380;
  /** 布局防抖 timer。 */
  private sidebarLayoutTimer: ReturnType<typeof setTimeout> | null = null;
  /** 是否已挂主窗口 resize 监听。 */
  private sidebarListeningResize = false;
  /** 最近一次实际应用的侧边栏布局（冗余守卫，避免回环 setBounds）。 */
  private lastSidebarLayout: { top: number; bottom: number; pane: number; chatW: number } | null = null;

  /** 注册 dspp:// 自定义协议，把根路径服务到内置扩展目录（须在 app ready 后调用）。
   *  对 HTML 页面额外在 <head> 前注入一段内联 chrome 垫片脚本：sidepanel.html 用 <script type="module">
   *  加载，module 在 DOM 解析后才求值，而 preload 的 webFrame.executeJavaScript 与之存在竞态，
   *  可能导致模块读 chrome.storage 时尚未打好补丁。内联脚本早于 defer 的 module 执行，可根治该问题。 */
  public registerDsppProtocol(): void {
    if (!this.builtinDir) return;
    const root = path.resolve(this.builtinDir);
    protocol.handle('dspp', async (req) => {
      try {
        const url = new URL(req.url);
        let rel = decodeURIComponent(url.pathname);
        if (!rel || rel === '/' || rel === '') rel = '/sidepanel.html';
        const abs = path.resolve(root, '.' + rel);
        if (!abs.startsWith(root)) return new Response('forbidden', { status: 403 });
        const resp = await net.fetch(pathToFileURL(abs).toString());
        if (rel.endsWith('.html')) {
          const html = await resp.text();
          const injected = html.replace(
            '<head>',
            '<head>\n<script>' + DSPP_CHROME_SHIM + '<\/script>'
          );
          return new Response(injected, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        return resp;
      } catch (e) {
        return new Response('not found: ' + String(e), { status: 404 });
      }
    });
  }

  /** 打开/关闭 DeepSeek++ 侧边栏工作台：内嵌主窗口右侧（浏览器插件式侧边栏）。再点则关闭。 */
  public openBuiltinSidepanel(): void {
    if (!this.builtinDir) return;
    const host = this.getMainWin?.()?.win;
    if (!host || host.isDestroyed()) {
      console.error('[ExtensionManager] 打开侧边栏失败：主窗口不可用');
      return;
    }
    if (this.isSidepanelOpen()) {
      this.closeSidepanel();
      return;
    }
    // 可能残留已销毁的侧边栏（渲染崩溃等）：先统一收尾，释放预留并恢复 chat 全宽，再重建。
    this.teardownSidebarState();
    this.sidebarHost = host;

    // 挂 resize / maximize 等布局监听：主窗口自己的 chat relayout（0ms 防抖）会把 chat 恢复为全宽，
    // 我们的布局放在稍晚的防抖里执行，确保侧边栏 + 压缩 chat 在窗口尺寸变化后仍正确。
    if (!this.sidebarListeningResize) {
      host.on('resize', this.onSidebarHostResize);
      host.on('resized', this.onSidebarHostResize);
      host.on('maximize', this.onSidebarHostResize);
      host.on('unmaximize', this.onSidebarHostResize);
      host.on('enter-full-screen', this.onSidebarHostResize);
      host.on('leave-full-screen', this.onSidebarHostResize);
      this.sidebarListeningResize = true;
    }

    // 移除旧视图再重建，防止残留。
    if (this.sidebarView) {
      try { host.contentView.removeChildView(this.sidebarView); } catch { /* 忽略 */ }
      this.sidebarView = null;
    }
    const view = new WebContentsView({
      webPreferences: {
        preload: DSPP_SIDEPANEL_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.sidebarView = view;
    try { view.setBackgroundColor('#1e1e1e'); } catch { /* 忽略 */ }
    try { (view as { setVisible?: (v: boolean) => void }).setVisible?.(false); } catch { /* 忽略 */ }

    host.contentView.addChildView(view);
    // 侧边栏优先加载插件自带的原生 sidepanel.html（chrome-extension:// 源，与 SW 同源 → 读插件自己的
    // 记忆/数据存储）。之前为绕开其一过的渲染崩溃而临时改 dspp://，但那会让记忆读到另一套空库，
    // 与你真实的记忆分家。这里改回原生源；若偶发 sandboxed_renderer 崩溃，见 openBuiltinSidepanel 处的兜底。
    const extId = this.builtinExtId;
    void view.webContents.loadURL(
      extId ? `chrome-extension://${extId}/sidepanel.html` : 'dspp://sidepanel/'
    );

    // 自证日志（沿用既有侧边栏日志，便于核验 React 渲染与控制台错误）
    this.attachSidepanelLogging(view);

    // 标记为打开（在视图就绪前生效，确保打开期间再点一定走「关闭」而非重新打开）。
    this.sidebarOpen = true;

    view.webContents.once('dom-ready', () => {
      if (this.sidebarView !== view || !this.sidebarOpen) return; // 已关闭/已被替换则不操作
      this.applySidebarLayout();
      try { (view as { setVisible?: (v: boolean) => void }).setVisible?.(true); } catch { /* 忽略 */ }
      view.webContents.focus();
    });
    view.webContents.once('destroyed', () => {
      // 侧边栏 WebContents 意外销毁也要统一收尾：释放预留、恢复 chat 全宽，
      // 避免「面板消失但 380px 侧边栏仍占位」的残留。正常 closeSidepanel 已把 sidebarView 置 null，不会重复执行。
      if (this.sidebarView === view) this.teardownSidebarState();
    });
    // 渲染进程崩溃（如 chrome-extension:// 载入面板偶发 sandboxed_renderer 失败）不会触发 'destroyed'，
    // 但会让侧边栏白屏。必须在此一并收尾，否则残留 380px 空边栏、且再点因 isSidepanelOpen 误判而无法关闭。
    view.webContents.on('render-process-gone', () => {
      if (this.sidebarView === view) this.teardownSidebarState();
    });
    this.applySidebarLayout();
  }

  // ---------------- 统一收尾：移除视图、卸掉宿主 resize 监听、释放宽度预留并恢复 chat 全宽 ----------------
  // 供三处调用：正常 close、toggle 打开前清理残留、以及侧边栏视图意外销毁（渲染崩溃）。幂等。
  private teardownSidebarState(): void {
    const host = this.sidebarHost;
    this.sidebarOpen = false; // 复位显式开关状态
    if (this.sidebarLayoutTimer) {
      clearTimeout(this.sidebarLayoutTimer);
      this.sidebarLayoutTimer = null;
    }
    if (this.sidebarView) {
      const view = this.sidebarView;
      if (host && !host.isDestroyed()) {
        try { host.contentView.removeChildView(view); } catch { /* 忽略 */ }
      }
      const vwc = view.webContents;
      if (vwc && !vwc.isDestroyed()) {
        try { vwc.close(); } catch { /* 忽略 */ }
      }
    }
    this.sidebarView = null;
    this.sidebarHost = null;
    // 卸掉宿主 resize 等监听，避免重建后监听重复叠加。
    if (host && !host.isDestroyed()) {
      const SIDEBAR_HOST_EVENTS = ['resize', 'resized', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const;
      for (const ev of SIDEBAR_HOST_EVENTS) {
        try { (host.removeListener as (ev: string, fn: () => void) => void)(ev, this.onSidebarHostResize); } catch { /* 忽略 */ }
      }
    }
    this.sidebarListeningResize = false;
    this.lastSidebarLayout = null; // 重置守卫，重新打开侧边栏（新视图初始在 0,0）需重新布局
    // 清除侧边栏预留，恢复 chat 全宽
    setSidebarPane(host, 0);
    // 直接恢复 chat 全宽。不能只靠 layoutView→applyViewBounds：其 lastBounds 冗余守卫可能仍记录着
    // 打开前的全宽，关闭时算出的目标(全宽)与 lastBounds 相等，会误判「未变化」而跳过 setBounds，
    // 导致 chat 仍被压缩、侧边栏收不回去。与 applySidebarLayout 直接 setBounds 压缩的做法对称即可根治。
    const main = this.getMainWin?.();
    const chat = main?.view;
    if (host && !host.isDestroyed() && chat && chat.webContents && !chat.webContents.isDestroyed()) {
      const { width, height } = host.getContentBounds();
      if (width > 0 && height > 0) {
        chat.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width: Math.max(0, width), height: Math.max(0, height - TITLEBAR_HEIGHT) });
      }
    }
  }

  /** 关闭侧边栏：移除视图并恢复 chat 视图为全宽。 */
  public closeSidepanel(): void {
    this.teardownSidebarState();
  }

  /** 侧边栏是否打开（以显式状态为准，渲染崩溃/白屏后仍可正常「再点关闭」）。 */
  public isSidepanelOpen(): boolean {
    return this.sidebarOpen;
  }

  // ---------------- 联网模式（标题栏按钮：一键切换 web_search + web_fetch） ----------------

  /** 常驻隐藏桥页面（web-tools-bridge.html）：用于主进程读写扩展 chrome.storage.local。 */
  private webToolsBridge: WebContentsView | null = null;

  /**
   * 确保常驻桥页面存在并已加载完成。
   * 用极简扩展页（无 React / 无 preload 依赖），避免 sidepanel.html 在无 preload 视图里执行 JS 卡死。
   */
  private ensureWebToolsBridge(): Promise<Electron.WebContents | null> {
    const extId = this.builtinExtId;
    if (!extId) return Promise.resolve(null);
    const view = this.webToolsBridge;
    if (view && !view.webContents.isDestroyed()) {
      const url = view.webContents.getURL();
      if (url.startsWith(`chrome-extension://${extId}/`)) return Promise.resolve(view.webContents);
      try { view.webContents.close(); } catch { /* 忽略 */ }
      this.webToolsBridge = null;
    }
    console.log('[web-tools] 创建常驻桥页面');
    const tmp = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
    });
    this.webToolsBridge = tmp;
    tmp.webContents.once('render-process-gone', (_ev, details) => {
      console.log('[web-tools] 桥页面渲染进程异常', details.reason, '标记重建');
      if (this.webToolsBridge === tmp) this.webToolsBridge = null;
    });
    return new Promise<Electron.WebContents | null>((resolve) => {
      const timer = setTimeout(() => { console.log('[web-tools] 桥页面加载超时'); if (this.webToolsBridge === tmp) { try { tmp.webContents.close(); } catch { /* 忽略 */ } this.webToolsBridge = null; } resolve(null); }, 8000);
      tmp.webContents.once('dom-ready', () => {
        clearTimeout(timer);
        console.log('[web-tools] 桥页面 dom-ready');
        if (this.webToolsBridge === tmp) resolve(tmp.webContents);
        else { try { tmp.webContents.close(); } catch { /* 忽略 */ } resolve(null); }
      });
      tmp.webContents.once('did-fail-load', (_ev, code, desc) => {
        console.log('[web-tools] 桥页面加载失败', code, desc);
        clearTimeout(timer);
        if (this.webToolsBridge === tmp) { try { tmp.webContents.close(); } catch { /* 忽略 */ } this.webToolsBridge = null; }
        resolve(null);
      });
      void tmp.webContents.loadURL(`chrome-extension://${extId}/web-tools-bridge.html`);
    });
  }

  /** 退出时销毁桥页面。 */
  public disposeWebToolsBridge(): void {
    const view = this.webToolsBridge;
    this.webToolsBridge = null;
    if (view && !view.webContents.isDestroyed()) {
      try { view.webContents.close(); } catch { /* 忽略 */ }
    }
  }

  /** 查询联网模式是否开启（读扩展 chrome.storage.local 的 deepseek_pp_web_tool_settings.web_search）。 */
  public getWebToolsEnabled(): Promise<boolean> {
    return this.runWebToolsOp('get');
  }

  /** 设置联网模式：web_search 与 web_fetch 同时开启/关闭（写入扩展 chrome.storage.local 持久化）。 */
  public setWebToolsEnabled(enabled: boolean): Promise<boolean> {
    return this.runWebToolsOp('set', enabled);
  }

  /** 任务模式联动 skill 自动激活：走扩展桥写 skill 激活存储 → chrome.storage.onChanged 广播侧边栏，开关即时刷新。 */
  public setSkillAutoEnabled(on: boolean): Promise<boolean> {
    const run = (): Promise<boolean> => this.doWebToolsOp('skill', on);
    const p = this.webToolsOpSeq.then(run, run);
    this.webToolsOpSeq = p.catch(() => true);
    return p;
  }

  /** 任务模式「自动匹配skill」两个子项（首条/每条）分别写入 SW 存储。 */
  public setSkillAutoFull(first: boolean, every: boolean): Promise<boolean> {
    const run = (): Promise<boolean> => this.doWebToolsOp('sa', first, every);
    const p = this.webToolsOpSeq.then(run, run);
    this.webToolsOpSeq = p.catch(() => true);
    return p;
  }

  /** 读取 skill 自动激活真实存储（首条/每条），供页面展开框初始化与插件侧同步。失败回退默认各开。 */
  public getSkillAutoFull(): Promise<{ first: boolean; every: boolean }> {
    const run = (): Promise<{ first: boolean; every: boolean }> => this.doWebToolsOpRaw('saget');
    const p = this.webToolsOpSeq.then(run, run);
    this.webToolsOpSeq = p.then(() => true, () => true);
    return p;
  }

  /** 增强搜索展开框：分别写「搜索互联网(web_search) / 获取网页(web_fetch)」到扩展真实存储。 */
  public setWebSearchFetch(search: boolean, fetch: boolean): Promise<boolean> {
    const run = (): Promise<boolean> => this.doWebToolsOp('ws', search, fetch);
    const p = this.webToolsOpSeq.then(run, run);
    this.webToolsOpSeq = p.catch(() => true);
    return p;
  }

  /** 读取网页工具真实存储（web_search/web_fetch），供增强搜索展开框初始化同步。 */
  public getWebSearchFetch(): Promise<{ search: boolean; fetch: boolean }> {
    const run = (): Promise<{ first: boolean; every: boolean }> => this.doWebToolsOpRaw('wsget');
    const p = this.webToolsOpSeq.then(run, run);
    this.webToolsOpSeq = p.then(() => true, () => true);
    return p.then(({ first, every }) => ({ search: first, fetch: every }));
  }

  /** 普通模式「记忆功能」：写扩展桥 memoryEnabled → 真正控制 SW 是否注入记忆提示词。 */
  public setMemoryEnabled(on: boolean): Promise<boolean> {
    const run = (): Promise<boolean> => this.doWebToolsOp('mem', on);
    const p = this.webToolsOpSeq.then(run, run);
    this.webToolsOpSeq = p.catch(() => true);
    return p;
  }

  /** 串行队列：避免连续点击时并发 loadURL 相互打断。 */
  private webToolsOpSeq: Promise<boolean> = Promise.resolve(true);

  private runWebToolsOp(op: 'get' | 'set', on?: boolean): Promise<boolean> {
    const run = (): Promise<boolean> => this.doWebToolsOp(op, on);
    const p = this.webToolsOpSeq.then(run, run);
    this.webToolsOpSeq = p.catch(() => true);
    return p;
  }

  /**
   * 桥页面自执行读写：loadURL 带参数加载 web-tools-bridge.html，
   * 页面脚本操作 chrome.storage 后把结果写入 document.title（wb:…），主进程监听 page-title-updated 取回。
   * 不使用 executeJavaScript（Electron 对 chrome-extension:// 页面执行注入代码会卡死）。
   */
  private async doWebToolsOp(op: 'get' | 'set' | 'skill' | 'sa' | 'mem' | 'ws' | 'wsget', on?: boolean, every?: boolean): Promise<boolean> {
    const wc = await this.ensureWebToolsBridge();
    if (!wc) return false;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean, note?: string): void => {
        if (settled) return;
        settled = true;
        wc.removeListener('page-title-updated', onTitle);
        clearTimeout(timer);
        console.log(`[web-tools] ${op}${typeof on === 'boolean' ? ' on=' + on : ''}${typeof every === 'boolean' ? ' every=' + every : ''} 结果=`, ok, note ?? '');
        resolve(ok);
      };
      const onTitle = (_ev: Electron.Event, title: string): void => {
        if (!title.startsWith('wb:')) return;
        const val = title.slice(3);
        finish(val === 'true', val === 'true' ? undefined : val);
      };
      const timer = setTimeout(() => finish(false, 'timeout'), 6000);
      wc.on('page-title-updated', onTitle);
      let url = `chrome-extension://${this.builtinExtId}/web-tools-bridge.html?op=${op}`;
      if (op === 'set' || op === 'skill' || op === 'mem') url += '&on=' + (on ? '1' : '0');
      else if (op === 'sa' || op === 'ws') url += '&first=' + (on ? '1' : '0') + '&every=' + (every ? '1' : '0');
      void wc.loadURL(url);
    });
  }

  /** 通用读取通道（同 doWebToolsOp，返回 "first,every" 类结果）：用于读取 skill / web tool 状态。 */
  private doWebToolsOpRaw(op: 'saget' | 'wsget'): Promise<{ first: boolean; every: boolean }> {
    return (async () => {
      const wc = await this.ensureWebToolsBridge();
      if (!wc) return { first: true, every: true };
      return new Promise<{ first: boolean; every: boolean }>((resolve) => {
        let settled = false;
        const finish = (v: { first: boolean; every: boolean }): void => {
          if (settled) return;
          settled = true;
          wc.removeListener('page-title-updated', onTitle);
          clearTimeout(timer);
          resolve(v);
        };
        const onTitle = (_ev: Electron.Event, title: string): void => {
          if (!title.startsWith('wb:')) return;
          const s = title.slice(3);
          const m = /^(\d),(\d)$/.exec(s);
          finish(m ? { first: m[1] === '1', every: m[2] === '1' } : { first: true, every: true });
        };
        const timer = setTimeout(() => finish({ first: true, every: true }), 6000);
        wc.on('page-title-updated', onTitle);
        void wc.loadURL(`chrome-extension://${this.builtinExtId}/web-tools-bridge.html?op=saget`);
      });
    })();
  }

  private onSidebarHostResize = (): void => {
    if (this.sidebarLayoutTimer) clearTimeout(this.sidebarLayoutTimer);
    // 与主窗口 chat relayout（0ms 防抖）同一 tick 布局：主窗口先铺满全宽、侧边栏紧接着把 chat
    // 压回右侧剩余宽度，本次事件内侧边栏布局后执行即获胜，避免两者以不同时刻交替执行导致左右闪卡。
    this.sidebarLayoutTimer = setTimeout(() => this.applySidebarLayout(), 0);
  };

  /** 计算并应用侧边栏 + 压缩后 chat 视图边界。 */
  private applySidebarLayout(): void {
    const host = this.sidebarHost;
    const view = this.sidebarView;
    if (!host || host.isDestroyed() || !view || view.webContents.isDestroyed()) return;
    const { width, height } = host.getContentBounds();
    if (width <= 0 || height <= 0) return;
    const pane = Math.min(this.SIDEPANEL_WIDTH, Math.max(160, width - 160)); // 给 chat 保留至少 160px
    const top = TITLEBAR_HEIGHT;
    const bottom = Math.max(0, height - top);
    const chatW = Math.max(0, width - pane);
    // 冗余守卫：布局值未变化时直接返回，避免与主窗口 relayout 互踢时无限互相触发（刷日志/无谓开销）。
    const prev = this.lastSidebarLayout;
    if (prev && prev.top === top && prev.bottom === bottom && prev.pane === pane && prev.chatW === chatW) {
      return;
    }
    view.setBounds({ x: width - pane, y: top, width: pane, height: bottom });
    // 记录侧边栏预留宽度，主窗口后续 chat relayout 据此压缩，避免 resize 时铺满全宽产生横跳。
    setSidebarPane(host, pane);
    const chat = this.getMainWin?.()?.view;
    if (chat && !chat.webContents.isDestroyed()) {
      chat.setBounds({ x: 0, y: top, width: chatW, height: bottom });
    }
    this.lastSidebarLayout = { top, bottom, pane, chatW };
  }

  /** 记录侧边栏加载与控制台事件（自证 React 渲染）。 */
  private attachSidepanelLogging(view: Electron.WebContentsView): void {
    const clogPath = path.join(app.getPath('userData'), 'dspp-sidepanel.log');
    const clog = (line: string): void => {
      try {
        fs.appendFileSync(clogPath, '[' + new Date().toISOString() + '] ' + line + '\n', 'utf-8');
      } catch {
        /* 忽略 */
      }
    };
    view.webContents.on('did-fail-load', (_e, code, desc, url) => clog('FAIL ' + code + ' ' + desc + ' ' + url));
    view.webContents.on('did-finish-load', () => clog('FINISH ' + view.webContents.getURL()));
    view.webContents.on('console-message', (_e, a, b, c, d) => {
      if (a && typeof a === 'object') {
        const x = a as { level?: number | string; message?: string; lineNumber?: number; sourceId?: string };
        clog('CONSOLE[' + String(x.level ?? '') + '] ' + String(x.message ?? '') + ' @ ' + (x.sourceId ?? '') + ':' + (x.lineNumber ?? ''));
      } else {
        clog('CONSOLE[' + String(a) + '] ' + String(b) + ' @ ' + String(d) + ':' + String(c));
      }
    });
  }

  // ---------------- 内部 ----------------

  private getLoaded(id: string): Extension | null {
    return session.defaultSession.getAllExtensions().find((e) => e.id === id) || null;
  }

  private async loadStore(): Promise<void> {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = fs.readFileSync(this.storePath, 'utf-8').replace(/^\uFEFF/, '');
      const data = JSON.parse(raw) as { plugins?: InstalledPlugin[]; pinned?: unknown; builtinEnabled?: unknown };
      if (Array.isArray(data.plugins)) {
        this.installed.clear();
        for (const p of data.plugins) {
          if (!p || typeof p.path !== 'string') continue;
          const id = this.idFromDir(p.path);
          if (id) this.installed.set(id, { path: p.path, enabled: !!p.enabled });
        }
      }
      this.pinned.clear();
      if (Array.isArray(data.pinned)) {
        for (const id of data.pinned) if (typeof id === 'string') this.pinned.add(id);
      }
      this.builtinEnabled = data.builtinEnabled === true;
    } catch (e) {
      console.error('[ExtensionManager] 读取插件清单失败', e);
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const plugins = Array.from(this.installed.values());
      const pinned = Array.from(this.pinned);
      const builtinEnabled = this.builtinEnabled;
      fs.writeFileSync(this.storePath, JSON.stringify({ schemaVersion: 1, plugins, pinned, builtinEnabled }, null, 2), 'utf-8');
    } catch (e) {
      console.error('[ExtensionManager] 保存插件清单失败', e);
    }
  }

  // ---------------- 固定到工具栏 ----------------

  /** 某插件是否内置（内置的固定按钮不在 Electron 里弹新窗口，改由宿主在网页内呼出侧边栏）。 */
  public isBuiltin(id: string | null | undefined): boolean {
    return !!id && id === this.builtinShowId;
  }

  /** 内置 DeepSeek++ 插件当前是否启用（关闭时断开一切基于它的功能）。 */
  public isBuiltinEnabled(): boolean {
    return this.builtinEnabled === true;
  }

  /** 内置插件的 Electron 真实 id（仅在其已加载时存在），供停用时移除运行时。 */
  private getBuiltinLoadedId(): string | null {
    const ext = session.defaultSession.getAllExtensions().find((e) => this.isBuiltinPath(e.path));
    return ext ? ext.id : null;
  }

  /** 固定/取消固定某插件到窗口栏（内置插件同样可固定，点击打开其入口页）。 */
  public async setPinned(id: string, pinned: boolean): Promise<void> {
    if (pinned) this.pinned.add(id);
    else this.pinned.delete(id);
    await this.saveStore();
  }

  /** 当前固定的插件列表（供标题栏渲染按钮）。内置插件已关闭时不再显示（保留固定标记，重开自动恢复）。 */
  public async getPinned(): Promise<{ id: string; name: string; iconPath: string | null }[]> {
    const all = await this.list();
    return all
      .filter((p) => this.pinned.has(p.id))
      .filter((p) => !(this.isBuiltin(p.id) && !this.isBuiltinEnabled()))
      .map((p) => ({ id: p.id, name: p.name, iconPath: p.iconPath }));
  }

  /** 打开某插件的入口页（side_panel / options / action popup / 缺省 index.html）。返回是否成功。
   *  内置插件不走这里（由宿主在网页内呼出侧边栏），返回 false。 */
  public async openExtensionPage(id: string): Promise<boolean> {
    if (this.isBuiltin(id)) return false;
    const rec = this.installed.get(id) || null;
    const ext = this.getLoaded(id);
    const dir = rec?.path || ext?.path || '';
    if (!dir) return false;
    const rel = this.readManifestEntryPage(dir);
    if (!rel) return false;
    const pagePath = path.join(dir, rel);
    if (!fs.existsSync(pagePath)) return false;

    const win = new BrowserWindow({
      width: 900,
      height: 680,
      title: `${this.readManifestName(dir)} - 插件`,
      backgroundColor: '#ffffff',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // 扩展页面以 file:// 加载时，其内部 ES module/worker 受 file 同源限制；
        // 关闭 webSecurity 以便在 Electron 内正常加载未打包的扩展静态资源。
        webSecurity: false,
      },
    });
    // 跳过无头模式/外部环境异常：正常加载即可
    void win.loadFile(pagePath);
    return true;
  }

  /** 读取扩展 manifest 指定的默认入口页。 */
  private readManifestEntryPage(dir: string): string | null {
    const m = this.readManifest(dir);
    if (!m) return null;
    const cands: string[] = [];
    const sp = m['side_panel'] as { default_path?: string } | undefined;
    if (sp?.default_path) cands.push(sp.default_path);
    const opt = m['options_ui'] as { page?: string } | undefined;
    if (opt?.page) cands.push(opt.page);
    const action = m['action'] as { default_popup?: string } | undefined;
    if (action?.default_popup) cands.push(action.default_popup);
    cands.push('index.html');
    for (const c of cands) {
      if (c && fs.existsSync(path.join(dir, c))) return c;
    }
    return null;
  }

  /** 从扩展目录推断其 id（读 manifest 的 key，或按路径 hash 兜底，便于持久化定位）。 */
  private idFromDir(dir: string): string {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) as { key?: string };
      if (manifest && manifest.key) return `man-${manifest.key.slice(0, 24)}`;
    } catch {
      /* 忽略 */
    }
    return `dir-${this.hash(dir)}`;
  }

  private hash(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(16);
  }

  private readManifest(dir: string): Record<string, unknown> | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private readManifestName(dir: string): string {
    const m = this.readManifest(dir);
    return (m?.name as string) || path.basename(dir);
  }

  private readManifestVersion(dir: string): string {
    const m = this.readManifest(dir);
    return (m?.version as string) || '?';
  }

  private readManifestIcon(dir: string): string | null {
    const m = this.readManifest(dir);
    if (!m || !m.icons) return null;
    try {
      const icons = m.icons as Record<string, string>;
      const sizes = Object.keys(icons).map(Number).filter((n) => !Number.isNaN(n));
      if (sizes.length === 0) return null;
      sizes.sort((a, b) => a - b);
      const rel = icons[String(sizes[sizes.length - 1])] || icons[String(sizes[0])];
      const abs = path.resolve(dir, rel);
      return fs.existsSync(abs) ? abs : null;
    } catch {
      return null;
    }
  }

  private resolveIcon(ext: Extension): string | null {
    try {
      const manifest = ext.manifest as { icons?: Record<string, string> } | undefined;
      if (!manifest || !manifest.icons) return null;
      const sizes = Object.keys(manifest.icons).map(Number).filter((n) => !Number.isNaN(n));
      if (sizes.length === 0) return null;
      sizes.sort((a, b) => a - b);
      const rel = manifest.icons[String(sizes[sizes.length - 1])];
      const abs = path.resolve(ext.path, rel);
      return fs.existsSync(abs) ? abs : null;
    } catch {
      return null;
    }
  }
}