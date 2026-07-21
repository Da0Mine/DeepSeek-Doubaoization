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
    var loginStatus = document.getElementById('login-status');
    if (btnSettings) btnSettings.onclick = function () { shell.openSettings(); };
    if (btnPin) btnPin.onclick = function () { shell.alwaysOnTop(); };
    if (btnSwap) btnSwap.onclick = function () { shell.swapMainSub(); };
    if (btnMin) btnMin.onclick = function () { shell.minimize(); };
    if (btnMax) btnMax.onclick = function () { shell.toggleMax(); };
    if (btnClose) btnClose.onclick = function () { shell.close(); };
    try {
      shell.getConfig('enableRoleSwap').then(function (on) {
        if (btnSwap && !on) btnSwap.style.display = 'none';
      }).catch(function () {});
    } catch (e) {}

    shell.onThemeVars(function (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          document.documentElement.style.setProperty(k, vars[k]);
        }
      }
      var dark = getComputedStyle(document.documentElement).getPropertyValue('--ds-bg').trim() === '#1e1e1e';
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    });
    shell.onLoginStatus(function (p) {
      if (!loginStatus) return;
      loginStatus.textContent = p.loggedIn ? '已登录' : '未登录，请登录';
      loginStatus.className = 'tb-status ' + (p.loggedIn ? 'ok' : 'warn');
    });

    // ---- 语言下拉 ----
    var srcSel = document.getElementById('src-lang');
    var dstSel = document.getElementById('dst-lang');
    LANGS.forEach(function (l) {
      var o1 = document.createElement('option'); o1.value = l; o1.textContent = l === 'Auto' ? '自动检测' : l;
      srcSel.appendChild(o1);
      var o2 = document.createElement('option'); o2.value = l; o2.textContent = l;
      dstSel.appendChild(o2);
    });

    // 读取配置默认值
    Promise.all([
      shell.getConfig('defaultTranslateSourceLang'),
      shell.getConfig('defaultTranslateTargetLang'),
      shell.getConfig('realTimeTranslateSync'),
    ]).then(function (vals) {
      if (vals[0]) srcSel.value = vals[0];
      if (vals[1]) dstSel.value = vals[1];
      if (typeof vals[2] === 'boolean') syncToggle.checked = vals[2];
    }).catch(function () {});

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

    syncToggle.addEventListener('change', function () {
      shell.setConfig('realTimeTranslateSync', syncToggle.checked);
    });
    srcSel.addEventListener('change', function () { shell.setConfig('defaultTranslateSourceLang', srcSel.value); });
    dstSel.addEventListener('change', function () { shell.setConfig('defaultTranslateTargetLang', dstSel.value); });

    btnSend.onclick = function () { doSync(); };

    // 译文回填
    shell.onTranslateResult(function (p) {
      if (p && p.translated) dstText.value = p.translated;
    });
  });
})();
