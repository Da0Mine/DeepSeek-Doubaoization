/* 模式提示弹框逻辑：接收主进程下发的提示类型（expert/simple），
 * 半透明遮罩 + 居中卡片，入场动画用纯 CSS transition（无 GSAP CDN 依赖，避免网络阻塞）。
 * 「我知道了」仅关闭弹窗，「不再提醒」永久关闭该提示（写入配置，可在设置中重新开启）。 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shell = window.shell;
    if (!shell) {
      console.error('[modeReminder] window.shell 不可用');
      return;
    }

    var card = document.getElementById('mr-card');
    var mask = document.getElementById('mr-mask');
    var badge = document.getElementById('mr-badge');
    var messageEl = document.getElementById('mr-message');
    var detailEl = document.getElementById('mr-detail');
    var neverBtn = document.getElementById('mr-never');
    var okBtn = document.getElementById('mr-ok');

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

    // ---- 提示文案映射（与主进程 prepareScreenShare 分支对应） ----
    var MESSAGES = {
      expert: {
        message: '专家模式不支持上传图片',
        detail: '当前对话为专家模式且已无法切换模型，请新建对话并选择「识图模式」后再使用共享屏幕。',
      },
      simple: {
        message: '快速模式不支持识图，只支持 OCR 识别，识别可能会不精准',
        detail: '共享屏幕将按「快速模式」的 OCR 识别能力发送截图，识别结果可能不够精准。',
      },
    };

    // ---- 按钮 ----
    okBtn.addEventListener('click', function () {
      shell.send('modeReminder:action', { action: 'ok' });
    });
    neverBtn.addEventListener('click', function () {
      shell.send('modeReminder:action', { action: 'never' });
    });

    // ---- 主进程下发提示内容（type=模式提示；notice=通用提示） ----
    shell.onModeReminderInfo(function (info) {
      if (!info) return;
      var t = null;
      if (info.type && MESSAGES[info.type]) {
        t = MESSAGES[info.type];
      } else if (info.notice) {
        t = {
          title: info.notice.title || '提示',
          message: info.notice.message,
          detail: info.notice.detail || '',
        };
        neverBtn.style.display = info.notice.hideNever ? 'none' : '';
      }
      if (!t) return;
      if (t.title) badge.textContent = t.title;
      messageEl.textContent = t.message;
      detailEl.textContent = t.detail || '';

      // 入场：请求下一帧再应用 transition，确保初始态已生效
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          mask.style.opacity = '1';
          card.classList.add('mr-show');
        });
      });
    });
  });
})();
