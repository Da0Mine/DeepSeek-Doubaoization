/* 插件管理面板逻辑。与主进程 ExtensionManager 经 window.shell 桥通信。 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shell = window.shell;
    if (!shell) {
      console.error('[extensions] window.shell 不可用');
      return;
    }

    var btnBack = document.getElementById('btn-back');
    var btnLoad = document.getElementById('btn-load');
    var btnRefresh = document.getElementById('btn-refresh');
    var listEl = document.getElementById('plugin-list');
    var statusEl = document.getElementById('status');
    var pinnedIds = {}; // id -> true（当前固定到窗口栏）

    if (btnBack) btnBack.onclick = function () { if (shell.closeExtensions) shell.closeExtensions(); };
    document.getElementById('btn-min').onclick = function () { shell.minimize(); };
    document.getElementById('btn-max').onclick = function () { shell.toggleMax(); };
    document.getElementById('btn-close').onclick = function () { shell.close(); };

    function setStatus(msg) { statusEl.textContent = msg || ''; }

    function iconFor(p) {
      var fb = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>';
      if (p && p.iconPath) {
        return '<img src="' + String(p.iconPath).replace(/"/g, '&quot;') + '" alt="" onerror="this.style.display=\'none\';">' + fb;
      }
      return fb;
    }

    function render(plugins) {
      if (!plugins || plugins.length === 0) {
        listEl.innerHTML =
          '<div class="empty">' +
          '<span class="empty-ico">' + iconFor(null) + '</span>' +
          '<span>还没有安装任何插件，点击右上角「加载扩展」安装已解压的扩展目录。</span>' +
          '</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < plugins.length; i++) {
        var p = plugins[i];
        var enabled = !!p.enabled;
        var builtin = !!p.builtin;
        var pinned = !!pinnedIds[p.id];
        html +=
          '<div class="plugin-card' + (enabled ? '' : ' disabled') + '" data-id="' + String(p.id).replace(/"/g, '&quot;') + '">' +
            '<div class="plugin-ico">' + iconFor(p) + '</div>' +
            '<div class="plugin-meta">' +
              '<div class="plugin-name">' + esc(p.name || '未命名') + '<span class="plugin-ver">v' + esc(p.version || '?') + '</span>' + (builtin ? '<span class="tag-builtin">内置</span>' : '') + '</div>' +
              '<div class="plugin-path" title="' + esc(p.path || '') + '">' + esc(p.path || '') + '</div>' +
              '<div class="plugin-state"><span class="' + (enabled ? 'state-on' : 'state-off') + '">' + (enabled ? '已启用' : '已停用') + '</span></div>' +
            '</div>' +
            '<div class="plugin-actions">' +
              '<button class="icon-btn btn-pin' + (pinned ? ' pinned-on' : '') + '" title="' + (pinned ? '从窗口栏取消固定' : '固定到窗口栏') + '">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>' +
              '</button>' +
              '<button class="switch' + (enabled ? ' on' : '') + '" title="' + (enabled ? '停用' : '启用') + '" aria-pressed="' + enabled + '"></button>' +
              (builtin ? '' : '<button class="icon-btn btn-remove" title="移除">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
              '</button>') +
            '</div>' +
          '</div>';
      }
      listEl.innerHTML = html;
      bindCardEvents();
    }

    function bindCardEvents() {
      var cards = listEl.querySelectorAll('.plugin-card');
      for (var i = 0; i < cards.length; i++) {
        (function (card) {
          var id = card.getAttribute('data-id');
          var sw = card.querySelector('.switch');
          if (sw) sw.onclick = function () { toggleEnabled(id, !!sw.classList.contains('on')); };
          var rm = card.querySelector('.btn-remove');
          if (rm) rm.onclick = function () { removePlugin(id, card); };
          var pin = card.querySelector('.btn-pin');
          if (pin) pin.onclick = function () {
            var cur = !!pinnedIds[id];
            setStatus(cur ? '正在取消固定…' : '正在固定到窗口栏…');
            shell.setExtensionPinned(id, !cur)
              .then(function () { setStatus(''); refresh(); })
              .catch(function (e) { setStatus('操作失败：' + (e && e.message ? e.message : e)); });
          };
        })(cards[i]);
      }
    }

    function toggleEnabled(id, wasOn) {
      setStatus('正在' + (wasOn ? '停用' : '启用') + '插件…');
      shell.setExtensionEnabled(id, !wasOn)
        .then(function () { setStatus(''); refresh(); })
        .catch(function (e) { setStatus('操作失败：' + (e && e.message ? e.message : e)); });
    }

    function removePlugin(id, card) {
      var name = card ? card.querySelector('.plugin-name').textContent || id : id;
      showConfirm('移除插件「' + name + '」？', '移除后仍需时可在「加载扩展」中重新安装。', function () {
        setStatus('正在移除…');
        shell.removeExtension(id)
          .then(function () { setStatus(''); refresh(); })
          .catch(function (e) { setStatus('移除失败：' + (e && e.message ? e.message : e)); });
      });
    }

    function refresh() {
      pinnedIds = {};
      if (shell.getPinnedExtensions) {
        shell.getPinnedExtensions().then(function (list) {
          if (list) list.forEach(function (p) { if (p && p.id) pinnedIds[p.id] = true; });
          loadList();
        }).catch(function () { loadList(); });
      } else {
        loadList();
      }
    }
    function loadList() {
      shell.listExtensions()
        .then(render)
        .catch(function (e) { setStatus('读取插件列表失败：' + (e && e.message ? e.message : e)); });
    }

    btnLoad.onclick = function () {
      setStatus('正在加载扩展…');
      shell.installExtensionFromPicker()
        .then(function (res) {
          if (res) { setStatus('已加载：' + (res.name || '')); refresh(); }
          else setStatus('');
        })
        .catch(function (e) { setStatus('加载失败：' + (e && e.message ? e.message : e)); });
    };
    btnRefresh.onclick = refresh;

    // 二次确认弹窗（破坏性操作）
    function showConfirm(title, msg, onOk) {
      var overlay = document.createElement('div');
      overlay.className = 'ds-confirm-overlay';
      overlay.innerHTML =
        '<div class="ds-confirm-card">' +
          '<div class="ds-confirm-title">' + esc(title) + '</div>' +
          '<div class="ds-confirm-msg">' + esc(msg) + '</div>' +
          '<div class="ds-confirm-btns">' +
            '<button class="ds-btn" data-act="cancel">取消</button>' +
            '<button class="ds-btn" data-act="ok">确定</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.querySelector('[data-act=cancel]').onclick = function () { overlay.remove(); };
      overlay.querySelector('[data-act=ok]').onclick = function () { overlay.remove(); onOk(); };
    }

    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    refresh();
  });
})();