/**
 * LocalShellServer：DeepSeek++「Shell Local」(python_exec 等) 的 Electron 宿主。
 *
 * 背景：DeepSeek++ 的 Shell 工具（python_exec / python_status / shell_status / 本地文件 …）
 * 靠 chrome.runtime.connectNative 连接系统里安装的 Shell Native Host。而 Electron 的扩展
 * 运行时**不支持 native messaging**（chrome.runtime.connectNative 不存在），所以原版的 Shell
 * 工具在 Electron 里永远"未发现 python_exec"。
 *
 * 方案：本模块在内置到本软件主进程里，起一个 127.0.0.1 HTTP 服务，按"改造后的
 * chrome.runtime.connectNative"（见 background.js 头部的代理）把扩展发给原生主机的 JSON-RPC
 * 信封转发过来，在这里执行真实的本机命令（尤其用本机 Python 跑 python_exec），把结果以原生
 * 主机同格式返回。整机装好软件即用、零配置；不依赖系统注册任何 Native Messaging 清单。
 *
 * 协议：信封 { protocol:'deepseek-pp-mcp-native', version:1, message:{jsonrpc…} }
 * 应答：原始 JSON-RPC { jsonrpc:'2.0', id, result }，result 为 MCP 标准 { content:[{type:'text',text}] }。
 */
import * as http from 'http';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/** 与 background.js head guard 中 connectNative 代理协商一致的固定端口。 */
export const SHELL_LOCAL_PORT = 47901;

/**
 * Shell Local 是否放行工具（任务模式开启才 true，普通模式关闭）。
 * SW 发现工具 → connectNative 代理 → 本 HTTP 宿主；宿主层按此标志决定 tools/list / tools/call 是否放行，
 * 从而在普通模式下彻底隐藏本地工具（比只改 ExtensionHost 的 GET_MCP_SERVERS 更彻底，
 * 因为 SW 自身存储的 shell-local 服务默认仍是启用状态，会绕过 ExtensionHost 直接把工具投影给模型）。
 */
let shellLocalEnabled = false;
export function setShellLocalEnabledForHost(v: boolean): void {
  shellLocalEnabled = v;
}
const PROTOCOL_VERSION = '2025-06-18';

/** 捆绑的精简 Python（带 pip）在安装包/开发环境的根目录：
 * 打包后位于 resources/python（extraResources）；未打包时位于项目根 resources/python。 */
function bundledPythonExe(): string | null {
  try {
    const base = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');
    const win = process.platform === 'win32';
    const cand = win ? path.join(base, 'python', 'python.exe') : path.join(base, 'python', 'bin', 'python3');
    if (fs.existsSync(cand)) return cand;
  } catch {
    /* ignore */
  }
  return null;
}

const MAX_PYTHON_TIMEOUT_MS = 30_000;
const MAX_PYTHON_CODE_BYTES = 60_000;
const MAX_PYTHON_OUTPUT_BYTES = 64_000;
const MAX_OUTPUT_BYTES = 128_000;

/** Shell 工具目录：与 deepseek-pp-shell-host packages/shell-host/contracts.mjs 保持一致。 */
const TOOL_DEFINITIONS = [
  {
    name: 'shell_exec',
    title: 'Execute Shell Command',
    description: 'Execute a command in the shell reported by shell_status. Returns stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        cwd: { type: 'string', description: 'Working directory. Defaults to user home.' },
        env: { type: 'object', additionalProperties: { type: 'string' } },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 600000 },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'shell_status',
    title: 'Shell Host Status',
    description: 'Report host health, platform, shell, current working directory, and Node.js version.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'python_status',
    title: 'Python Interpreter Status',
    description: 'Report whether a local Python interpreter is available and which quick-validation packages can be imported.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'python_exec',
    title: 'Execute Python Code',
    description: 'Run short Python code for calculation, reasoning checks, and small data transformations. Do not install packages, access sensitive local files, or use network access.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Short Python code to execute.' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: MAX_PYTHON_TIMEOUT_MS },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'python_pip_install',
    title: 'Install Python Package',
    description: 'Install one or more Python packages into the bundled interpreter via pip (e.g. python-docx, openpyxl, requests). Automatically tries multiple trusted mirrors (默认使用国内镜像源并自动回退，避免单一镜像失效)。',
    inputSchema: {
      type: 'object',
      properties: {
        packages: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description: 'One or more package names (optionally with version, e.g. requests==2.31.0).',
        },
        timeout_ms: { type: 'integer', minimum: 5000, maximum: 600000 },
      },
      required: ['packages'],
      additionalProperties: false,
    },
  },
  {
    name: 'python_pip_status',
    title: 'Python Package Status',
    description: 'Report which commonly useful Python packages are already installed in the bundled/python interpreter (e.g. openpyxl, python-docx, requests, numpy, pandas).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'local_file_stat',
    title: 'Inspect Local File',
    description: 'Return whether a local path exists, whether it is a file or directory, its size, and its last modified timestamp.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute or home-relative local path to inspect.' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'local_file_read',
    title: 'Read Local Text File',
    description: 'Read a UTF-8 local text file in character windows so large files can be fetched in chunks.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        start: { type: 'integer', minimum: 0 },
        max_chars: { type: 'integer', minimum: 1, maximum: 100_000 },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'local_file_write',
    title: 'Write Local Text File',
    description: 'Write UTF-8 text to a local file without shell quoting. Supports overwrite or append and can create parent directories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        append: { type: 'boolean' },
        create_directories: { type: 'boolean' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'local_skill_preview',
    title: 'Preview Local Skill Folder',
    description: 'Read SKILL.md files, nearby text resources, and script file manifests from a local Skill folder. Does not execute local code.',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string' },
        selectedPaths: { type: 'array', items: { type: 'string' } },
      },
      required: ['rootPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'local_folder_pick',
    title: 'Pick Local Folder',
    description: 'Open the operating system folder picker and return the absolute path selected by the user.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        defaultPath: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
];

/** 标准文本型 MCP 结果。 */
function textResult(text: string) {
  return { content: [{ type: 'text', text }] };
}

function ok(result: unknown) {
  return result;
}

/** 活跃的子进程集合：退出时统一 kill，避免命令超时前退出导致残留（持续吃内存/句柄）。 */
const activeChildren = new Set<child_process.ChildProcess>();

async function runCommand(command: string, cwd?: string, env?: Record<string, string>, timeoutMs = 120_000): Promise<string> {
  return new Promise<string>((resolve) => {
    const winShell = process.platform === 'win32';
    const shell = winShell ? 'powershell.exe' : (process.env.SHELL || '/bin/sh');
    const args = winShell ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];
    const child = child_process.spawn(shell, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      shell: false,
    });
    activeChildren.add(child); // 登记活跃子进程
    const out: string[] = [];
    const err: string[] = [];
    child.stdout.on('data', (d: Buffer) => { if (out.join('').length + d.length <= MAX_OUTPUT_BYTES) out.push(String(d)); });
    child.stderr.on('data', (d: Buffer) => { if (err.join('').length + d.length <= MAX_OUTPUT_BYTES) err.push(String(d)); });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, timeoutMs);
    child.on('close', (code) => {
      activeChildren.delete(child);
      clearTimeout(timer);
      const stdout = out.join('').replace(/\r\n/g, '\n').trim();
      const stderr = err.join('').replace(/\r\n/g, '\n').trim();
      resolve(JSON.stringify({ exitCode: code ?? -1, stdout, stderr }, null, 2));
    });
    child.on('error', (e) => {
      activeChildren.delete(child);
      clearTimeout(timer);
      resolve(JSON.stringify({ exitCode: -1, stdout: '', stderr: String(e && e.message || e) }, null, 2));
    });
  });
}

async function findPython(): Promise<string | null> {
  // 优先用捆绑的精简 Python（开箱即用、任何电脑零配置），回退到系统 PATH 里的 python。
  const bundled = bundledPythonExe();
  if (bundled && fs.existsSync(bundled)) return bundled;
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];
  for (const cand of candidates) {
    const hit = await new Promise<boolean>((resolve) => {
      try {
        child_process.execFile(cand, ['--version'], { timeout: 3000, windowsHide: true }, (err) => resolve(!err));
      } catch { resolve(false); }
    });
    if (hit) return cand;
  }
  return null;
}

async function runPython(code: string, timeoutMs: number): Promise<string> {
  const python = (await findPython()) ?? 'python';
  const timeout = Math.max(1000, Math.min(timeoutMs, MAX_PYTHON_TIMEOUT_MS));
  return new Promise<string>((resolve) => {
    child_process.execFile(python, ['-c', code], { timeout, windowsHide: true }, (err, stdout, stderr) => {
      const text = String(stdout || '');
      const errText = String(stderr || '');
      if (err) {
        // err instanceof Error 且带 killed/信号说明超时
        const timedOut = ((err as Error & { killed?: boolean }).killed === true);
        resolve(textResult(timedOut
          ? `Error: Python execution timed out after ${timeout} ms.\n${errText.slice(0, MAX_PYTHON_OUTPUT_BYTES)}`
          : `Exit code: ${((err as Error & { code?: number }).code ?? -1)}\n${errText.slice(0, MAX_PYTHON_OUTPUT_BYTES)}`).content[0].text);
        return;
      }
      resolve(text.slice(0, MAX_PYTHON_OUTPUT_BYTES).trim() || '(no output)');
    });
  });
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'shell_status':
      return ok(textResult(JSON.stringify({
        healthy: true,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        shell: process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/sh'),
        cwd: process.cwd(),
      }, null, 2)));
    case 'python_status': {
      const python = await findPython();
      const checks: Record<string, boolean> = {};
      if (python) {
        for (const pkg of ['numpy', 'pandas', 'sympy']) {
          const okPkg = await new Promise<boolean>((resolve) => {
            try {
              child_process.execFile(python, ['-c', `import ${pkg}`], { timeout: 5000, windowsHide: true }, (e) => resolve(!e));
            } catch { resolve(false); }
          });
          checks[pkg] = okPkg;
        }
      }
      return ok(textResult(JSON.stringify({
        available: !!python,
        interpreter: python,
        checks,
        path: python ? (await new Promise<string>((resolve) => {
          try { child_process.execFile(python, ['-c', 'import sys,os;print(os.path.abspath(sys.executable))'], { timeout: 5000, windowsHide: true }, (e, o) => resolve(e ? '' : String(o || '').trim())); }
          catch { resolve(''); }
        })) : null,
      }, null, 2)));
    }
    case 'python_exec': {
      const code = String(args?.code ?? '');
      if (!code) return ok(textResult('Error: python_exec requires a "code" argument.'));
      if (Buffer.byteLength(code, 'utf8') > MAX_PYTHON_CODE_BYTES) {
        return ok(textResult(`Error: python_exec code exceeds ${MAX_PYTHON_CODE_BYTES} bytes.`));
      }
      const timeoutMs = typeof args?.timeout_ms === 'number' ? args.timeout_ms : 10_000;
      const output = await runPython(code, timeoutMs);
      return ok(textResult(output));
    }
    case 'python_pip_install': {
      const raw = args?.packages;
      const pkgs: string[] = (Array.isArray(raw) ? raw : [raw]).map((x) => String(x ?? '').trim()).filter(Boolean);
      if (pkgs.length === 0) return ok(textResult('Error: python_pip_install requires "packages".'));
      const python = (await findPython()) ?? 'python';
      const timeoutMs = typeof args?.timeout_ms === 'number' ? args.timeout_ms : 180_000;
      // 多个国内镜像源依次回退，全部失败再试官方源，避免单一镜像失效导致安装失败。
      const mirrors = [
        'https://pypi.tuna.tsinghua.edu.cn/simple',
        'https://mirrors.aliyun.com/pypi/simple/',
        'https://mirrors.huaweicloud.com/repository/pypi/simple',
        'https://pypi.org/simple',
      ];
      let lastErr = '';
      for (const mirror of mirrors) {
        const r = await new Promise<{ err: Error | null; stdout: string; stderr: string }>((resolve) => {
          try {
            child_process.execFile(python, ['-m', 'pip', 'install', '-q', '-i', mirror, '--disable-pip-version-check', ...pkgs], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
          } catch (e) { resolve({ err: e as Error, stdout: '', stderr: '' }); }
        });
        if (!r.err) {
          return ok(textResult(`已通过镜像 ${mirror} 安装：${pkgs.join(' ')}\n${r.stdout.trim()}`));
        }
        lastErr = (r.stderr || r.stdout || (r.err && r.err.message) || '').slice(0, 1200);
      }
      return ok(textResult(`安装失败：所有镜像源均不可用。最后错误：\n${lastErr}\n(Package names: ${pkgs.join(', ')})`));
    }
    case 'python_pip_status': {
      const python = (await findPython()) ?? 'python';
      const checks: Record<string, boolean> = {};
      for (const pkg of ['openpyxl', 'docx', 'requests', 'numpy', 'pandas', 'sympy']) {
        const okPkg = await new Promise<boolean>((resolve) => {
          try { child_process.execFile(python, ['-c', `import importlib.util as u,sys;sys.exit(0 if u.find_spec('${pkg}') else 1)`], { timeout: 8000, windowsHide: true }, (e) => resolve(!e)); }
          catch { resolve(false); }
        });
        checks[pkg] = okPkg;
      }
      return ok(textResult(JSON.stringify({ interpreter: python, checks }, null, 2)));
    }
    case 'shell_exec': {
      const command = String(args?.command ?? '');
      if (!command) return ok(textResult('Error: shell_exec requires a "command" argument.'));
      const timeoutMs = typeof args?.timeout_ms === 'number' ? args.timeout_ms : 120_000;
      const cwd = typeof args?.cwd === 'string' && args.cwd ? args.cwd : undefined;
      const env = (args?.env && typeof args.env === 'object') ? (args.env as Record<string, string>) : undefined;
      const result = await runCommand(command, cwd, env, timeoutMs);
      return ok(textResult(result));
    }
    case 'local_file_stat': {
      const p = String(args?.path ?? '');
      if (!p) return ok(textResult('Error: local_file_stat requires "path".'));
      try {
        const st = fs.statSync(p);
        return ok(textResult(JSON.stringify({ path: p, exists: true, isFile: st.isFile(), isDirectory: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs }, null, 2)));
      } catch {
        return ok(textResult(JSON.stringify({ path: p, exists: false }, null, 2)));
      }
    }
    case 'local_file_read': {
      const p = String(args?.path ?? '');
      if (!p) return ok(textResult('Error: local_file_read requires "path".'));
      const start = typeof args?.start === 'number' && args.start >= 0 ? args.start : 0;
      const max = typeof args?.max_chars === 'number' ? Math.min(args.max_chars, 100_000) : 16_000;
      try {
        const data = fs.readFileSync(p, 'utf8');
        const sliced = data.slice(start, start + max);
        return ok(textResult(JSON.stringify({ path: p, start, totalChars: data.length, content: sliced }, null, 2)));
      } catch (e) {
        return ok(textResult(`Error reading ${p}: ${e instanceof Error ? e.message : String(e)}`));
      }
    }
    case 'local_file_write': {
      const p = String(args?.path ?? '');
      const content = String(args?.content ?? '');
      if (!p) return ok(textResult('Error: local_file_write requires "path" and "content".'));
      try {
        if (args?.create_directories !== false) fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content, { encoding: 'utf8', flag: args?.append ? 'a' : 'w' });
        return ok(textResult(`Wrote ${content.length} chars to ${p}`));
      } catch (e) {
        return ok(textResult(`Error writing ${p}: ${e instanceof Error ? e.message : String(e)}`));
      }
    }
    default:
      return ok(textResult(`Tool ${name} is not supported by the embedded Shell Local host in this environment.`));
  }
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function handleJrpMessage(message: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return jsonRpcError(null, -32600, 'Invalid JSON-RPC request.');
  }
  const id = message.id ?? null;
  const method = message.method as string;
  const params = (message.params ?? {}) as Record<string, unknown>;
  switch (method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'deepseek-pp-shell', version: 'embedded-1.0.0' },
        instructions: 'Embedded Shell Local host (python_exec, python_status, shell_status, local file tools) bundled with DeepSeek desktop.',
      });
    case 'ping':
      return jsonRpcResult(id, {});
    case 'tools/list':
      return jsonRpcResult(id, { tools: shellLocalEnabled ? TOOL_DEFINITIONS : [] });
    case 'tools/call': {
      if (!shellLocalEnabled) {
        return jsonRpcResult(id, textResult('Shell Local is disabled (普通模式). Switch to 任务模式 to use local tools.'));
      }
      const name = typeof params?.name === 'string' ? params.name : '';
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await handleToolCall(name, args);
        return jsonRpcResult(id, result);
      } catch (e) {
        return jsonRpcResult(id, textResult(`Tool ${name} failed: ${e instanceof Error ? e.message : String(e)}`));
      }
    }
    case 'notifications/initialized':
    case 'initialized':
      return null;
    default:
      return jsonRpcError(id, -32601, `Unsupported method: ${method}`);
  }
}

let server: http.Server | null = null;

function sendJson(res: http.ServerResponse, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
  });
  res.end(body);
}

/** 启动本地 Shell 宿主服务（幂等）。返回是否监听成功。 */
export function startLocalShellServer(): boolean {
  if (server) return true;
  server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Private-Network': 'true',
      });
      res.end();
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/mcp')) {
      sendJson(res, jsonRpcError(null, -32600, 'Expected POST /mcp'));
      return;
    }
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += String(chunk); if (raw.length > 2_000_000) req.destroy(); });
    req.on('end', () => {
      let envelope: Record<string, unknown>;
      try {
        envelope = JSON.parse(raw || '{}');
      } catch {
        sendJson(res, jsonRpcError(null, -32700, 'Parse error'));
        return;
      }
      // 解包原生信封：取 message 里的 JSON-RPC 请求
      const message = (envelope && typeof envelope.message === 'object'
        ? envelope.message
        : envelope) as Record<string, unknown>;
      handleJrpMessage(message)
        .then((reply) => {
          if (reply) sendJson(res, reply);
          else sendJson(res, { jsonrpc: '2.0', id: null }); // 通知类：空应答
        })
        .catch((e) => sendJson(res, jsonRpcError((message as { id?: unknown })?.id ?? null, -32603, e instanceof Error ? e.message : String(e))));
    });
    req.on('error', () => { try { res.end(); } catch { /* ignore */ } });
  });
  server.on('error', (err) => {
    console.error('[LocalShellServer] 监听失败:', (err as Error).message);
    try { server!.close(); } catch { /* ignore */ }
    server = null;
  });
  try {
    server.listen(SHELL_LOCAL_PORT, '127.0.0.1');
    return true;
  } catch {
    return false;
  }
}

/** 停止本地 Shell 宿主服务。 */
export function stopLocalShellServer(): void {
  if (server) {
    try { server.close(); } catch { /* ignore */ }
    server = null;
  }
}

/** 退出时统一 kill 所有活跃的 shell/python 子进程，避免超时前退出导致残留吃内存/句柄。 */
export function killAllChildProcesses(): void {
  for (const c of activeChildren) {
    try { c.kill(); } catch { /* ignore */ }
  }
  activeChildren.clear();
}