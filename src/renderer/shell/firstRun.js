/* 首次运行登录引导 / 用户须知：遮罩 + 两级弹窗（登录引导 → 用户须知）。
 * 入场用纯 CSS transition（无 GSAP CDN 依赖，避免网络阻塞）。
 * 「确定」从登录引导切到用户须知；「我已知晓」通知主进程关闭并开始等待登录。 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shell = window.shell;
    if (!shell) {
      console.error('[firstRun] window.shell 不可用');
      return;
    }

    var mask = document.getElementById('fr-mask');
    var loginCard = document.getElementById('fr-login');
    var noticeCard = document.getElementById('fr-notice');
    var loginOk = document.getElementById('fr-login-ok');
    var noticeOk = document.getElementById('fr-notice-ok');

    // ---- 主题适配（深色模式） ----
    function applyThemeVars(vars) {
      if (!vars) return;
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          document.documentElement.style.setProperty(k, vars[k]);
        }
      }
      var bg = vars['--ds-bg'] || '';
      var dark = /^#/.test(bg) ? parseInt(bg.replace('#', ''), 16) < 0x888888 : false;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    }
    shell.onThemeVars(function (vars) { applyThemeVars(vars); });
    if (shell.requestThemeVars) {
      shell.requestThemeVars().then(applyThemeVars).catch(function () {});
    }

    // ---- 入场：弹窗一（登录引导） ----
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        mask.style.opacity = '1';
        loginCard.classList.add('fr-show');
      });
    });

    // ---- 确定 → 弹窗二（用户须知） ----
    loginOk.addEventListener('click', function () {
      loginCard.classList.remove('fr-show');
      setTimeout(function () {
        loginCard.style.display = 'none';
        noticeCard.style.display = 'block';
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            noticeCard.classList.add('fr-show');
          });
        });
      }, 140);
    });

    // ---- 我已知晓 → 通知主进程（关闭弹窗并开始等待登录） ----
    noticeOk.addEventListener('click', function () {
      shell.send('firstRun:action', { action: 'done' });
    });
  });
})();
