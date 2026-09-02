/**
 * ExtensionHost：DeepSeek++（MV3 扩展）的 Electron 宿主。
 *
 * 背景：DeepSeek++ 在 Electron 里作为 MV3 扩展加载时，其 background service worker
 * 注册失败（Electron 不支持），导致它注入页面的 content script 在调用 chrome.* 时
 * 拿不到后台、请求被挂起 → 发消息慢；token/用量也因后台缺失而读不到。
 *
 * 本模块目标：不依赖 Electron 的扩展运行时，改由本软件充当它的宿主：
 *  - 主进程侧实现 chrome 兼容语义（当前：chrome.storage 文件持久化 + chrome.runtime 消息总线骨架）；
 *  - 后续由页面侧的 chrome 注入 + 本进程后台 dispatch 补齐消息应答与 token 统计。
 *
 * 设计上保持与 DeepSeek++ 消息协议对齐的扩展点（后台 handler 在后续里程碑接入）。
 */
import { app, ipcMain, WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '../ipc/channels';

/** chrome.runtime 消息信封，与 DeepSeek++ 的运行时消息承载解耦（保留原结构透传）。 */
interface RuntimeEnvelope {
  channel?: string;
  type?: string;
  payload?: unknown;
  [key: string]: unknown;
}

/** 后台 handler：处理来自页面 content 的消息并返回应答（或 void）。 */
type RuntimeHandler = (msg: RuntimeEnvelope, sender: WebContents) => RuntimeEnvelope | void | Promise<RuntimeEnvelope | void>;

interface StorageArea {
  data: Record<string, unknown>;
}

/** usage 累计记录（来自 DeepSeek++ core/usage/types）。 */
interface UsageTurnRecord {
  id: string;
  recordedAt: number;
  day: string;
  source: string;
  chatSessionId: string | null;
  assistantMessageId: number | null;
  modelType: string | null;
  totalTokens: number;
  tokenSource: string;
  tps: number;
  speedSource: string;
  elapsedMs: number;
  messageCount: number;
}

interface UsageSummary {
  rangeDays: number;
  generatedAt: number;
  totalTokens: number;
  sessionCount: number;
  messageCount: number;
  turnCount: number;
  activeDays: number;
  currentStreak: number;
  serverTokenRecordCount: number;
  mostUsedModel: unknown;
  days: unknown[];
  heatmap: unknown[];
  modelUsage: unknown[];
  models?: unknown[];
}

/** DeepSeek++ Memory 记录（本地持久化，ms 时间戳）。 */
type DsppMemory = {
  id?: number;
  syncId: string;
  scope: 'global' | 'project';
  projectId?: string;
  type: 'user' | 'feedback' | 'topic' | 'reference';
  name: string;
  content: string;
  description: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  lastAccessedAt: number;
};

/** DeepSeek++ SystemPromptPreset（本地持久化，ms 时间戳）。 */
type DsppPreset = {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

/** DeepSeek++ 收藏项（SavedItem），本地 JSON 持久化。 */
type DsppSavedItem = {
  id: string;
  syncId: string;
  kind: 'snippet' | 'bookmark';
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

/** DeepSeek++ 项目上下文（ProjectContextState），本地 JSON 持久化。 */
type DsppProject = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
};

type DsppProjectConversation = {
  conversationId: string;
  projectId: string;
  title: string;
  url: string;
  addedAt: number;
  lastSeenAt: number;
};

type DsppProjectState = {
  schemaVersion: number;
  projects: DsppProject[];
  conversations: DsppProjectConversation[];
  pendingProjectId: string | null;
  files: unknown[];
  activeProjectId: string | null;
  activeFileIds: string[];
};

/** DeepSeek++ 场景配置（ScenarioConfig）。 */
type DsppScenario = {
  id: string;
  label: string;
  template: string;
  builtIn: boolean;
  enabled: boolean;
};

export class ExtensionHost {
  /** 按扩展 id(或区) 隔离的 storage.local 数据。 */
  private localArea: StorageArea = { data: {} };
  private storePath = path.join(app.getPath('userData'), 'ext-host-storage.json');
  private loaded = false;
  private runtimeHandlers: Map<string, RuntimeHandler> = new Map();
  /** 广播"后台→指定页面 content"的消息。 */
  private tabListeners = new Map<number, Set<(msg: RuntimeEnvelope) => void>>();
  /** Shell Local 是否启用（任务模式开启= true，普通模式= false）。影响 GET_MCP_SERVERS 是否把本地工具暴露给模型。 */
  private shellLocalOn = false;
  /** 普通模式「记忆提示词」是否注入（默认开，可由下拉普通模式旁的「记忆功能」关闭，也可经主进程 setMemoryOn 设置）。 */
  private memoryOn = true;
  /** skill 自动激活（任务模式开=true 首条+每条都激活；普通/增强=false）。 */
  private skillAutoOn = false;
  /** 与 background.js SW 一致的 skill 自动激活配置存储键。 */
  private static readonly SKILL_AUTO_KEY = 'deepseek_pp_skill_auto_activation';

  /** 设置/读取 Shell Local 启用状态（任务模式开关）。 */
  public setShellLocalEnabled(v: boolean): void {
    this.shellLocalOn = v;
  }
  public getShellLocalEnabled(): boolean {
    return this.shellLocalOn;
  }
  /** 设置普通模式「记忆提示词」是否注入。 */
  public setMemoryOn(v: boolean): void {
    this.memoryOn = v;
  }
  public getMemoryOn(): boolean {
    return this.memoryOn;
  }
  /** 任务模式联动 skill 自动激活：true=首条+每条都激活（并写入 SW 存储），false=都关。 */
  public setSkillAutoEnabled(v: boolean): void {
    this.setSkillAutoFull(v, v);
  }
  public getSkillAutoEnabled(): boolean {
    return this.skillAutoOn;
  }
  /** 任务模式「自动匹配skill」：按总开关门控后的两个子项（首条/每条）分别写入 SW 存储，让实际匹配生效。 */
  public setSkillAutoFull(first: boolean, every: boolean): void {
    this.skillAutoOn = first || every;
    void this.setStoreValue(ExtensionHost.SKILL_AUTO_KEY, { firstMessage: first, everyMessage: every });
  }
  public getSkillAutoFull(): { firstMessage: boolean; everyMessage: boolean } {
    const cur = (this.localArea.data[ExtensionHost.SKILL_AUTO_KEY] ?? {}) as Record<string, unknown>;
    return { firstMessage: cur.firstMessage !== false, everyMessage: cur.everyMessage !== false };
  }
  /** 增强搜索「网页工具」：统一设置 web_search / web_fetch（写入宿主 storage，保持与插件侧边栏同源）。 */
  public setWebToolsAll(search: boolean, fetch: boolean): void {
    const KEY = 'deepseek_pp_web_tool_settings';
    const cur = (this.localArea.data[KEY] ?? {}) as Record<string, unknown>;
    this.setLocal({ [KEY]: { ...cur, web_search: search, web_fetch: fetch } });
  }
  /** 读取网页工具当前状态（与插件侧边栏同源，读宿主 storage）。 */
  public getWebToolsState(): { web_search: boolean; web_fetch: boolean } {
    return this.getWebToolSettings();
  }
  /** 同步写 SW 存储指定键（保留 codec 兼容：多数读取端做 vC()/normalize 兜底，写对象即可）。 */
  private async setStoreValue(key: string, value: unknown): Promise<void> {
    try {
      this.setLocal({ [key]: value });
    } catch (e) {
      console.error('[ExtensionHost] setStoreValue 失败', key, e);
    }
  }

  constructor() {
    this.load();
  }

  /** 加载/保存持久化的 storage。 */
  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf-8')) as { local?: Record<string, unknown> };
        this.localArea.data = (raw && typeof raw.local === 'object' && raw.local) || {};
      }
    } catch (e) {
      console.error('[ExtensionHost] 读取 storage 失败', e);
    }
    this.loaded = true;
    // 预置 DeepSeek++ 宠物开关：默认开启，让 content 在 chat 页渲染小鲸鱼宠物（端上可见的插件活体）。
    if (this.localArea.data['deepseek_pp_pet'] === undefined) {
      this.localArea.data['deepseek_pp_pet'] = {
        enabled: true,
        position: 'bottom-right',
        size: 132,
        opacity: 0.96,
        motion: true,
      };
    }
    // 预置悬浮聊天球开关：默认开启（与 core/floating-chat 的「未显式关闭即启用」语义一致），
    // 保证注入 floating-chat.js 后悬浮球直接出现，无需用户先手动打开。
    if (this.localArea.data['deepseek_pp_floating_chat_enabled'] === undefined) {
      this.localArea.data['deepseek_pp_floating_chat_enabled'] = true;
    }
    // 预置搜索互联网/获取网页开关：默认全部开启（用户可在插件侧边栏 ⚙️ 工具 或聊天页「增强搜索」展开框调整）。
    if (this.localArea.data['deepseek_pp_web_tool_settings'] === undefined) {
      this.localArea.data['deepseek_pp_web_tool_settings'] = { web_search: true, web_fetch: true };
    }
    // 预置 skill 自动激活（首条/每条）：默认全部开启，供「任务模式」展开框与插件侧边栏 Skill 页显示一致。
    if (this.localArea.data['deepseek_pp_skill_auto_activation'] === undefined) {
      this.localArea.data['deepseek_pp_skill_auto_activation'] = { firstMessage: true, everyMessage: true };
    }
    this.persistLocal();
  }

  private persistLocal(): void {
    try {
      if (this.loaded) {
        fs.writeFileSync(this.storePath, JSON.stringify({ local: this.localArea.data }, null, 2), 'utf-8');
      }
    } catch (e) {
      console.error('[ExtensionHost] 保存 storage 失败', e);
    }
  }

  /** 读取网页搜索工具开关（storage 为唯一真源；缺省回退默认值）。 */
  private getWebToolSettings(): { web_search: boolean; web_fetch: boolean } {
    const cur = (this.localArea.data['deepseek_pp_web_tool_settings'] ?? {}) as Record<string, unknown>;
    return {
      web_search: typeof cur.web_search === 'boolean' ? cur.web_search : true,
      web_fetch: typeof cur.web_fetch === 'boolean' ? cur.web_fetch : true,
    };
  }

  /** 更新单个网页搜索工具开关并持久化（与 UI 开关双向同步）。 */
  private setWebToolSetting(payload: unknown): { ok: true } {
    const p = (payload && typeof payload === 'object' ? payload : {}) as { name?: unknown; enabled?: unknown };
    if (typeof p.name !== 'string' || typeof p.enabled !== 'boolean') return { ok: true };
    const cur = (this.localArea.data['deepseek_pp_web_tool_settings'] ?? {}) as Record<string, unknown>;
    this.setLocal({ deepseek_pp_web_tool_settings: { ...cur, [p.name]: p.enabled } });
    return { ok: true };
  }

  // ---------------- chrome.storage.local ----------------

  /** 记录 storage 访问的 key（用于盘点 content 依赖的配置）。 */
  private traceStorage(op: string, keys: unknown): void {
    try {
      const logPath = path.join(app.getPath('userData'), 'dspp-storage.log');
      fs.appendFileSync(logPath, '[' + new Date().toISOString() + '] ' + op + ' ' + JSON.stringify(keys) + '\n', 'utf-8');
    } catch {
      /* 忽略 */
    }
  }

  getLocal(keys?: string | string[]): Record<string, unknown> {
    this.traceStorage('GET', keys);
    const d = this.localArea.data;
    if (keys === undefined) return { ...d };
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (k in d) out[k] = d[k];
    return out;
  }

  setLocal(values: Record<string, unknown>): void {
    this.traceStorage('SET', values ? Object.keys(values) : []);
    for (const [k, v] of Object.entries(values)) this.localArea.data[k] = v;
    this.persistLocal();
  }

  removeLocal(keys: string | string[]): void {
    this.traceStorage('REMOVE', keys);
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) delete this.localArea.data[k];
    this.persistLocal();
  }

  // ---------------- chrome.runtime 消息总线 ----------------

  /** 注册后台 handler（DeepSeek++ 各业务域，后续里程碑接入）。 */
  public on(domain: string | undefined, handler: RuntimeHandler): void {
    this.runtimeHandlers.set(domain ?? '*', handler);
  }

  /**
   * 内置 Shell Local MCP server 记录（GET_MCP_SERVERS 返回）。
   * 结构对齐插件 mcp-tools-controller 的 codec（version:1、status、execution、allowlist 等均为必填合法枚举），
   * 供聊天注入脚本把 python_exec / shell_status 等本地工具投影给模型。
   */
  private shellLocalServerRecord(): Record<string, unknown> {
    const now = Date.now();
    const on = this.shellLocalOn;
    return {
      version: 1,
      id: 'shell-local',
      displayName: 'Shell Local',
      // 任务模式开启才启用（普通模式关闭 shell local）。关闭时模型看不到本地工具，MCP 页显示为禁用。
      enabled: on,
      transport: { kind: 'native_messaging', nativeHost: 'com.deepseek_pp.shell' },
      headers: [],
      secrets: [],
      timeouts: { connectMs: 5000, requestMs: 120000, discoveryMs: 10000 },
      limits: { maxResultBytes: 128000, maxToolCount: 8 },
      allowlist: {
        mode: 'allow',
        // 打开 Shell Local 时默认所有工具可用（用户指定：shell local 开启即全开）。
        toolNames: [
          'shell_exec', 'shell_status',
          'python_status', 'python_exec', 'python_pip_install', 'python_pip_status',
          'local_skill_preview', 'local_folder_pick',
          'local_file_stat', 'local_file_read', 'local_file_write',
        ],
      },
      execution: { mode: 'auto', enabled: on },
      status: on ? 'unknown' : 'disabled',
      lastConnectedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** 页面 content script 发来的消息：按命令名分发到后台 handler 并返回应答。
   * 命令协议来自 DeepSeek++ core/messaging/background-runtime-contracts.ts（信封 {type,payload}）。 */
  public async handleRuntimeMessage(msg: RuntimeEnvelope, sender: WebContents): Promise<unknown> {
    const type = typeof msg?.type === 'string' ? msg.type : '';
    this.traceCommand(type, (msg as { payload?: unknown }).payload);
    if (!type) {
      return { ok: false, error: 'runtime_message_invalid' };
    }
    try {
      switch (type) {
        // ---- usage 域（core/usage）----
        case 'RECORD_USAGE_TURN':
          return this.recordUsageTurn((msg as { payload?: unknown }).payload);
        case 'GET_USAGE_SUMMARY':
          return this.getUsageSummary((msg as { payload?: { rangeDays?: number } }).payload);
        case 'CLEAR_USAGE_STATS':
          return this.clearUsageStats();
        // ---- content 启动时请求的只读域（返回类型正确缺省；关键不返回 null，content 会把 null 当异常）----
        case 'GET_TOOL_DESCRIPTORS':
          return [];
        case 'GET_MEMORIES':
        case 'GET_MEMORY_BY_ID':
        case 'SAVE_MEMORY':
        case 'UPDATE_MEMORY':
        case 'DELETE_MEMORY':
          return this.handleMemory(type, (msg as { payload?: unknown }).payload);
        case 'GET_SKILLS':
          return [];
        case 'GET_PRESETS':
        case 'GET_ACTIVE_PRESET':
        case 'SAVE_PRESET':
        case 'DELETE_PRESET':
        case 'SET_ACTIVE_PRESET':
          return this.handlePreset(type, (msg as { payload?: unknown }).payload);
        case 'GET_MODEL_TYPE':
          return { model: 'default' };
        case 'GET_PROMPT_INJECTION_SETTINGS':
          // memory：普通模式「记忆提示词」是否注入（默认开，可由下拉普通模式旁的「记忆功能」关闭）。
          return { memory: this.memoryOn, systemPrompt: true, presetCadence: 'default', forceLanguage: 'auto' };
        case 'GET_SKILL_AUTO_ACTIVATION_SETTINGS':
          // skill 自动激活：任务模式开启时 首条/每条 都激活；普通/增强均关。
          return { firstMessage: this.skillAutoOn, everyMessage: this.skillAutoOn };
        case 'GET_MCP_SERVERS':
          // 聊天注入脚本经此取 MCP 服务列表。任务模式开启才返回内置 Shell Local server，让本地工具
          // 投影给模型；普通模式不返回（彻底隐藏，模型看不到本地工具），避免仅靠 enabled:false 时
          // 模型端仍缓存旧工具描述符。
          return {
            version: 2,
            servers: this.shellLocalOn ? [this.shellLocalServerRecord()] : [],
            toolCaches: [],
          };
        case 'GET_MCP_TOOL_CACHE':
          // 尚无 SW 刷新回填的工具缓存；返回 null 表示“未发现”，SW 侧会触发对内置宿主的发现/刷新。
          return null;
        case 'GET_MCP_CAPABILITY_SETTINGS':
          return { version: 1, adaptiveMaxDirectTools: 8, adaptiveMaxPromptBytes: 24000, servers: {} };
        case 'GET_MCP_REQUEST_TIMEOUT':
          return { timeoutMs: 120000 };
        case 'GET_PLATFORM_CAPABILITIES':
          return {
            kind: 'browser_extension',
            name: 'WebExtension',
            capabilities: {
              storage: true,
              runtimeMessaging: true,
              downloads: false,
              filePicker: true,
              folderPicker: true,
              assetUrl: true,
              sidePanel: true,
              // Shell Local（python_exec 等）经 connectNative 桥接内置 LocalShellServer，
              // Electron 下已注入 connectNative shim 转发到 127.0.0.1:47901，故当作支持原生消息，
              // 否则插件会把 Shell Local 标为「未安装 Native Host」并禁用启用/测试。
              nativeMessaging: true,
              contextMenus: false,
              alarms: false,
              tabs: false,
              tabGroups: false,
              debugger: false,
              browserControl: false,
              accessibilityTree: false,
            },
          };
        case 'GET_WEB_TOOL_SETTINGS':
          // 从 storage 读取（与 SET_WEB_TOOL_SETTING 写入的 key 一致），保证 UI 开关与磁盘文件同源。
          return this.getWebToolSettings();
        case 'SET_WEB_TOOL_SETTING':
          return this.setWebToolSetting((msg as { payload?: unknown }).payload);
        case 'GET_BROWSER_CONTROL_SETTINGS':
          return {
            enabled: false,
            targetTabId: null,
            includeSnapshotAfterActions: true,
            maxSnapshotNodes: 12000,
            maxSnapshotTextBytes: 2000000,
          };
        case 'GET_BROWSER_CONTROL_STATE':
          return { supported: false, enabled: false, attached: false, targetTabId: null, target: null, targets: [], error: null };
        case 'GET_SYNC_CONFIG':
          return null;
        case 'GET_VOICE_SETTINGS':
          return { enabled: false, voiceId: null, speed: 1 };
        case 'GET_VOICE_CAPABILITIES':
          return { supported: false, voices: [] };
        case 'GET_PROJECT_CONTEXT_STATE':
          return this.getProjectState();
        case 'CREATE_PROJECT_CONTEXT':
          return this.createProject((msg as { payload?: unknown }).payload);
        case 'UPDATE_PROJECT_CONTEXT':
          return this.updateProject((msg as { payload?: unknown }).payload);
        case 'DELETE_PROJECT_CONTEXT':
          return this.deleteProject((msg as { payload?: unknown }).payload);
        case 'ADD_CONVERSATION_TO_PROJECT':
          return this.addProjectConversation((msg as { payload?: unknown }).payload);
        case 'REMOVE_CONVERSATION_FROM_PROJECT':
          return this.removeProjectConversation((msg as { payload?: unknown }).payload);
        case 'SET_PENDING_PROJECT_CONTEXT':
          return this.setPendingProject((msg as { payload?: unknown }).payload);
        case 'GET_CURRENT_DEEPSEEK_CONVERSATION':
          return { ok: false, conversation: null };
        case 'GET_CONFIG':
          return { version: '1.14.0' };
        case 'WHATS_NEW_DISMISSED':
          return { ok: true };
        case 'GET_ARTIFACT':
          return { ok: false, error: 'artifact_not_found' };
        case 'GET_BACKGROUND':
          return { enabled: false };
        case 'GET_DEEPSEEK_THEME':
          return { theme: 'auto' };
        case 'GET_PET':
          return { enabled: false, position: 'bottom-right', size: 132, opacity: 0.96, motion: true };
        case 'SET_DEEPSEEK_THEME':
          return { ok: true };
        // ---- saved-items 域（core/saved-items，本地 JSON 持久化）----
        case 'GET_SAVED_ITEMS':
          return this.loadSavedItems();
        case 'SAVE_SAVED_ITEM':
          return this.saveSavedItem((msg as { payload?: unknown }).payload);
        case 'DELETE_SAVED_ITEM':
          return this.deleteSavedItem((msg as { payload?: unknown }).payload);
        // ---- scenarios 域（core/scenario，返回剧情组配置）----
        case 'SCENARIOS_UPDATED':
          return this.handleScenariosUpdated((msg as { payload?: unknown }).payload);
        // ---- 其余命令：读命令返回被 [' ]，写命令返回 {ok:true}，避免所有页面“操作失败 UNIMPLEMENTED” ----
        default: {
          console.warn('[ExtensionHost] 缺省应答 后台命令', type);
          if (/^(GET_|LIST_|PREVIEW_)/.test(type)) return [];
          return { ok: true };
        }
      }
    } catch (e) {
      console.error('[ExtensionHost] 处理运行时消息失败', type, e);
      return { ok: false, error: String((e as Error)?.message || e), command: type };
    }
  }

  /** 后台向某页面 content 主动推送消息（模拟 chrome.tabs.sendMessage）。 */
  public sendToWebContents(wc: WebContents, msg: RuntimeEnvelope): void {
    if (!wc || wc.isDestroyed()) return;
    const set = this.tabListeners.get(wc.id) || new Set();
    for (const cb of set) {
      try {
        cb(msg);
      } catch {
        /* 忽略单个监听器异常 */
      }
    }
    // 页面侧通过 window 事件桥接收；把推送落到页面
    try {
      wc.executeJavaScript(
        `(function () {
          const ev = new CustomEvent('__dspp_push', { detail: ${JSON.stringify(msg).replace(/</g, '\\u003c')} });
          window.dispatchEvent(ev);
          return true;
        })()`
      ).catch(() => {});
    } catch {
      /* 忽略 */
    }
  }

  // ---------------- memory 域（对应 core 的 Memory，本地 JSON 持久化） ----------------

  private memories: DsppMemory[] | null = null;
  private memoryNextId = 1;

  private memoriesPath(): string {
    return path.join(app.getPath('userData'), 'dspp-memories.json');
  }

  private loadMemories(): void {
    if (this.memories) return;
    try {
      const raw = fs.readFileSync(this.memoriesPath(), 'utf-8');
      const obj = JSON.parse(raw);
      const arr: DsppMemory[] = Array.isArray(obj?.items) ? (obj.items as DsppMemory[]) : [];
      this.memories = arr;
      this.memoryNextId = typeof obj?.nextId === 'number' ? obj.nextId : arr.length + 1;
    } catch {
      this.memories = [];
    }
  }

  private persistMemories(): void {
    try {
      fs.writeFileSync(
        this.memoriesPath(),
        JSON.stringify({ nextId: this.memoryNextId, items: this.memories }, null, 2),
        'utf-8'
      );
    } catch {
      /* 忽略 */
    }
  }

  private handleMemory(type: string, payload: unknown): unknown {
    this.loadMemories();
    switch (type) {
      case 'GET_MEMORIES':
        return [...this.memories!];
      case 'GET_MEMORY_BY_ID': {
        const id = (payload as { id?: number })?.id;
        return this.memories!.find((m) => m.id === id) ?? null;
      }
      case 'SAVE_MEMORY': {
        const p = (payload || {}) as Partial<DsppMemory>;
        const now = Date.now();
        const m: DsppMemory = {
          id: this.memoryNextId++,
          syncId: p.syncId ?? 'local-' + this.memoryNextId,
          scope: p.scope ?? 'global',
          projectId: p.projectId,
          type: p.type ?? 'user',
          name: p.name ?? '',
          content: p.content ?? '',
          description: p.description ?? '',
          tags: Array.isArray(p.tags) ? p.tags : [],
          pinned: !!p.pinned,
          createdAt: now,
          updatedAt: now,
          accessCount: 0,
          lastAccessedAt: now,
        };
        this.memories!.push(m);
        this.persistMemories();
        return m;
      }
      case 'UPDATE_MEMORY': {
        const p = payload as Partial<DsppMemory>;
        const idx = this.memories!.findIndex((m) => m.id === p.id);
        if (idx < 0) return { ok: false, error: 'not_found' };
        this.memories![idx] = { ...this.memories![idx], ...p, updatedAt: Date.now() };
        this.persistMemories();
        return { ok: true };
      }
      case 'DELETE_MEMORY': {
        const id = (payload as { id?: number })?.id;
        const before = this.memories!.length;
        this.memories = this.memories!.filter((m) => m.id !== id);
        if (this.memories!.length !== before) this.persistMemories();
        return { ok: true };
      }
      default:
        return { ok: false, error: 'UNIMPLEMENTED', command: type };
    }
  }

  // ---------------- 预设域（SystemPromptPreset，本地 JSON 持久化） ----------------

  private presets: DsppPreset[] | null = null;
  private activePresetId: string | null = null;

  // ---------------- saved-items / projects / scenarios（本地 JSON 持久化）----------------
  private savedItems: DsppSavedItem[] | null = null;
  private projectState: DsppProjectState | null = null;
  private scenarios: DsppScenario[] | null = null;

  private presetsPath(): string {
    return path.join(app.getPath('userData'), 'dspp-presets.json');
  }

  private loadPresets(): void {
    if (this.presets) return;
    try {
      const raw = fs.readFileSync(this.presetsPath(), 'utf-8');
      const obj = JSON.parse(raw);
      this.presets = Array.isArray(obj?.items) ? (obj.items as DsppPreset[]) : [];
      this.activePresetId = typeof obj?.activeId === 'string' ? (obj.activeId as string) : null;
    } catch {
      this.presets = [];
    }
  }

  private persistPresets(): void {
    try {
      fs.writeFileSync(
        this.presetsPath(),
        JSON.stringify({ activeId: this.activePresetId, items: this.presets }, null, 2),
        'utf-8'
      );
    } catch {
      /* 忽略 */
    }
  }

  private handlePreset(type: string, payload: unknown): unknown {
    this.loadPresets();
    switch (type) {
      case 'GET_PRESETS':
        return [...this.presets!];
      case 'GET_ACTIVE_PRESET':
        return this.presets!.find((p) => p.id === this.activePresetId) ?? null;
      case 'SAVE_PRESET': {
        const p = (payload || {}) as Partial<DsppPreset>;
        if (!p.id) p.id = 'preset-' + Date.now();
        const now = Date.now();
        const idx = this.presets!.findIndex((x) => x.id === p.id);
        const item: DsppPreset = {
          id: p.id,
          name: p.name ?? '',
          content: p.content ?? '',
          createdAt: idx >= 0 ? this.presets![idx].createdAt : now,
          updatedAt: now,
        };
        if (idx >= 0) this.presets![idx] = item;
        else this.presets!.push(item);
        this.persistPresets();
        return { ok: true };
      }
      case 'DELETE_PRESET': {
        const id = (payload as { id?: string })?.id;
        this.presets = this.presets!.filter((p) => p.id !== id);
        if (this.activePresetId === id) this.activePresetId = null;
        this.persistPresets();
        return { ok: true };
      }
      case 'SET_ACTIVE_PRESET': {
        const id = (payload as { id?: string | null })?.id ?? null;
        this.activePresetId = id;
        this.persistPresets();
        return { ok: true };
      }
      default:
        return { ok: false, error: 'UNIMPLEMENTED', command: type };
    }
  }

  // ---------------- saved-items 域（core/saved-items，本地 JSON 持久化） ----------------

  private savedItemsPath(): string {
    return path.join(app.getPath('userData'), 'dspp-saved-items.json');
  }

  private loadSavedItemsState(): void {
    if (this.savedItems) return;
    try {
      const raw = fs.readFileSync(this.savedItemsPath(), 'utf-8');
      const obj = JSON.parse(raw);
      this.savedItems = Array.isArray(obj?.items)
        ? (obj.items as DsppSavedItem[]).filter((x) => typeof x.id === 'string')
        : [];
    } catch {
      this.savedItems = [];
    }
  }

  private persistSavedItems(): void {
    try {
      fs.writeFileSync(this.savedItemsPath(), JSON.stringify({ schemaVersion: 1, items: this.savedItems }, null, 2), 'utf-8');
    } catch {
      /* 忽略 */
    }
  }

  private loadSavedItems(): DsppSavedItem[] {
    this.loadSavedItemsState();
    return [...this.savedItems!];
  }

  private saveSavedItem(payload: unknown): DsppSavedItem {
    this.loadSavedItemsState();
    const p = (payload || {}) as Partial<DsppSavedItem>;
    const now = Date.now();
    const id = typeof p.id === 'string' && p.id ? p.id : 'item-' + now + '-' + Math.random().toString(36).slice(2, 8);
    const idx = this.savedItems!.findIndex((x) => x.id === id);
    const item: DsppSavedItem = {
      id,
      syncId: typeof p.syncId === 'string' && p.syncId ? p.syncId : id,
      kind: p.kind === 'bookmark' ? 'bookmark' : 'snippet',
      title: String(p.title ?? ''),
      content: String(p.content ?? ''),
      tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
      createdAt: idx >= 0 ? this.savedItems![idx].createdAt : now,
      updatedAt: now,
    };
    if (idx >= 0) this.savedItems![idx] = item;
    else this.savedItems!.push(item);
    this.persistSavedItems();
    return item;
  }

  private deleteSavedItem(payload: unknown): { ok: true } {
    this.loadSavedItemsState();
    const id = (payload as { id?: string })?.id;
    if (typeof id === 'string') {
      this.savedItems = this.savedItems!.filter((x) => x.id !== id);
      this.persistSavedItems();
    }
    return { ok: true };
  }

  // ---------------- projects 域（core/project，本地 JSON 持久化） ----------------

  private projectsPath(): string {
    return path.join(app.getPath('userData'), 'dspp-projects.json');
  }

  private loadProjectState(): DsppProjectState {
    if (this.projectState) return this.projectState;
    try {
      const raw = fs.readFileSync(this.projectsPath(), 'utf-8');
      const obj = JSON.parse(raw) as DsppProjectState | null;
      this.projectState = {
        schemaVersion: 1,
        projects: Array.isArray(obj?.projects) ? obj.projects : [],
        conversations: Array.isArray(obj?.conversations) ? obj.conversations : [],
        pendingProjectId: obj && typeof obj.pendingProjectId === 'string' ? obj.pendingProjectId : null,
        files: Array.isArray(obj?.files) ? obj.files : [],
        activeProjectId: obj && typeof obj.activeProjectId === 'string' ? obj.activeProjectId : null,
        activeFileIds: Array.isArray(obj?.activeFileIds) ? obj.activeFileIds : [],
      };
    } catch {
      this.projectState = { schemaVersion: 1, projects: [], conversations: [], pendingProjectId: null, files: [], activeProjectId: null, activeFileIds: [] };
    }
    return this.projectState;
  }

  private persistProjectState(): void {
    try {
      fs.writeFileSync(this.projectsPath(), JSON.stringify(this.projectState, null, 2), 'utf-8');
    } catch {
      /* 忽略 */
    }
  }

  private getProjectState(): DsppProjectState {
    const s = this.loadProjectState();
    return {
      schemaVersion: 1,
      projects: s.projects,
      conversations: s.conversations,
      pendingProjectId: s.pendingProjectId,
      files: s.files,
      activeProjectId: s.activeProjectId,
      activeFileIds: s.activeFileIds,
    };
  }

  private createProject(payload: unknown): DsppProject {
    const s = this.loadProjectState();
    const p = (payload || {}) as { name?: unknown; description?: unknown; instructions?: unknown };
    const now = Date.now();
    const project: DsppProject = {
      id: crypto.randomUUID(),
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '未命名项目',
      description: String((p as { description?: unknown }).description ?? '').trim(),
      instructions: typeof p.instructions === 'string' ? p.instructions.trim() : '',
      createdAt: now,
      updatedAt: now,
    };
    s.projects.push(project);
    this.persistProjectState();
    return project;
  }

  private updateProject(payload: unknown): DsppProject | { ok: false; error: string } {
    const s = this.loadProjectState();
    const p = (payload || {}) as { projectId?: string; patch?: Record<string, unknown> };
    const project = s.projects.find((x) => x.id === p.projectId);
    if (!project) return { ok: false, error: 'project_not_found' };
    const patch = p.patch || {};
    if (typeof patch.name === 'string') project.name = patch.name.trim() || project.name;
    if (typeof patch.description === 'string') project.description = patch.description.trim();
    if (typeof patch.instructions === 'string') project.instructions = patch.instructions.trim();
    project.updatedAt = Date.now();
    this.persistProjectState();
    return { ...project };
  }

  private deleteProject(payload: unknown): { ok: true } {
    const s = this.loadProjectState();
    const id = (payload as { projectId?: string })?.projectId;
    if (typeof id === 'string') {
      s.projects = s.projects.filter((x) => x.id !== id);
      s.conversations = s.conversations.filter((x) => x.projectId !== id);
      if (s.pendingProjectId === id) s.pendingProjectId = null;
      this.persistProjectState();
    }
    return { ok: true };
  }

  private addProjectConversation(payload: unknown): { ok: true } {
    const s = this.loadProjectState();
    const p = (payload || {}) as { projectId?: string; conversation?: { conversationId?: string; title?: unknown; url?: unknown } };
    const project = s.projects.find((x) => x.id === p.projectId);
    if (!project) return { ok: true };
    const cid = String(p.conversation?.conversationId ?? '').trim();
    if (!cid) return { ok: true };
    const now = Date.now();
    const existing = s.conversations.find((x) => x.conversationId === cid);
    const title = typeof p.conversation?.title === 'string' && p.conversation.title.trim()
      ? p.conversation.title.trim()
      : (existing?.title ?? '对话');
    const conv: DsppProjectConversation = {
      conversationId: cid,
      projectId: project.id,
      title,
      url: String(p.conversation?.url ?? existing?.url ?? ''),
      addedAt: existing?.addedAt ?? now,
      lastSeenAt: now,
    };
    s.conversations = [...s.conversations.filter((x) => x.conversationId !== cid), conv];
    project.updatedAt = now;
    if (s.pendingProjectId === project.id) s.pendingProjectId = null;
    this.persistProjectState();
    return { ok: true };
  }

  private removeProjectConversation(payload: unknown): { ok: true } {
    const s = this.loadProjectState();
    const cid = (payload as { conversationId?: string })?.conversationId;
    if (typeof cid === 'string') {
      s.conversations = s.conversations.filter((x) => x.conversationId !== cid);
      this.persistProjectState();
    }
    return { ok: true };
  }

  private setPendingProject(payload: unknown): { ok: true } {
    const s = this.loadProjectState();
    const pid = (payload as { projectId?: string | null })?.projectId ?? null;
    s.pendingProjectId = pid;
    this.persistProjectState();
    return { ok: true };
  }

  // ---------------- scenarios 域（core/scenario，本地 JSON 持久化） ----------------

  private scenariosPath(): string {
    return path.join(app.getPath('userData'), 'dspp-scenarios.json');
  }

  private loadScenariosState(): DsppScenario[] {
    if (this.scenarios) return this.scenarios;
    try {
      const raw = fs.readFileSync(this.scenariosPath(), 'utf-8');
      const obj = JSON.parse(raw);
      this.scenarios = Array.isArray(obj?.items) ? (obj.items as DsppScenario[]) : [];
    } catch {
      this.scenarios = [];
    }
    return this.scenarios;
  }

  private persistScenarios(): void {
    try {
      fs.writeFileSync(this.scenariosPath(), JSON.stringify({ items: this.scenarios }, null, 2), 'utf-8');
    } catch {
      /* 忽略 */
    }
  }

  private handleScenariosUpdated(payload: unknown): { ok: true; scenarios: DsppScenario[] } {
    this.loadScenariosState();
    const op = (payload && typeof payload === 'object' ? payload : {}) as {
      operation?: string;
      scenario?: Partial<DsppScenario>;
      id?: string;
    };
    if (op.operation === 'add' && op.scenario) {
      const sc = op.scenario;
      this.scenarios!.push({
        id: sc.id ?? 'scenario-' + Date.now(),
        label: String(sc.label ?? ''),
        template: String(sc.template ?? ''),
        builtIn: !!sc.builtIn,
        enabled: sc.enabled === undefined ? true : !!sc.enabled,
      });
      this.persistScenarios();
    } else if (op.operation === 'update' && op.scenario && op.scenario.id) {
      const idx = this.scenarios!.findIndex((x) => x.id === op.scenario!.id);
      if (idx >= 0) {
        this.scenarios![idx] = { ...this.scenarios![idx], ...op.scenario };
        this.persistScenarios();
      }
    } else if (op.operation === 'delete' && op.id) {
      this.scenarios = this.scenarios!.filter((x) => x.id !== op.id);
      this.persistScenarios();
    }
    return { ok: true, scenarios: [...this.scenarios!] };
  }

  // ---------------- usage 域（对应 core/usage） ----------------

  /** 记录 content 发来的后台命令（到文件 + stdout），用于盘点需实现的命令域。 */
  private traceCommand(type: string, payload: unknown): void {
    const dir = app.getPath('userData');
    const logPath = path.join(dir, 'dspp-runtime.log');
    let summary = '';
    if (payload && typeof payload === 'object') {
      const keys = Object.keys(payload as Record<string, unknown>).slice(0, 6);
      summary = ' payloadKeys=' + keys.join(',');
    }
    const line = '[' + new Date().toISOString() + '] ' + type + summary + '\n';
    try {
      fs.appendFileSync(logPath, line, 'utf-8');
    } catch {
      /* 忽略 */
    }
  }

  private readUsageTurns(): UsageTurnRecord[] {
    const raw = this.localArea.data['usage.turns'];
    return Array.isArray(raw) ? (raw as UsageTurnRecord[]) : [];
  }

  private persistUsageTurns(turns: UsageTurnRecord[]): void {
    this.localArea.data['usage.turns'] = turns;
    this.persistLocal();
  }

  private dayKey(ts: number): string {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  /** 今日（自然日）累计 token 消耗。供「token 显示」悬浮块读取。
   * 插件 SW 把用量写进 Electron 原生的扩展 chrome.storage（Local Extension Settings/<id>/leveldb），
   * 宿主 localArea 拿不到。此方法直接解析其**活跃 journal**（WAL，未压缩，含最新写入）里的
   * WriteBatch，读出 `deepseek_pp_usage_turns_v1` 的数组值并汇总今天的 totalTokens。
   * 自包含、无依赖，可在任何机器上运行。 */
  public getTodayUsageTokens(logDebug = false): number {
    return this.getTokenStats(logDebug).today;
  }

  /** 今日累计 与 全部累计 token 消耗。供「token 显示」悬浮块及悬浮提示使用。
   * 数据源 = 插件 SW 的 Electron 原生 chrome.storage（Local Extension Settings/<id>/leveldb）：
   *   - 活跃 journal（.log，未压缩，含最新写入）；
   *   - 已压实合并的 .ldb（snappy 压缩，含历史快照）。
   * 同一 key 在多次写入/压实后会留下多份快照，取 totalTokens 总和最大的一份（最优=最新）计算。 */
  public getTokenStats(logDebug = false): { today: number; total: number } {
    const today = this.dayKey(Date.now());
    // 缓存：解析（尤其 .ldb + snappy）较重，仅当插件 usage 存储文件实际变化时重扫，
    // 避免每 3s 的轮询在唯一主进程里反复同步解压数 MB 的 leveldb，拖慢整个应用（含工具调用）。
    const mtime = this.usageSourceMaxMtime();
    if (this.tokenStatsCachedMtime === mtime && this.tokenStatsCached) {
      if (logDebug) {
        try {
          fs.appendFileSync(path.join(app.getPath('userData'), 'dspp-token.log'), `[${new Date().toISOString()}] today=${today} tokens=${this.tokenStatsCached.today} total=${this.tokenStatsCached.total} (cached)\n`, 'utf-8');
        } catch (e) { /* ignore */ }
      }
      return { ...this.tokenStatsCached };
    }
    const cands: unknown[] = [];
    try { const j = this.readPluginUsageJournal(); if (Array.isArray(j)) cands.push(j); } catch (e) { /* ignore */ }
    for (const v of this.readSstableUsageSnapshots()) cands.push(v);
    let bestTot = -1;
    let bestArr: unknown = [];
    for (const c of cands) {
      const tot = this.sumTokensTotal(c);
      if (tot > bestTot) { bestTot = tot; bestArr = c; }
    }
    const res = { today: this.sumTokensInDay(bestArr, today), total: this.sumTokensTotal(bestArr) };
    this.tokenStatsCached = res;
    this.tokenStatsCachedMtime = mtime;
    if (logDebug) {
      try {
        const logPath = path.join(app.getPath('userData'), 'dspp-token.log');
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] today=${today} tokens=${res.today} total=${res.total} cands=${cands.length} (scanned)\n`, 'utf-8');
      } catch (e) { /* ignore */ }
    }
    return res;
  }

  private tokenStatsCached: { today: number; total: number } | null = null;
  private tokenStatsCachedMtime = -1;

  /** 插件 usage 存储（Local Extension Settings 目录下 .log/.ldb）的最新修改时间；用于缓存判脏。 */
  private usageSourceMaxMtime(): number {
    try {
      const base = path.join(app.getPath('userData'), 'Local Extension Settings');
      if (!fs.existsSync(base)) return 0;
      let max = 0;
      for (const sd of fs.readdirSync(base).filter((n) => /^[a-z]{32}$/i.test(n))) {
        const dir = path.join(base, sd);
        try { if (!fs.statSync(dir).isDirectory()) continue; } catch (e) { continue; }
        for (const f of fs.readdirSync(dir)) {
          if (!/\.(ldb|log)$/.test(f)) continue;
          try { const m = fs.statSync(path.join(dir, f)).mtimeMs; if (m > max) max = m; } catch (e) { /* ignore */ }
        }
      }
      return max;
    } catch (e) {
      return 0;
    }
  }

  /** 读取插件扩展 storage 的 journal，返回解出的 usage 数组（找不到返回 undefined）。 */
  private readPluginUsageJournal(): unknown {
    try {
      const KEY = 'deepseek_pp_usage_turns_v1';
      const base = path.join(app.getPath('userData'), 'Local Extension Settings');
      if (!fs.existsSync(base)) return undefined;
      let bestJournals: { path: string; mtime: number }[] = [];
      const subdirs = fs.readdirSync(base).filter((n) => /^[a-z]{32}$/i.test(n));
      for (const sd of subdirs) {
        const dir = path.join(base, sd);
        try { if (!fs.statSync(dir).isDirectory()) continue; } catch (e) { continue; }
        for (const f of fs.readdirSync(dir)) {
          if (!/^\d+\.log$/.test(f)) continue;
          const p = path.join(dir, f);
          bestJournals.push({ path: p, mtime: fs.statSync(p).mtimeMs });
        }
      }
      bestJournals.sort((a, b) => b.mtime - a.mtime);
      for (const j of bestJournals) {
        const batches = this.parseLeveldbLog(fs.readFileSync(j.path));
        // 按写入顺序，取该 key 最后一次写入的数组
        let last: unknown;
        for (const batch of batches) {
          for (const rec of this.parseWriteBatch(batch)) {
            if (rec.key === KEY) last = rec.value;
          }
        }
        if (last !== undefined) return last;
      }
      return undefined;
    } catch (e) {
      return undefined;
    }
  }

  /** 解析 leveldb .log 文件，返回逻辑记录（每个 WriteBatch 的原始字节）。 */
  private parseLeveldbLog(buf: Buffer): Buffer[] {
    const BLOCK = 32768;
    const out: Buffer[] = [];
    let i = 0;
    let frag: Buffer[] = [];
    while (i + 7 <= buf.length) {
      const blockStart = Math.floor(i / BLOCK) * BLOCK;
      const inBlock = i - blockStart;
      const blockEnd = Math.min(buf.length, blockStart + BLOCK);
      if (inBlock + 7 > blockEnd - blockStart || i + 7 > buf.length) {
        i = blockStart + BLOCK; // 跳到下一块（块尾不足 7 字节按零填充）
        continue;
      }
      const length = buf.readUInt16LE(i + 4);
      const type = buf[i + 6];
      const dataStart = i + 7;
      if (length === 0) { i = blockStart + BLOCK; continue; }
      if (dataStart + length > buf.length) break;
      const data = buf.slice(dataStart, dataStart + length);
      i = dataStart + length;
      if (type === 1) out.push(data); // full
      else if (type === 2) frag = [data]; // first
      else if (type === 3) frag.push(data); // middle
      else if (type === 4) { frag.push(data); out.push(Buffer.concat(frag)); frag = []; } // last
    }
    return out;
  }

  /** 解析 WriteBatch 字节，返回 {key, value} 条目数组。 */
  private parseWriteBatch(batch: Buffer): { key: string; value: unknown }[] {
    const entries: { key: string; value: unknown }[] = [];
    if (batch.length < 12) return entries;
    const count = batch.readUInt32LE(8);
    let pos = 12;
    for (let n = 0; n < count && pos < batch.length; n++) {
      const type = batch[pos]; pos += 1;
      const keyLen = this.readVarintAt(batch, pos); if (keyLen === null) break; pos += keyLen.bytes;
      if (pos + keyLen.value > batch.length) break;
      const key = batch.slice(pos, pos + keyLen.value).toString('utf-8'); pos += keyLen.value;
      if (type === 1) {
        const valLen = this.readVarintAt(batch, pos); if (valLen === null) break; pos += valLen.bytes;
        if (pos + valLen.value > batch.length) break;
        const raw = batch.slice(pos, pos + valLen.value).toString('utf-8'); pos += valLen.value;
        try { entries.push({ key, value: JSON.parse(raw) }); } catch (e) { entries.push({ key, value: undefined }); }
      } else {
        entries.push({ key, value: undefined });
      }
    }
    return entries;
  }

  private readVarintAt(buf: Buffer, pos: number): { value: number; bytes: number } | null {
    let result = 0;
    let shift = 0;
    let p = pos;
    while (p < buf.length && shift < 35) {
      const b = buf[p]; p += 1;
      result |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return { value: result, bytes: p - pos };
      shift += 7;
    }
    return null;
  }

  /** 读取插件扩展 storage 的 .ldb（snappy 压缩的 SSTable），返回 key 的全部历史快照数组。 */
  private readSstableUsageSnapshots(): unknown[] {
    const out: unknown[] = [];
    try {
      const base = path.join(app.getPath('userData'), 'Local Extension Settings');
      if (!fs.existsSync(base)) return out;
      for (const sd of fs.readdirSync(base).filter((n) => /^[a-z]{32}$/i.test(n))) {
        const dir = path.join(base, sd);
        try { if (!fs.statSync(dir).isDirectory()) continue; } catch (e) { continue; }
        for (const f of fs.readdirSync(dir)) {
          if (!/\.ldb$/.test(f)) continue;
          try { out.push(...this.extractUsageSnapshotsFromSstable(fs.readFileSync(path.join(dir, f)))); } catch (e) { /* 单个文件失败跳过 */ }
        }
      }
    } catch (e) { /* 目录不可用则返回空 */ }
    return out;
  }

  /** 从单个 .ldb 文件里解出 `deepseek_pp_usage_turns_v1` 的所有快照数组（不同写入/压实版本）。 */
  private extractUsageSnapshotsFromSstable(buf: Buffer): unknown[] {
    const out: unknown[] = [];
    if (buf.length < 48) return out;
    const KEY = 'deepseek_pp_usage_turns_v1';
    // Footer（最后 48 字节）：metaindex_handle + index_handle（各 2 个 varint）+ magic
    let p = buf.length - 48;
    const metaOff = this.varintPos(buf, p); if (!metaOff) return out; p = metaOff.p;
    const metaSize = this.varintPos(buf, p); if (!metaSize) return out; p = metaSize.p;
    const iOff = this.varintPos(buf, p); if (!iOff) return out; p = iOff.p;
    const iSize = this.varintPos(buf, p); if (!iSize) return out;
    const idxRaw = buf.slice(iOff.v, iOff.v + iSize.v);
    const idxDec = this.decompressLeveldbBlock(idxRaw);
    if (!idxDec) return out;
    for (const ie of this.parseLeveldbBlockEntries(idxDec)) {
      // index 条目 value = BlockHandle（varint offset, varint size）
      const h1 = this.varintPos(ie.value, 0);
      if (!h1 || h1.p >= ie.value.length) continue;
      const h2 = this.varintPos(ie.value, h1.p);
      if (!h2 || h2.v <= 0) continue;
      const oh = h1.v, oz = h2.v;
      if (oz <= 0 || oh + oz > buf.length) continue;
      const blk = this.decompressLeveldbBlock(buf.slice(oh, oh + oz));
      if (!blk) continue;
      for (const e of this.parseLeveldbBlockEntries(blk)) {
        // 块内 key 可能是内部 key（含 8 字节 seq/type 尾），用前缀匹配；跳过 `$`meta 键
        if (e.key.startsWith(KEY) && !e.key.startsWith(KEY + '$')) {
          try { const v = JSON.parse(e.value.toString('utf-8')); if (Array.isArray(v)) out.push(v); } catch (e3) { /* 忽略坏值 */ }
        }
      }
    }
    return out;
  }

  /** 解压一个 leveldb 块（原始句柄内容）：[变长头=解压后长度][snappy 流]。 */
  private decompressLeveldbBlock(raw: Buffer): Buffer | null {
    const h = this.varintPos(raw, 0);
    if (!h || h.p <= 0) return null;
    return this.snappyDecode(raw.slice(h.p));
  }

  /** 解析一个已解压的 leveldb 块为 [{key, valueBuffer}]（含共享前缀重建）。 */
  private parseLeveldbBlockEntries(buf: Buffer): { key: string; value: Buffer }[] {
    const entries: { key: string; value: Buffer }[] = [];
    if (buf.length < 4) return entries;
    const numRestart = buf.readUInt32LE(buf.length - 4);
    if (numRestart > 100000) return entries;
    const restartStart = buf.length - 4 - numRestart * 4;
    if (restartStart < 0) return entries;
    const keyArr: number[] = [];
    let pos = 0;
    while (pos < restartStart) {
      const shared = this.varintPos(buf, pos); if (!shared || shared.v > keyArr.length) break; pos = shared.p;
      const unshared = this.varintPos(buf, pos); if (!unshared) break; pos = unshared.p;
      const valLen = this.varintPos(buf, pos); if (!valLen) break; pos = valLen.p;
      if (pos + unshared.v + valLen.v > buf.length) break;
      const full = keyArr.slice(0, shared.v).concat(Array.from(buf.slice(pos, pos + unshared.v)));
      pos += unshared.v;
      const value = buf.slice(pos, pos + valLen.v);
      pos += valLen.v;
      keyArr.splice(0, keyArr.length, ...full);
      entries.push({ key: Buffer.from(full).toString('latin1'), value });
    }
    return entries;
  }

  private varintPos(buf: Buffer, pos: number): { v: number; p: number } | null {
    const r = this.readVarintAt(buf, pos);
    if (!r) return null;
    return { v: r.value, p: pos + r.bytes };
  }

  /** 纯 JS snappy（raw）解压。块内压缩格式：literal + 1/2/4 字节 offset 的 copy。 */
  private snappyDecode(input: Buffer): Buffer | null {
    const out: number[] = [];
    try {
      let ip = 0;
      while (ip < input.length) {
        const tag = input[ip++];
        const type = tag & 3;
        if (type === 0) {
          let len = tag >> 2;
          if (len >= 60) {
            const n = len - 59;
            len = 0;
            for (let i = 0; i < n; i++) len |= input[ip++] << (8 * i);
          }
          len += 1;
          for (let i = 0; i < len; i++) out.push(input[ip++]);
        } else {
          let len: number;
          let off: number;
          if (type === 1) { len = 4 + ((tag >> 2) & 7); off = ((tag >> 5) << 8) | input[ip++]; }
          else if (type === 2) { len = 1 + (tag >> 2); off = input[ip] | (input[ip + 1] << 8); ip += 2; }
          else { len = 1 + (tag >> 2); off = (input[ip] | (input[ip + 1] << 8) | (input[ip + 2] << 16) | (input[ip + 3] << 24)) >>> 0; ip += 4; }
          if (off <= 0 || off > out.length || out.length + len > 5000000) return null;
          for (let i = 0; i < len; i++) out.push(out[out.length - off]);
        }
      }
      return Buffer.from(out);
    } catch (e) {
      return null;
    }
  }

  private sumTokensInDay(raw: unknown, today: string): number {
    let arr: unknown = raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) arr = (raw as { records?: unknown }).records;
    if (!Array.isArray(arr)) return 0;
    let sum = 0;
    for (const t of arr) {
      const tk = t && (t as { totalTokens?: unknown }).totalTokens;
      if (t && (t as { day?: unknown }).day === today && typeof tk === 'number' && Number.isFinite(tk)) sum += tk;
    }
    return Math.round(sum);
  }

  private sumTokensTotal(raw: unknown): number {
    let arr: unknown = raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) arr = (raw as { records?: unknown }).records;
    if (!Array.isArray(arr)) return 0;
    let sum = 0;
    for (const t of arr) {
      const tk = t && (t as { totalTokens?: unknown }).totalTokens;
      if (t && typeof tk === 'number' && Number.isFinite(tk)) sum += tk;
    }
    return Math.round(sum);
  }

  private recordUsageTurn(payload: unknown): UsageTurnRecord {
    const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const now = Date.now();
    const id = typeof p.id === 'string' && p.id ? p.id : `turn-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const rec: UsageTurnRecord = {
      id,
      recordedAt: now,
      day: this.dayKey(now),
      source: typeof p.source === 'string' ? p.source : 'deepseek-web',
      chatSessionId: typeof p.chatSessionId === 'string' ? p.chatSessionId : null,
      assistantMessageId: typeof p.assistantMessageId === 'number' ? p.assistantMessageId : null,
      modelType: typeof p.modelType === 'string' ? p.modelType : null,
      totalTokens: typeof p.totalTokens === 'number' ? p.totalTokens : 0,
      tokenSource: typeof p.tokenSource === 'string' ? p.tokenSource : 'unknown',
      tps: typeof p.tps === 'number' ? p.tps : 0,
      speedSource: typeof p.speedSource === 'string' ? p.speedSource : 'unknown',
      elapsedMs: typeof p.elapsedMs === 'number' ? p.elapsedMs : 0,
      messageCount: typeof p.messageCount === 'number' ? p.messageCount : 1,
    };
    this.persistUsageTurns([...this.readUsageTurns(), rec]);
    return rec;
  }

  private getUsageSummary(payload: unknown): UsageSummary {
    const rangeDays = (payload && typeof payload === 'object' && (payload as { rangeDays?: number }).rangeDays === 30) ? 30 : 7;
    const all = this.readUsageTurns();
    const cutoff = Date.now() - rangeDays * 24 * 3600 * 1000;
    const turns = all.filter((t) => t.recordedAt >= cutoff);
    const daySet = new Set<string>();
    let totalTokens = 0;
    let messages = 0;
    const sessions = new Set<string>();
    const models = new Map<string, { tokens: number; turns: number }>();
    turns.forEach((t) => {
      daySet.add(t.day);
      totalTokens += t.totalTokens;
      messages += t.messageCount;
      if (t.chatSessionId) sessions.add(t.chatSessionId);
      const mk = t.modelType || 'unknown';
      const m = models.get(mk) || { tokens: 0, turns: 0 };
      m.tokens += t.totalTokens;
      m.turns += 1;
      models.set(mk, m);
    });
    const byDay = new Map<string, { tokens: number; turn: number }>();
    turns.forEach((t) => {
      const d = byDay.get(t.day) || { tokens: 0, turn: 0 };
      d.tokens += t.totalTokens;
      d.turn += 1;
      byDay.set(t.day, d);
    });
    const days = Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, d]) => ({
        day,
        timestamp: new Date(day + 'T00:00:00').getTime(),
        tokens: d.tokens,
        messageCount: 0,
        sessionCount: 0,
        turnCount: d.turn,
        models: [] as unknown[],
      }));
    return {
      rangeDays,
      generatedAt: Date.now(),
      totalTokens,
      sessionCount: sessions.size,
      messageCount: messages,
      turnCount: turns.length,
      activeDays: daySet.size,
      currentStreak: 0,
      serverTokenRecordCount: turns.length,
      mostUsedModel: null,
      days,
      heatmap: [],
      modelUsage: Array.from(models.entries()).map(([key, m]) => ({
        modelKey: key,
        modelLabel: key,
        totalTokens: m.tokens,
        turnCount: m.turns,
        messageCount: 0,
        sessionCount: 0,
        share: turns.length ? m.turns / turns.length : 0,
      })),
    };
  }

  private clearUsageStats(): { ok: true } {
    this.persistUsageTurns([]);
    return { ok: true };
  }

  // ---------------- IPC 注册 ----------------

  public registerIpc(): void {
    ipcMain.handle(IPC.EXT_HOST_STORAGE_GET, (_e, keys?: string | string[]) => this.getLocal(keys));
    ipcMain.handle(IPC.EXT_HOST_STORAGE_SET, (_e, values: Record<string, unknown>) => {
      this.setLocal(values);
      return true;
    });
    ipcMain.handle(IPC.EXT_HOST_STORAGE_REMOVE, (_e, keys: string | string[]) => {
      this.removeLocal(keys);
      return true;
    });
    ipcMain.handle(IPC.EXT_HOST_RUNTIME_MESSAGE, async (e, msg: RuntimeEnvelope) =>
      this.handleRuntimeMessage(msg, e.sender)
    );
  }
}