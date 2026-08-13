/**
 * 注入 chat.deepseek.com 的预加载脚本。
 * 提供：上传钩子（window.__ds.uploadFile）、登录态探测（window.__ds.detectLogin），
 * 并周期性经 IPC.LOGIN_DETECT 向主进程回报登录态（主进程再广播给外壳）。
 *
 * 预加载脚本运行在特权上下文，可直接 require Node 模块（fs），
 * 通过 contextBridge 仅暴露安全的方法给页面。
 */
import { contextBridge, ipcRenderer } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '../main/ipc/channels';
import { LOGIN_BUTTON_TEXTS } from '../main/inject/deepseek-selectors';

/**
 * 尽早为页面注入 setPointerCapture / releasePointerCapture 的 polyfill。
 * DeepSeek 页面在某些元素（如 SVG）上调用 setPointerCapture 时会抛
 * "setPointerCapture is not a function" 导致模型下拉等交互直接崩溃（问题 B）。
 * preload 在页面脚本前执行，故可提前补上这两个方法，使其变为 no-op，
 * 既消除报错又不会拦截/吞掉页面自身的点击。
 */
(function installPointerCapturePolyfill(): void {
  try {
    if (typeof Element !== 'undefined') {
      const proto = Element.prototype as unknown as Record<string, unknown>;
      if (typeof proto.setPointerCapture !== 'function') {
        proto.setPointerCapture = function (_pointerId?: number): void {};
      }
      if (typeof proto.releasePointerCapture !== 'function') {
        proto.releasePointerCapture = function (_pointerId?: number): void {};
      }
    }
  } catch {
    /* 极端环境下忽略，不阻断注入 */
  }
})();

const dsApi = {
  /**
   * 将本地图片文件写入页面的文件输入（DataTransfer），
   * 触发 change 事件，使 React 受控组件感知到文件选择。
   * @returns 是否成功（文件输入存在且赋值成功）。
   */
  uploadFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false;
      const buf = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      // 根据文件扩展名推断 MIME 类型
      const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.zip': 'application/zip',
        '.txt': 'text/plain',
        '.json': 'application/json',
        '.js': 'text/javascript',
        '.ts': 'text/typescript',
        '.html': 'text/html',
        '.css': 'text/css',
        '.md': 'text/markdown',
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg',
      };
      const mimeType = mimeMap[ext] || 'application/octet-stream';
      const file = new File([buf], fileName, { type: mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
      if (!input) return false;
      // 兼容不同浏览器/框架对 files 的赋值方式
      try {
        (input as unknown as { files: FileList }).files = dt.files;
      } catch (e) {
        Object.defineProperty(input, 'files', {
          value: dt.files,
          configurable: true,
        });
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) {
      console.error('[webviewPreload] uploadFile 失败:', e);
      return false;
    }
  },

  /** 探测登录态：无登录按钮且存在输入框视为已登录；「退出登录」菜单项直接视为已登录。 */
  detectLogin(): boolean {
    try {
      const texts = LOGIN_BUTTON_TEXTS;
      const btns = Array.from(document.querySelectorAll('button, a'));
      const txtOf = (b: Element): string =>
        ((b.textContent || b.getAttribute('aria-label') || '') as string).trim().toLowerCase();
      const isLogout = (t: string): boolean =>
        t.includes('退出登录') || t.includes('注销') || t.includes('log out') || t.includes('sign out');
      // 登录/注册按钮精确匹配：避免「注册表/注册码」等正文内容被「注册」误命中
      const isLoginBtn = (t: string): boolean =>
        texts.some((k) => t === k || t.startsWith(k + ' ') || t.startsWith(k + '账号'));
      // 已登录页面常驻「退出登录」菜单项：命中即视为已登录
      if (btns.some((b) => isLogout(txtOf(b)))) return true;
      const hasLogin = btns.some((b) => {
        const t = txtOf(b);
        if (!t || isLogout(t)) return false;
        return isLoginBtn(t);
      });
      const input = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
      return !hasLogin && !!input;
    } catch (e) {
      return false;
    }
  },

  /**
   * 网页内「新建对话」被触发时由注入脚本调用（Bug2 修复）。
   * 经 IPC.NEW_CONVERSATION 通知主进程，主进程据此自动切换到设置的默认模型模式。
   */
  reportNewConversation(): void {
    try {
      console.log('[preload] reportNewConversation → 发送 IPC NEW_CONVERSATION');
      ipcRenderer.send(IPC.NEW_CONVERSATION);
    } catch (e) {
      console.log('[preload] reportNewConversation 异常 ' + e);
    }
  },

  /**
   * 网页内回答生成状态变化时由注入脚本调用（回答完成提醒功能）。
   * started=true 表示开始生成（最后一条 AI 消息文本增长），false 表示回答完成/停止。
   * switched=true 表示用户已切换到其他会话：主进程应取消当前跟踪且不提醒
   * （SPA 切走后页面已看不到原会话的回答，无法再可靠判定其完成）。
   */
  reportAnswerStatus(started: boolean, switched = false): void {
    try {
      ipcRenderer.send(IPC.ANSWER_STATUS, { started: !!started, switched: !!switched });
    } catch (e) {
      console.log('[preload] reportAnswerStatus 异常 ' + e);
    }
  },

  /**
   * 通用 IPC 发送方法，供注入脚本使用。
   * 用于共享屏幕 Enter 键拦截器、共享文档发送/刷新等场景。
   */
  send(channel: string, payload?: any): void {
    try {
      // 只允许白名单内的通道，防止注入脚本滥用
      const allowedChannels = ['screenShare:enterPressed', 'docShare:send', 'docShare:stop', 'docShare:refresh'];
      if (allowedChannels.includes(channel)) {
        ipcRenderer.send(channel, payload);
      }
    } catch (e) {
      console.error('[webviewPreload] send 失败:', e);
    }
  },
  /** 主 -> webview：订阅共享文档列表刷新结果（payload: { mode, names }）。 */
  onDocShareRefresh: (cb: (payload: { mode: string; names: string[] }) => void): void => {
    ipcRenderer.on(IPC.DOC_SHARE_REFRESH_RESULT, (_e, payload: { mode?: string; names?: string[] }) =>
      cb(
        payload && typeof payload === 'object' && Array.isArray(payload.names)
          ? { mode: String(payload.mode ?? ''), names: payload.names }
          : { mode: '', names: [] }
      )
    );
  },
};

contextBridge.exposeInMainWorld('__ds', dsApi);

// 网页内剪刀按钮触发：页面派发自定义 DOM 事件 -> 经 IPC 通知主进程启动截图（I-01）
function bindScissorsTrigger(): void {
  const handler = (): void => {
    try {
      ipcRenderer.send(IPC.SCISSORS_TRIGGER);
    } catch (e) {
      // 忽略
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () =>
      document.addEventListener('ds-scissors-trigger', handler)
    );
  } else {
    document.addEventListener('ds-scissors-trigger', handler);
  }
}
bindScissorsTrigger();

// 网页内「+」按钮菜单触发：截图提问（简化模式）
function bindPlusEvents(): void {
  const handler = (e: Event): void => {
    try {
      const type = (e as CustomEvent).detail?.type;
      if (type === 'screenshotQ') {
        ipcRenderer.send(IPC.PLUS_SCREENSHOT_Q);
      } else if (type === 'uploadFile') {
        ipcRenderer.send(IPC.PLUS_UPLOAD_FILE);
      } else if (type === 'shareScreen') {
        ipcRenderer.send(IPC.PLUS_SHARE_SCREEN);
      } else if (type === 'shareDoc') {
        ipcRenderer.send(IPC.PLUS_SHARE_DOC);
      } else if (type === 'shareExcel') {
        ipcRenderer.send(IPC.PLUS_SHARE_EXCEL);
      } else if (type === 'sharePdf') {
        ipcRenderer.send(IPC.PLUS_SHARE_PDF);
      }
    } catch (err) {
      // 忽略
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () =>
      document.addEventListener('ds-plus-trigger', handler)
    );
  } else {
    document.addEventListener('ds-plus-trigger', handler);
  }
}
bindPlusEvents();

/**
 * 屏蔽 DeepSeek 官方「使用环境异常」风险提示弹窗。
 * 该弹窗（文案：使用环境异常 / 当前页面的使用环境可能存在数据和隐私泄露风险 / 建议您使用我们的官方产品）
 * 由 chat.deepseek.com 的安全检测触发（Electron 环境可能被误判），会遮挡页面并影响使用。
 * 通过 MutationObserver 监听 DOM，发现含特征文案的弹窗容器即整体隐藏；定时器兜底覆盖 SPA 重渲染。
 */
function blockEnvironmentRiskDialog(): void {
  const RISK_KEY = '使用环境异常';
  const RISK_HINTS = ['当前页面的使用环境可能存在数据和隐私泄露风险', '建议您使用我们的官方产品'];
  const processed = new WeakSet<Element>();

  function isRiskDialog(el: Element): boolean {
    try {
      const text = (el.textContent || '').replace(/\s+/g, '');
      if (text.indexOf(RISK_KEY) < 0) return false;
      // 命中标题后再要求命中至少一条特征句，避免误伤用户聊天内容
      return RISK_HINTS.some((h) => text.indexOf(h) >= 0);
    } catch {
      return false;
    }
  }

  /** 隐藏单个元素（去重保护，防止重复处理同一节点）。 */
  function hideElement(el: HTMLElement): void {
    if (processed.has(el)) return;
    processed.add(el);
    el.style.display = 'none';
    el.style.visibility = 'hidden';
  }

  /**
   * 检测是否为覆盖全屏的遮罩层。
   * 特征：fixed/absolute + 覆盖视口大部分区域 + （backdrop-filter 模糊 或 半透明深色背景）。
   * 用于找出与弹窗卡片同级/位于其上的灰蒙模糊遮罩。
   */
  function isMaskOverlay(el: Element): boolean {
    try {
      const cs = window.getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
      const b = el.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      if (b.width < vw * 0.7 || b.height < vh * 0.7) return false;
      const bf = (
        cs.getPropertyValue('backdrop-filter') ||
        cs.getPropertyValue('-webkit-backdrop-filter') ||
        ''
      ).toLowerCase();
      if (bf && bf.indexOf('blur') !== -1) return true;
      const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(cs.backgroundColor);
      if (m) {
        const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
        const lum = (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
        return alpha < 0.9 && lum < 200;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** 找到包含特征文案的最外层弹窗容器（fixed/absolute 高层级）并整体隐藏。
   *  弹窗的模糊遮罩层通常是弹窗卡片的兄弟节点（React portal 结构），卡片隐藏后遮罩仍残留，
   *  因此沿祖先链逐级检查各层兄弟/自身，把全屏模糊遮罩一并隐藏。 */
  function hideDialog(seed: Element): void {
    let node: Element | null = seed;
    let target: Element = seed;
    let depth = 0;
    while (node && node.parentElement && depth < 6) {
      try {
        const cs = window.getComputedStyle(node.parentElement);
        if (cs.position === 'fixed' || cs.position === 'absolute') {
          target = node.parentElement;
        }
      } catch {
        /* 忽略 */
      }
      node = node.parentElement;
      depth++;
    }
    hideElement(target as HTMLElement);
    // 遮罩可能与卡片同级（body/portal 根的直接子节点），或位于更高层级：
    // 从种子沿祖先链上溯 12 层，检查每一层自身及兄弟节点是否为全屏遮罩。
    node = seed;
    depth = 0;
    while (node && depth < 12) {
      const parent: Element | null = node.parentElement;
      if (parent) {
        if (isMaskOverlay(parent)) hideElement(parent as HTMLElement);
        const kids = parent.children;
        for (let i = 0; i < kids.length; i++) {
          if (isMaskOverlay(kids[i])) hideElement(kids[i] as HTMLElement);
        }
      }
      node = parent;
      depth++;
    }
    // 生产环境不输出日志，避免终端刷屏（调试时取消注释）
    // console.log('[web:risk] 已屏蔽「使用环境异常」弹窗及其模糊遮罩');
  }

  function scanRoot(root: ParentNode): void {
    try {
      if (!root || typeof root.querySelectorAll !== 'function') return;
      const nodes = root.querySelectorAll('div, section, article, main, aside');
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (el.children.length > 12) continue; // 跳过大型容器，降低误伤与开销
        if (isRiskDialog(el)) {
          hideDialog(el);
          return; // 每次命中一个即可，其余由监听器继续处理
        }
      }
    } catch {
      /* 忽略 */
    }
  }

  function start(): void {
    try {
      if (document.body) scanRoot(document.body);
      const mo = new MutationObserver((muts) => {
        for (let m = 0; m < muts.length; m++) {
          const added = muts[m].addedNodes;
          for (let k = 0; k < added.length; k++) {
            const n = added[k];
            if (n && n.nodeType === 1) scanRoot(n as ParentNode);
          }
        }
      });
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      // 兜底轮询：覆盖滚动懒加载 / React 重新挂载（低频，开销可忽略）
      setInterval(() => {
        if (document.body) scanRoot(document.body);
      }, 4000);
    } catch {
      /* 忽略 */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}
blockEnvironmentRiskDialog();

// 之前的 layout-fix 注入已全部移除（重构方案）：
//   - 旧方案通过在 preload 注入 CSS 锁死 html/body，但破坏了 DeepSeek 内部 fixed/absolute
//     定位元素的布局，导致主内容区消失、消息区卡死等副作用。
//   - 新方案改在主进程 WindowManager 里通过 view.webContents.insertCSS 隐藏 webContents
//     自身的滚动条（::-webkit-scrollbar { display: none }），不修改 DeepSeek 内部布局。
//   - 此处不再注入任何 style 或修改 DOM 元素。

// 登录态检测：已移除窗口常驻定时轮询（用户要求），仅在 设置 → 高级 → 账号 → 登录状态 中
// 按需经 account:getStatus 主动查询（detectLogin 方法保留供主进程调用）。

declare global {
  interface Window {
    __ds: typeof dsApi;
    __dsNewConvBound?: boolean;
  }
}
