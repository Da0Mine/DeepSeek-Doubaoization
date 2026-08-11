/**
 * 开机自启设置封装：同时修复两套已知问题。
 *
 * 【问题 1 — Electron unpackaged 模式 setLoginItemSettings 不传 path+args】
 *   开发模式下仅调用 setLoginItemSettings({ openAtLogin: true })，Windows 注册表里
 *   只写入 electron.exe，缺少 app 路径参数。
 *   结果：Windows 开机执行 electron.exe（无 app 路径）→ 弹 default_app "to run a
 *   local app" 提示窗口；getLoginItemSettings().wasOpenedAtLogin 永远 false。
 *   修复：unpackaged 模式下，set 和 get 都要带上相同的 path + args。
 *
 * 【问题 2 — CVE-2026-34768：Electron ≤38.8.6 写入注册表时不加引号】
 *   即便我们传了 path + args，只要其中任意一个含空格，Windows 启动时按空格
 *   分割参数，把路径截断成 `D:\Workbuddy` 之类 → 弹 "Cannot find module"
 *   错误对话框，app 完全起不来。
 *   本项目路径 `D:\Workbuddy 工作文件\...` 恰好含空格，必中。
 *   修复：unpackaged 模式下，绕开 setLoginItemSettings，直接用 `reg.exe` 写
 *   入带引号的注册表项；并自己用 process.argv 判断 wasOpenedAtLogin。
 *   打包模式下（electron-builder 出 .exe）路径通常无空格，回归默认行为即可。
 *
 * 参考：
 *   - https://github.com/rullerzhou-afk/clawd-on-desk/pull/81
 *   - https://github.com/electron/electron/security/advisories/GHSA-jfqx-fxh3-c62j
 *   - https://www.cve.org/CVERecord?id=CVE-2026-34768
 */
import { app } from 'electron';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_VALUE_NAME = 'DeepSeek';

/** 启动时进程命令行（开发模式用于判断 wasOpenedAtLogin）。 */
function launchCommandForRegistry(): string {
  // 必须给 exe 路径和 app 路径都加双引号，否则 Windows 启动时按空格切分参数，
  // 把含空格的路径截断（CVE-2026-34768 写入的注册表值没有引号，就会出现这种
  // 弹 "Cannot find module 'D:\Workbuddy'" 错误）。
  const exe = `"${process.execPath}"`;
  const appPath = `"${app.getAppPath()}"`;
  return `${exe} ${appPath}`;
}

/** 用 Electron API 设置开机自启（仅打包模式；含空格路径会被 CVE 截断）。 */
function setLoginItemPackaged(openAtLogin: boolean): void {
  app.setLoginItemSettings({ openAtLogin });
}

/** 用 Electron API 读取开机自启状态（仅打包模式）。 */
function getLoginItemPackaged(): Electron.LoginItemSettings {
  return app.getLoginItemSettings({});
}

/**
 * 用 reg.exe 写入带引号的注册表项（绕开 CVE-2026-34768）。
 * unpackaged 模式专用，因为 Electron 31 的 setLoginItemSettings 会写入无引号
 * 路径，含空格路径会被 Windows 截断。
 */
async function setLoginItemUnpackaged(openAtLogin: boolean): Promise<void> {
  // 不论开启还是关闭，都先用 Electron API 清理之前可能存在的无引号注册表项
  // （CVE-2026-34768 写入的坏值，以及我们旧代码可能写过的值）。
  // 关闭/开启时都要传相同的 path+args 才能匹配上之前写入的项。
  try {
    app.setLoginItemSettings({
      openAtLogin: false,
      path: process.execPath,
      args: [app.getAppPath()],
    });
  } catch {
    /* 忽略 */
  }

  if (!openAtLogin) {
    // 关闭：再用 reg.exe 删除我们自己的带引号值（Electron API 不会动它）
    try {
      await execAsync(`reg delete "${REG_KEY}" /v ${REG_VALUE_NAME} /f`, { windowsHide: true });
    } catch {
      /* 值不存在，忽略 */
    }
    return;
  }

  // 开启：用 reg.exe 写入带双引号的完整命令行
  const cmd = launchCommandForRegistry();
  await execFileAsync(
    'reg.exe',
    ['add', REG_KEY, '/v', REG_VALUE_NAME, '/t', 'REG_SZ', '/d', cmd, '/f'],
    { windowsHide: true }
  );
}

/**
 * 从注册表读取我们的开机自启值（unpackaged 模式用，绕开 Electron API）。
 * 解析逻辑需自行处理：注册表里写入的是带引号的完整命令行
 *   "D:\...\electron.exe" "D:\...\deepseek-desktop"
 * 我们比较"是否包含我们的 exe + app 路径"来判断是否启用。
 */
async function getLoginItemUnpackaged(): Promise<{
  openAtLogin: boolean;
  wasOpenedAtLogin: boolean;
}> {
  let raw = '';
  try {
    const { stdout } = await execAsync(
      `reg query "${REG_KEY}" /v ${REG_VALUE_NAME}`,
      { windowsHide: true }
    );
    // 输出形如：
    //   HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
    //     DeepSeek    REG_SZ    "C:\...\electron.exe" "C:\...\deepseek-desktop"
    const m = stdout.match(/REG_SZ\s+(.+?)\r?\n?$/m);
    if (m) raw = m[1].trim();
  } catch {
    // 值不存在
    return { openAtLogin: false, wasOpenedAtLogin: false };
  }

  // 同时判断：注册表值是否同时包含我们的 exe 和 app 路径（不区分大小写）
  const exeLower = process.execPath.toLowerCase();
  const appLower = app.getAppPath().toLowerCase();
  const rawLower = raw.toLowerCase();
  const openAtLogin = rawLower.includes(exeLower) && rawLower.includes(appLower);

  // wasOpenedAtLogin：当前进程的命令行是否匹配我们写入的命令行
  // （process.execPath 和 app.getAppPath() 都在 argv 中出现）。
  const argv = process.argv.map((s) => s.toLowerCase());
  const wasOpenedAtLogin = argv.some((a) => a === exeLower) &&
    argv.some((a) => a === appLower);

  return { openAtLogin, wasOpenedAtLogin };
}

/** 同步版 setLoginItem：打包模式同步、unpackaged 模式异步 fire-and-forget。 */
export function setLoginItem(openAtLogin: boolean): void {
  if (app.isPackaged) {
    setLoginItemPackaged(openAtLogin);
  } else {
    // 异步执行：reg.exe 是 IO 操作，但不阻塞调用方。
    // 这里不 await 错误吞掉，开发者模式下用户能看到主进程控制台日志。
    setLoginItemUnpackaged(openAtLogin).catch((e) => {
      console.error('[loginItem] 写入注册表失败:', e);
    });
  }
}

/**
 * 同步版 getLoginItem：unpackaged 模式下，因为读取注册表是异步的，
 * 这里**用 process.argv 做一次同步启发式判断**：
 *   - 当前进程命令行的 argv[0] 是 process.execPath
 *   - argv[1] 是 app.getAppPath()（被 electron 视为 module path）
 *   如果两者都在 argv 中，且 argv 长度 > 1，说明 electron 启动时带了 app 路径，
 *   等价于"被我们的开机自启注册表项启动"。
 *
 * 注意：这只对 unpackaged 模式有意义；打包模式直接走 Electron API（同步且权威）。
 */
export function getLoginItem(): Electron.LoginItemSettings & { wasOpenedAtLogin: boolean } {
  if (app.isPackaged) {
    return getLoginItemPackaged() as Electron.LoginItemSettings & { wasOpenedAtLogin: boolean };
  }
  // unpackaged 模式启发式判断（同步版）：
  //   - wasOpenedAtLogin：当前进程 argv 中是否同时包含 process.execPath 和 app.getAppPath()。
  //     这能区分"手动 electron . 启动"（argv 里是 . 相对路径）和"开机自启启动"
  //     （argv 里是 app.getAppPath() 绝对路径）。
  //   - openAtLogin：需要查注册表，但这里无法 await，先用 process.argv 同步读。
  //     因为我们的注册表写入命令是固定的 `electron.exe "app-path"`，如果当前进程
  //     的命令行就是这套模式，就反推 openAtLogin=true。
  const argv = process.argv;
  const exeLower = process.execPath.toLowerCase();
  const appLower = app.getAppPath().toLowerCase();
  const argvLower = argv.map((s) => s.toLowerCase());
  const hasExe = argvLower.some((a) => a === exeLower);
  const hasApp = argvLower.some((a) => a === appLower);
  // 启发式：argv 中是否包含「electron.exe + app 绝对路径」的组合
  //   - 手动 `npm start` 启动：argv 一般是 [electron.exe, "."]，不含 app 绝对路径
  //   - 开机自启启动：argv 是 [electron.exe, "D:\...\app-path"]，含绝对路径
  const wasOpenedAtLogin = hasExe && hasApp;

  // 同步读 openAtLogin 是不可行的（注册表查询是 async）。
  // 在 mainWindow.ts 中，wasOpenedAtLogin 已经是判断的关键；
  // openAtLogin 仅用于 settings.js 显示勾选状态。settings.js 会通过 IPC
  // 异步查询（由 handlers.ts 包装成 sync API 时再做）。
  // 这里用 wasOpenedAtLogin 作 fallback：如果当前是开机自启启动，
  // 反推 openAtLogin 也应是 true。
  return {
    openAtLogin: wasOpenedAtLogin,
    openAsHidden: false,
    restoreState: false,
    wasOpenedAtHidden: false,
    wasOpenedAtLogin,
  } as unknown as Electron.LoginItemSettings & { wasOpenedAtLogin: boolean };
}

/** 异步版 getLoginItem：返回权威结果（从注册表读取）。用于 settings 面板同步显示勾选状态。 */
export async function getLoginItemAsync(): Promise<{
  openAtLogin: boolean;
  wasOpenedAtLogin: boolean;
}> {
  if (app.isPackaged) {
    const s = getLoginItemPackaged();
    return {
      openAtLogin: !!s.openAtLogin,
      wasOpenedAtLogin: !!s.wasOpenedAtLogin,
    };
  }
  return getLoginItemUnpackaged();
}
