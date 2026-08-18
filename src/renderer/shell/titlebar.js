/* 自定义标题栏交互（原生 JS）。通过 window.shell（shellPreload 暴露）与主进程通信。 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shell = window.shell;
    if (!shell) {
      console.error('[titlebar] window.shell 不可用');
      return;
    }

    var btnSettings = document.getElementById('btn-settings');
    var btnUpdate = document.getElementById('btn-update');
    var btnPin = document.getElementById('btn-pin');
    var btnSwap = document.getElementById('btn-swap');
    var btnMin = document.getElementById('btn-min');
    var btnMax = document.getElementById('btn-max');
    var btnClose = document.getElementById('btn-close');

    if (btnSettings) btnSettings.onclick = function () { shell.openSettings(); };
    // 更新图标按钮：仅主窗口需要；收到「发现新版本」后显示，点击打开设置并跳转到「更新」板块。
    if (shell.windowType !== 'main') {
      if (btnUpdate) btnUpdate.style.display = 'none';
    } else {
      if (btnUpdate && shell.onUpdateAvailable) {
        shell.onUpdateAvailable(function (info) {
          btnUpdate.style.display = '';
          if (info && info.latestVersion) {
            btnUpdate.title = '发现新版本 v' + info.latestVersion;
          }
        });
        btnUpdate.onclick = function () {
          if (shell.openUpdateSettings) shell.openUpdateSettings();
        };
      }
    }
    function setPinIcon(pinned) {
      if (!btnPin) return;
      if (pinned) btnPin.classList.add('pinned');
      else btnPin.classList.remove('pinned');
      btnPin.setAttribute('aria-pressed', String(!!pinned));
    }
    if (btnPin) {
      // 置顶按钮仅副窗口需要；主窗口去掉（见需求）。
      if (shell.windowType === 'main') {
        btnPin.style.display = 'none';
      } else {
        btnPin.onclick = function () { shell.alwaysOnTop(); };
        // 初始化图标状态 + 监听主进程同步
        if (shell.isAlwaysOnTop) {
          shell.isAlwaysOnTop().then(setPinIcon).catch(function () {});
        }
        if (shell.onAlwaysOnTop) shell.onAlwaysOnTop(setPinIcon);
      }
    }
    // 设置按钮仅主窗口需要；副窗口（sub / B 类）去掉（见需求）。
    if (shell.windowType !== 'main') {
      if (btnSettings) btnSettings.style.display = 'none';
    }
    if (btnSwap) {
      // 图标随窗口类型变化：主窗口小方块空心；副窗口（及 B 类窗口）小方块实心
      if (shell.windowType !== 'main') {
        btnSwap.innerHTML = '<svg class="tb-ico" viewBox="0 0 1024 1024" aria-hidden="true" style="fill:currentColor;stroke:none;"><path d="M921.6 12.8h-307.2A89.6 89.6 0 0 0 524.8 102.4v307.2c0 49.4592 40.1408 89.6 89.6 89.6h307.2A89.6 89.6 0 0 0 1011.2 409.6V102.4A89.6 89.6 0 0 0 921.6 12.8zM204.8 140.8h204.8a38.4 38.4 0 0 0 0-76.8H204.8A140.8 140.8 0 0 0 64 204.8v614.4A140.8 140.8 0 0 0 204.8 960h614.4A140.8 140.8 0 0 0 960 819.2v-204.8a38.4 38.4 0 0 0-76.8 0v204.8c0 35.328-28.672 64-64 64H204.8c-35.328 0-64-28.672-64-64V204.8c0-35.328 28.672-64 64-64z" fill="currentColor"/><path d="M601.6 115.2a12.8 12.8 0 0 1 12.8-12.8h281.6a12.8 12.8 0 0 1 12.8 12.8v281.6a12.8 12.8 0 0 1-12.8 12.8H614.4a12.8 12.8 0 0 1-12.8-12.8z" fill="currentColor"/></svg>';
      }
      // 悬浮提示：主窗口 → 切换为副窗口；副窗口（及 B 类窗口）→ 切换为主窗口
      btnSwap.title = shell.windowType === 'main' ? '切换为副窗口' : '切换为主窗口';
      btnSwap.onclick = function () { shell.swapMainSub(); };
    }
    if (btnMin) btnMin.onclick = function () { shell.minimize(); };
    if (btnMax) btnMax.onclick = function () { shell.toggleMax(); };
    if (btnClose) btnClose.onclick = function () { shell.close(); };

    // 主副切换总开关（enableRoleSwap）已移除，主副切换按钮固定可用。

    // 主题变量下发：写入 :root
    shell.onThemeVars(function (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          document.documentElement.style.setProperty(k, vars[k]);
        }
      }
      var dark = getComputedStyle(document.documentElement).getPropertyValue('--ds-bg').trim() === '#1e1e1e';
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    });
    // 登录态显示已移除：不再在窗口上常驻检测（登录状态请到 设置 → 个人中心 → 账号 中查看）。
  });
})();
