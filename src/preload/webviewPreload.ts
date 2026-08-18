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

/** 页面内查找栏控制器（DOMContentLoaded 后由 installFindBar 赋值，供 __ds.showFindBar 延迟调用）。 */
let findBarController: { show(): void; hide(): void; isVisible(): boolean } | null = null;

// 【实验观察】打印伪装后的浏览器指纹，确认 Edge UA 伪装是否生效（实验结束后移除）
try {
  const uaData = (navigator as unknown as { userAgentData?: { brands?: { brand: string; version: string }[] } })
    .userAgentData;
  console.log(
    '[UA-DIAG] ua=' + navigator.userAgent +
    ' webdriver=' + (navigator as unknown as { webdriver?: unknown }).webdriver +
    ' brands=' + (uaData && uaData.brands ? uaData.brands.map((b) => b.brand + '/' + b.version).join(',') : 'none')
  );
} catch {
  /* 忽略 */
}

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
  /** 根据扩展名推断 MIME 类型。 */
  mimeOf(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
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
    return mimeMap[ext] || 'application/octet-stream';
  },

  /** 将本地文件写入页面的文件输入（单文件，复用多文件实现）。 */
  uploadFile(filePath: string): boolean {
    return this.uploadFiles([filePath]);
  },

  /**
   * 将多个本地文件一次性写入页面的文件输入（DataTransfer 可容纳多文件），
   * 触发 change 事件，使 React 受控组件感知到文件选择。用于「共享多个文档」。
   * @returns 是否成功（至少一个文件成功且赋值成功）。
   */
  uploadFiles(filePaths: string[]): boolean {
    try {
      const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
      const dt = new DataTransfer();
      for (const p of paths) {
        if (!fs.existsSync(p)) continue;
        const buf = fs.readFileSync(p);
        const fileName = path.basename(p);
        const file = new File([buf], fileName, { type: this.mimeOf(fileName) });
        dt.items.add(file);
      }
      if (dt.files.length === 0) return false;
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
      console.error('[webviewPreload] uploadFiles 失败:', e);
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
   * 网页内「无痕模式」切换时由注入脚本调用（加号菜单「无痕模式」项）。
   * 经 IPC.INC0GNITO_MODE 通知主进程记录/清除该 webContents 的无痕状态；
   * 主进程在「关闭对话窗口 / 新建对话 / 退出程序 / 切换对话」时据此删除对话记录。
   */
  setIncognito(on: boolean): void {
    try {
      ipcRenderer.send(IPC.INC0GNITO_MODE, { on: !!on });
    } catch (e) {
      console.log('[preload] setIncognito 异常 ' + e);
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
  /** 主 -> webview：订阅共享文档列表刷新结果（payload: { mode, docs: {name,type}[] }）。 */
  onDocShareRefresh: (cb: (payload: { mode: string; docs: { name: string; type: string }[] }) => void): void => {
    ipcRenderer.on(IPC.DOC_SHARE_REFRESH_RESULT, (_e, payload: { mode?: string; docs?: { name?: unknown; type?: unknown }[] }) =>
      cb(
        payload && typeof payload === 'object' && Array.isArray(payload.docs)
          ? {
              mode: String(payload.mode ?? ''),
              docs: payload.docs
                .filter((d) => d && typeof d === 'object')
                .map((d) => ({ name: String((d as { name?: unknown }).name ?? ''), type: String((d as { type?: unknown }).type ?? '') })),
            }
          : { mode: '', docs: [] }
      )
    );
  },

  // ---- 页面内查找栏（Ctrl+F 唤起，浏览器原生查找体验） ----
  /** 显示/聚焦页面内查找栏（主进程 Ctrl+F 拦截后调用）。 */
  showFindBar: (): void => {
    try {
      findBarController?.show();
    } catch {
      /* 忽略 */
    }
  },
  /** 隐藏查找栏并清除高亮。 */
  hideFindBar: (): void => {
    try {
      findBarController?.hide();
    } catch {
      /* 忽略 */
    }
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
      } else if (type === 'shareDocAll') {
        ipcRenderer.send(IPC.PLUS_SHARE_DOC_ALL);
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
 * 页面内查找栏（Ctrl+F 唤起，浏览器原生查找体验）。
 * - 使用 Chromium 原生 window.find() 高亮/滚动，无 React 冲突；
 * - DOM 注入到 DeepSeek 页面顶部右侧，跟随页面滚动/窗口移动，无需额外窗口；
 * - 输入实时查找 + 上/下切换（Enter/Shift+Enter 或 ▲/▼）+ 计数 + Esc/✕ 关闭；
 * - preload 与页面共享 DOM：UI 由 preload 构造，但查找逻辑全部在页面内完成。
 */
function installFindBar(): void {
  try {
    if ((window as unknown as { __dsFindBarInstalled?: boolean }).__dsFindBarInstalled) return;
    (window as unknown as { __dsFindBarInstalled: boolean }).__dsFindBarInstalled = true;

    // 1. 样式（毛玻璃深色浮层，与设置面板下拉菜单一致）
    const STYLE_ID = 'ds-find-bar-style';
    if (!document.getElementById(STYLE_ID)) {
      const css = document.createElement('style');
      css.id = STYLE_ID;
      css.textContent = `
        #ds-find-bar {
          position: fixed; top: 12px; right: 16px; z-index: 2147483647;
          display: none; align-items: center; gap: 6px; padding: 6px 8px;
          box-sizing: border-box;
          font-size: 13px; font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
          background: rgba(38, 40, 48, 0.92);
          -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
          border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
          box-shadow: 0 6px 24px rgba(0,0,0,0.40); color: #e8eaf0;
        }
        #ds-find-bar input {
          width: 180px; height: 26px; padding: 0 10px;
          font-size: 13px; font-family: inherit; color: #fff;
          background: rgba(255,255,255,0.08); border: 1px solid transparent; border-radius: 6px;
          outline: none; box-sizing: border-box; transition: border-color .18s;
        }
        #ds-find-bar input:focus { border-color: rgba(90,140,255,0.85); }
        #ds-find-bar input::placeholder { color: #7c8290; }
        #ds-find-bar .ds-fb-count {
          min-width: 52px; text-align: center; color: #9aa3b2; font-size: 12px; user-select: none;
        }
        #ds-find-bar .ds-fb-btn {
          width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
          border: none; background: transparent; color: #c8cdd6; border-radius: 6px; cursor: pointer;
          font-size: 12px; line-height: 1; padding: 0; user-select: none;
          transition: background .18s, color .18s, transform .08s;
        }
        #ds-find-bar .ds-fb-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
        #ds-find-bar .ds-fb-btn:active { transform: scale(.94); }
      `;
      document.head.appendChild(css);
    }
    if (document.getElementById('ds-find-bar')) return;

    // 2. DOM
    const bar = document.createElement('div');
    bar.id = 'ds-find-bar';
    bar.setAttribute('role', 'search');

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '在页面中查找…';
    input.spellcheck = false;

    const count = document.createElement('span');
    count.className = 'ds-fb-count';

    const mkBtn = (label: string, title: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ds-fb-btn';
      b.title = title;
      b.textContent = label;
      return b;
    };
    const prevBtn = mkBtn('▲', '上一个（Shift+Enter）');
    const nextBtn = mkBtn('▼', '下一个（Enter）');
    const closeBtn = mkBtn('✕', '关闭（Esc）');

    bar.appendChild(input);
    bar.appendChild(count);
    bar.appendChild(prevBtn);
    bar.appendChild(nextBtn);
    bar.appendChild(closeBtn);
    document.body.appendChild(bar);

    // 3. 查找状态
    let keyword = '';
    let total = 0;
    let current = 0;
    /** 拼音输入法组合标志：组合期间不执行查找，避免打断 IME。 */
    let composing = false;
    /** 匹配列表（Range + 锚点元素）。 */
    let matches: { range: Range; el: Element | null }[] = [];
    let currentIdx = 0;
    /** 包裹当前匹配的 <mark>（蓝色高亮）。 */
    let wrappedMark: HTMLElement | null = null;

    const setCount = (): void => {
      if (!keyword) {
        count.textContent = '';
      } else if (total > 0) {
        count.textContent = current > 0 ? current + '/' + total : '0/' + total;
      } else {
        count.textContent = '无结果';
      }
    };

    const clearSelection = (): void => {
      try {
        const s = window.getSelection();
        if (s) s.removeAllRanges();
      } catch {
        /* 忽略 */
      }
    };

    /** 还原被包裹的匹配文本（DOM 恢复原状）。 */
    const restoreWrapped = (): void => {
      if (wrappedMark && wrappedMark.parentNode) {
        try {
          wrappedMark.replaceWith(...Array.from(wrappedMark.childNodes));
        } catch {
          /* 忽略 */
        }
      }
      wrappedMark = null;
    };

    /** 清除高亮：还原包裹 + 清选区。 */
    const clearHighlights = (): void => {
      restoreWrapped();
      clearSelection();
    };

    /** 遍历文本节点，收集所有匹配的 Range（大小写不敏感，排除查找栏自身）。 */
    const collectMatches = (kw: string): { range: Range; el: Element | null }[] => {
      const out: { range: Range; el: Element | null }[] = [];
      if (!kw) return out;
      const lower = kw.toLowerCase();
      try {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode()) !== null) {
          const parent = node.parentElement;
          if (!parent) continue;
          const tag = parent.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'NOSCRIPT') continue;
          if (parent.closest && (parent.closest('#ds-find-bar') || parent.closest('.ds-find-mark'))) continue;
          const text = (node.textContent || '').toLowerCase();
          let idx = 0;
          for (;;) {
            const pos = text.indexOf(lower, idx);
            if (pos === -1) break;
            try {
              const range = document.createRange();
              range.setStart(node, pos);
              range.setEnd(node, pos + kw.length);
              out.push({ range, el: parent });
            } catch {
              /* 单个失败跳过 */
            }
            idx = pos + lower.length;
          }
        }
      } catch {
        /* 忽略 */
      }
      return out;
    };

    /**
     * 包裹当前匹配为蓝色高亮 <mark>。
     * 对"部分选中文本节点"的 Range，surroundContents 会抛 InvalidStateError，
     * 必须先 splitText 把匹配拆成独立文本节点，再用 selectNode + surroundContents。
     */
    const wrapCurrent = (): boolean => {
      restoreWrapped();
      const m = matches[currentIdx];
      if (!m) return false;
      try {
        const mark = document.createElement('mark');
        mark.className = 'ds-find-mark';
        mark.style.cssText =
          'background:rgba(90,140,255,0.70)!important;color:#fff!important;' +
          'border-radius:3px;padding:0 1px;box-shadow:0 0 0 1px rgba(90,140,255,0.9);';
        const sc = m.range.startContainer;
        const ec = m.range.endContainer;
        if (sc.nodeType === Node.TEXT_NODE && ec.nodeType === Node.TEXT_NODE && sc === ec) {
          const text = sc as Text;
          // 先拆尾部再拆头部，偏移量才不会乱
          if (m.range.endOffset < text.length) text.splitText(m.range.endOffset);
          let start = text;
          if (m.range.startOffset > 0) start = text.splitText(m.range.startOffset);
          // start 现在是从匹配起点开始的独立文本节点，长度为匹配长度
          const r = document.createRange();
          r.selectNode(start);
          r.surroundContents(mark);
          wrappedMark = mark;
          return true;
        }
        // 跨节点边界（正常不会走到）：直接尝试
        m.range.surroundContents(mark);
        wrappedMark = mark;
        return true;
      } catch {
        return false;
      }
    };

    /** 滚动当前高亮 mark 到可滚动容器垂直居中。 */
    const scrollToMark = (): void => {
      if (!wrappedMark || !wrappedMark.parentNode) return;
      try {
        // CSS zoom（字号缩放注入 html zoom）下 getBoundingClientRect 返回「缩放后」坐标，
        // 而 scrollTop/scrollY 是「布局」值，直接混算会滚动过头（约 5%）。统一换算为布局坐标。
        let z = 1;
        try { z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1; } catch { z = 1; }
        const rect = wrappedMark.getBoundingClientRect();
        const rectT = rect.top / z;
        const rectH = rect.height / z;
        let container: Element | null = wrappedMark.parentElement;
        let target: HTMLElement | null = null;
        while (container && container !== document.documentElement) {
          const cs = window.getComputedStyle(container);
          if (/(auto|scroll|overlay)/.test(cs.overflowY) && container.scrollHeight > container.clientHeight) {
            target = container as HTMLElement;
            break;
          }
          container = container.parentElement;
        }
        if (target) {
          const cr = target.getBoundingClientRect();
          const crT = cr.top / z;
          const crH = cr.height / z;
          target.scrollTop += rectT - crT - (crH - rectH) / 2;
        } else {
          window.scrollTo({ top: window.scrollY + rectT - (window.innerHeight - rectH) / 2 });
        }
      } catch {
        /* 忽略 */
      }
    };

    /** 输入内容变化后从头重新查找并高亮/跳转到第一个匹配。 */
    const runSearch = (): void => {
      restoreWrapped(); // 先还原旧包裹，保证 DOM 干净再遍历
      const kw = input.value;
      keyword = kw;
      matches = collectMatches(kw);
      total = matches.length;
      if (!kw || total === 0) {
        clearSelection();
        current = 0;
        setCount();
        return;
      }
      currentIdx = 0;
      if (wrapCurrent()) scrollToMark();
      current = 1;
      setCount();
    };

    /** 上一个/下一个（循环）。 */
    const goTo = (backwards: boolean): void => {
      const n = matches.length;
      if (!input.value || n === 0) return;
      currentIdx = backwards ? (currentIdx - 1 + n) % n : (currentIdx + 1) % n;
      restoreWrapped();
      matches = collectMatches(keyword);
      if (!matches.length) {
        total = 0;
        current = 0;
        setCount();
        return;
      }
      currentIdx = currentIdx % matches.length;
      if (wrapCurrent()) scrollToMark();
      current = currentIdx + 1;
      setCount();
    };

    const show = (): void => {
      bar.style.display = 'flex';
      input.focus();
      // 非组合态才全选已有内容，避免选中打断输入法
      if (input.value && !composing) input.select();
    };

    const hide = (): void => {
      bar.style.display = 'none';
      clearHighlights();
      keyword = '';
      matches = [];
      total = 0;
      current = 0;
      setCount();
    };

    // 4. 事件
    // 拼音输入法组合期间（isComposing）不执行查找：window.find 会移动选区并打断
    // IME 组合上下文，导致敲第一个字母就退出输入模式。等 compositionend 后再查。
    input.addEventListener('compositionstart', () => {
      composing = true;
    });
    input.addEventListener('compositionend', () => {
      composing = false;
      runSearch();
    });
    input.addEventListener('input', (e) => {
      if (composing || (e as InputEvent).isComposing) return; // IME 组合中不打断
      runSearch();
    });

    input.addEventListener('keydown', (e) => {
      const key = (e as KeyboardEvent).key;
      // Windows 拼音组合时 keydown 的 keyCode 为 229 / isComposing 为 true：
      // Enter（选候选词）与 Esc（取消组合）都要放行给输入法，不作为查找快捷键
      const ime = (e as KeyboardEvent).isComposing || (e as KeyboardEvent).keyCode === 229;
      if (key === 'Enter' && !ime) {
        e.preventDefault();
        e.stopPropagation();
        goTo((e as KeyboardEvent).shiftKey);
      } else if (key === 'Escape' && !ime) {
        e.preventDefault();
        e.stopPropagation();
        hide();
      }
    });

    prevBtn.addEventListener('click', () => goTo(true));
    nextBtn.addEventListener('click', () => goTo(false));
    closeBtn.addEventListener('click', hide);

    // 页面内 Ctrl+F 兜底拦截（主进程 before-input-event 优先，双保险；组合态不拦）
    document.addEventListener(
      'keydown',
      (e) => {
        if ((e as KeyboardEvent).isComposing) return;
        if ((e as KeyboardEvent).ctrlKey && !(e as KeyboardEvent).altKey && ((e as KeyboardEvent).key === 'f' || (e as KeyboardEvent).key === 'F')) {
          e.preventDefault();
          e.stopPropagation();
          if (bar.style.display === 'none') show();
          else input.focus();
        }
      },
      true
    );

    // 查找栏可见时，按 Esc 也可关闭（不拦截 DeepSeek 自身的 Esc 弹窗关闭）
    document.addEventListener(
      'keydown',
      (e) => {
        if ((e as KeyboardEvent).key === 'Escape' && bar.style.display !== 'none') {
          hide();
        }
      },
      true
    );

    findBarController = { show, hide, isVisible: () => bar.style.display !== 'none' };
  } catch (err) {
    console.error('[webviewPreload] installFindBar 失败:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installFindBar);
} else {
  installFindBar();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installStaleOverlayCleaner);
} else {
  installStaleOverlayCleaner();
}

/**
 * 点击自愈：清除「残留全屏遮罩」。
 * 现象：点侧边栏「更多/三个点」删除对话（或点搜索按钮）→ 面板/弹窗闪现后，
 * 其全屏 backdrop 遮罩残留成透明/半透明拦截层 → 之后侧边栏按钮全部点不动。
 * 这里在 mousedown 捕获阶段检测「点击目标被更高层无内容遮罩完全覆盖」并隐藏之。
 * 判定（多重保护，避免误伤正常弹窗）：
 *   1) 最上层元素 fixed/absolute 且覆盖 ≥50% 视口；
 *   2) 背景为透明或半透明（alpha<0.75）；
 *   3) 自身无可见文本内容（空壳遮罩）；
 *   4) 关键：临时置 pointer-events:none 取「下层元素」，下层是可交互元素
 *      （按钮/链接/输入框等）才清理——用户点空白处想关弹窗时不清理。
 */
function installStaleOverlayCleaner(): void {
  try {
    document.addEventListener(
      'mousedown',
      (e) => {
        try {
          if (!document.elementFromPoint) return;
          // 注意：不能依赖 e.target 判断「是否被覆盖」——残留遮罩在最上层时，
          // mousedown 的 e.target 就是遮罩本身，会导致 top===t 恒成立而直接 return，
          // 自愈永远不触发（曾因此多轮修复无效）。
          const top = document.elementFromPoint(e.clientX, e.clientY);
          if (!top) return;
          const cs = window.getComputedStyle(top);
          if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          if (cs.pointerEvents === 'none') return;
          const r = top.getBoundingClientRect();
          if (r.width < window.innerWidth * 0.5 || r.height < window.innerHeight * 0.5) return;
          // 背景：透明 或 半透明（alpha<0.75）
          const bg = cs.backgroundColor;
          let isShade = false;
          if (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') {
            isShade = true;
          } else {
            const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(bg);
            if (m) {
              const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
              if (alpha < 0.75) isShade = true;
            }
          }
          if (!isShade) return;
          // 无可见文本内容（空壳遮罩）
          if ((top.textContent || '').trim().length > 0) return;
          // 关键：取被遮罩挡住的「下层元素」，确认是可交互元素才清理
          const topEl = top as HTMLElement;
          const prevPE = topEl.style.pointerEvents;
          topEl.style.pointerEvents = 'none';
          let beneath: Element | null = null;
          try {
            beneath = document.elementFromPoint(e.clientX, e.clientY);
          } catch {
            /* 忽略 */
          }
          topEl.style.pointerEvents = prevPE;
          if (!beneath || beneath === top) return;
          const interactive =
            beneath.closest &&
            beneath.closest(
              'button, a, input, textarea, select, [role="button"], [role="menuitem"], [role="option"], [contenteditable="true"], [onclick], [data-action]'
            );
          if (!interactive) return;
          // 确认是被遮罩挡住的按钮（下层元素或其祖先含可交互元素）→ 残留遮罩，清除
          (top as HTMLElement).style.display = 'none';
          (top as HTMLElement).style.visibility = 'hidden';
        } catch {
          /* 忽略 */
        }
      },
      true
    );
  } catch {
    /* 忽略 */
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installStaleOverlayCleaner);
} else {
  installStaleOverlayCleaner();
}

/**
 * 屏蔽 DeepSeek 官方「使用环境异常」风险提示弹窗。
 * 该弹窗（文案：使用环境异常 / 当前页面的使用环境可能存在数据和隐私泄露风险 / 建议您使用我们的官方产品）
 * 由 chat.deepseek.com 的安全检测触发（Electron 环境可能被误判），会遮挡页面并影响使用。
 *
 * 关键实现约束（2026-08-15 教训）：
 *   ❌ 旧方案用 display:none 隐藏弹窗 DOM，但 React 的 modal 系统（ds-modal-overlay/
 *      ds-modal-wrapper）内部状态仍认为弹窗打开 → 之后用户再打开任何 modal（如删除确认）
 *      时 React 状态冲突 → 新 modal 打开瞬间被自动关闭。
 *   ✅ 正确方案：模拟点击弹窗的关闭/确认按钮，或派发 Esc 键，让 React 自己走正常的
 *      关闭流程（状态同步），用户后续的 modal 交互才不受影响。
 * 通过 MutationObserver 监听 DOM，发现含特征文案的弹窗即自动关闭；定时器兜底覆盖 SPA 重渲染。
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

  /** 找到风险弹窗卡片（含特征文案元素的最内层按钮容器）。 */
  function findCard(seed: Element): Element | null {
    let node: Element | null = seed;
    for (let d = 0; d < 8 && node; d++, node = node.parentElement) {
      try {
        if (node.querySelectorAll && node.querySelectorAll('button, [role="button"]').length > 0) return node;
      } catch {
        /* 忽略 */
      }
    }
    return null;
  }

  /**
   * 自动关闭风险弹窗：优先点按钮、其次 Esc，让 React 状态正常同步。
   * 绝不直接 display:none（会破坏 React modal 状态，导致后续删除确认等 modal 自动关闭）。
   */
  function dismissDialog(seed: Element): void {
    if (processed.has(seed)) return;
    processed.add(seed);
    try {
      // 1. 点击弹窗内的关闭/确认按钮（文本匹配常见文案；找不到则点最后一个按钮）
      const card = findCard(seed);
      if (card) {
        const btns = Array.from(card.querySelectorAll('button, [role="button"]')) as HTMLElement[];
        const closeRe = /知道|继续|确定|同意|关闭|完成|got it|ok|close/i;
        let target = btns.find((b) => closeRe.test((b.textContent || '').trim()));
        if (!target && btns.length) target = btns[btns.length - 1];
        if (target) {
          try {
            target.click();
            return;
          } catch {
            /* 继续下一步 */
          }
        }
      }
      // 2. Esc 键关闭（React 监听 Esc 关闭 modal，状态同步）
      try {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
        return;
      } catch {
        /* 继续下一步 */
      }
      // 3. 兜底：若 600ms 后弹窗仍在（按钮/Esc 均未生效），再隐藏（最后手段）
      setTimeout(() => {
        try {
          const card2 = findCard(seed);
          if (card2) {
            const r = card2.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              (card2 as HTMLElement).style.display = 'none';
              (card2 as HTMLElement).style.visibility = 'hidden';
            }
          }
        } catch {
          /* 忽略 */
        }
      }, 600);
    } catch {
      /* 忽略 */
    }
  }

  function scanRoot(root: ParentNode): void {
    try {
      if (!root || typeof root.querySelectorAll !== 'function') return;
      const nodes = root.querySelectorAll('div, section, article, main, aside');
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (el.children.length > 12) continue; // 跳过大型容器，降低误伤与开销
        if (isRiskDialog(el)) {
          dismissDialog(el);
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
// 【实验撤销】为验证 Edge UA 伪装是否根治风险弹窗，暂时不自动关闭（保留函数便于回退）。
// 若伪装生效弹窗不再出现；若仍出现且破坏 modal 交互，恢复本行即可。
// blockEnvironmentRiskDialog();

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
