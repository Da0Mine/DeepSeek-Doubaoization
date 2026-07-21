/**
 * 配置读写（%APPDATA%/DeepSeek/config.json）。
 * 启动读 config.json 并与 28 项默认值做「深度合并」；
 * set 后自动 save；支持 onChange 订阅。
 */
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_PATH } from '../constants';
import type { ConfigKey, ConfigShape } from '../../shared/types';

/** 28 项配置默认值（必须完整覆盖 ConfigShape）。 */
const DEFAULT_CONFIG: ConfigShape = {
  globalToggleShortcut: 'Alt+`',
  screenshotShortcut: 'Ctrl+Shift+A',
  theme: 'system',
  closeToTray: true,
  trayEnabled: true,
  startAtLogin: false,
  minimizeToTrayOnStart: false,
  deepThinkEnabled: false,
  /** 智能搜索默认开启（用户要求）。 */
  smartSearchEnabled: true,
  customTitleBar: true,
  alwaysOnTop: true,
  fontSize: 14,
  realTimeTranslateSync: true,
  windowCopyKeepsContext: true,
  enableRoleSwap: true,
  autoStartVisionModel: true,
  screenshotSavePath: '',
  visionPromptTemplate: '请识别并描述这张图片中的内容。',
  extractTextPromptTemplate: '请提取图片中的所有文字，保留原有排版。',
  translatePromptTemplate: '请将以下内容翻译为{targetLang}：\n{content}',
  explainPromptTemplate: '请详细解释以下内容，并给出背景知识：\n{content}',
  proxyEnabled: false,
  proxyUrl: '',
  notificationEnabled: true,
  subWindowShortcut: 'Alt+Q',
  defaultModelMode: 'simple',
  annotationColors: ['#ff3b30', '#34c759', '#007aff', '#ffcc00', '#ffffff'],
  /** 默认折叠模型的思考过程（深度思考/思维链），默认开启。 */
  collapseThinking: true,
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
