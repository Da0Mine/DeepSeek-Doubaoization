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

// 之前的 layout-fix 注入已全部移除（重构方案）：
//   - 旧方案通过在 preload 注入 CSS 锁死 html/body，但破坏了 DeepSeek 内部 fixed/absolute
//     定位元素的布局，导致主内容区消失、消息区卡死等副作用。
//   - 新方案改在主进程 WindowManager 里通过 view.webContents.insertCSS 隐藏 webContents
//     自身的滚动条（::-webkit-scrollbar { display: none }），不修改 DeepSeek 内部布局。
//   - 此处不再注入任何 style 或修改 DOM 元素。

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
