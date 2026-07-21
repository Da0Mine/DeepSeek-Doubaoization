/**
 * 轻量调试日志：写入项目根目录 logs/autofix-<日期>.log，并同步打印到终端。
 *
 * 启用条件（二选一）：
 *   - 项目根目录存在 .debug-autolog 标记文件（调试期由主理人创建，确认修好后删除）；
 *   - 或启动时设置环境变量 DS_DEBUG=1。
 * 未启用时 logf 为 no-op，不影响生产运行。
 */
import * as fs from 'fs';
import * as path from 'path';

const markerPath = path.resolve(process.cwd(), '.debug-autolog');
const ENABLED = fs.existsSync(markerPath) || process.env.DS_DEBUG === '1';

const LOG_DIR = path.resolve(process.cwd(), 'logs');

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function logFile(): string {
  return path.join(LOG_DIR, `autofix-${today()}.log`);
}

let dirOk = false;
function ensureDir(): void {
  if (dirOk) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    /* 忽略：无法建目录则仅打印到终端 */
  }
  dirOk = true;
}

export function isDebugLogEnabled(): boolean {
  return ENABLED;
}

/** 记录一条调试日志：落盘 + 终端打印。 */
export function logf(tag: string, msg: string, extra?: unknown): void {
  if (!ENABLED) return;
  const ts = new Date().toISOString();
  let line = `[${ts}] [${tag}] ${msg}`;
  if (extra !== undefined) {
    try {
      const s = typeof extra === 'string' ? extra : JSON.stringify(extra);
      line += ' ' + s;
    } catch {
      line += ' ' + String(extra);
    }
  }
  try {
    ensureDir();
    fs.appendFileSync(logFile(), line + '\n');
  } catch {
    /* 忽略写入错误 */
  }
  console.log(`[LOG:${tag}] ${msg}`, extra ?? '');
}
