/* 翻译窗口交互（原生 JS）。源/目标语言下拉 + 原文区 + 译文实时回填（防抖默认 400ms）。 */
(function () {
  'use strict';

  var LANGS = ['Auto', '中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español', 'Русский'];

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shell = window.shell;
    if (!shell) { console.error('[translate] window.shell 不可用'); return; }

    // ---- 标题栏按钮（与 titlebar.js 一致）----
    var btnSettings = document.getElementById('btn-settings');
    var btnPin = document.getElementById('btn-pin');
    var btnSwap = document.getElementById('btn-swap');
    var btnMin = document.getElementById('btn-min');
    var btnMax = document.getElementById('btn-max');
    var btnClose = document.getElementById('btn-close');
    if (btnSettings) btnSettings.onclick = function () { shell.openSettings(); };
    if (btnPin) btnPin.onclick = function () { shell.alwaysOnTop(); };
    if (btnSwap) btnSwap.onclick = function () { shell.swapMainSub(); };
    if (btnMin) btnMin.onclick = function () { shell.minimize(); };
    if (btnMax) btnMax.onclick = function () { shell.toggleMax(); };
    if (btnClose) btnClose.onclick = function () { shell.close(); };
    // 主副切换总开关（enableRoleSwap）已移除，主副切换按钮固定可用。

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

    // ---- 语言下拉 ----
    var srcSel = document.getElementById('src-lang');
    var dstSel = document.getElementById('dst-lang');
    LANGS.forEach(function (l) {
      var o1 = document.createElement('option'); o1.value = l; o1.textContent = l === 'Auto' ? '自动检测' : l;
      srcSel.appendChild(o1);
      var o2 = document.createElement('option'); o2.value = l; o2.textContent = l;
      dstSel.appendChild(o2);
    });

    // 翻译设置项已移出设置面板；此处用固定默认语言（源=自动检测，目标=English），
    // 下拉选择为窗口内会话状态，不再持久化到配置。
    // realTimeTranslateSync 配置项已移除，翻译同步固定为「始终启用」；
    // 本地 sync-toggle（HTML 默认 checked）仅作为窗口内「输入时自动同步」的会话级开关，不持久化。
    srcSel.value = 'Auto';
    dstSel.value = 'English';

    // ---- 实时同步 ----
    var srcText = document.getElementById('src-text');
    var dstText = document.getElementById('dst-text');
    var syncToggle = document.getElementById('sync-toggle');
    var btnSend = document.getElementById('btn-send');
    var timer = null;
    var DEBOUNCE = 400;

    function doSync() {
      var text = srcText.value.trim();
      if (!text) { dstText.value = ''; return; }
      shell.translateSync({
        sourceLang: srcSel.value,
        targetLang: dstSel.value,
        text: text,
        translated: '',
      });
    }

    srcText.addEventListener('input', function () {
      if (syncToggle.checked) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(doSync, DEBOUNCE);
      }
    });

    // 注：realTimeTranslateSync 配置项已移除，不再将开关持久化到配置（仅作为窗口内会话级开关）。

    btnSend.onclick = function () { doSync(); };

    // 译文回填
    shell.onTranslateResult(function (p) {
      if (p && p.translated) dstText.value = p.translated;
    });
  });
})();
