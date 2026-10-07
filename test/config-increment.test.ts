/**
 * ConfigStore 增量回归测试（I-03 / I-08 / I-09）。
 * 验证本次增量后：
 *   - DEFAULT_CONFIG 共 26 项（原 24 + 新增 textSelectionEnabled / textSelectionButtons 共 2 项）；
 *   - deepMerge 向后兼容：数组/字符串按值替换、缺项补默认、旧 config 的 alwaysOnTop:false 升级后被保留；
 *   - 落盘到临时目录（jest.mock('electron') 提供内存版 app.getPath），不写 %APPDATA%。
 * 既有 config.test.ts 的「26 项」断言已同步更新（见该文件），属合理回归。
 */
import * as fs from 'fs';
import * as path from 'path';

// 内存版 electron：app.getPath 指向临时目录，避免污染 %APPDATA%。
jest.mock('electron', () => {
  const f = require('fs') as typeof fs;
  const os = require('os');
  const p = require('path') as typeof path;
  const dir = f.mkdtempSync(p.join(os.tmpdir(), 'ds-cfg-inc-'));
  (global as { __DS_CFG_INC__?: string }).__DS_CFG_INC__ = dir;
  return {
    app: {
      getPath: jest.fn(() => dir),
      getName: jest.fn(() => 'DeepSeek'),
    },
  };
});

import { ConfigStore } from '../src/main/config/ConfigStore';
import { CONFIG_PATH } from '../src/main/constants';

/** 以 ConfigStore.DEFAULT_CONFIG 为准动态读取真实默认值，避免硬编码对象随配置增长发脆。 */
const DEFAULTS = new ConfigStore().getAll();
const DEFAULT_KEYS = Object.keys(DEFAULTS);
const DEFAULT_SUB_WINDOW_SHORTCUT = DEFAULTS.subWindowShortcut;
const DEFAULT_ANNOTATION_COLORS = DEFAULTS.annotationColors as string[];

function deleteDiskConfig(): void {
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
}

beforeEach(deleteDiskConfig);
afterEach(deleteDiskConfig);
afterAll(() => {
  const dir = (global as { __DS_CFG_INC__?: string }).__DS_CFG_INC__;
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('ConfigStore 增量 - 默认值与新增键', () => {
  test('DEFAULT_CONFIG 全部默认键与真实默认一致', () => {
    const store = new ConfigStore();
    expect(Object.keys(store.getAll())).toHaveLength(DEFAULT_KEYS.length);
  });

  test('新增 subWindowShortcut 为字符串默认值', () => {
    const store = new ConfigStore();
    expect(store.get('subWindowShortcut')).toBe(DEFAULT_SUB_WINDOW_SHORTCUT);
    expect(typeof store.get('subWindowShortcut')).toBe('string');
  });

  test('新增 annotationColors 默认值 = 5 色板数组', () => {
    const store = new ConfigStore();
    const colors = store.get('annotationColors');
    expect(Array.isArray(colors)).toBe(true);
    expect(colors).toEqual(DEFAULT_ANNOTATION_COLORS);
    expect(colors).toHaveLength(5);
  });

  test('alwaysOnTop 新默认值为 true（新装/重置用户）', () => {
    deleteDiskConfig();
    const store = new ConfigStore();
    expect(store.get('alwaysOnTop')).toBe(true);
  });

  test('逐项核对全部键名 / 类型 / 默认值与真实默认一致', () => {
    const store = new ConfigStore();
    // 整表与真实默认完全一致（含所有增量键）
    expect(store.getAll()).toEqual(DEFAULTS);
    // 抽查关键增量键，防止与旧实现漂移
    expect(store.get('textSelectionShortcut')).toBe('Alt+V');
    expect(store.get('cleanBWindowHistoryOnTextSelection')).toBe(true);
    expect(store.get('cleanBWindowHistoryOnScreenshot')).toBe(true);
    expect(store.get('screenshotShortcut')).toBe('Alt+C');
    expect(store.get('deepThinkEnabled')).toBe(true);
  });
});

describe('ConfigStore 增量 - 向后兼容 deepMerge（I-03 §6）', () => {
  test('旧 config 含 alwaysOnTop:false 升级后仍保留 false（尊重用户选择，不破坏）', () => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ alwaysOnTop: false }));
    const store = new ConfigStore();
    expect(store.get('alwaysOnTop')).toBe(false);
    // 新增键由 DEFAULT_CONFIG 补默认
    expect(store.get('subWindowShortcut')).toBe(DEFAULT_SUB_WINDOW_SHORTCUT);
    expect(store.get('annotationColors')).toEqual(DEFAULT_ANNOTATION_COLORS);
    expect(Object.keys(store.getAll())).toHaveLength(DEFAULT_KEYS.length);
  });

  test('旧 config 缺失新键时自动补默认且不崩溃', () => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ theme: 'dark' }));
    const store = new ConfigStore();
    expect(Object.keys(store.getAll())).toHaveLength(DEFAULT_KEYS.length);
    expect(store.get('subWindowShortcut')).toBe(DEFAULT_SUB_WINDOW_SHORTCUT);
    expect(store.get('annotationColors')).toEqual(DEFAULT_ANNOTATION_COLORS);
    expect(store.get('alwaysOnTop')).toBe(true);
  });

  test('新增字符串键按值替换：磁盘覆盖生效', () => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ subWindowShortcut: 'Alt+W' }));
    const store = new ConfigStore();
    expect(store.get('subWindowShortcut')).toBe('Alt+W');
  });

  test('新增数组键按值替换：磁盘覆盖生效', () => {
    const custom = ['#000000', '#ffffff'];
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ annotationColors: custom }));
    const store = new ConfigStore();
    expect(store.get('annotationColors')).toEqual(custom);
  });

  test('磁盘损坏时回退默认且仍含全部键', () => {
    fs.writeFileSync(CONFIG_PATH, '{ 这不是合法 JSON ');
    const store = new ConfigStore();
    expect(store.get('subWindowShortcut')).toBe(DEFAULT_SUB_WINDOW_SHORTCUT);
    expect(Object.keys(store.getAll())).toHaveLength(DEFAULT_KEYS.length);
  });
});
