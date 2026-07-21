/**
 * ConfigStore 增量回归测试（I-03 / I-08 / I-09）。
 * 验证本次增量后：
 *   - DEFAULT_CONFIG 共 27 项（原 26 + 新增 subWindowShortcut / annotationColors / collapseThinking / defaultModelMode / smartSearchEnabled，alwaysOnTop 默认 true，移除翻译设置 2 项、截图默认动作 1 项与 windowCopyKeepsContext）；
 *   - deepMerge 向后兼容：数组/字符串按值替换、缺项补默认、旧 config 的 alwaysOnTop:false 升级后被保留；
 *   - 落盘到临时目录（jest.mock('electron') 提供内存版 app.getPath），不写 %APPDATA%。
 * 既有 config.test.ts 的「27 项」断言已同步更新（见该文件），属合理回归。
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
import type { ConfigShape } from '../src/shared/types';

const DEFAULT_SUB_WINDOW_SHORTCUT = 'Alt+Q';
const DEFAULT_ANNOTATION_COLORS = ['#ff3b30', '#34c759', '#007aff', '#ffcc00', '#ffffff'];

function deleteDiskConfig(): void {
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
}

beforeEach(deleteDiskConfig);
afterEach(deleteDiskConfig);
afterAll(() => {
  const dir = (global as { __DS_CFG_INC__?: string }).__DS_CFG_INC__;
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('ConfigStore 增量 - 27 项默认值与新增键', () => {
  test('DEFAULT_CONFIG 共 27 项', () => {
    const store = new ConfigStore();
    expect(Object.keys(store.getAll())).toHaveLength(27);
  });

  test('新增 subWindowShortcut 默认值 "Alt+Q" 且为字符串', () => {
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

  test('逐项核对全部 27 键名 / 类型 / 默认值完全一致', () => {
    const store = new ConfigStore();
    const expected: ConfigShape = {
      globalToggleShortcut: 'Alt+`',
      screenshotShortcut: 'Ctrl+Shift+A',
      theme: 'system',
      closeToTray: true,
      trayEnabled: true,
      startAtLogin: false,
      minimizeToTrayOnStart: false,
      deepThinkEnabled: false,
      smartSearchEnabled: true,
      customTitleBar: true,
      alwaysOnTop: true,
      fontSize: 14,
      realTimeTranslateSync: true,
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
      annotationColors: ['#ff3b30', '#34c759', '#007aff', '#ffcc00', '#ffffff'],
      collapseThinking: true,
      defaultModelMode: 'simple',
    };
    expect(store.getAll()).toEqual(expected);
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
    expect(Object.keys(store.getAll())).toHaveLength(27);
  });

  test('旧 config 缺失新键时自动补默认且不崩溃', () => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ theme: 'dark' }));
    const store = new ConfigStore();
    expect(Object.keys(store.getAll())).toHaveLength(27);
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

  test('磁盘损坏时回退默认且仍含 27 项', () => {
    fs.writeFileSync(CONFIG_PATH, '{ 这不是合法 JSON ');
    const store = new ConfigStore();
    expect(store.get('subWindowShortcut')).toBe(DEFAULT_SUB_WINDOW_SHORTCUT);
    expect(Object.keys(store.getAll())).toHaveLength(27);
  });
});
