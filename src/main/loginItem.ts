/**
 * 开机自启设置封装（统一 reg.exe 方案）。
 *
 * 【背景 — CVE-2026-34768：Electron ≤38.8.6 写入注册表时不加引号】
 *   app.setLoginItemSettings 在含空格路径（本项目 `D:\Workbuddy 工作文件\...`）下
 *   写入无引号值，Windows 启动时按空格截断 → 弹 "Cannot find module" 错误。
 *   且打包版 wasOpenedAtLogin（Electron 内部解析 Run 项）对无引号值 / 多自启项
 *   并存时判断不稳定，导致「开机自启却弹出主窗口」。
 *
 * 【统一方案】
 *   - 开发版 / 打包版一律用 `reg.exe` 写入带引号的命令，并附加自启标记参数
 *     `--login-start`；
 *   - wasOpenedAtLogin 直接判断当前进程 argv 是否含 `--login-start`：
 *     开机自启启动 → 含标记 → 托盘；手动双击 / npm start → 无标记 → 正常显示。
 *     彻底绕开 Electron API 的不稳定判断。
 *   - 设置时先清理全部 DeepSeek 相关 Run 项（DeepSeek / electron.app.DeepSeek），
 *     避免开发版 / 打包版双自启项并存导致开机双实例竞争、second-instance 弹窗。
 */
import { app } from 'electron';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
/** 本应用可能存在的全部自启注册表值名（开发版 / Electron 默认值名），设置时统一清理。 */
const REG_ENTRY_NAMES = ['DeepSeek', 'electron.app.DeepSeek'];
/** 自启启动标记参数：开机自启时附加，用于区分「自启启动」与「手动双击 / 手动 npm start」。 */
const LOGIN_FLAG = '--login-start';

/** 自启注册表命令：exe + (unpackaged 时 app 路径) + --login-start，路径全部加双引号防截断。 */
function launchCommandForRegistry(): string {
  const exe = `"${process.execPath}"`;
  const appArg = app.isPackaged ? '' : ` "${app.getAppPath()}"`;
  return `${exe}${appArg} ${LOGIN_FLAG}`;
}

/** 删除全部 DeepSeek 相关自启项。 */
async function cleanupAllEntries(): Promise<void> {
  for (const name of REG_ENTRY_NAMES) {
    try {
      await execAsync(`reg delete "${REG_KEY}" /v ${name} /f`, { windowsHide: true });
    } catch {
      /* 值不存在，忽略 */
    }
  }
}

/** 用 reg.exe 写入带引号 + 自启标记的注册表项（统一开发/打包模式）。 */
async function setLoginItemViaReg(openAtLogin: boolean): Promise<void> {
  // 先清理旧的（含 Electron API 写入的 electron.app.* 项），避免双自启项并存
  await cleanupAllEntries();
  if (!openAtLogin) return;
  const cmd = launchCommandForRegistry();
  await execFileAsync(
    'reg.exe',
    ['add', REG_KEY, '/v', 'DeepSeek', '/t', 'REG_SZ', '/d', cmd, '/f'],
    { windowsHide: true }
  );
}

/** 同步版 setLoginItem：统一异步写入（fire-and-forget，错误打印到主进程控制台）。 */
export function setLoginItem(openAtLogin: boolean): void {
  setLoginItemViaReg(openAtLogin).catch((e) => {
    console.error('[loginItem] 写入注册表失败:', e);
  });
}

/** 当前进程是否由开机自启启动（argv 含 --login-start）。 */
function wasOpenedByLoginFlag(): boolean {
  return process.argv.includes(LOGIN_FLAG);
}

/**
 * 同步版 getLoginItem：wasOpenedAtLogin 用 --login-start 标记判断
 * （可靠区分自启 / 手动启动）。openAtLogin 为同步启发式（与自启标记一致）。
 */
export function getLoginItem(): Electron.LoginItemSettings & { wasOpenedAtLogin: boolean } {
  const wasOpenedAtLogin = wasOpenedByLoginFlag();
  return {
    openAtLogin: wasOpenedAtLogin,
    openAsHidden: false,
    restoreState: false,
    wasOpenedAtHidden: false,
    wasOpenedAtLogin,
  } as unknown as Electron.LoginItemSettings & { wasOpenedAtLogin: boolean };
}

/** 异步版 getLoginItem：从注册表读取权威结果（设置面板显示勾选状态用）。 */
export async function getLoginItemAsync(): Promise<{
  openAtLogin: boolean;
  wasOpenedAtLogin: boolean;
}> {
  let raw = '';
  for (const name of REG_ENTRY_NAMES) {
    try {
      const { stdout } = await execAsync(`reg query "${REG_KEY}" /v ${name}`, { windowsHide: true });
      const m = stdout.match(/REG_SZ\s+(.+?)\r?\n?$/m);
      if (m) {
        raw = m[1].trim();
        break;
      }
    } catch {
      /* 该项不存在，查下一个 */
    }
  }
  const exeLower = process.execPath.toLowerCase();
  const openAtLogin = !!raw && raw.toLowerCase().includes(exeLower);
  return { openAtLogin, wasOpenedAtLogin: wasOpenedByLoginFlag() };
}
