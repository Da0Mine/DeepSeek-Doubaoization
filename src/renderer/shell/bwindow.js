/* B 类临时窗口交互（原生 JS）：仅关闭 / 最小化 / 最大化 / 置顶 + 翻译语言下拉框 + 主题变量下发。 */
(function () {
  'use strict';

  var TRANSLATE_LANGS = ['简体中文', '繁體中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español', 'Português', 'Русский', 'العربية', 'Italiano', 'Nederlands', 'Polski', 'Tiếng Việt', 'ภาษาไทย', 'हिन्दी'];

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
    function setPinIcon(pinned) {
      if (!btnPin) return;
      if (pinned) btnPin.classList.add('pinned');
      else btnPin.classList.remove('pinned');
      btnPin.setAttribute('aria-pressed', String(!!pinned));
    }
    // B 类窗口按配置 alwaysOnTop 决定初始置顶状态（构造时已设置，isAlwaysOnTop() 返回正确值）。
    // 点击 btn-pin toggle 置顶状态（与主/副窗口 btn-pin 行为一致）。
    if (btnPin) {
      btnPin.onclick = function () { shell.alwaysOnTop(); };
      if (shell.isAlwaysOnTop) {
        shell.isAlwaysOnTop().then(setPinIcon).catch(function () {});
      }
      if (shell.onAlwaysOnTop) shell.onAlwaysOnTop(setPinIcon);
    }

    // ---- 翻译语言下拉框（标题栏左侧，替换「结果」文字） ----
    var langSelect = document.getElementById('lang-select');
    if (langSelect) {
      // 填充语言选项
      TRANSLATE_LANGS.forEach(function (l) {
        var opt = document.createElement('option');
        opt.value = l;
        opt.textContent = l;
        langSelect.appendChild(opt);
      });
      // 防止程序赋值 .value 触发 change 事件导致重复发送（关键修复）
      var isSettingLang = false;
      if (shell.onTranslateSetLang) {
        shell.onTranslateSetLang(function (lang) {
          // 显示下拉框
          langSelect.style.display = '';
          // 设置当前语言，isSettingLang 标志阻止 change 事件处理器误发 IPC
          isSettingLang = true;
          langSelect.value = lang;
          isSettingLang = false;
        });
      }
      // 用户手动切换语言 → 通知主进程重新翻译
      langSelect.addEventListener('change', function () {
        if (isSettingLang) return;
        var newLang = langSelect.value;
        if (shell.changeTranslateLang) {
          shell.changeTranslateLang(newLang);
        }
      });
    }

    shell.onThemeVars(function (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          document.documentElement.style.setProperty(k, vars[k]);
        }
      }
    });
  });
})();