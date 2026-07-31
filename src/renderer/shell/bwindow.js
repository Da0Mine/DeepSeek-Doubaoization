/* B 类临时窗口交互（原生 JS）：仅关闭 / 最小化 / 最大化 / 置顶 + 主题变量下发。 */
(function () {
  'use strict';
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  ready(function () {
    var shell = window.shell;
    if (!shell) return;
    var btnMin = document.getElementById('btn-min');
    var btnMax = document.getElementById('btn-max');
    var btnClose = document.getElementById('btn-close');
    var btnPin = document.getElementById('btn-pin');
    if (btnMin) btnMin.onclick = function () { shell.minimize(); };
    if (btnMax) btnMax.onclick = function () { shell.toggleMax(); };
    if (btnClose) btnClose.onclick = function () { shell.close(); };
    // B 类窗口默认不置顶；点击 btn-pin toggle 置顶状态（与主/副窗口 btn-pin 行为一致）。
    if (btnPin) btnPin.onclick = function () { shell.alwaysOnTop(); };
    shell.onThemeVars(function (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          document.documentElement.style.setProperty(k, vars[k]);
        }
      }
    });
  });
})();
