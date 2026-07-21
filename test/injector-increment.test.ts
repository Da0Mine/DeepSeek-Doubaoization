/**
 * Injector 增量接线测试（I-01 / I-06）。
 * 用最小桩 mock 掉 webContents.executeJavaScript，验证：
 *   - submitToChat 先注入文本（可选图片）→ 填文 → 点击发送（clickSend），顺序正确；
 *   - clickSend 等待发送按钮可用态（跳过 disabled / aria-disabled）后再 click；
 *   - sendToChat 末端统一走 submitToChat；
 *   - injectScissorsButton 注入脚本含剪刀按钮与 MutationObserver、调用不抛错，
 *     且 Node 侧 onTrigger 不被直接调用（真实触发走 IPC）。
 * 选择器与 React 受控赋值方式属「待实机验证」；这里只验证调用契约与接线顺序。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WebContents } from 'electron';

jest.mock('electron', () => {
  const f = require('fs') as typeof fs;
  const os = require('os');
  const p = require('path') as typeof path;
  const dir = f.mkdtempSync(p.join(os.tmpdir(), 'ds-inj-inc-'));
  (global as { __DS_INJ_INC__?: string }).__DS_INJ_INC__ = dir;
  return {
    app: { getPath: jest.fn(() => dir), getName: jest.fn(() => 'DeepSeek') },
  };
});

import { ConfigStore } from '../src/main/config/ConfigStore';
import { PromptTemplates } from '../src/main/prompts/promptTemplates';
import { Injector } from '../src/main/inject/Injector';

const cfg = new ConfigStore();
const injector = new Injector(new PromptTemplates(cfg));

/** 构造最小 WebContents 桩，executeJavaScript 默认返回 true。 */
function makeWebContents(returnValue: unknown = true): WebContents & { executeJavaScript: jest.Mock } {
  return {
    executeJavaScript: jest.fn().mockResolvedValue(returnValue),
  } as unknown as WebContents & { executeJavaScript: jest.Mock };
}

/** 取出某次 executeJavaScript 调用传入的脚本字符串列表。 */
function scriptsOf(wc: WebContents & { executeJavaScript: jest.Mock }): string[] {
  return wc.executeJavaScript.mock.calls.map((c) => String(c[0]));
}

afterAll(() => {
  const dir = (global as { __DS_INJ_INC__?: string }).__DS_INJ_INC__;
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Injector 增量 - submitToChat 接线（I-06）', () => {
  test('submitToChat(无图) 先 fillText 再 clickSend，且返回 true', async () => {
    const wc = makeWebContents(true);
    const ok = await injector.submitToChat(wc, '你好');
    expect(ok).toBe(true);
    const scripts = scriptsOf(wc);
    expect(scripts.some((s) => s.includes('你好'))).toBe(true); // 填文
    expect(scripts.some((s) => s.includes('.click()'))).toBe(true); // 点发送
    const fillIdx = scripts.findIndex((s) => s.includes('你好'));
    const clickIdx = scripts.findIndex((s) => s.includes('.click()'));
    expect(fillIdx).toBeGreaterThanOrEqual(0);
    expect(clickIdx).toBeGreaterThan(fillIdx); // 填文早于点击
  });

  test('submitToChat(带图) 先 uploadImage 再 fillText 再 clickSend', async () => {
    const wc = makeWebContents(true);
    const ok = await injector.submitToChat(wc, '看图', '/tmp/a.png');
    expect(ok).toBe(true);
    const scripts = scriptsOf(wc);
    const upIdx = scripts.findIndex((s) => s.includes('uploadFile'));
    const fillIdx = scripts.findIndex((s) => s.includes('看图'));
    const clickIdx = scripts.findIndex((s) => s.includes('.click()'));
    expect(upIdx).toBeGreaterThanOrEqual(0);
    expect(fillIdx).toBeGreaterThan(upIdx);
    expect(clickIdx).toBeGreaterThan(fillIdx);
  });

  test('clickSend 公开方法：发送按钮可用时返回 true', async () => {
    const wc = makeWebContents(true);
    const ok = await injector.clickSend(wc);
    expect(ok).toBe(true);
    expect(scriptsOf(wc).some((s) => s.includes('.click()'))).toBe(true);
  });

  test('clickSend 点击脚本跳过 disabled / aria-disabled（等待可用态）', async () => {
    const wc = makeWebContents(true);
    await injector.clickSend(wc);
    const sendScript = scriptsOf(wc).find((s) => s.includes('.click()'));
    expect(sendScript).toBeDefined();
    expect(sendScript).toContain('disabled');
    expect(sendScript).toContain('aria-disabled');
  });

  test('sendToChat 与 submitToChat 等价（末端统一走 submitToChat）', async () => {
    const wc = makeWebContents(true);
    const ok = await injector.sendToChat(wc, '测试发送');
    expect(ok).toBe(true);
    expect(scriptsOf(wc).some((s) => s.includes('.click()'))).toBe(true);
  });
});

describe('Injector 增量 - injectScissorsButton 接线（I-01）', () => {
  test('注入脚本含剪刀按钮与 MutationObserver 且调用不抛错', async () => {
    const wc = makeWebContents(true) as WebContents & { executeJavaScript: jest.Mock };
    const onTrigger = jest.fn();
    const ok = await injector.injectScissorsButton(wc, onTrigger);
    expect(ok).toBe(true);
    const code = wc.executeJavaScript.mock.calls[0][0] as string;
    expect(code).toContain('ds-scissors-btn'); // 剪刀按钮 id
    expect(code).toContain('MutationObserver'); // 应对 SPA 重渲染重注入
    expect(code).toContain('scissors-trigger'); // 点击经 DOM 事件上报
    // 真实触发走 IPC(SCISSORS_TRIGGER)，Node 侧 onTrigger 不应被直接调用
    expect(onTrigger).not.toHaveBeenCalled();
  });

  test('executeJavaScript 抛错时返回 false 不崩溃', async () => {
    const wc = makeWebContents(true) as WebContents & { executeJavaScript: jest.Mock };
    wc.executeJavaScript.mockRejectedValueOnce(new Error('boom'));
    const onTrigger = jest.fn();
    const ok = await injector.injectScissorsButton(wc, onTrigger);
    expect(ok).toBe(false);
  });
});
