/**
 * 轻量调试日志：写入 logs/autofix-<日期>.log，并同步打印到终端。
 *
 * 启用条件（三选一）：
 *   - 项目根目录存在 .debug-autolog 标记文件（开发期习惯，保持兼容）；
 *   - 或用户数据目录（%APPDATA%/DeepSeek）存在同名标记文件（打包安装后用）；
 *   - 或启动时设置环境变量 DS_DEBUG=1。
 * 未启用时 logf 为 no-op，不影响生产运行。
 *
 * ⚠️ 不要把日志目录写死 process.cwd()：打包安装后从开始菜单快捷方式启动时 cwd 可能是
 * C:\Windows\System32，或用户把程序装到只读目录 —— 建目录失败会让**用户机器上完全没有日志**，
 * 出问题时无从取证。故按「项目根 → 用户数据目录」顺序挑第一个真正可写的位置。
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/** 标记文件候选目录：项目根（开发期）+ 用户数据目录（打包安装后）。 */
function markerDirs(): string[] {
  const dirs: string[] = [];
  try {
    dirs.push(process.cwd());
  } catch {
    /* ignore */
  }
  try {
    dirs.push(app.getPath('userData'));
  } catch {
    /* app 尚未 ready */
  }
  return dirs;
}
/** 惰性判定：logger 可能在 app ready 之前就被 import，那时 markerDirs() 拿不到 userData 路径。 */
let enabledCache: boolean | null = null;
function enabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  enabledCache =
    process.env.DS_DEBUG === '1' ||
    markerDirs().some((d) => {
      try {
        return fs.existsSync(path.join(d, '.debug-autolog'));
      } catch {
        return false;
      }
    });
  return enabledCache;
}

/** 日志目录：按「项目根 → 用户数据目录」挑第一个真正可写的位置（只探测一次）。 */
let logDir: string | null = null;
function resolveLogDir(): string {
  if (logDir) return logDir;
  const candidates: string[] = [];
  try {
    candidates.push(path.resolve(process.cwd(), 'logs'));
  } catch {
    /* ignore */
  }
  try {
    candidates.push(path.join(app.getPath('userData'), 'logs'));
  } catch {
    /* ignore */
  }
  for (const c of candidates) {
    try {
      fs.mkdirSync(c, { recursive: true });
      // 「目录存在」不等于「可写」（Windows 下 access 检查很弱），用真实写探针确认。
      const probe = path.join(c, `.write-probe-${process.pid}`);
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
      logDir = c;
      return c;
    } catch {
      /* 试下一个候选 */
    }
  }
  logDir = candidates.length ? candidates[candidates.length - 1] : 'logs';
  return logDir;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function logFile(): string {
  return path.join(resolveLogDir(), `autofix-${today()}.log`);
}

let dirOk = false;
function ensureDir(): void {
  if (dirOk) return;
  try {
    fs.mkdirSync(resolveLogDir(), { recursive: true });
  } catch {
    /* 忽略：无法建目录则仅打印到终端 */
  }
  dirOk = true;
}

export function isDebugLogEnabled(): boolean {
  return enabled();
}

/** 日志所在目录（供设置面板「打开日志目录」定位文件）。 */
export function getDebugLogDir(): string {
  return resolveLogDir();
}

/**
 * 打开/关闭调试日志（设置面板开关）：在标记目录写/删 `.debug-autolog` 标记文件，
 * 并清缓存重新探测，立即生效、无需重启。
 * 关闭时若仍设置了环境变量 DS_DEBUG=1，则依然视为开启（环境变量优先级最高）。
 * @returns 应用后的实际状态。
 */
export function setDebugLogEnabled(on: boolean): boolean {
  for (const d of markerDirs()) {
    const marker = path.join(d, '.debug-autolog');
    try {
      if (on) fs.writeFileSync(marker, new Date().toISOString() + '\n', 'utf-8');
      else if (fs.existsSync(marker)) fs.unlinkSync(marker);
    } catch {
      /* 目录不可写则跳过（userData 一般可写） */
    }
  }
  enabledCache = null; // 重新探测（含环境变量）
  const cur = enabled();
  logf('DEBUG_LOG', `调试日志${cur ? '已开启' : '已关闭'} 目录=${resolveLogDir()}`);
  return cur;
}

/** 记录一条调试日志：落盘 + 终端打印。 */
export function logf(tag: string, msg: string, extra?: unknown): void {
  if (!enabled()) return;
  // 高频噪音 tag / 一次性诊断 dump（无调试价值、会刷屏）直接丢弃：
  //  layout=每次布局/缩放都打；INPUT_HOOK=每次文本选择/剪贴板都打；web:LOG/WARN=聊天页自身 console；
  //  dom-probe=滚动容器 DOM 结构一次性 dump，体量大且无用。
  // 注：INPUT_HOOK 已临时放行（调试期定位"启动后前几次划词失效"，确认修复后可回归丢弃）。
  if (tag === 'layout' || tag === 'web:LOG' || tag === 'web:WARN' || tag === 'dom-probe') return;
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
