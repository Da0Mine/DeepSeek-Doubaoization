/**
 * IPC 通道对称静态分析。
 * 做法：
 *   1. 直接引入 src/main/ipc/channels.ts 的 IPC 导出（唯一真相），拿到全部通道键；
 *   2. 在主进程侧（src/main/**）与预加载侧（src/preload/**）源码中，确认每个通道键都通过
 *      `IPC.KEY` 至少被一侧引用（主进程 ipcMain.on/handle/send 或注入脚本、预加载 ipcRenderer.send/on）；
 *   3. 断言：无死通道（每个通道至少一侧被引用）、无重复键、通道值合法。
 * 说明：部分通道（如 main -> webview 的发送通道）由主进程在注入脚本里以 `IPC.KEY`
 * 引用，因此「两侧均引用」不适用本组织方式；这里只校验「无死通道」这一有意义的对称不变量。
 * 真实 IPC 行为正确性仍需端到端验证。
 */
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '../src/main/ipc/channels';

const root = path.resolve(__dirname, '..');

/** 以 IPC 导出为唯一真相（替代从源码正则解析，规避注释/类型被误计入）。 */
const channelKeys = Object.keys(IPC);

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectFiles(fp));
    else if (e.name.endsWith('.ts')) out.push(fp);
  }
  return out;
}

const mainDir = path.join(root, 'src/main');
const rendererDir = path.join(root, 'src/preload');
const mainContent = collectFiles(mainDir).map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
const rendererContent = collectFiles(rendererDir).map((f) => fs.readFileSync(f, 'utf-8')).join('\n');

describe('IPC 通道对称 - 静态分析', () => {
  test('channels.ts 定义通道集合且键名唯一、通道值合法', () => {
    expect(channelKeys.length).toBeGreaterThanOrEqual(100);
    // 键名唯一
    expect(new Set(channelKeys).size).toBe(channelKeys.length);
    // 每个通道值是非空字符串（格式如 '域:动作'）
    for (const k of channelKeys) {
      expect(typeof IPC[k as keyof typeof IPC]).toBe('string');
      expect((IPC[k as keyof typeof IPC] as unknown as string).length).toBeGreaterThan(0);
    }
  });

  test('无死通道：每个通道至少在主进程侧或预加载侧被引用（IPC.KEY），无完全未接线通道', () => {
    const dead: string[] = [];
    for (const key of channelKeys) {
      const token = `IPC.${key}`;
      const inMain = mainContent.includes(token);
      const inRenderer = rendererContent.includes(token);
      if (!inMain && !inRenderer) {
        dead.push(`${key}`);
      }
    }
    if (dead.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[IPC 死通道]', dead.join(' | '));
    }
    expect(dead).toEqual([]);
  });
});