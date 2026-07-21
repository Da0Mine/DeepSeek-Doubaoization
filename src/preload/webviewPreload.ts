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
      const file = new File([buf], 'deepseek-screenshot.png', { type: 'image/png' });
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

  /** 探测登录态：无登录按钮且存在输入框视为已登录（待实机验证）。 */
  detectLogin(): boolean {
    try {
      const texts = LOGIN_BUTTON_TEXTS;
      const btns = Array.from(document.querySelectorAll('button, a'));
      const hasLogin = btns.some((b) =>
        texts.some((t) => (b.textContent || '').trim().toLowerCase().includes(t.toLowerCase()))
      );
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

/**
 * 修复主窗口侧边栏异常展开（用户反馈：窗口偏窄时左侧历史会话栏被展开、挤压主内容区，
 * 并出现超长滚动条）。
 *
 * 策略（只改样式、不破坏 DeepSeek 官网 DOM 结构）：
 *  1) 注入兜底 CSS（<style id="ds-sidebar-fix">）：给 html/body 设 overflow-x:hidden; min-width:0，
 *     从根本上杜绝横向溢出导致的超长滚动条。
 *  2) JS 动态探测页面中「贴近左侧、宽度达标」的侧边栏元素（getBoundingClientRect），
 *     当窗口可用宽度不足（innerWidth - 侧边栏宽度 < 主内容最小宽度）时，给侧边栏加内联折叠样式
 *     （width/max-width/min-width:0; overflow:hidden; opacity:0），并给其右侧兄弟元素设
 *     flex:1 1 auto; min-width:480px，使其填满剩余空间。窗口变宽时自动恢复。
 *  3) 监听 window.resize 重新判定；找不到侧边栏则什么都不做（避免误伤）。
 *
 * 注意：用 lastSidebar 记录已折叠元素，保证「折叠后窗口再次变宽」能正确恢复（否则宽度归 0 后
 * 探测会失败、再也找不到该栏而无法还原）。
 */
function installSidebarLayoutFix(): void {
  try {
    const STYLE_ID = 'ds-sidebar-fix';
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        html, body { overflow-x: hidden !important; min-width: 0 !important; }
      `;
      document.head.appendChild(style);
    }

    const MIN_CONTENT_WIDTH = 480;
    const SIDEBAR_MIN_WIDTH = 200;
    const SIDEBAR_MAX_WIDTH = 400;
    let lastSidebar: HTMLElement | null = null;

    /** 查找「贴近左侧、宽度达标」的侧边栏候选（优先复用已记录的元素，便于还原）。 */
    function findSidebar(): HTMLElement | null {
      if (lastSidebar && document.contains(lastSidebar)) return lastSidebar;
      let best: HTMLElement | null = null;
      let bestWidth = 0;
      const candidates = document.querySelectorAll<HTMLElement>('div, aside, nav');
      candidates.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (
          rect.width >= SIDEBAR_MIN_WIDTH &&
          rect.width <= SIDEBAR_MAX_WIDTH &&
          rect.left >= -1 &&
          rect.left <= 4 &&
          rect.height > 200
        ) {
          if (rect.width > bestWidth) {
            bestWidth = rect.width;
            best = el;
          }
        }
      });
      lastSidebar = best;
      return best;
    }

    /** 依当前窗口宽度决定是否折叠/还原侧边栏（不改动 DOM 结构，仅改内联样式）。 */
    function collapseSidebarIfNeeded(): void {
      const sidebar = findSidebar();
      if (!sidebar) return; // 找不到侧边栏则不误伤
      const rect = sidebar.getBoundingClientRect();
      const available = window.innerWidth - rect.width;
      const sibling = sidebar.nextElementSibling as HTMLElement | null;
      if (available < MIN_CONTENT_WIDTH) {
        sidebar.style.setProperty('width', '0', 'important');
        sidebar.style.setProperty('max-width', '0', 'important');
        sidebar.style.setProperty('min-width', '0', 'important');
        sidebar.style.setProperty('overflow', 'hidden', 'important');
        sidebar.style.setProperty('opacity', '0', 'important');
        if (sibling) {
          sibling.style.setProperty('flex', '1 1 auto', 'important');
          sibling.style.setProperty('min-width', `${MIN_CONTENT_WIDTH}px`, 'important');
          sibling.style.setProperty('margin-left', '0', 'important');
        }
      } else {
        // 窗口足够宽：移除折叠样式，恢复官网默认布局
        sidebar.style.removeProperty('width');
        sidebar.style.removeProperty('max-width');
        sidebar.style.removeProperty('min-width');
        sidebar.style.removeProperty('overflow');
        sidebar.style.removeProperty('opacity');
        if (sibling) {
          sibling.style.removeProperty('flex');
          sibling.style.removeProperty('min-width');
          sibling.style.removeProperty('margin-left');
        }
      }
    }

    const run = (): void => {
      try {
        collapseSidebarIfNeeded();
      } catch {
        // 单次判定异常不影响整体注入
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
    // 窗口尺寸变化（拖拽缩放、显示/隐藏）时重新判定
    window.addEventListener('resize', run);
    // 初次延迟补判：DeepSeek 为 SPA，侧边栏可能稍后才挂载
    setTimeout(run, 500);
    setTimeout(run, 1500);
  } catch {
    // 极端环境忽略，不影响注入
  }
}
installSidebarLayoutFix();

// 定时探测并回报登录态（仅在页面加载完成后）
let lastState = false;
setInterval(() => {
  try {
    const loggedIn = dsApi.detectLogin();
    if (loggedIn !== lastState) {
      lastState = loggedIn;
      ipcRenderer.send(IPC.LOGIN_DETECT, { loggedIn, url: location.href });
    }
  } catch (e) {
    // 忽略探测异常
  }
}, 3000);

declare global {
  interface Window {
    __ds: typeof dsApi;
    __dsNewConvBound?: boolean;
  }
}
