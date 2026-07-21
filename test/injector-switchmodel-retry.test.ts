/**
 * Injector - switchModelMode 健壮性回归（问题 A 修复）。
 * 用最小桩 mock 掉 webContents.executeJavaScript，模拟「目标 radio 先折叠/不可见、
 * 展开后再次出现」的真实场景，验证：
 *   - 已是目标模式则立即返回 true（裸布尔短路）；
 *   - 目标 radio 先 hidden、展开选择器后再次出现时，会重试并可信点击（sendInputEvent 被调用）；
 *   - 最终 aria-checked 变为 true 即返回 true。
 * 选择器与真实 DOM 行为属「待实机验证」；此处只验证重试/展开/点击的接线契约
 * （问题 A 的核心：不再「找不到按钮」就立刻放弃）。
 */
import type { WebContents } from 'electron';

function makeWebContents(): WebContents & { executeJavaScript: jest.Mock; sendInputEvent: jest.Mock; focus: jest.Mock } {
  return {
    executeJavaScript: jest.fn(),
    sendInputEvent: jest.fn(),
    focus: jest.fn(),
  } as unknown as WebContents & { executeJavaScript: jest.Mock; sendInputEvent: jest.Mock; focus: jest.Mock };
}

// 延迟引入，确保 jest.mock('electron') 已在 injector.test 中注册（共享模块缓存）。
import { ConfigStore } from '../src/main/config/ConfigStore';
import { PromptTemplates } from '../src/main/prompts/promptTemplates';
import { Injector } from '../src/main/inject/Injector';

const cfg = new ConfigStore();
const injector = new Injector(new PromptTemplates(cfg));

describe('Injector - switchModelMode (问题 A 健壮性)', () => {
  test('已是目标模式时立即返回 true（不点击）', async () => {
    const wc = makeWebContents();
    wc.executeJavaScript.mockImplementation((code: string) => {
      if (code.includes('data-model-type="expert"') && code.includes('aria-checked')) {
        return Promise.resolve(true); // 已选中
      }
      return Promise.resolve(true);
    });
    const ok = await injector.switchModelMode(wc, 'expert');
    expect(ok).toBe(true);
    expect(wc.sendInputEvent).not.toHaveBeenCalled();
  });

  test('目标 radio 先折叠(hidden)，展开后出现并可信点击，最终切换成功', async () => {
    let ariaCalls = 0;
    let rectHidden = true;
    const wc = makeWebContents();
    wc.executeJavaScript.mockImplementation((code: string) => {
      // 读取/轮询 aria-checked：首次(already)返回 false，后续轮询返回 true
      if (code.includes('data-model-type="expert"') && code.includes('aria-checked') && !code.includes('getBoundingClientRect')) {
        ariaCalls += 1;
        return Promise.resolve(ariaCalls === 1 ? false : true);
      }
      // 当前选中 radio 坐标查询（expandModelSelector）：返回坐标触发展开点击
      if (code.includes('aria-checked="true"') && code.includes('[role="radio"]')) {
        return Promise.resolve({ x: 1, y: 1 });
      }
      // 目标 radio 可见性轮询：首次 hidden，之后返回可见坐标
      if (code.includes('getBoundingClientRect') && code.includes('data-model-type="expert"')) {
        if (rectHidden) {
          rectHidden = false;
          return Promise.resolve({ hidden: true });
        }
        return Promise.resolve({ x: 100, y: 50, width: 40, height: 20 });
      }
      return Promise.resolve(true);
    });
    const ok = await injector.switchModelMode(wc, 'expert');
    expect(ok).toBe(true);
    // 至少一次可信点击（mouseUp）
    expect(wc.sendInputEvent).toHaveBeenCalled();
    const kinds = wc.sendInputEvent.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(kinds).toContain('mouseUp');
  });
});
