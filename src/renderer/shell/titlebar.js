/* 自定义标题栏交互（原生 JS）。通过 window.shell（shellPreload 暴露）与主进程通信。 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shell = window.shell;
    if (!shell) {
      console.error('[titlebar] window.shell 不可用');
      return;
    }

    var btnSettings = document.getElementById('btn-settings');
    var btnUpdate = document.getElementById('btn-update');
    var btnPin = document.getElementById('btn-pin');
    var btnSwap = document.getElementById('btn-swap');
    var btnMin = document.getElementById('btn-min');
    var btnMax = document.getElementById('btn-max');
    var btnClose = document.getElementById('btn-close');
    var btnNavBack = document.getElementById('btn-nav-back');
    var btnNavForward = document.getElementById('btn-nav-forward');
    var btnNavReload = document.getElementById('btn-nav-reload');

    // 导航按钮（后退/前进/刷新）仅主窗口显示。
    if (shell.windowType === 'main') {
      var navState = { canGoBack: false, canGoForward: false };
      function applyNavState(s) {
        if (!s) return;
        navState = s;
        if (btnNavBack) btnNavBack.classList.toggle('is-disabled', !s.canGoBack);
        if (btnNavForward) btnNavForward.classList.toggle('is-disabled', !s.canGoForward);
      }
      if (btnNavBack) btnNavBack.onclick = function () { if (navState.canGoBack) shell.chatNavBack(); };
      if (btnNavForward) btnNavForward.onclick = function () { if (navState.canGoForward) shell.chatNavForward(); };
      if (btnNavReload) btnNavReload.onclick = function () { shell.chatNavReload(); };
      // 初始状态 + 订阅主进程推送（SPA 路由 / 加载完成后会更新可用性）
      if (shell.getChatNavState) shell.getChatNavState().then(applyNavState).catch(function () {});
      if (shell.onChatNavState) shell.onChatNavState(applyNavState);
    } else {
      [btnNavBack, btnNavForward, btnNavReload].forEach(function (b) {
        if (b) b.style.display = 'none';
      });
    }

    if (btnSettings) btnSettings.onclick = function () { shell.openSettings(); };
    // 固定在窗口栏的扩展按钮（位于设置按钮右侧；仅主窗口）。
    var tbPinned = document.getElementById('tb-pinned');
    function renderPinned(list) {
      if (!tbPinned || shell.windowType !== 'main') return;
      tbPinned.innerHTML = '';
      (list || []).forEach(function (p) {
        var b = document.createElement('button');
        b.className = 'tb-btn tb-pinned';
        b.title = p.name || '扩展';
        b.setAttribute('aria-label', p.name || '扩展');
        if (p.iconPath) {
          var img = document.createElement('img');
          img.className = 'tb-pinned-ico';
          img.src = p.iconPath;
          img.alt = '';
          img.onerror = function () { img.style.display = 'none'; };
          b.appendChild(img);
        }
        b.onclick = function () { if (shell.openExtensionPage) shell.openExtensionPage(p.id); };
        tbPinned.appendChild(b);
      });
    }
    if (shell.windowType === 'main') {
      if (shell.getPinnedExtensions) shell.getPinnedExtensions().then(renderPinned).catch(function () {});
      if (shell.onPinnedExtensions) shell.onPinnedExtensions(renderPinned);
    }
    // 更新图标按钮：仅主窗口需要；收到「发现新版本」后显示，点击打开设置并跳转到「更新」板块。
    if (shell.windowType !== 'main') {
      if (btnUpdate) btnUpdate.style.display = 'none';
    } else {
      if (btnUpdate && shell.onUpdateAvailable) {
        shell.onUpdateAvailable(function (info) {
          btnUpdate.style.display = '';
          if (info && info.latestVersion) {
            btnUpdate.title = '发现新版本 v' + info.latestVersion;
          }
        });
        btnUpdate.onclick = function () {
          if (shell.openUpdateSettings) shell.openUpdateSettings();
        };
      }
    }
    function setPinIcon(pinned) {
      if (!btnPin) return;
      if (pinned) btnPin.classList.add('pinned');
      else btnPin.classList.remove('pinned');
      btnPin.setAttribute('aria-pressed', String(!!pinned));
    }
    if (btnPin) {
      // 置顶按钮仅副窗口需要；主窗口去掉（见需求）。
      if (shell.windowType === 'main') {
        btnPin.style.display = 'none';
      } else {
        btnPin.onclick = function () { shell.alwaysOnTop(); };
        // 初始化图标状态 + 监听主进程同步
        if (shell.isAlwaysOnTop) {
          shell.isAlwaysOnTop().then(setPinIcon).catch(function () {});
        }
        if (shell.onAlwaysOnTop) shell.onAlwaysOnTop(setPinIcon);
      }
    }
    // 设置按钮仅主窗口需要；副窗口（sub / B 类）去掉（见需求）。
    if (shell.windowType !== 'main') {
      if (btnSettings) btnSettings.style.display = 'none';
    }
    if (btnSwap) {
      // 图标随窗口类型变化：主窗口小方块空心；副窗口（及 B 类窗口）小方块实心
      if (shell.windowType !== 'main') {
        btnSwap.innerHTML = '<svg class="tb-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h12"/><path d="M11 4l4 3-4 3"/><path d="M21 17H9"/><path d="M13 14l-4 3 4 3"/></svg>';
      }
      // 悬浮提示：主窗口 → 切换为副窗口；副窗口（及 B 类窗口）→ 切换为主窗口
      btnSwap.title = shell.windowType === 'main' ? '切换为副窗口' : '切换为主窗口';
      btnSwap.onclick = function () { shell.swapMainSub(); };
    }
    if (btnMin) btnMin.onclick = function () { shell.minimize(); };
    // 最大化按钮仅主窗口需要；副窗口不用最大化，去掉（见需求）。
    if (btnMax && shell.windowType !== 'main') btnMax.style.display = 'none';
    if (btnMax) btnMax.onclick = function () { shell.toggleMax(); };
    if (btnClose) btnClose.onclick = function () { shell.close(); };

    // 主副切换总开关（enableRoleSwap）已移除，主副切换按钮固定可用。

    // 主题变量下发：写入 :root
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
  });
})();