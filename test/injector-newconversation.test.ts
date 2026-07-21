/**
 * Injector - injectNewConversationWatcher 回归测试。
 * 用最小桩 mock 掉 webContents.executeJavaScript（与项目其他 injector 测试一致的 makeWebContents 约定），
 * 验证「新建对话」监听被正确注入到网页：
 *   - 仅监听 document 的 click（捕获阶段，第三参 true），兼容动态渲染的「新建对话」按钮；
 *   - 触发后经 window.__ds.reportNewConversation() 经 IPC 通知主进程；
 *   - 用 window.__dsNewConvBound 标记避免重复注入；
 *   - executeJavaScript 抛错时返回 false 而不崩溃。
 *
 * 注意（问题 1 根因修正）：不再监听 window.hashchange。旧实现监听 hashchange 会在「点侧边栏切到旧会话」
 * 这类普通导航时也上报，导致误把旧会话切到默认模型、并与真正的「新建对话」并发触发把 radio 点击搞乱。
 * 现仅「真正点中『新建对话』按钮」时才上报，与参考项目「显式点击新建对话按钮」一致。故本测试
 * 不再断言 hashchange，转而断言「仅 click 触发」这一更正后的契约。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WebContents } from 'electron';

jest.mock('electron', () => {
  const f = require('fs') as typeof fs;
  const os = require('os');
  const p = require('path') as typeof path;
  const dir = f.mkdtempSync(p.join(os.tmpdir(), 'ds-newconv-'));
  (global as { __DS_NEWCONV__?: string }).__DS_NEWCONV__ = dir;
  return {
    app: { getPath: jest.fn(() => dir), getName: jest.fn(() => 'DeepSeek') },
  };
});

import { ConfigStore } from '../src/main/config/ConfigStore';
import { PromptTemplates } from '../src/main/prompts/promptTemplates';
import { Injector } from '../src/main/inject/Injector';

const injector = new Injector(new PromptTemplates(new ConfigStore()));

/** 构造最小 WebContents 桩，executeJavaScript 默认返回 true（与项目约定一致：裸值桩）。 */
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
  const dir = (global as { __DS_NEWCONV__?: string }).__DS_NEWCONV__;
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Injector - injectNewConversationWatcher', () => {
  test('注入脚本仅绑定「捕获阶段 click 监听」（不监听 hashchange），且调用不抛错返回 true', async () => {
    const wc = makeWebContents(true);
    const ok = await injector.injectNewConversationWatcher(wc);
    expect(ok).toBe(true);
    expect(wc.executeJavaScript).toHaveBeenCalledTimes(1);

    const code = scriptsOf(wc)[0];
    // 捕获阶段：document.addEventListener('click', fn, true) —— 关键，兼容动态渲染的「新建对话」按钮
    expect(code).toMatch(/document\.addEventListener\(\s*'click'[\s\S]*?,\s*true\s*\)/);
    // 更正：不再监听 hashchange，避免普通会话切换误触发默认模型切换
    expect(code).not.toContain('hashchange');
    // 触发经预加载 reportNewConversation 经 IPC 上报主进程
    expect(code).toContain('reportNewConversation');
    // 幂等标记：已绑定则直接返回，避免重复注入
    expect(code).toContain('__dsNewConvBound');
    // 新建对话按钮识别函数
    expect(code).toContain('isNewChatButton');
    // 触发前延迟，等 SPA 渲染完新会话再应用默认模型
    expect(code).toContain('setTimeout(report, 350)');
  });

  test('识别「新建对话」按钮：文本 / aria-label 匹配', async () => {
    const wc = makeWebContents(true);
    await injector.injectNewConversationWatcher(wc);
    const code = scriptsOf(wc)[0];
    // 文本匹配 新建对话 / 新对话 / newchat
    expect(code).toContain('新建对话');
    expect(code).toContain('新对话');
    expect(code).toContain('newchat');
    // aria-label 包含 新建对话 / newchat
    expect(code).toContain('新建对话');
  });

  test('executeJavaScript 抛错时返回 false 而不崩溃', async () => {
    const wc = makeWebContents(true);
    wc.executeJavaScript.mockRejectedValueOnce(new Error('boom'));
    const ok = await injector.injectNewConversationWatcher(wc);
    expect(ok).toBe(false);
  });
});
