/* 黑名单窗口选择交互（原生 JS）：hover 高亮窗口 + 左上角显示进程名，点击加入黑名单。 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shell = window.shell;
    if (!shell) {
      console.error('[blacklistPicker] window.shell 不可用');
      return;
    }

    var rects = []; // 主进程下发的可选窗口（遮罩局部坐标，含 processName）
    var active = null; // 当前 hover 命中的窗口

    var snap = document.getElementById('snap');
    var plabel = document.getElementById('plabel');
    var scopeIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

    // 命中规则：优先「链序最顶层（z 最小）且包含鼠标点」的窗口；z 缺失时回退面积最小。
    function findAt(cx, cy) {
      var hits = [];
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        if (cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height) hits.push(r);
      }
      if (!hits.length) return null;
      var best = null;
      for (var j = 0; j < hits.length; j++) {
        if (typeof hits[j].z !== 'number') continue;
        if (!best || hits[j].z < best.z) best = hits[j];
      }
      if (!best) {
        best = hits[0];
        var minA = best.width * best.height;
        for (var m = 1; m < hits.length; m++) {
          var a = hits[m].width * hits[m].height;
          if (a < minA) { minA = a; best = hits[m]; }
        }
      }
      return best;
    }

    function updateAt(cx, cy) {
      var s = findAt(cx, cy);
      if (s === active) return;
      active = s;
      if (s) {
        snap.style.display = 'block';
        snap.style.left = s.x + 'px';
        snap.style.top = s.y + 'px';
        snap.style.width = s.width + 'px';
        snap.style.height = s.height + 'px';
        plabel.style.display = 'flex';
        plabel.style.left = s.x + 'px';
        plabel.style.top = s.y + 'px';
        plabel.innerHTML = scopeIcon + '<span>' + escapeHtml(s.processName || '未知进程') + '</span>';
      } else {
        snap.style.display = 'none';
        plabel.style.display = 'none';
      }
    }

    function escapeHtml(t) {
      return String(t).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    // 主进程下发可选窗口列表
    shell.onBlacklistPickWindows(function (list) {
      rects = list || [];
    });

    window.addEventListener('mousemove', function (e) {
      updateAt(e.clientX, e.clientY);
    });

    // 左键点击：命中窗口则加入黑名单；点了空白则取消
    window.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var name = active ? active.processName : '';
      if (name) {
        shell.send('blacklist:pickSelected', { name: name });
      } else {
        shell.send('blacklist:pickCancel');
      }
    });

    // 右键 = 取消
    window.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      shell.send('blacklist:pickCancel');
    });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') shell.send('blacklist:pickCancel');
    });
  });
})();