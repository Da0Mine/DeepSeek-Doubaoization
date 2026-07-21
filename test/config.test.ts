/**
 * ConfigStore 单元测试。
 * 通过 jest.mock('electron') 提供内存版 app.getPath，避免真实写入 %APPDATA%。
 * 配置文件落盘到临时目录，每个用例清理，保证隔离。
 */
import * as fs from 'fs';
import * as path from 'path';

// 在模块加载期（constants.ts 的 IIFE 计算 CONFIG_PATH 之前）提供内存版 electron。
// 临时目录在 factory 内部创建，并挂到 global 以便 afterAll 清理。
jest.mock('electron', () => {
  const f = require('fs') as typeof fs;
  const os = require('os');
  const p = require('path') as typeof path;
  const dir = f.mkdtempSync(p.join(os.tmpdir(), 'ds-config-'));
  (global as { __DS_TMP__?: string }).__DS_TMP__ = dir;
  return {
    app: {
      getPath: jest.fn(() => dir),
      getName: jest.fn(() => 'DeepSeek'),
    },
  };
});

import { ConfigStore } from '../src/main/config/ConfigStore';
import { CONFIG_PATH } from '../src/main/constants';
import type { ConfigShape } from '../src/shared/types';

/** PRD 规定的 22 项默认值（键名 + 值），用作断言基准。 */
const PRD_DEFAULTS: Record<string, unknown> = {
  globalToggleShortcut: 'Alt+`',
  screenshotShortcut: 'Ctrl+Shift+A',
  theme: 'system',
  closeToTray: true,
  trayEnabled: true,
  startAtLogin: false,
  minimizeToTrayOnStart: false,
  deepThinkEnabled: false,
  smartSearchEnabled: true,
  alwaysOnTop: true,
  fontSize: 14,
  visionPromptTemplate: '请识别并描述这张图片中的内容。',
  extractTextPromptTemplate: '请提取图片中的所有文字，保留原有排版。',
  translatePromptTemplate: '请将以下内容翻译为{targetLang}：\n{content}',
  explainPromptTemplate: '请详细解释以下内容，并给出背景知识：\n{content}',
  proxyEnabled: false,
  proxyUrl: '',
  notificationEnabled: true,
  // ---- 增量（I-08 / I-09 / I-10 / I-11）：新增 4 项 ----
  subWindowShortcut: 'Alt+Q',
  annotationColors: ['#ff3b30', '#34c759', '#007aff', '#ffcc00', '#ffffff'],
  collapseThinking: true,
  defaultModelMode: 'simple',
};

function deleteDiskConfig(): void {
  if (fs.existsSync(CONFIG_PATH)) {
    fs.unlinkSync(CONFIG_PATH);
  }
}

beforeEach(() => {
  deleteDiskConfig();
});

afterEach(() => {
  deleteDiskConfig();
});

afterAll(() => {
  const dir = (global as { __DS_TMP__?: string }).__DS_TMP__;
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ConfigStore - 22 项默认值', () => {
  test('getAll 返回恰好 22 个键', () => {
    const store = new ConfigStore();
    expect(Object.keys(store.getAll())).toHaveLength(22);
  });

  test('所有默认值与 PRD 完全一致', () => {
    const store = new ConfigStore();
    const all = store.getAll();
    for (const [key, value] of Object.entries(PRD_DEFAULTS)) {
      expect(all[key as keyof typeof all]).toEqual(value);
    }
  });

  test('get 能正确读取单项', () => {
    const store = new ConfigStore();
    expect(store.get('fontSize')).toBe(14);
    expect(store.get('theme')).toBe('system');
  });
});

describe('ConfigStore - 深度合并 (load)', () => {
  test('磁盘缺字段时以默认值补齐', () => {
    // 仅提供部分字段，缺失项应回退默认值
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ fontSize: 20, theme: 'dark' }));
    const store = new ConfigStore();
    const all = store.getAll();
    // 已有字段被保留
    expect(all.fontSize).toBe(20);
    expect(all.theme).toBe('dark');
    // 缺失字段补齐默认
    expect(all.closeToTray).toBe(true);
    expect(all.trayEnabled).toBe(true);
    // 总数仍为 22
    expect(Object.keys(all)).toHaveLength(22);
  });

  test('磁盘已有值不被默认值覆盖', () => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ fontSize: 99, closeToTray: false }));
    const store = new ConfigStore();
    expect(store.get('fontSize')).toBe(99);
    expect(store.get('closeToTray')).toBe(false);
    // 其它默认值保持
    expect(store.get('trayEnabled')).toBe(true);
    expect(store.get('theme')).toBe('system');
  });

  test('磁盘文件缺失时回退到默认配置', () => {
    deleteDiskConfig();
    const store = new ConfigStore();
    expect(store.getAll()).toEqual(PRD_DEFAULTS as never);
  });

  test('磁盘文件损坏（非法 JSON）时不崩溃，回退默认', () => {
    fs.writeFileSync(CONFIG_PATH, '{ this is not valid json ');
    const store = new ConfigStore();
    expect(store.get('fontSize')).toBe(14);
    expect(Object.keys(store.getAll())).toHaveLength(22);
  });
});

describe('ConfigStore - set / 持久化', () => {
  test('set 后落盘内容包含修改值', () => {
    const store = new ConfigStore();
    store.set('fontSize', 18);
    expect(fs.existsSync(CONFIG_PATH)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    expect(raw.fontSize).toBe(18);
  });

  test('set 写入的是完整配置（含全部 22 项默认），不会丢字段', () => {
    const store = new ConfigStore();
    store.set('theme', 'dark');
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    expect(Object.keys(raw)).toHaveLength(22);
    expect(raw.theme).toBe('dark');
    expect(raw.fontSize).toBe(14); // 其它默认仍在
  });

  test('set 只改目标键，不影响其它项', () => {
    const store = new ConfigStore();
    store.set('fontSize', 22);
    expect(store.get('fontSize')).toBe(22);
    expect(store.get('theme')).toBe('system');
    expect(store.get('trayEnabled')).toBe(true);
  });
});

describe('ConfigStore - getAll 返回副本', () => {
  test('外部修改 getAll 的返回值不影响内部状态', () => {
    const store = new ConfigStore();
    const snapshot = store.getAll();
    snapshot.fontSize = 999;
    expect(store.get('fontSize')).toBe(14);
  });
});

describe('ConfigStore - reset', () => {
  test('reset 回到全部默认值', () => {
    const store = new ConfigStore();
    store.set('fontSize', 30);
    expect(store.get('fontSize')).toBe(30);
    store.reset();
    expect(store.get('fontSize')).toBe(14);
    expect(store.get('theme')).toBe('system');
    expect(store.get('closeToTray')).toBe(true);
    expect(Object.keys(store.getAll())).toHaveLength(22);
  });

  test('reset 后落盘也是默认', () => {
    const store = new ConfigStore();
    store.set('fontSize', 30);
    store.reset();
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    expect(raw.fontSize).toBe(14);
  });
});

describe('ConfigStore - onChange 订阅', () => {
  test('set 触发 onChange，参数携带最新快照', () => {
    const store = new ConfigStore();
    const calls: ConfigShape[] = [];
    store.onChange((cfg) => calls.push(cfg));
    store.set('theme', 'dark');
    expect(calls).toHaveLength(1);
    expect(calls[0].theme).toBe('dark');
  });

  test('reset 也触发 onChange', () => {
    const store = new ConfigStore();
    const calls: ConfigShape[] = [];
    store.onChange((cfg) => calls.push(cfg));
    store.set('fontSize', 40);
    store.reset();
    expect(calls).toHaveLength(2);
    expect(calls[1].fontSize).toBe(14);
  });

  test('返回的取消订阅函数可停止接收通知', () => {
    const store = new ConfigStore();
    const calls: ConfigShape[] = [];
    const off = store.onChange((cfg) => calls.push(cfg));
    store.set('fontSize', 1);
    off();
    store.set('fontSize', 2);
    expect(calls).toHaveLength(1);
  });
});
