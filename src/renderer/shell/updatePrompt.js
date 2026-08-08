/* 更新提醒弹框逻辑：接收主进程下发的版本信息，
 * 「暂不更新」记录忽略版本，「立即更新」开始下载并展示进度。 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shell = window.shell;
    if (!shell) {
      console.error('[updatePrompt] window.shell 不可用');
      return;
    }
    var gsap = window.gsap;

    var card = document.getElementById('up-card');
    var mask = document.getElementById('up-mask');
    var versionEl = document.getElementById('up-version');
    var notesEl = document.getElementById('up-notes');
    var progressWrap = document.getElementById('up-progress');
    var progressFill = document.getElementById('up-progress-fill');
    var progressText = document.getElementById('up-progress-text');
    var actionsEl = document.getElementById('up-actions');
    var laterBtn = document.getElementById('up-later');
    var installBtn = document.getElementById('up-install');

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

    // ---- 轻量 markdown 渲染（标题 / 列表 / 段落） ----
    function renderNotes(md) {
      if (!md) return '<p>该版本暂无更新说明。</p>';
      var lines = String(md).split(/\r?\n/);
      var html = '';
      var inList = false;
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (/^#{1,4}\s+/.test(t)) {
          if (inList) { html += '</ul>'; inList = false; }
          html += '<div class="up-notes-h">' + t.replace(/^#{1,4}\s+/, '') + '</div>';
        } else if (/^[-*]\s+/.test(t)) {
          if (!inList) { html += '<ul>'; inList = true; }
          html += '<li>' + t.replace(/^[-*]\s+/, '') + '</li>';
        } else if (/^\s*$/.test(t)) {
          if (inList) { html += '</ul>'; inList = false; }
        } else {
          if (inList) { html += '</ul>'; inList = false; }
          html += '<p>' + t + '</p>';
        }
      }
      if (inList) html += '</ul>';
      return html;
    }

    // ---- 下载进度（percent 为 -1 表示失败） ----
    function setProgress(p) {
      if (p.percent < 0) {
        progressWrap.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = '下载失败，请前往 Release 页面手动下载';
        installBtn.disabled = false;
        installBtn.textContent = '立即更新';
        return;
      }
      progressWrap.style.display = 'block';
      progressFill.style.width = (p.percent || 0) + '%';
      if (p.total > 0) {
        var fmt = function (n) { return (n / 1048576).toFixed(1); };
        progressText.textContent =
          '正在下载 ' + fmt(p.received) + ' / ' + fmt(p.total) + ' MB（' + (p.percent || 0) + '%）';
      } else {
        progressText.textContent = '正在下载 ' + (p.received / 1048576).toFixed(1) + ' MB…';
      }
    }
    shell.onUpdateDownloadProgress(function (p) {
      if (p.receiver && p.receiver !== 'prompt') return;
      setProgress(p);
    });

    // ---- 按钮 ----
    laterBtn.addEventListener('click', function () {
      shell.send('update:promptAction', { action: 'later' });
    });
    installBtn.addEventListener('click', function () {
      installBtn.disabled = true;
      installBtn.textContent = '下载中…';
      shell.send('update:promptAction', { action: 'install' });
    });

    // ---- 版本信息下发 ----
    shell.onUpdatePromptInfo(function (info) {
      if (!info) return;
      versionEl.textContent = 'v' + info.latestVersion;
      notesEl.innerHTML = renderNotes(info.releaseNotes);

      if (gsap) {
        gsap.fromTo(card, { autoAlpha: 0, y: 24, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.35, ease: 'back.out(1.5)' });
        gsap.fromTo(mask, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' });
      } else {
        card.style.opacity = '1';
        card.style.visibility = 'visible';
      }
    });
  });
})();
