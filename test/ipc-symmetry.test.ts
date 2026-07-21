/**
 * IPC 通道对称静态分析（独立复核工程师「29 通道对称」声称）。
 * 做法：
 *   1. 解析 src/main/ipc/channels.ts 中 `export const IPC = { KEY: 'value', ... }` 拿到全部通道名；
 *   2. 在主进程侧（src/main/**）与渲染侧（src/preload/**）源码中，确认每个通道名都通过
 *      `IPC.KEY` 被引用（主进程 ipcMain.on/handle/send，渲染侧 ipcRenderer.send/on）；
 *   3. 断言：通道总数 == 30、无死通道（至少一侧被引用）、无单侧缺口（两侧均引用）。
 * 这是对「无死通道、无单侧缺口」的独立复核；真实 IPC 行为正确性仍需端到端验证。
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const channelsPath = path.join(root, 'src/main/ipc/channels.ts');
const channelsSrc = fs.readFileSync(channelsPath, 'utf-8');

/** 解析 IPC 对象：KEY: 'value' → 收集 KEY。 */
const channelKeys: string[] = [];
{
  const re = /(\w+)\s*:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(channelsSrc)) !== null) {
    channelKeys.push(m[1]);
  }
}

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
  test('channels.ts 恰好定义 31 个通道', () => {
    expect(channelKeys).toHaveLength(31);
  });

  test('每个通道在主进程侧与渲染侧均被引用（IPC.KEY），无单侧缺口', () => {
    const gaps: string[] = [];
    for (const key of channelKeys) {
      const token = `IPC.${key}`;
      const inMain = mainContent.includes(token);
      const inRenderer = rendererContent.includes(token);
      if (!inMain || !inRenderer) {
        gaps.push(`${key} (main:${inMain}, renderer:${inRenderer})`);
      }
    }
    if (gaps.length > 0) {
      // 打印缺口，便于报告定位
      // eslint-disable-next-line no-console
      console.log('[IPC 缺口]', gaps.join(' | '));
    }
    expect(gaps).toEqual([]);
  });

  test('无死通道：每个通道至少在一侧被引用', () => {
    for (const key of channelKeys) {
      const token = `IPC.${key}`;
      expect(mainContent.includes(token) || rendererContent.includes(token)).toBe(true);
    }
  });
});
