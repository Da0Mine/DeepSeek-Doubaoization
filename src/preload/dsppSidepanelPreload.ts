/**
 * DeepSeek++ 侧边栏 host preload：加载由自定义协议 dspp:// 服务的 sidepanel.html（React 工作台）。
 * 提供：
 *  - window.__ds（contextBridge）：extHost storage / runtime 桥 → 主进程 ExtensionHost
 *  - 页面主世界注入 window.chrome（storage/runtime 兼容层），供 sidepanel React 调用
 * 经 IPC.EXT_HOST_* 转发到 ExtensionHost，使 sidepanel 在无 Electron MV3 扩展运行时下可用。
 */
import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { IPC } from '../main/ipc/channels';

const ds = {
  extHostStorageGet: (keys?: string | string[]): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke(IPC.EXT_HOST_STORAGE_GET, keys),
  extHostStorageSet: (values: Record<string, unknown>): Promise<boolean> =>
    ipcRenderer.invoke(IPC.EXT_HOST_STORAGE_SET, values),
  extHostStorageRemove: (keys: string | string[]): Promise<boolean> =>
    ipcRenderer.invoke(IPC.EXT_HOST_STORAGE_REMOVE, keys),
  extHostRuntimeMessage: (message: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IPC.EXT_HOST_RUNTIME_MESSAGE, message),
  /** 关闭内嵌侧边栏（DeepSeek++ ✕ 按钮）。 */
  closeSidepanel: (): void => {
    try {
      ipcRenderer.send(IPC.DSPP_CLOSE_SIDEPANEL);
    } catch {
      /* 忽略 */
    }
  },
};
contextBridge.exposeInMainWorld('__ds', ds);

// 页面主世界注入 chrome 兼容层
try {
  webFrame.executeJavaScript(`(function () {
    if (window.__dsppChromePatched) return;
    // 原生扩展页（chrome-extension://）已有 Electron 注入的真实 chrome → 不覆盖，直接标记跳过
    if (window.chrome && window.chrome.runtime && typeof window.chrome.runtime.sendMessage === 'function') {
      window.__dsppChromePatched = true;
      try { console.log('[dspp] sidepanel native-chrome present, skip shim'); } catch (e) {}
      return;
    }
    var b = window.__ds;
    function wrapStorage() {
      return {
        get: function (keys) { return Promise.resolve(b.extHostStorageGet(keys == null ? undefined : keys)).then(function (r) { return r || {}; }); },
        set: function (values) { return Promise.resolve(b.extHostStorageSet(values || {})).then(function () {}); },
        remove: function (keys) { return Promise.resolve(b.extHostStorageRemove(keys)).then(function () {}); },
        onChanged: { addListener: function () {}, removeListener: function () {} }
      };
    }
    function mkRuntime() {
      return {
        sendMessage: function (message) {
          return Promise.resolve(b.extHostRuntimeMessage(message ? JSON.parse(JSON.stringify(message)) : {})).then(function (r) { return r; });
        },
        onMessage: { addListener: function (fn) { window.__dsppRuntimeListener = fn; }, removeListener: function () {} },
        getManifest: function () { return { name: 'DeepSeek++', version: '1.14.0', manifest_version: 3 }; },
        id: '__dspp-host'
      };
    }
    var existing = (typeof window.chrome === 'object' && window.chrome) || {};
    Object.defineProperty(window, 'chrome', {
      value: Object.assign({}, existing, {
        runtime: mkRuntime(),
        storage: {
          local: wrapStorage(),
          sync: wrapStorage(),
          onChanged: { addListener: function () {}, removeListener: function () {} }
        },
        i18n: {
          getUILanguage: function () { return 'zh-CN'; },
          getMessage: function (key) { return typeof key === 'string' ? key : ''; },
          detectLanguage: function (txt) { return Promise.resolve({ isReliable: true, languages: [] }); }
        },
        extension: {
          isAllowedIncognitoAccess: function (cb) { if (typeof cb === 'function') cb(false); return Promise.resolve(false); },
          getURL: function (p) { var s = p == null ? '' : String(p); if (s.charAt(0) === '/') s = s.slice(1); return 'dspp://sidepanel/' + s; }
        },
        permissions: {
          contains: function (_origins) {
            // 悬浮聊天球默认视为已授权（默认开启），避免"未获网页访问权限"误报
            return Promise.resolve(b.extHostStorageGet('deepseek_pp_floating_chat_enabled'))
              .then(function (r) { return !(r && r.deepseek_pp_floating_chat_enabled === false); });
          },
          request: function (_origins) { return Promise.resolve(true); },
          onAdded: { addListener: function () {}, removeListener: function () {} },
          onRemoved: { addListener: function () {}, removeListener: function () {} }
        }
      }),
      configurable: true,
      writable: true
    });
    window.__dsppChromePatched = true;
    window.__dspp_patch_source = 'preload';
    try { console.log('[dspp] chrome-patch:OK via-preload'); } catch (e) {}
  })()`).catch(() => {});
} catch (e) {
  console.log('[dspp-sidepanel] chrome patch 异常', e);
}

// 注入内嵌侧边栏的 ✕ 关闭按钮（右上角悬浮），点击经 __ds.closeSidepanel 通知主进程关闭。
try {
  webFrame.executeJavaScript(`(function () {
    function inject() {
      if (!window.__ds || typeof window.__ds.closeSidepanel !== 'function') return;
      if (document.getElementById('__dspp_close_btn')) return;
      var btn = document.createElement('div');
      btn.id = '__dspp_close_btn';
      btn.setAttribute('role', 'button');
      btn.setAttribute('title', '关闭侧边栏');
      btn.style.cssText =
        'position:fixed;top:0;right:0;z-index:2147483647;width:40px;height:38px;' +
        'display:flex;align-items:center;justify-content:center;cursor:pointer;' +
        'font-size:16px;line-height:1;color:#c8cdd6;user-select:none;' +
        'font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;';
      btn.textContent = '\\u2715';
      btn.addEventListener('click', function () { try { window.__ds.closeSidepanel(); } catch (e) {} });
      btn.addEventListener('mouseenter', function () { btn.style.color = '#fff'; btn.style.background = 'rgba(255,255,255,0.10)'; });
      btn.addEventListener('mouseleave', function () { btn.style.color = '#c8cdd6'; btn.style.background = 'transparent'; });
      document.body.appendChild(btn);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
    else inject();
  })()`).catch(() => {});
} catch (e) {
  console.log('[dspp-sidepanel] close btn 注入异常', e);
}