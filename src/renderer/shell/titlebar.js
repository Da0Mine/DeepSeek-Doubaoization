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
    var btnPin = document.getElementById('btn-pin');
    var btnSwap = document.getElementById('btn-swap');
    var btnMin = document.getElementById('btn-min');
    var btnMax = document.getElementById('btn-max');
    var btnClose = document.getElementById('btn-close');

    if (btnSettings) btnSettings.onclick = function () { shell.openSettings(); };
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
    if (btnSwap) btnSwap.onclick = function () { shell.swapMainSub(); };
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
