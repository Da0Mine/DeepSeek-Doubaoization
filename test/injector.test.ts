/**
 * Injector 单元测试。
 * Injector 仅以「类型」方式依赖 electron（import type { WebContents }），运行时不加载 electron，
 * 因此用最小桩对象 mock 掉 webContents.executeJavaScript 即可验证「提示词接线」逻辑：
 *   - 传文/传图时确实调用了 executeJavaScript；
 *   - 传入脚本里包含由 PromptTemplates 渲染出的预期提示词文本。
 * 选择器与 React 受控组件赋值方式属「待实机验证」范畴，这里只验证逻辑接线与调用契约。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WebContents } from 'electron';

jest.mock('electron', () => {
  const f = require('fs') as typeof fs;
  const os = require('os');
  const p = require('path') as typeof path;
  const dir = f.mkdtempSync(p.join(os.tmpdir(), 'ds-injector-'));
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
import { Injector } from '../src/main/inject/Injector';

const cfg = new ConfigStore();
const templates = new PromptTemplates(cfg);
const injector = new Injector(templates);

/** 构造一个最小 WebContents 桩，executeJavaScript 默认返回 true。 */
function makeWebContents(returnValue: unknown = true): WebContents & { executeJavaScript: jest.Mock; sendInputEvent: jest.Mock; focus: jest.Mock } {
  return {
    executeJavaScript: jest.fn().mockResolvedValue(returnValue),
    sendInputEvent: jest.fn(),
    focus: jest.fn(),
  } as unknown as WebContents & { executeJavaScript: jest.Mock; sendInputEvent: jest.Mock; focus: jest.Mock };
}

/** 取出某次 executeJavaScript 调用传入的脚本字符串列表。 */
function scriptsOf(wc: WebContents & { executeJavaScript: jest.Mock }): string[] {
  return wc.executeJavaScript.mock.calls.map((c) => String(c[0]));
}

afterAll(() => {
  const dir = (global as { __DS_TMP__?: string }).__DS_TMP__;
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Injector - translate 提示词接线', () => {
  test('translate 调用 executeJavaScript，且脚本含渲染后的翻译提示词', async () => {
    const wc = makeWebContents(true);
    await injector.translate(wc, 'Hello world', 'English');
    expect(wc.executeJavaScript).toHaveBeenCalled();

    const expected = templates.render(templates.translatePrompt('English'), { content: 'Hello world' });
    const scripts = scriptsOf(wc);
    // 脚本中嵌入的是 JSON.stringify(prompt)，精确匹配证明完整提示词（含两个占位符均已解析）被注入
    expect(scripts.some((s) => s.includes(JSON.stringify(expected)))).toBe(true);
    // 同时应含目标语言与原文（以更宽松的方式再确认一次）
    expect(scripts.some((s) => s.includes('English'))).toBe(true);
    expect(scripts.some((s) => s.includes('Hello world'))).toBe(true);
  });

  test('translate 失败时（选择器均无响应）返回 false', async () => {
    const wc = makeWebContents(false);
    const ok = await injector.translate(wc, 'x', 'English');
    expect(ok).toBe(false);
  });
});

describe('Injector - explain 提示词接线', () => {
  test('explain 调用 executeJavaScript，且脚本含渲染后的解释提示词', async () => {
    const wc = makeWebContents(true);
    await injector.explain(wc, 'Some text to explain');
    expect(wc.executeJavaScript).toHaveBeenCalled();

    const expected = templates.render(templates.explainPrompt(), { content: 'Some text to explain' });
    const scripts = scriptsOf(wc);
    expect(scripts.some((s) => s.includes(JSON.stringify(expected)))).toBe(true);
    expect(scripts.some((s) => s.includes('Some text to explain'))).toBe(true);
  });
});

describe('Injector - extractText 提示词接线', () => {
  test('extractText 先上传图片、再注入提取文字提示词', async () => {
    const wc = makeWebContents(true);
    const ok = await injector.extractText(wc, '/tmp/shot.png');
    expect(ok).toBe(true);

    const scripts = scriptsOf(wc);
    // 1) 图片上传路径：脚本应调用 window.__ds.uploadFile
    expect(scripts.some((s) => s.includes('uploadFile'))).toBe(true);
    expect(scripts.some((s) => s.includes(JSON.stringify('/tmp/shot.png')))).toBe(true);
    // 2) 提取文字提示词被注入到输入框
    const expected = templates.extractTextPrompt();
    expect(scripts.some((s) => s.includes(JSON.stringify(expected)))).toBe(true);
  });
});

describe('Injector - uploadImage', () => {
  test('uploadImage 调用 executeJavaScript 且脚本含 uploadFile 与文件路径', async () => {
    const wc = makeWebContents(JSON.stringify({ ok: true, preload: true, attached: true }));
    const ok = await injector.uploadImage(wc, '/p/img.png');
    expect(ok).toBe(true);
    const scripts = scriptsOf(wc);
    expect(scripts[0]).toContain('uploadFile');
    expect(scripts[0]).toContain(JSON.stringify('/p/img.png'));
  });

  test('uploadImage 在脚本执行异常时返回 false 而不抛错', async () => {
    const wc = makeWebContents(true);
    wc.executeJavaScript.mockRejectedValue(new Error('boom'));
    const ok = await injector.uploadImage(wc, '/p/img.png');
    expect(ok).toBe(false);
  });
});

describe('Injector - readLatestResponse', () => {
  test('返回 executeJavaScript 的返回值', async () => {
    const wc = makeWebContents('AI 的最新回复');
    const r = await injector.readLatestResponse(wc);
    expect(r).toBe('AI 的最新回复');
  });

  test('脚本使用 ASSISTANT_MESSAGE_SELECTORS（含 assistant 候选）', async () => {
    const wc = makeWebContents('');
    await injector.readLatestResponse(wc);
    expect(wc.executeJavaScript.mock.calls[0][0]).toContain('assistant');
  });

  test('异常时返回空字符串', async () => {
    const wc = makeWebContents(true);
    wc.executeJavaScript.mockRejectedValueOnce(new Error('x'));
    expect(await injector.readLatestResponse(wc)).toBe('');
  });
});

describe('Injector - detectLogin', () => {
  test('executeJavaScript 返回真值时 detectLogin 为真', async () => {
    const wc = makeWebContents(true);
    expect(await injector.detectLogin(wc)).toBe(true);
  });

  test('executeJavaScript 返回假值时 detectLogin 为假', async () => {
    const wc = makeWebContents(false);
    expect(await injector.detectLogin(wc)).toBe(false);
  });
});

describe('Injector - switchToVisionModel', () => {
  test('找到 vision radio 并经可信点击切换，返回 true', async () => {
    let ariaCalls = 0;
    const wc = makeWebContents();
    wc.executeJavaScript.mockImplementation((code: string) => {
      if (code.includes('getBoundingClientRect') && code.includes('data-model-type="vision"')) {
        return Promise.resolve({ x: 100, y: 50, width: 40, height: 20 });
      }
      if (code.includes('aria-checked')) {
        ariaCalls += 1;
        return Promise.resolve(ariaCalls === 1 ? false : true);
      }
      if (code.includes('__dsHiddenAncestors')) return Promise.resolve(undefined);
      // 找 radio / radiogroup / 新建对话 等查询：一律认为存在
      return Promise.resolve(true);
    });
    const ok = await injector.switchToVisionModel(wc);
    expect(ok).toBe(true);
    expect(wc.sendInputEvent).toHaveBeenCalled();
  });

  test('未找到 vision radio（连点新建对话也找不到）时返回 false', async () => {
    const wc = makeWebContents();
    wc.executeJavaScript.mockImplementation((code: string) => {
      if (code.includes('aria-checked')) return Promise.resolve(false);
      if (code.includes('getBoundingClientRect')) return Promise.resolve({ x: 5, y: 5, width: 20, height: 20 });
      if (code.includes('__dsHiddenAncestors')) return Promise.resolve(undefined);
      // 找 radio / radiogroup：一律认为不存在
      return Promise.resolve(false);
    });
    const ok = await injector.switchToVisionModel(wc);
    expect(ok).toBe(false);
    // 仅「新建对话」按钮被坐标点击（sendInputEvent 至少被调用），但 vision 切换本身未成功
    expect(wc.sendInputEvent).toHaveBeenCalled();
  }, 20000);
});
