/**
 * WPS 文档共享管理器：通过 Windows COM（PowerShell 包装）访问 WPS 文字
 * （ProgID `Kwps.Application`），枚举当前打开的文档、读取文档最新内容。
 *
 * 说明：
 * - 用 `[Marshal]::GetActiveObject` 获取「已运行的」WPS 实例，只枚举用户
 *   真正打开的文档（不启动新实例、不新建文档）。
 * - 读取内容直接取 `Document.Content.Text`（内存最新版，含未保存修改），
 *   不做 Save()——避免未命名文档触发「另存为」对话框卡死子进程。
 * - PowerShell 用 `-EncodedCommand`（base64 UTF-16LE）传参，彻底规避引号转义。
 * - 输出可能混入 CLIXML 进度流，解析时正则提取 JSON 片段。
 */
import { execFile } from 'child_process';

/** 打开的 WPS 文字文档信息。 */
export interface WpsDocInfo {
  /** 文档名（含扩展名），如「报告.docx」。 */
  name: string;
  /** 完整路径。 */
  full: string;
}

const POWER_SHELL = 'powershell.exe';
const TIMEOUT_MS = 15000;

/** 从 PowerShell 输出中提取 JSON 片段（对象或数组），失败返回 null。 */
function extractJson(raw: string): string | null {
  const s = raw || '';
  const objIdx = s.indexOf('{');
  const arrIdx = s.indexOf('[');
  let start = -1;
  let end = -1;
  if (objIdx === -1 && arrIdx === -1) return null;
  if (objIdx === -1) start = arrIdx;
  else if (arrIdx === -1) start = objIdx;
  else start = Math.min(objIdx, arrIdx);
  const c = s[start];
  const close = c === '[' ? ']' : '}';
  end = s.lastIndexOf(close);
  if (end <= start) return null;
  return s.slice(start, end + 1);
}

/** 执行 PowerShell EncodedCommand，返回 stdout 文本。 */
function runPs(script: string): Promise<string> {
  const enc = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile(
      POWER_SHELL,
      ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', enc],
      { timeout: TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        if (err) {
          // 超时/执行失败：视为无结果（可能 WPS 未运行等）
          resolve('');
          return;
        }
        resolve(stdout || '');
      }
    );
  });
}

export class WpsDocManager {
  /**
   * 获取当前前台窗口标题（用于合并共享时把「正在激活」的文档排到最前）。
   * 前台窗口通常是 WPS 或用户正在操作的窗口；标题形如「文档名 - WPS 文字」。
   * 失败 / 无前台窗口返回空字符串。
   */
  public async getForegroundWindowTitle(): Promise<string> {
    const script = `$ProgressPreference='SilentlyContinue'
$sig = @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
'@
Add-Type -MemberDefinition $sig -Name FgWin -Namespace Win32Fg
$h = [Win32Fg.FgWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][Win32Fg.FgWin]::GetWindowText($h, $sb, 512)
Write-Output $sb.ToString()`;
    const raw = await runPs(script);
    return (raw || '').trim();
  }

  /**
   * 枚举当前打开的全部 WPS 文字文档。
   * 最后活动的文档（ActiveDocument）排第一，作为默认选中项。
   * WPS 未运行 / 未打开文档 / COM 不可用时返回空数组。
   */
  public async listDocuments(): Promise<WpsDocInfo[]> {
    const script = `$ProgressPreference='SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  $a = [Runtime.InteropServices.Marshal]::GetActiveObject('Kwps.Application')
  $activeName = $null
  try { $activeName = $a.ActiveDocument.Name } catch {}
  $list = New-Object System.Collections.ArrayList
  foreach ($d in $a.Documents) { [void]$list.Add(@{ name = [string]$d.Name; full = [string]$d.FullName }) }
  if ($activeName) {
    $idx = -1
    for ($i = 0; $i -lt $list.Count; $i++) { if ([string]$list[$i].name -eq [string]$activeName) { $idx = $i; break } }
    if ($idx -gt 0) { $t = $list[$idx]; $list.RemoveAt($idx); $list.Insert(0, $t) }
  }
  Write-Output ($list | ConvertTo-Json -Compress)
} catch { Write-Output '[]' }`;
    try {
      const raw = await runPs(script);
      const json = extractJson(raw);
      if (!json) return [];
      const parsed = JSON.parse(json) as unknown;
      // ConvertTo-Json 对单个文档输出「对象」而非「数组」，统一容错为数组
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr
        .filter((it: unknown) => it && typeof it === 'object')
        .map((it) => ({ name: String((it as { name?: unknown }).name ?? ''), full: String((it as { full?: unknown }).full ?? '') }))
        .filter((it) => it.name.length > 0);
    } catch (e) {
      console.error('[WpsDoc] 枚举文档失败:', e);
      return [];
    }
  }

  /**
   * 获取指定文档的本地文件路径（保存最新版到磁盘），并返回内容哈希与大小。
   * 已保存文档：Save() 后返回原路径；未保存的新建文档：SaveAs 到临时目录后返回临时路径。
   * @param name 文档名；为空时获取 ActiveDocument。
   * @returns { name, full, hasPath, hash, size }；失败或文档已关闭返回 null。
   */
  public async getDocumentFile(name?: string): Promise<{ name: string; full: string; hasPath: boolean; hash: string; size: number } | null> {
    const nameJson = JSON.stringify(name ?? '');
    const script = `$ProgressPreference='SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  $a = [Runtime.InteropServices.Marshal]::GetActiveObject('Kwps.Application')
  $target = ${nameJson}
  $doc = $null
  if ($target) { foreach ($d in $a.Documents) { if ([string]$d.Name -eq $target) { $doc = $d; break } } }
  if (-not $doc) { $doc = $a.ActiveDocument }
  if (-not $doc) { Write-Output 'null'; exit }
  $full = [string]$doc.FullName
  $hasPath = ($full -and $full.Contains(':'))
  if ($hasPath) {
    try { $doc.Save() } catch {}
  } else {
    # 未保存的新建文档：另存为临时文件，作为附件上传
    try {
      $tmp = Join-Path $env:TEMP ('deepseek-docshare-' + [guid]::NewGuid().ToString('N') + '.docx')
      $doc.SaveAs($tmp)
      if (Test-Path $tmp) { $full = $tmp; $hasPath = $true }
    } catch {}
  }
  $text = [string]$doc.Content.Text
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','')
  Write-Output (@{ name = [string]$doc.Name; full = $full; hasPath = $hasPath; hash = $hash; size = $text.Length } | ConvertTo-Json -Compress)
} catch { Write-Output 'null' }`;
    try {
      const raw = await runPs(script);
      const json = extractJson(raw);
      if (!json || json === 'null') return null;
      const parsed = JSON.parse(json) as { name?: unknown; full?: unknown; hasPath?: unknown; hash?: unknown; size?: unknown };
      return {
        name: String(parsed.name ?? ''),
        full: String(parsed.full ?? ''),
        hasPath: parsed.hasPath === true,
        hash: String(parsed.hash ?? ''),
        size: Number(parsed.size ?? 0),
      };
    } catch (e) {
      console.error('[WpsDoc] 获取文档文件失败:', e);
      return null;
    }
  }

  /**
   * 轻量检测：读取文档内容哈希与大小（不保存），用于轮询判断文档是否被改动。
   * @param name 文档名；为空时检测 ActiveDocument。
   */
  public async getDocumentDigest(name?: string): Promise<{ hash: string; size: number } | null> {
    const nameJson = JSON.stringify(name ?? '');
    const script = `$ProgressPreference='SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  $a = [Runtime.InteropServices.Marshal]::GetActiveObject('Kwps.Application')
  $target = ${nameJson}
  $doc = $null
  if ($target) { foreach ($d in $a.Documents) { if ([string]$d.Name -eq $target) { $doc = $d; break } } }
  if (-not $doc) { $doc = $a.ActiveDocument }
  if (-not $doc) { Write-Output 'null'; exit }
  $text = [string]$doc.Content.Text
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','')
  Write-Output (@{ hash = $hash; size = $text.Length } | ConvertTo-Json -Compress)
} catch { Write-Output 'null' }`;
    try {
      const raw = await runPs(script);
      const json = extractJson(raw);
      if (!json || json === 'null') return null;
      const parsed = JSON.parse(json) as { hash?: unknown; size?: unknown };
      return { hash: String(parsed.hash ?? ''), size: Number(parsed.size ?? 0) };
    } catch (e) {
      console.error('[WpsDoc] 检测文档改动失败:', e);
      return null;
    }
  }

  // ---------------- WPS 表格（Ket.Application） ----------------

  /**
   * ROT（Running Object Table）辅助：多实例场景下 GetActiveObject 只能拿到
   * ROT 中最后注册的实例（可能是无工作簿的后台进程），而每个打开的表格会以
   * 文件路径注册独立的 moniker。因此改走 ROT：按文件路径 moniker 绑定到具体
   * 工作簿，未保存的新建工作簿则从 CLSID moniker 的实例取 ActiveWorkbook。
   */
  private static readonly ROT_HELPER = `Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Reflection;
public static class WpsRot {
  [DllImport(\"ole32.dll\")] static extern int GetRunningObjectTable(int reserved, out IRunningObjectTable prot);
  [DllImport(\"ole32.dll\")] static extern int CreateBindCtx(int reserved, out IBindCtx ppbc);
  [DllImport(\"ole32.dll\")] static extern int MkParseDisplayName(IBindCtx pbc, [MarshalAs(UnmanagedType.LPWStr)] string szDisplayName, out int pchEaten, out IMoniker ppmk);
  static object GetProp(object o, string n) {
    try { return o.GetType().InvokeMember(n, BindingFlags.GetProperty, null, o, null); } catch { return null; }
  }
  static string GetStr(object o, string n) { try { object v = GetProp(o, n); return v == null ? \"\" : v.ToString(); } catch { return \"\"; } }
  public static string[] ListExcel() {
    var res = new List<string>();
    try {
      IRunningObjectTable rot;
      if (GetRunningObjectTable(0, out rot) != 0) return res.ToArray();
      IEnumMoniker en; rot.EnumRunning(out en);
      IMoniker[] m = new IMoniker[1]; IntPtr f = IntPtr.Zero;
      while (en.Next(1, m, f) == 0) {
        try {
          IBindCtx bc; CreateBindCtx(0, out bc);
          string disp; m[0].GetDisplayName(bc, null, out disp);
          if (Regex.IsMatch(disp, @"\\.(xlsx|xlsm|xls|csv)$", RegexOptions.IgnoreCase)) {
            IMoniker pm; int eaten; object wb = null;
            if (MkParseDisplayName(bc, disp, out eaten, out pm) == 0) { try { rot.GetObject(pm, out wb); } catch {} }
            if (wb != null) {
              string nm = GetStr(wb, \"Name\");
              if (nm.Length > 0) res.Add(nm + \"\\t\" + GetStr(wb, \"FullName\"));
            }
          }
        } catch {}
      }
    } catch {}
    return res.ToArray();
  }
  // 仅按 ROT moniker 显示名（完整文件路径）枚举表格，不访问工作簿对象。
  // WPS 多组件整合模式（et.exe /from_prome）下工作簿对象可能是空壳（Name/Sheets 取不到），
  // 但 moniker 显示名始终包含完整路径，可据此显示文档并回退读取磁盘文件。
  public static string[] ListExcelPaths() {
    var res = new List<string>();
    try {
      IRunningObjectTable rot;
      if (GetRunningObjectTable(0, out rot) != 0) return res.ToArray();
      IEnumMoniker en; rot.EnumRunning(out en);
      IMoniker[] m = new IMoniker[1]; IntPtr f = IntPtr.Zero;
      while (en.Next(1, m, f) == 0) {
        try {
          IBindCtx bc; CreateBindCtx(0, out bc);
          string disp; m[0].GetDisplayName(bc, null, out disp);
          if (Regex.IsMatch(disp, @"\\.(xlsx|xlsm|xls|csv)$", RegexOptions.IgnoreCase)) res.Add(disp);
        } catch {}
      }
    } catch {}
    return res.ToArray();
  }
  public static object OpenByName(string name) {
    try {
      IRunningObjectTable rot;
      if (GetRunningObjectTable(0, out rot) != 0) return null;
      IEnumMoniker en; rot.EnumRunning(out en);
      IMoniker[] m = new IMoniker[1]; IntPtr f = IntPtr.Zero;
      while (en.Next(1, m, f) == 0) {
        try {
          IBindCtx bc; CreateBindCtx(0, out bc);
          string disp; m[0].GetDisplayName(bc, null, out disp);
          bool isFile = Regex.IsMatch(disp, @"\\.(xlsx|xlsm|xls|csv)$", RegexOptions.IgnoreCase);
          object wb = null;
          if (isFile) {
            IMoniker pm; int eaten;
            if (MkParseDisplayName(bc, disp, out eaten, out pm) == 0) { try { rot.GetObject(pm, out wb); } catch {} }
          } else if (disp.StartsWith(\"!\")) {
            try { rot.GetObject(m[0], out wb); } catch {}
            if (wb != null) {
              try { object aw = wb.GetType().InvokeMember(\"ActiveWorkbook\", BindingFlags.GetProperty, null, wb, null); if (aw != null) wb = aw; } catch {}
            }
          }
          if (wb != null) {
            string nm = GetStr(wb, \"Name\");
            if (nm == name) return wb;
          }
        } catch {}
      }
    } catch {}
    return null;
  }
  public static string[] ListPdf() {
    var res = new List<string>();
    try {
      IRunningObjectTable rot;
      if (GetRunningObjectTable(0, out rot) != 0) return res.ToArray();
      IEnumMoniker en; rot.EnumRunning(out en);
      IMoniker[] m = new IMoniker[1]; IntPtr f = IntPtr.Zero;
      while (en.Next(1, m, f) == 0) {
        try {
          IBindCtx bc; CreateBindCtx(0, out bc);
          string disp; m[0].GetDisplayName(bc, null, out disp);
          if (Regex.IsMatch(disp, @"\\.pdf$", RegexOptions.IgnoreCase)) {
            IMoniker pm; int eaten; object wb = null;
            if (MkParseDisplayName(bc, disp, out eaten, out pm) == 0) { try { rot.GetObject(pm, out wb); } catch {} }
            if (wb != null) {
              string nm = GetStr(wb, \"Name\");
              if (nm.Length > 0) res.Add(nm + \"\\t\" + GetStr(wb, \"FullName\"));
            }
          }
        } catch {}
      }
    } catch {}
    return res.ToArray();
  }
  public static object OpenPdfByName(string name) {
    try {
      IRunningObjectTable rot;
      if (GetRunningObjectTable(0, out rot) != 0) return null;
      IEnumMoniker en; rot.EnumRunning(out en);
      IMoniker[] m = new IMoniker[1]; IntPtr f = IntPtr.Zero;
      while (en.Next(1, m, f) == 0) {
        try {
          IBindCtx bc; CreateBindCtx(0, out bc);
          string disp; m[0].GetDisplayName(bc, null, out disp);
          bool isFile = Regex.IsMatch(disp, @"\\.pdf$", RegexOptions.IgnoreCase);
          object wb = null;
          if (isFile) {
            IMoniker pm; int eaten;
            if (MkParseDisplayName(bc, disp, out eaten, out pm) == 0) { try { rot.GetObject(pm, out wb); } catch {} }
          }
          if (wb != null) {
            string nm = GetStr(wb, \"Name\");
            if (nm == name) return wb;
          }
        } catch {}
      }
    } catch {}
    return null;
  }
}
"@`;

  /**
   * 枚举当前打开的全部 WPS 表格工作簿。
   * 走 ROT moniker 显示名（完整路径）而非工作簿对象：WPS 多组件整合模式下
   * 工作簿对象可能是空壳（Name/Sheets 取不到），但 moniker 显示名始终可靠。
   * 返回顺序为 ROT 注册顺序（通常最近打开在前），第一个作为默认选中项。
   */
  public async listExcelDocuments(): Promise<WpsDocInfo[]> {
    const script = `$ProgressPreference='SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
${WpsDocManager.ROT_HELPER}
$paths = [WpsRot]::ListExcelPaths()
$out = New-Object System.Collections.ArrayList
foreach ($fp in $paths) {
  if ($fp) { [void]$out.Add(@{ name = [IO.Path]::GetFileName($fp); full = $fp }) }
}
Write-Output ($out | ConvertTo-Json -Compress)`;
    try {
      const raw = await runPs(script);
      const json = extractJson(raw);
      if (!json) return [];
      const parsed = JSON.parse(json) as unknown;
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr
        .filter((it: unknown) => it && typeof it === 'object')
        .map((it) => ({ name: String((it as { name?: unknown }).name ?? ''), full: String((it as { full?: unknown }).full ?? '') }))
        .filter((it) => it.name.length > 0);
    } catch (e) {
      console.error('[WpsDoc] 枚举表格失败:', e);
      return [];
    }
  }

  /** 表格内容摘要（表名+行列数+单元格值），用于哈希检测改动。 */
  private static excelDigestScript(): string {
    return `$text = ''
foreach ($sh in $wb.Sheets) {
  try {
    $ur = $sh.UsedRange
    if ($null -eq $ur) { continue }
    $rc = [int]$ur.Rows.Count; $cc = [int]$ur.Columns.Count
    $text += [string]$sh.Name + ':' + $rc + 'x' + $cc + ';'
    if (($rc * $cc) -le 200000) { try { $v = $ur.Value2; $text += ($v | ConvertTo-Json -Compress -Depth 3) } catch {} }
  } catch {}
}
$sha = [System.Security.Cryptography.SHA256]::Create()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
$hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','')`;
  }

  /**
   * 获取指定工作簿的本地文件路径（保存最新版到磁盘），并返回内容摘要哈希与大小。
   * 已保存工作簿：Save() 后返回原路径；未保存的新建工作簿：SaveAs 到临时目录。
   */
  public async getExcelDocumentFile(name?: string): Promise<{ name: string; full: string; hasPath: boolean; hash: string; size: number } | null> {
    const nameJson = JSON.stringify(name ?? '');
    const digest = WpsDocManager.excelDigestScript();
    const script = `$ProgressPreference='SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
${WpsDocManager.ROT_HELPER}
$wb = [WpsRot]::OpenByName(${nameJson})
if ($null -eq $wb) {
  # COM 空壳回退（WPS 多组件整合模式 et.exe /from_prome）：工作簿对象取不到，
  # 改按 ROT moniker 路径找磁盘文件，以 FileShare.ReadWrite 共享方式读取已保存内容
  $target = ${nameJson}
  $fp = $null
  foreach ($pp in [WpsRot]::ListExcelPaths()) { if ([IO.Path]::GetFileName($pp) -eq $target) { $fp = $pp; break } }
  if (-not $fp) { Write-Output 'null'; exit }
  try {
    $fs = [IO.File]::Open($fp, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $len = [int]$fs.Length
    $buf = New-Object byte[] $len
    [void]$fs.Read($buf, 0, $len)
    $fs.Close()
  } catch { Write-Output 'null'; exit }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = [BitConverter]::ToString($sha.ComputeHash($buf)).Replace('-','')
  Write-Output (@{ name = $target; full = $fp; hasPath = $true; hash = $hash; size = $len } | ConvertTo-Json -Compress)
  exit
}
$full = [string]$wb.FullName
$hasPath = ($full -and $full.Contains(':'))
if ($hasPath) {
  try { $wb.Save() } catch {}
} else {
  try {
    $tmp = Join-Path $env:TEMP ('deepseek-excel-share-' + [guid]::NewGuid().ToString('N') + '.xlsx')
    $wb.SaveAs($tmp)
    if (Test-Path $tmp) { $full = $tmp; $hasPath = $true }
  } catch {}
}
${digest}
  Write-Output (@{ name = [string]$wb.Name; full = $full; hasPath = $hasPath; hash = $hash; size = $text.Length } | ConvertTo-Json -Compress)`;
    try {
      const raw = await runPs(script);
      const json = extractJson(raw);
      if (!json || json === 'null') return null;
      const parsed = JSON.parse(json) as { name?: unknown; full?: unknown; hasPath?: unknown; hash?: unknown; size?: unknown };
      return {
        name: String(parsed.name ?? ''),
        full: String(parsed.full ?? ''),
        hasPath: parsed.hasPath === true,
        hash: String(parsed.hash ?? ''),
        size: Number(parsed.size ?? 0),
      };
    } catch (e) {
      console.error('[WpsDoc] 获取表格文件失败:', e);
      return null;
    }
  }

  /** 轻量检测：读取工作簿内容摘要哈希与大小（不保存），用于轮询判断是否被改动。 */
  public async getExcelDocumentDigest(name?: string): Promise<{ hash: string; size: number } | null> {
    const nameJson = JSON.stringify(name ?? '');
    const digest = WpsDocManager.excelDigestScript();
    const script = `$ProgressPreference='SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
${WpsDocManager.ROT_HELPER}
$wb = [WpsRot]::OpenByName(${nameJson})
if ($null -eq $wb) {
  # COM 空壳回退：按 ROT 路径读磁盘文件字节哈希（与 getExcelDocumentFile 的回退算法一致）
  $target = ${nameJson}
  $fp = $null
  foreach ($pp in [WpsRot]::ListExcelPaths()) { if ([IO.Path]::GetFileName($pp) -eq $target) { $fp = $pp; break } }
  if (-not $fp) { Write-Output 'null'; exit }
  try {
    $fs = [IO.File]::Open($fp, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $len = [int]$fs.Length
    $buf = New-Object byte[] $len
    [void]$fs.Read($buf, 0, $len)
    $fs.Close()
  } catch { Write-Output 'null'; exit }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = [BitConverter]::ToString($sha.ComputeHash($buf)).Replace('-','')
  Write-Output (@{ hash = $hash; size = $len } | ConvertTo-Json -Compress)
  exit
}
${digest}
  Write-Output (@{ hash = $hash; size = $text.Length } | ConvertTo-Json -Compress)`;
    try {
      const raw = await runPs(script);
      const json = extractJson(raw);
      if (!json || json === 'null') return null;
      const parsed = JSON.parse(json) as { hash?: unknown; size?: unknown };
      return { hash: String(parsed.hash ?? ''), size: Number(parsed.size ?? 0) };
    } catch (e) {
      console.error('[WpsDoc] 检测表格改动失败:', e);
      return null;
    }
  }

  // ---------------- WPS PDF（wpspdf.exe / kpdf.Application，ROT 文件路径 moniker） ----------------

  /**
   * PDF 信息脚本：通过 kpdf.Application（WPS PDF COM 自动化）定位内存中正在编辑的文档，
   * 对文件做「稳定内容签名」用于改动检测。
   *
   * 签名 = SHA256(全部 stream 字节 + 对象数量 + 页面数)：
   *   - WPS 保存时会更新对象字典里的 CreationDate/LastModified 等时间戳元数据（以及 trailer /ID），
   *     整文件字节哈希每次必然不同，因此只取 stream 数据（内容/WPSInk 标注所在，保存前后字节稳定）；
   *   - 对象数量 + 页面数用于捕捉「删页/旋转/增删对象」这类不改动 stream 字节的结构性修改。
   * 内容未变则签名稳定，内容或结构一改签名立刻变化。
   *
   * saveFirst 在「发送上传」与「轮询检测」时都传 true：因为 PDF 的 COM 接口（kpdf.Application）
   * 不像 Word/Excel 那样暴露内存内容读取（Content.Text/单元格），要感知未保存的修改必须
   * 让 WPS 把内存状态落盘一次。这与 WPS 自带的自动保存/自动备份机制同理；仅共享激活期间发生。
   * 若传 false 则纯读取（不保存），只能感知已落盘的改动。
   */
  private static pdfInfoScript(nameJson: string, saveFirst: boolean): string {
    // 注意：必须生成 PowerShell 原生布尔 $true/$false，不能裸写 true（PowerShell 5 中会被当成命令调用而置空）
    const saveFlag = saveFirst ? '$true' : '$false';
    return `$ProgressPreference='SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$saveF = ${saveFlag}
function Get-PdfStableHash([string]$path) {
  try {
    $bytes = [IO.File]::ReadAllBytes($path)
    $s = [Text.Encoding]::ASCII.GetString($bytes)
    $buf = New-Object System.Collections.Generic.List[byte]
    $pos = 0
    $objCount = 0
    $objRe = [regex]'\\d+\\s+\\d+\\s+obj'
    while ($true) {
      $m = $objRe.Match($s, $pos)
      if (-not $m.Success) { break }
      $objCount++
      $objStart = $m.Index
      $ei = $s.IndexOf('endobj', $objStart)
      if ($ei -lt 0) { break }
      $objText = $s.Substring($objStart, $ei - $objStart)
      $lm = [regex]::Match($objText, '/Length\\s+(\\d+)')
      $sm = [regex]::Match($objText, 'stream\\s*[\\r\\n]')
      if ($lm.Success -and $sm.Success) {
        $len = [int]$lm.Groups[1].Value
        $dataStart = $sm.Index + $sm.Length
        if (($dataStart + $len) -le $bytes.Length) {
          for ($k = $dataStart; $k -lt ($dataStart + $len); $k++) { $buf.Add($bytes[$k]) }
        }
      }
      $pos = $ei + 6
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $arr = $buf.ToArray()
    return @{ streamHash = [BitConverter]::ToString($sha.ComputeHash($arr)).Replace('-',''); size = $arr.Length; objCount = $objCount }
  } catch { return $null }
}
function Get-PdfInfo([object]$doc) {
  $full = [string]$doc.FullName
  if (-not $full -or -not $full.Contains(':')) { return $null }
  # Dirtyed：WPS PDF 文档对象暴露的「是否有未保存修改」标志（属性名拼写如此）
  $dirty = $false
  $dirtyBefore = $false
  try { $dirtyBefore = [bool]$doc.Dirtyed; $dirty = $dirtyBefore } catch {}
  if ($saveF -and $dirty) {
    # 有未保存修改：Save() 落盘并验证 Dirtyed 已清除；失败重试一次，仍失败视为读取失败
    $saved = $false
    for ($r = 0; $r -lt 2 -and -not $saved; $r++) {
      try {
        [void]$doc.Save()  # 丢弃返回值，避免污染函数输出流
        try { $dirty = [bool]$doc.Dirtyed } catch { $dirty = $true }
        if (-not $dirty) { $saved = $true }
      } catch {}
    }
    if (-not $saved) { return $null }
  }
  $h = Get-PdfStableHash $full
  if (-not $h) { return $null }
  $pc = 0
  try { $pc = [int]$doc.PageCount } catch {}
  $sha2 = [System.Security.Cryptography.SHA256]::Create()
  $seed = $h.streamHash + ':' + $h.objCount + ':' + $pc
  $hash = [BitConverter]::ToString($sha2.ComputeHash([Text.Encoding]::UTF8.GetBytes($seed))).Replace('-','')
  return @{ name = [string]$doc.Name; full = $full; hash = $hash; size = $h.size; dirty = $dirty; dirtyBefore = $dirtyBefore }
}
$target = ${nameJson}
$out = $null
try {
  $app = [Runtime.InteropServices.Marshal]::GetActiveObject('kpdf.Application')
  $doc = $null
  # 注意：COM 集合必须用 Count + Item(i) 遍历（foreach 枚举的项 Name/FullName 为空）
  $cnt = $app.Documents.Count
  for ($i = 1; $i -le $cnt; $i++) {
    try { $d = $app.Documents.Item($i); if ([string]$d.Name -eq $target) { $doc = $d; break } } catch {}
  }
  if (-not $doc) { $doc = $app.ActiveDocument }
  if ($doc) { $out = Get-PdfInfo $doc; if ($out) { $out.src = 'kpdf' } }
} catch {}
if (-not $out) {
  ${WpsDocManager.ROT_HELPER}
  $d2 = [WpsRot]::OpenPdfByName($target)
  if ($d2) { $out = Get-PdfInfo $d2; if ($out) { $out.src = 'rot' } }
}
if (-not $out) { Write-Output 'null'; exit }
Write-Output ($out | ConvertTo-Json -Compress)`;
  }

  /**
   * 枚举当前打开的全部 WPS PDF 文档。
   * 首选 kpdf.Application 的 Documents 集合（内存真实列表），失败时退回 ROT 文件路径 moniker。
   * 最后活动的文档（ActiveDocument）排第一，作为默认选中项。
   */
  public async listPdfDocuments(): Promise<WpsDocInfo[]> {
    const script = `$ProgressPreference='SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$list = New-Object System.Collections.ArrayList
$activeName = $null
try {
  $app = [Runtime.InteropServices.Marshal]::GetActiveObject('kpdf.Application')
  try { $activeName = [string]$app.ActiveDocument.Name } catch {}
  # 注意：COM 集合必须用 Count + Item(i) 遍历（foreach 枚举的项 Name/FullName 为空）
  $cnt = $app.Documents.Count
  for ($i = 1; $i -le $cnt; $i++) {
    try {
      $d = $app.Documents.Item($i)
      $nm = [string]$d.Name
      if ($nm) { [void]$list.Add(@{ name = $nm; full = [string]$d.FullName }) }
    } catch {}
  }
} catch {}
if ($list.Count -eq 0) {
  ${WpsDocManager.ROT_HELPER}
  $rows = [WpsRot]::ListPdf()
  foreach ($s in $rows) {
    $p = $s -split "\\t"
    if ($p.Length -ge 2 -and $p[0]) { [void]$list.Add(@{ name = $p[0]; full = $p[1] }) }
  }
}
if ($activeName) {
  $idx = -1
  for ($i = 0; $i -lt $list.Count; $i++) { if ([string]$list[$i].name -eq $activeName) { $idx = $i; break } }
  if ($idx -gt 0) { $t = $list[$idx]; $list.RemoveAt($idx); $list.Insert(0, $t) }
}
Write-Output ($list | ConvertTo-Json -Compress)`;
    try {
      const raw = await runPs(script);
      const json = extractJson(raw);
      if (!json) return [];
      const parsed = JSON.parse(json) as unknown;
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr
        .filter((it: unknown) => it && typeof it === 'object')
        .map((it) => ({ name: String((it as { name?: unknown }).name ?? ''), full: String((it as { full?: unknown }).full ?? '') }))
        .filter((it) => it.name.length > 0);
    } catch (e) {
      console.error('[WpsDoc] 枚举 PDF 失败:', e);
      return [];
    }
  }

  /** 获取指定 PDF 的本地路径与内容哈希/大小。上传前调用一次 Save()，把内存中未保存的修改落盘，
   *  使附带的文件包含最新内容（仅此一处会保存，改动检测轮询为纯读取，不干扰 WPS 保存机制）。
   *  src：本次读取走的路径（kpdf=COM 自动化 / rot=ROT 兜底），用于诊断。 */
  public async getPdfDocumentFile(name?: string): Promise<{ name: string; full: string; hasPath: boolean; hash: string; size: number; src?: string; dirty?: boolean; dirtyBefore?: boolean } | null> {
    const script = WpsDocManager.pdfInfoScript(JSON.stringify(name ?? ''), true);
    try {
      const raw = await runPs(script);
      const json = extractJson(raw);
      if (!json || json === 'null') return null;
      const parsed = JSON.parse(json) as { name?: unknown; full?: unknown; hash?: unknown; size?: unknown; src?: unknown; dirty?: unknown; dirtyBefore?: unknown };
      return {
        name: String(parsed.name ?? ''),
        full: String(parsed.full ?? ''),
        hasPath: true,
        hash: String(parsed.hash ?? ''),
        size: Number(parsed.size ?? 0),
        src: parsed.src ? String(parsed.src) : undefined,
        dirty: parsed.dirty === true,
        dirtyBefore: parsed.dirtyBefore === true,
      };
    } catch (e) {
      console.error('[WpsDoc] 获取 PDF 文件失败:', e);
      return null;
    }
  }

  /**
   * 轻量检测：读取 PDF 稳定内容哈希与大小，用于轮询判断是否被改动。
   * saveFirst=true 时先 Save() 一次让未保存修改落盘（可感知未保存改动；kpdf 无内存内容读取）；
   * saveFirst=false 时纯读取，只感知已落盘的改动。
   */
  public async getPdfDocumentDigest(name?: string, saveFirst = false): Promise<{ hash: string; size: number; dirty?: boolean; dirtyBefore?: boolean } | null> {
    const script = WpsDocManager.pdfInfoScript(JSON.stringify(name ?? ''), saveFirst);
    try {
      const raw = await runPs(script);
      const json = extractJson(raw);
      if (!json || json === 'null') return null;
      const parsed = JSON.parse(json) as { hash?: unknown; size?: unknown; dirty?: unknown; dirtyBefore?: unknown };
      return { hash: String(parsed.hash ?? ''), size: Number(parsed.size ?? 0), dirty: parsed.dirty === true, dirtyBefore: parsed.dirtyBefore === true };
    } catch (e) {
      console.error('[WpsDoc] 检测 PDF 改动失败:', e);
      return null;
    }
  }

  /**
   * 检测 PDF 类型：文字式（含文本层）或图片式（扫描件/纯图片）。
   * 通过 kpdf 定位当前打开文档的路径（不保存），读文件统计对象字典里 /Font 与 /Image 的出现：
   *   - 含 /Font → 文字式（'text'）；
   *   - 无 /Font → 图片式（'image'，无论是否含 /Image）；
   *   - 无法定位文档 → 'unknown'（按文字式保守处理，避免误切换识图模式）。
   */
  public async detectPdfType(name?: string): Promise<'text' | 'image' | 'unknown'> {
    const nameJson = JSON.stringify(name ?? '');
    const script = `$ProgressPreference='SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$target = ${nameJson}
$full = $null
try {
  $app = [Runtime.InteropServices.Marshal]::GetActiveObject('kpdf.Application')
  $cnt = $app.Documents.Count
  for ($i = 1; $i -le $cnt; $i++) {
    try { $d = $app.Documents.Item($i); if ([string]$d.Name -eq $target) { $full = [string]$d.FullName; break } } catch {}
  }
  if (-not $full) { $full = [string]$app.ActiveDocument.FullName }
} catch {}
if (-not $full -or -not $full.Contains(':')) { Write-Output (@{ t = 'unknown' } | ConvertTo-Json -Compress); exit }
try {
  $s = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($full))
  $fontCount = ([regex]::Matches($s, '/Font')).Count
  if ($fontCount -gt 0) { Write-Output (@{ t = 'text' } | ConvertTo-Json -Compress) } else { Write-Output (@{ t = 'image' } | ConvertTo-Json -Compress) }
} catch { Write-Output (@{ t = 'unknown' } | ConvertTo-Json -Compress) }`;
    try {
      const raw = await runPs(script);
      const json = extractJson(raw);
      if (!json) return 'unknown';
      const parsed = JSON.parse(json) as { t?: unknown };
      const t = String(parsed.t ?? '');
      return t === 'text' || t === 'image' ? (t as 'text' | 'image') : 'unknown';
    } catch (e) {
      console.error('[WpsDoc] 检测 PDF 类型失败:', e);
      return 'unknown';
    }
  }
}
