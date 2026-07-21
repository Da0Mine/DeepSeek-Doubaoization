/**
 * PromptTemplates 单元测试。
 * 使用真实的 ConfigStore（默认值即 PRD 26 项配置的单一来源）来验证 5 个模板默认值，
 * 同时单独验证 render 的占位符替换逻辑（含缺变量、多占位符等边界）。
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('electron', () => {
  const f = require('fs') as typeof fs;
  const os = require('os');
  const p = require('path') as typeof path;
  const dir = f.mkdtempSync(p.join(os.tmpdir(), 'ds-prompts-'));
  (global as { __DS_TMP__?: string }).__DS_TMP__ = dir;
  return {
    app: {
      getPath: jest.fn(() => dir),
      getName: jest.fn(() => 'DeepSeek'),
    },
  };
});

import { ConfigStore } from '../src/main/config/ConfigStore';
import { PromptTemplates } from '../src/main/prompts/promptTemplates';

const cfg = new ConfigStore();
const pt = new PromptTemplates(cfg);

afterAll(() => {
  const dir = (global as { __DS_TMP__?: string }).__DS_TMP__;
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('PromptTemplates - 5 个模板默认值与 PRD 一致', () => {
  test('visionPromptTemplate 默认文本正确', () => {
    expect(cfg.get('visionPromptTemplate')).toBe('请识别并描述这张图片中的内容。');
    expect(pt.visionPrompt()).toBe('请识别并描述这张图片中的内容。');
  });

  test('extractTextPromptTemplate 默认文本正确', () => {
    expect(cfg.get('extractTextPromptTemplate')).toBe('请提取图片中的所有文字，保留原有排版。');
    expect(pt.extractTextPrompt()).toBe('请提取图片中的所有文字，保留原有排版。');
  });

  test('translatePromptTemplate 默认文本含 {targetLang} 与 {content}', () => {
    const tpl = cfg.get('translatePromptTemplate') as string;
    expect(tpl).toBe('请将以下内容翻译为{targetLang}：\n{content}');
    expect(tpl).toContain('{targetLang}');
    expect(tpl).toContain('{content}');
  });

  test('explainPromptTemplate 默认文本含 {content}', () => {
    const tpl = cfg.get('explainPromptTemplate') as string;
    expect(tpl).toBe('请详细解释以下内容，并给出背景知识：\n{content}');
    expect(tpl).toContain('{content}');
  });
});

describe('PromptTemplates - render 占位符替换', () => {
  test('单占位符被替换', () => {
    expect(pt.render('Hello {name}', { name: 'World' })).toBe('Hello World');
  });

  test('占位符位于文本中间', () => {
    expect(pt.render('a{content}b', { content: 'X' })).toBe('aXb');
  });

  test('多占位符分别替换', () => {
    expect(pt.render('{a}-{b}', { a: '1', b: '2' })).toBe('1-2');
  });

  test('同一占位符多次出现全部替换', () => {
    expect(pt.render('{content}{content}', { content: 'X' })).toBe('XX');
  });

  test('缺失变量时占位符原样保留（不抛错）', () => {
    expect(pt.render('keep {missing}', {})).toBe('keep {missing}');
  });

  test('部分提供变量时，未提供的占位符保留', () => {
    expect(pt.render('{a}{b}', { a: '1' })).toBe('1{b}');
  });

  test('变量值为空字符串时替换为空（而非回退占位符）', () => {
    expect(pt.render('x{content}y', { content: '' })).toBe('xy');
  });

  test('变量值为 null/undefined 时占位符保留', () => {
    expect(pt.render('x{content}y', { content: undefined as unknown as string })).toBe('x{content}y');
  });
});

describe('PromptTemplates - 业务逻辑接线', () => {
  test('translatePrompt(lang) 把 {targetLang} 代入，保留 {content}', () => {
    const r = pt.translatePrompt('English');
    expect(r).toBe('请将以下内容翻译为English：\n{content}');
    expect(r).toContain('English');
    expect(r).toContain('{content}');
  });

  test('translatePrompt + render 组合产出完整翻译提示词', () => {
    const full = pt.render(pt.translatePrompt('English'), { content: 'Hello' });
    expect(full).toBe('请将以下内容翻译为English：\nHello');
  });

  test('explainPrompt 保留 {content} 占位符', () => {
    const r = pt.explainPrompt();
    expect(r).toContain('{content}');
    expect(r).toBe('请详细解释以下内容，并给出背景知识：\n{content}');
  });

  test('visionPrompt / extractTextPrompt 返回对应模板原文', () => {
    expect(pt.visionPrompt()).toBe('请识别并描述这张图片中的内容。');
    expect(pt.extractTextPrompt()).toBe('请提取图片中的所有文字，保留原有排版。');
  });
});
