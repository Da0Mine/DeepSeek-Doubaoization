/**
 * 划词工具栏逻辑：接收主进程经 IPC（toolbar:update）下发的按钮列表和选中文本，
 * 渲染按钮并处理点击事件；内容渲染完成后回报实际宽度（toolbar:resize），
 * 使窗口宽度自适应按钮数量，并触发首次显示。
 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shell = window.shell;
    if (!shell) {
      console.error('[toolbar] window.shell 不可用');
      return;
    }

    var toolbar = document.getElementById('toolbar');
    var pending = false;

    // 各按钮对应的图标 SVG（白色镂空线条风格）
    var ICON_MAP = {
      '问问DeepSeek': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>',
      '复制': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      '翻译': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
      '解释': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
      '提取文字': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
    };

    function renderToolbar(buttons, selectedText) {
      toolbar.innerHTML = '';
      if (!Array.isArray(buttons) || buttons.length === 0) return;

      buttons.forEach(function (btn, index) {
        if (index > 0) {
          var divider = document.createElement('span');
          divider.className = 'toolbar-divider';
          toolbar.appendChild(divider);
        }

        var button = document.createElement('button');
        button.className = 'toolbar-btn';

        // 每个按钮前加对应图标
        var iconSvg = ICON_MAP[btn.label] || '';
        button.innerHTML = iconSvg + '<span>' + btn.label + '</span>';

        button.addEventListener('click', function () {
          if (pending) return;
          pending = true;

          if (btn.label === '复制') {
            // 复制前通知主进程暂停剪贴板检测，避免复制后剪贴板变化触发重复弹窗
            shell.send('textSelection:beforeCopy');
            // 复制到剪贴板 - 通过 IPC
            navigator.clipboard.writeText(selectedText).then(function () {
              shell.close();
            }).catch(function () {
              // fallback
              shell.close();
            });
          } else {
            // 发送给主进程处理
            shell.send('textSelection:action', {
              action: btn.label,
              text: selectedText,
            });
            shell.close();
          }
        });

        toolbar.appendChild(button);
      });

      // 内容渲染完成后回报实际宽度，主进程据此自适应窗口尺寸并显示
      requestAnimationFrame(function () {
        shell.send('toolbar:resize', { width: toolbar.offsetWidth });
      });
    }

    // 订阅主进程内容下发（窗口复用后每次划词动态更新）
    shell.onToolbarUpdate(function (p) {
      if (!p) return;
      pending = false;
      renderToolbar(p.buttons, p.text || '');
    });
  });
})();
