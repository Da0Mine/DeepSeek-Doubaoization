/**
 * 窗口吸附枚举：截图遮罩的「悬浮吸附窗口，点击完成框选」功能。
 * Windows 无现成 API 枚举所有窗口边界，用 PowerShell 内联 C# 调 user32 一次性枚举
 * 所有可见顶层窗口矩形（EnumWindows 按 Z 序从顶到底），再换算成遮罩（主屏）局部 CSS 坐标下发。
 */
import { screen } from 'electron';
import { execFile } from 'child_process';

/** 下发到遮罩的窗口矩形（overlay 局部坐标，CSS 像素）。h 为窗口句柄，仅供主进程过滤（不透传到渲染层）。 */
export interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 窗口句柄（数字），用于排除遮罩自身等窗口；渲染层忽略。 */
  h?: number;
}

/** PowerShell 输出的原始窗口（物理像素）。 */
interface RawWindow {
  hw: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// PowerShell 脚本：内联 C#（user32）按真实 Z 序（从顶到底）遍历可见顶层窗口矩形，输出 JSON。
// 注意：EnumWindows 的枚举顺序未定义（不是 Z 序），若有两个最大化全屏窗口叠放，列表前部的
// 全屏窗口会吞掉所有悬浮命中（表现为吸附框固定在左上角的全屏）。必须用 GetTopWindow +
// GetWindow(GW_HWNDNEXT) 沿 Z 序链遍历，才能保证「悬浮命中最上层窗口」。
// 过滤规则：系统壳窗口（桌面/任务栏/输入法层等）+ 工具窗口（WS_EX_TOOLWINDOW，含全屏透明特效层）。
const PS_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinSnap {
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
  public static extern IntPtr GetWindowLongPtr64(IntPtr h, int n);
  [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
  public static extern IntPtr GetWindowLong32(IntPtr h, int n);
  public static long GetExStyle(IntPtr h) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(h, -20).ToInt64() : GetWindowLong32(h, -20).ToInt64();
  }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$list = New-Object System.Collections.ArrayList
$h = [WinSnap]::GetTopWindow([IntPtr]::Zero)
while ($h -ne [IntPtr]::Zero) {
  if ([WinSnap]::IsWindowVisible($h)) {
    $r = New-Object WinSnap+RECT
    [WinSnap]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = $r.Right - $r.Left
    $ht = $r.Bottom - $r.Top
    if ($w -ge 24 -and $ht -ge 24) {
      $sb = New-Object System.Text.StringBuilder 256
      [WinSnap]::GetClassName($h, $sb, 256) | Out-Null
      $cn = $sb.ToString()
      if ($cn -notin @('Progman','WorkerW','Shell_TrayWnd','Shell_SecondaryTrayWnd','DV2ControlHost','TaskListThumbnailWnd','MultitaskingViewFrame','ImmersiveLauncher','Windows.UI.Core.CoreWindow','DummyDWMListenerWindow','ThumbnailDeviceHelperWnd')) {
        if (([WinSnap]::GetExStyle($h) -band 0x80) -eq 0) {
          [void]$list.Add([pscustomobject]@{ hw=('0x{0:X}' -f $h.ToInt64()); x=$r.Left; y=$r.Top; w=$w; h=$ht })
        }
      }
    }
  }
  $h = [WinSnap]::GetWindow($h, 2)
}
$list | ConvertTo-Json -Compress -Depth 3
`;

/** 执行 PowerShell 脚本，返回原始窗口列表；失败返回空数组（吸附功能优雅降级）。 */
function runPowerShell(): Promise<RawWindow[]> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          const data = JSON.parse(stdout.trim());
          resolve(Array.isArray(data) ? data : []);
        } catch {
          resolve([]);
        }
      }
    );
  });
}

/**
 * 枚举可见顶层窗口矩形，转成遮罩（主屏）局部 CSS 坐标，输出顺序仅代表枚举顺序（渲染层用「面积最小」命中）。
 * 坐标换算说明（自适应任意 DPI 缩放）：
 * - PowerShell 的 GetWindowRect 返回物理像素；Electron 的 display.size 也是物理像素。
 * - Electron 的 display.bounds 是遮罩 overlay 的实际视口尺寸（部分环境返回物理值、部分返回 DIP）。
 * - 统一用「物理坐标 → bounds 尺寸」比例映射：css = (物理 - 主屏物理原点) / 主屏物理尺寸 × bounds 尺寸。
 *   这样无论 Electron 在此环境报告 bounds 为物理还是 DIP，吸附框都能与鼠标位置精确对齐。
 * @param skipHandles 需排除的窗口句柄（本应用窗口，如「截图时保留窗口」开启时）。
 */
export async function enumWindowSnapRects(skipHandles: number[] = []): Promise<SnapRect[]> {
  const skip = new Set(skipHandles);
  const rawList = await runPowerShell();
  const primary = screen.getPrimaryDisplay();
  // 主屏物理范围（display.size 为物理像素）
  const physW = primary.size.width || primary.bounds.width;
  const physH = primary.size.height || primary.bounds.height;
  if (physW <= 0 || physH <= 0) return [];
  // 主屏物理原点：按 bounds 与 size 同比例换算（bounds.x 相对 bounds.width）
  const physX0 = (primary.bounds.x / primary.bounds.width) * physW;
  const physY0 = (primary.bounds.y / primary.bounds.height) * physH;
  const out: SnapRect[] = [];
  for (const r of rawList) {
    const hwnd = parseInt(r.hw, 16);
    if (!Number.isFinite(hwnd) || skip.has(hwnd)) continue;
    // 裁剪到主屏物理范围（最大化窗口的 DWM 阴影带负偏移，不裁剪会导致选区越界、主进程 crop 失败）
    const clipX = Math.max(physX0, r.x);
    const clipY = Math.max(physY0, r.y);
    const clipR = Math.min(r.x + r.w, physX0 + physW);
    const clipB = Math.min(r.y + r.h, physY0 + physH);
    const cw = clipR - clipX;
    const ch = clipB - clipY;
    if (cw < 16 || ch < 16) continue;
    // 物理坐标 → overlay 局部 CSS（比例映射，自适应 DPI）
    out.push({
      x: ((clipX - physX0) / physW) * primary.bounds.width,
      y: ((clipY - physY0) / physH) * primary.bounds.height,
      width: (cw / physW) * primary.bounds.width,
      height: (ch / physH) * primary.bounds.height,
      h: hwnd,
    });
  }
  return out;
}
