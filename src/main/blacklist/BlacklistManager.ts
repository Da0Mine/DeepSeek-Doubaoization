/**
 * 黑名单管理：进程名集合（持久化到 config.blacklistProcesses）+ 运行检测 + 暂停态。
 * 当黑名单中「任一」进程正在运行时进入暂停态（临时停用快捷键 / 划词 / 系统通知）；
 * 全部退出后自动恢复。暂停态变化通过 onEnterPause / onExitPause 回调通知主进程接线；
 * 暂停态同时写入 blacklistState，供通知 gate 查询。
 *
 * 进程标识：进程名可能带 .exe 也可能不带（如 game.exe 的前缀 game），统一按
 * 进程基名（去 .exe 等扩展）比对，多进程同名按「任一实例在运行」判定。
 */
import { execFile } from 'child_process';
import type { ConfigStore } from '../config/ConfigStore';
import { setBlacklistPaused } from './blacklistState';

/** 进程名规范化：去前后空格、去 .exe 扩展（保留其他扩展以放行自定义后缀）。 */
function normalizeName(raw: string): string {
  let n = String(raw || '').trim();
  if (!n) return '';
  const lower = n.toLowerCase();
  if (lower.endsWith('.exe')) n = n.slice(0, -4).trim();
  return n;
}

/** 批量规范化（并去重）。 */
function normalizeNames(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw || []) {
    const n = normalizeName(r);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * 用 PowerShell 判断给定进程名集合中是否有任一进程在运行。
 * - 进程名带/不带 .exe 均可（归一化后查询）。
 * - 多进程同名（如多个游戏实例）只需任一在运行即为 true。
 * - 失败（命令异常/超时）时返回 false（优雅降级为「不暂停」）。
 */
function anyRunning(names: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    if (!names.length) {
      resolve(false);
      return;
    }
    // 用 PowerShell 数组字面量安全地把名字注入脚本。注意：JSON 的字面量（["a","b"]）在
    // PowerShell 中会被当作「类型名」解析而直接语法报错（Missing type name after '['），
    // 导致 -EncodedCommand 整条失败、检测返回 false → 黑名单永不生效。必须用 @('a','b')。
    // 单引号内的单引号用 '' 转义，避免特殊字符破坏脚本。
    const arr = names.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(',');
    const script = `$n = @(${arr}) -replace '\\.exe$',''; (Get-Process -Name $n -ErrorAction SilentlyContinue | Measure-Object).Count`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 3000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(false);
          return;
        }
        const m = /(\d+)/.exec(String(stdout).trim());
        resolve(!!m && parseInt(m[1], 10) > 0);
      }
    );
  });
}

export class BlacklistManager {
  /** 当前黑名单进程名集合（不含扩展）。 */
  private processes: Set<string> = new Set();
  private paused = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 暂停态进入回调（主进程接它停止快捷键/划词）。 */
  public onEnterPause: (() => void) | null = null;
  /** 暂停态解除回调（主进程接它恢复快捷键/划词）。 */
  public onExitPause: (() => void) | null = null;

  constructor(private readonly config: ConfigStore) {}

  /** 启动：从配置加载黑名单并开始轮询；返回 Promise 完成第一次检测（供主进程启动后立即同步状态）。 */
  public start(): Promise<void> {
    this.reloadFromConfig();
    this.timer = setInterval(() => {
      this.poll().catch(() => {});
    }, 3000);
    return this.poll();
  }

  /** 停止轮询（退出时调用）。 */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 从配置当前值重新加载集合（配置被其它途径改动后调用）。 */
  public reloadFromConfig(): void {
    const list = this.config.get('blacklistProcesses') || [];
    this.processes = new Set(normalizeNames(list));
  }

  /** 返回当前黑名单进程名列表（供设置界面渲染）。 */
  public listProcesses(): string[] {
    return Array.from(this.processes);
  }

  /** 当前是否处于暂停态。 */
  public isPaused(): boolean {
    return this.paused;
  }

  /**
 * 获取「识别到的软件」候选列表（供手动添加的下拉框）：运行中带主窗口的进程名，
 * 去重、排序，并排除本软件(ELECTRON)与常见系统驻留进程。每项附带其 exe 的关联图标
 *（png base64，提取失败/为空时为 null）。
 */
  public listCandidates(): Promise<Array<{ name: string; icon: string | null }>> {
    return new Promise((resolve) => {
      const exclude = new Set([
        'electron', 'explorer', 'dwm', 'ApplicationFrameHost', 'RuntimeBroker',
        'ShellExperienceHost', 'TextInputHost', 'StartMenuExperienceHost', 'SearchHost',
        'conhost', 'svchost', 'csrss', 'winlogon', 'fontdrvhost', 'smartscreen',
        'SecurityHealthSystray', 'msedgewebview2', 'sihost', 'taskhostw', 'ctfmon',
        'WmiPrvSE', 'taskhostex', 'dllhost', 'SettingSyncHost', 'SearchIndexer',
        'focuswnd', 'CalculatorApp', 'Video.UI', 'LockApp',
      ]);
      // 用 System.Drawing 提取每个进程 exe 的关联图标为 png(base64)。取 MainModule.FileName
      // 时某些系统进程会拒绝访问，用 try/catch 跳过 → icon 为空。
      const script = `
Add-Type -AssemblyName System.Drawing
$out = New-Object System.Collections.ArrayList
Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object {
  $n = $_.ProcessName
  $icon = ''
  try {
    $f = $_.MainModule.FileName
    if ($f -and (Test-Path $f)) {
      $ic = [System.Drawing.Icon]::ExtractAssociatedIcon($f)
      if ($ic) {
        $bmp = $ic.ToBitmap()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $icon = [Convert]::ToBase64String($ms.ToArray())
        $ic.Dispose(); $bmp.Dispose(); $ms.Dispose()
      }
    }
  } catch { $icon = '' }
  [void]$out.Add([pscustomobject]@{ name = $n; icon = $icon })
}
$out | ConvertTo-Json -Compress -Depth 3`;
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            resolve([]);
            return;
          }
          try {
            const data = JSON.parse(String(stdout).trim());
            if (!Array.isArray(data)) {
              resolve([]);
              return;
            }
            const out: Array<{ name: string; icon: string | null }> = [];
            for (const it of data) {
              const n = normalizeName(it && it.name);
              if (!n) continue;
              if (exclude.has(n.toLowerCase())) continue;
              const icon = typeof it.icon === 'string' && it.icon ? 'data:image/png;base64,' + it.icon : null;
              out.push({ name: n, icon });
            }
            resolve(out);
          } catch {
            resolve([]);
          }
        }
      );
    });
  }

  /** 加入一个进程名（写回配置 + 立即触发一次检测，使暂停态即时生效）。 */
  public async add(name: string): Promise<boolean> {
    const n = normalizeName(name);
    if (!n || this.processes.has(n)) return false;
    this.processes.add(n);
    this.save();
    await this.poll();
    return true;
  }

  /** 移除一个进程名（写回配置 + 立即触发一次检测）。 */
  public async remove(name: string): Promise<boolean> {
    const n = normalizeName(name);
    if (!n) return false;
    const ok = this.processes.delete(n);
    if (ok) {
      this.save();
      await this.poll();
    }
    return ok;
  }

  /** 写回配置（持久化）。 */
  private save(): void {
    this.config.set('blacklistProcesses', this.listProcesses());
  }

  /** 轮询一次：任一黑名单进程在运行 → 暂停；全不在 → 解除。仅在状态变化时触发回调。 */
  private async poll(): Promise<void> {
    if (this.processes.size === 0) {
      this.applyPaused(false);
      return;
    }
    const running = await anyRunning(this.listProcesses());
    console.log(`[blacklist] poll: names=[${this.listProcesses().join(',')}] running=${running}`);
    this.applyPaused(running);
  }

  private applyPaused(v: boolean): void {
    if (this.paused === v) return;
    this.paused = v;
    // 同步模块级共享状态，供通知 gate 查询
    setBlacklistPaused(v);
    if (v) {
      this.onEnterPause?.();
    } else {
      this.onExitPause?.();
    }
  }
}