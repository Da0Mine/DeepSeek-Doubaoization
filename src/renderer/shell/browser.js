/* 内置浏览器外壳交互：标签栏渲染/切换/关闭 + 窗口控制 + 主题变量。 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shell = window.shell;
    if (!shell) return;

    var tabsEl = document.getElementById('tabs');
    var btnNew = document.getElementById('btn-new-tab');
    var btnMin = document.getElementById('btn-min');
    var btnMax = document.getElementById('btn-max');
    var btnClose = document.getElementById('btn-close');

    if (btnMin) btnMin.onclick = function () { shell.minimize(); };
    if (btnMax) btnMax.onclick = function () { shell.toggleMax(); };
    if (btnClose) btnClose.onclick = function () { shell.close(); };

    // 渲染标签栏
    function renderTabs(state) {
      if (!tabsEl) return;
      if (!state || !state.tabs) return;
      tabsEl.innerHTML = '';
      state.tabs.forEach(function (tab) {
        var el = document.createElement('div');
        el.className = 'tab' + (tab.active ? ' active' : '');
        el.title = tab.url;
        el.onclick = function () {
          if (shell.switchBrowserTab) shell.switchBrowserTab(tab.id);
        };
        var title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = tab.title || tab.url;
        el.appendChild(title);
        var closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close';
        closeBtn.textContent = '×';
        closeBtn.onclick = function (e) {
          e.stopPropagation();
          if (shell.closeBrowserTab) shell.closeBrowserTab(tab.id);
        };
        el.appendChild(closeBtn);
        tabsEl.appendChild(el);
      });
    }

    // 初始化拉取一次快照
    if (shell.getBrowserState) {
      shell.getBrowserState().then(renderTabs).catch(function () {});
    }
    // 订阅后续更新
    if (shell.onBrowserTabsUpdated) {
      shell.onBrowserTabsUpdated(renderTabs);
    }
    // 新建标签页：新建后聚焦输入地址（主进程新开空白标签由用户输入；简化：直接新建并聚焦）
    if (btnNew) {
      btnNew.onclick = function () {
        if (shell.newBrowserTab) shell.newBrowserTab();
      };
    }

    // 主题变量：初始化主动拉取一次（外壳刚创建时广播可能已错过），之后订阅变更
    if (shell.requestThemeVars) {
      shell.requestThemeVars().then(function (vars) {
        applyVars(vars);
      }).catch(function () {});
    }
    if (shell.onThemeVars) {
      shell.onThemeVars(applyVars);
    }
  });

  function applyVars(vars) {
    if (!vars) return;
    for (var k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) {
        document.documentElement.style.setProperty(k, vars[k]);
      }
    }
  }
})();
