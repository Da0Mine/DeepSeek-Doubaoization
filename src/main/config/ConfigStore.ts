/**
 * 配置读写（%APPDATA%/DeepSeek/config.json）。
 * 启动读 config.json 并与 22 项默认值做「深度合并」；
 * set 后自动 save；支持 onChange 订阅。
 */
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_PATH } from '../constants';
import type { ConfigKey, ConfigShape } from '../../shared/types';

/** 配置默认值（必须完整覆盖 ConfigShape）。 */
const DEFAULT_CONFIG: ConfigShape = {
  globalToggleShortcut: 'Alt+`',
  screenshotShortcut: 'Alt+C',
  theme: 'system',
  closeToTray: true,
  trayEnabled: true,
  startAtLogin: false,
  minimizeToTrayOnStart: false,
  /** 链接打开方式：默认内置浏览器窗口（多标签）。 */
  linkOpenMode: 'internal',
  /** 截图时保留应用窗口：默认关闭（截图前自动隐藏应用窗口，避免被截进图里）。 */
  keepWindowsOnScreenshot: false,
  /** 深度思考默认开启（用户要求）。 */
  deepThinkEnabled: true,
  /** 智能搜索默认开启（用户要求）。 */
  smartSearchEnabled: true,
  /** 副窗口和 B 类窗口默认置顶（主窗口不参与）。默认开启。 */
  alwaysOnTop: true,
  /** 全局字号相对偏移（0=默认，-2~+2）。旧版为绝对 px 值，新版改为相对偏移。 */
  fontSize: 0,
  visionPromptTemplate: '请识别并描述这张图片中的内容。',
  extractTextPromptTemplate: '请提取图片中的所有文字，保留原有排版。',
  translatePromptTemplate: '请将以下内容翻译为{targetLang}：\n{content}',
  explainPromptTemplate: '请详细解释以下内容，并给出背景知识：\n{content}',
  proxyEnabled: false,
  proxyUrl: '',
  notificationEnabled: true,
  notificationScreenshot: true,
  notificationOperation: true,
  notificationTextSelection: true,
  notificationShortcut: true,
  notificationReplyDone: true,
  subWindowShortcut: 'Alt+Space',
  defaultModelMode: 'simple',
  screenShareSwitchVision: true,
  /** 共享屏幕模式提示弹框：默认开启。点击「不再提醒」后置 false，可在设置中重新开启。 */
  screenShareModeReminder: true,
  /** 共享（屏幕/文档）空闲自动退出时间（分钟）：0=不自动退出。默认 10。 */
  shareIdleTimeout: 10,
  /** 共享WPS Word 大文档（>70万字）重新提交轮数，默认 15；≤70万字仅在检测到改动时提交。 */
  docShareWpsWordLargeRounds: 15,
  /** 共享WPS Word 触发阈值（字符数），默认 700000。 */
  docShareWpsWordLargeThreshold: 700000,
  /** 共享WPS Excel 大工作簿（>10万字）重新提交轮数，默认 15；≤10万字仅在检测到改动时提交。 */
  docShareWpsExcelLargeRounds: 15,
  /** 共享WPS Excel 触发阈值（字符数），默认 100000。 */
  docShareWpsExcelLargeThreshold: 100000,
  /** 共享WPS PDF 大文档重新提交轮数，默认 15；未超阈值仅在检测到改动时提交。 */
  docSharePdfLargeRounds: 15,
  /** 共享WPS PDF 触发阈值（按文件字节数近似字符数），默认 200000。 */
  docSharePdfLargeThreshold: 200000,
  /** 共享WPS PDF 改动检测保存间隔（秒）：默认 0=仅发送时保存（平时不自动保存原件，发送时 Save() 抓取最新）。 */
  docSharePdfSaveInterval: 0,
  annotationColors: ['#ff3b30', '#34c759', '#007aff', '#ffcc00', '#ffffff'],
  /** 默认折叠模型的思考过程（深度思考/思维链），默认开启。 */
  collapseThinking: true,
  /** 截图翻译默认目标语言。 */
  defaultTranslateLang: '简体中文',
  /** 关闭 B 窗口时自动删除该对话记录。默认开启。 */
  cleanBWindowHistory: true,

  // ---- 划词功能（I-12） ----
  textSelectionEnabled: true,
  textSelectionButtons: JSON.stringify([
    { label: '问问DeepSeek', prompt: '', type: 'quote' },
    { label: '复制', prompt: '' },
    { label: '翻译', prompt: '请将以下内容翻译为{targetLang}：\n{content}' },
    { label: '解释', prompt: '请详细解释以下内容，并给出背景知识：\n{content}' },
  ]),
  /** 划词功能开关快捷键，默认空，需手动设置。 */
  textSelectionShortcut: '',
  /** 首次使用说明引导：默认未完成，首次启动主窗口时自动弹出；完成后可在设置中重新打开。 */
  onboardingCompleted: false,
  /** 首次运行登录引导 / 用户须知：默认未展示，展示完即置 true（仅首次运行触发一次）。 */
  firstRunNoticeShown: false,
  /** 启动时自动检查更新：默认开启。 */
  autoCheckUpdate: true,
  /** 已忽略的更新版本号：用户点「暂不更新」后记录，等待下一个版本再提醒。 */
  ignoredUpdateVersion: '',
};

type Listener = (cfg: ConfigShape) => void;

export class ConfigStore {
  private data: ConfigShape = { ...DEFAULT_CONFIG };
  private readonly listeners: Set<Listener> = new Set();

  constructor() {
    this.data = this.load();
  }

  /** 读取磁盘配置并与默认值深度合并；文件缺失/损坏时回退默认值。 */
  public load(): ConfigShape {
    let merged: ConfigShape = { ...DEFAULT_CONFIG };
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<ConfigShape>;
        merged = deepMerge(merged, parsed);
      }
    } catch (e) {
      console.error('[ConfigStore] 读取配置失败，使用默认值:', e);
    }

    // 迁移：旧版 fontSize 为绝对 px 值（如 14），新版为相对偏移（0），
    // 若值 > 5 说明是旧版格式，重置为 0。
    if (merged.fontSize > 5) {
      merged.fontSize = 0;
    }

    // 迁移：快捷键默认值改为引导演示中的「左Alt+C / 左Alt+空格」。
    // 仅当磁盘值仍等于旧默认值时迁移，用户自定义过的值保持不变。
    if (merged.screenshotShortcut === 'Ctrl+Shift+A') {
      merged.screenshotShortcut = 'Alt+C';
    }
    if (merged.subWindowShortcut === 'Alt+Q') {
      merged.subWindowShortcut = 'Alt+Space';
    }

    // 迁移：确保「问问DeepSeek」按钮存在（旧版配置可能没有）
    try {
      const btns = JSON.parse(merged.textSelectionButtons || '[]') as any[];
      const hasQuote = btns.some((b: any) => b.type === 'quote' || b.label === '问问DeepSeek');
      if (!hasQuote) {
        btns.unshift({ label: '问问DeepSeek', prompt: '', type: 'quote' });
        merged.textSelectionButtons = JSON.stringify(btns);
      }
    } catch {
      // 解析失败则跳过迁移
    }

    this.data = merged;
    return merged;
  }

  /** 写入磁盘（原子性：先写临时文件再重命名）。 */
  public save(): void {
    try {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      const tmp = `${CONFIG_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, CONFIG_PATH);
    } catch (e) {
      console.error('[ConfigStore] 写入配置失败:', e);
    }
  }

  /** 读取单项配置。 */
  public get<K extends ConfigKey>(key: K): ConfigShape[K] {
    return this.data[key];
  }

  /** 写入单项配置并自动落盘、通知订阅者。 */
  public set<K extends ConfigKey>(key: K, value: ConfigShape[K]): void {
    this.data[key] = value;
    this.save();
    this.emit();
  }

  /** 返回全部配置的副本（防止外部直接改内部对象）。 */
  public getAll(): ConfigShape {
    return { ...this.data };
  }

  /** 重置为默认值。 */
  public reset(): void {
    this.data = { ...DEFAULT_CONFIG };
    this.save();
    this.emit();
  }

  /** 重置指定键到默认值。 */
  public resetKeys(keys: ConfigKey[]): void {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, k)) {
        (this.data as unknown as Record<string, unknown>)[k] = (DEFAULT_CONFIG as unknown as Record<string, unknown>)[k];
      }
    }
    this.save();
    this.emit();
  }

  /** 订阅变更，返回取消订阅函数。 */
  public onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    const snapshot = this.getAll();
    for (const l of this.listeners) {
      try {
        l(snapshot);
      } catch (e) {
        console.error('[ConfigStore] onChange 回调异常:', e);
      }
    }
  }
}

/** 深度合并：仅合并对象（非数组）字段，undefined 值被忽略。 */
function deepMerge(base: ConfigShape, override: Partial<ConfigShape>): ConfigShape {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override) as Array<keyof ConfigShape>) {
    const v = override[key];
    const baseVal = base[key];
    if (
      v !== undefined &&
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      baseVal !== undefined &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      out[key as string] = deepMerge(
        baseVal as ConfigShape,
        v as Partial<ConfigShape>
      );
    } else if (v !== undefined) {
      out[key as string] = v;
    }
  }
  return out as unknown as ConfigShape;
}
