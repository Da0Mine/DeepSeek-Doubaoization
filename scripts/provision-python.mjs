/**
 * 预置捆绑的精简版 Python（供 LocalShellServer 的 python_exec / python_pip_install 使用）。
 * 行为：下载官方 Windows embeddable Python → 启用 pip（改 ._pth + get-pip）→ 用国内镜像预装
 * openpyxl / python-docx（读写 Word/Excel 常用纯 Python 库，不含 numpy 等大库）。可重复执行幂等。
 * 产物：<项目根>/resources/python/  （打包时 electron-builder extraResources 会把它带进安装包）
 *
 * 用法：node scripts/provision-python.mjs
 */
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PY_DIR = path.join(ROOT, 'resources', 'python');
const PY_VERSION = process.env.PY_VERSION || '3.12.3';
const PY_THT = PY_VERSION.slice(0, 4).replace('.', ''); // 3.12.3 -> py312
// 发行包下载来源：官方 + 国内镜像按序尝试（防单一源失效/不可达）
const ZIP_CANDIDATES = [
  `https://www.python.org/ftp/python/${PY_VERSION}/python-${PY_VERSION}-embed-amd64.zip`,
  `https://registry.npmmirror.com/-/binary/python/${PY_VERSION}/python-${PY_VERSION}-embed-amd64.zip`,
  `https://mirrors.huaweicloud.com/python/${PY_VERSION}/python-${PY_VERSION}-embed-amd64.zip`,
  `https://mirrors.tuna.tsinghua.edu.cn/python/${PY_VERSION}/python-${PY_VERSION}-embed-amd64.zip`,
];
// get-pip.py 下载来源（官方 + 镜像）
const GETPIP_CANDIDATES = [
  'https://bootstrap.pypa.io/get-pip.py',
  'https://registry.npmmirror.com/-/binary/get-pip.py',
  'https://mirrors.huaweicloud.com/get-pip.py',
];

// 预装镜像源（与 python_pip_install 一致，按序回退）
const MIRRORS = [
  'https://pypi.tuna.tsinghua.edu.cn/simple',
  'https://mirrors.aliyun.com/pypi/simple/',
  'https://mirrors.huaweicloud.com/repository/pypi/simple',
  'https://pypi.org/simple',
];
// pip wheel 的 simple index 来源（embeddable python 无 ensurepip，用解 wheel 的方式离线装 pip）
const PIP_INDEXES = [
  'https://pypi.tuna.tsinghua.edu.cn/simple',
  'https://mirrors.aliyun.com/pypi/simple',
  'https://mirrors.huaweicloud.com/repository/pypi/simple',
  'https://pypi.org/simple',
];

const log = (...a) => console.log('[provision-python]', ...a);

async function downloadOne(url, dest) {
  log('下载', url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function downloadAny(urls, dest) {
  let lastErr = '';
  for (const u of urls) {
    try { await downloadOne(u, dest); log('OK <-', u); return true; }
    catch (e) { lastErr = e.message; log('失败', u, ':', lastErr); }
  }
  throw new Error(`所有来源均不可用：${lastErr}`);
}

async function extractZip(zipPath) {
  log('解压到', PY_DIR);
  rmSync(PY_DIR, { recursive: true, force: true });
  mkdirSync(PY_DIR, { recursive: true });
  // 用 tar 解 zip 不行，需用系统 unzip/Expand-Archive；node 无内置 unzip，这里用 powershell Expand-Archive。
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${PY_DIR}' -Force`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('解压失败');
}

function enablePip() {
  // 找到 <py312>._pth：取消 import site、修复可能被误并到 python312.zip 行的 site-packages、
  // 并新起一行保证 python312.zip 独立存在 + Lib\site-packages 独立一行（否则 stdlib 加载失败）。
  const pthFiles = readdirSync(PY_DIR).filter((f) => f.endsWith('._pth'));
  if (!pthFiles.length) throw new Error('未找到 ._pth 文件');
  for (const f of pthFiles) {
    const p = path.join(PY_DIR, f);
    let out = readFileSync(p, 'utf8');
    // 修复误并行：python312.zipLib\site-packages -> python312.zip
    out = out.replace(/^(python\d+\.zip)Lib\\site-packages$/gm, '$1');
    out = out.replace(/^(python\d+\.zip)Lib\\site-packages/gm, '$1');
    out = out.replace(/^#\s*(import site)$/m, '$1'); // 取消注释 import site
    if (!out.endsWith('\n')) out += '\n';
    if (!/^Lib\\site-packages$/m.test(out)) out += 'Lib\\site-packages\n';
    writeFileSync(p, out);
    log('已启用 site+pip:', f, '内容:\n' + out);
  }
}

function run(cmd, args, { timeoutMs = 600000 } = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], timeout: timeoutMs });
  if (r.status && r.status !== 0) return false;
  return true;
}

async function bootstrapPip() {
  // embeddable Python 无 ensurepip：从 simple index 抓最新 pip wheel、解进 site-packages 装 pip。
  const base = path.join(PY_DIR, 'Lib', 'site-packages');
  mkdirSync(base, { recursive: true });
  let lastErr = '';
  for (const bi of PIP_INDEXES) {
    const page = `${bi}/pip/`; // 带尾部斜杠，保证相对 URL 解析正确
    try {
      const res = await fetch(page, { headers: { accept: 'text/html' } });
      if (!res.ok) { lastErr = `index ${res.status} ${page}`; continue; }
      const html = await res.text();
      let best = null, bestV = null;
      for (const m of html.matchAll(/href="([^"]+?pip-([0-9][0-9A-Za-z.]*)-py3-none-any\.whl(?:#sha256=[A-Za-z0-9]+)?)"/g)) {
        const v = m[2].split('.').map(Number);
        if (!bestV || cmp(v, bestV.split('.').map(Number)) > 0) { best = m[1].split('#')[0]; bestV = m[2]; }
      }
      if (!best) { lastErr = 'index 无匹配 wheel ' + page; continue; }
      const url = best.startsWith('http') ? best : new URL(best, page).toString();
      log('下载 pip wheel:', url);
      const whlZip = path.join(PY_DIR, 'pip.wheel.zip');
      await downloadOne(url, whlZip); // 下载失败则抛错 → 换下一镜像
      const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${whlZip}' -DestinationPath '${base}' -Force`], { stdio: 'inherit' });
      rmSync(whlZip, { force: true });
      if (r.status !== 0) throw new Error('解 pip wheel 失败');
      const chk = spawnSync(path.join(PY_DIR, 'python.exe'), ['-m', 'pip', '--version'], { encoding: 'utf8' });
      if (chk.status === 0) { log('pip 就绪:', chk.stdout.trim()); return; }
      lastErr = chk.stderr || chk.stdout || 'pip not ready';
    } catch (e) { lastErr = e.message; }
  }
  throw new Error('pip 引导失败：' + lastErr);
}

function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function pipWithMirrors(pkgs) {
  for (const m of MIRRORS) {
    log('pip install 使用镜像', m);
    if (run(path.join(PY_DIR, 'python.exe'), ['-m', 'pip', 'install', '--no-warn-script-location', '-i', m, ...pkgs])) return true;
  }
  return false;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('当前仅支持 Windows 预置（目标工作机为 Windows）');
  mkdirSync(path.join(ROOT, 'resources'), { recursive: true });
  const pyExeFinal = path.join(PY_DIR, 'python.exe');
  if (existsSync(pyExeFinal)) {
    log('已存在', pyExeFinal, '，跳过下载/解压（继续修正/校验与补装）');
  } else {
    const zipPath = path.join(ROOT, 'resources', `python-${PY_VERSION}-embed.zip`);
    await downloadAny(ZIP_CANDIDATES, zipPath);
    await extractZip(zipPath);
    rmSync(zipPath, { force: true });
  }
  enablePip(); // 总是修正 ._pth（新解压或已存在均执行）
  await bootstrapPip();
  log('预装 openpyxl + python-docx ...');
  if (!pipWithMirrors(['openpyxl', 'python-docx'])) throw new Error('预装 openpyxl/python-docx 失败');

  // 校验
  const chk = execFileSync(path.join(PY_DIR, 'python.exe'), ['-c', "import sys;print(sys.version);import openpyxl,docx;print('openpyxl',openpyxl.__version__);print('docx ok')"], { encoding: 'utf8' });
  log('校验通过:\n' + chk);

  const size = (() => {
    let n = 0;
    const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else n += require_stats(p);
    });
    walk(PY_DIR);
    return n;
  })();
  log(`完成。resources/python 共 ${(size / 1e6).toFixed(1)} MB`);
}

function require_stats(p) {
  return readFileSync(p).length;
}

main().then(() => process.exit(0)).catch((e) => { console.error('[provision-python] 失败:', e.message); process.exit(1); });