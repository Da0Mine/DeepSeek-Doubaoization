/* 设置面板（重构版）：左侧一级导航 + 右侧二级内容。 */
(function () {
  'use strict';
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // 字段 schema：section / items（常规已按功能细分为多个一级分类，避免冗杂）
  var SCHEMA = [
    { section: '常规 · 外观', items: [
      { key: 'theme', label: '主题', type: 'select', options: [{ label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }, { label: '跟随系统', value: 'system' }] },
      { key: 'fontSize', label: '外壳字号', type: 'number' },
      { key: 'customTitleBar', label: '自绘标题栏', type: 'checkbox' },
    ]},
    { section: '窗口与托盘', items: [
      { key: 'alwaysOnTop', label: '默认置顶', type: 'checkbox' },
      { key: 'closeToTray', label: '关闭进托盘', type: 'checkbox' },
      { key: 'trayEnabled', label: '托盘图标', type: 'checkbox' },
      { key: 'startAtLogin', label: '开机自启', type: 'checkbox' },
      { key: 'minimizeToTrayOnStart', label: '启动最小化到托盘', type: 'checkbox' },
    ]},
    { section: '对话与模型', items: [
      { key: 'deepThinkEnabled', label: '深度思考', type: 'checkbox' },
      { key: 'smartSearchEnabled', label: '智能搜索', type: 'checkbox' },
      { key: 'collapseThinking', label: '折叠思考过程', type: 'checkbox' },
      { key: 'defaultModelMode', label: '默认模型模式', type: 'select', options: [{ label: '快速模式', value: 'simple' }, { label: '专家模式', value: 'expert' }, { label: '识图模式', value: 'vision' }] },
      { key: 'autoStartVisionModel', label: '识图自动开视觉模型', type: 'checkbox' },
      { key: 'realTimeTranslateSync', label: '翻译实时同步', type: 'checkbox' },
    ]},
    { section: '交互与通知', items: [
      { key: 'notificationEnabled', label: '通知开关', type: 'checkbox' },
      { key: 'enableRoleSwap', label: '主副切换总开关', type: 'checkbox' },
    ]},
    { section: '快捷键管理', items: [
      { key: 'screenshotShortcut', label: '截图快捷键', type: 'shortcut' },
      { key: 'subWindowShortcut', label: '副窗呼出键', type: 'shortcut' },
    ]},
    { section: '截图', items: [
      { key: 'screenshotSavePath', label: '截图落盘路径', type: 'text' },
    ]},
    { section: '代理', items: [
      { key: 'proxyEnabled', label: '代理开关', type: 'checkbox' },
      { key: 'proxyUrl', label: '代理地址', type: 'text' },
    ]},
    { section: '提示词模板', items: [
      { key: 'visionPromptTemplate', label: '识图提示词', type: 'textarea' },
      { key: 'extractTextPromptTemplate', label: '提取提示词', type: 'textarea' },
      { key: 'translatePromptTemplate', label: '翻译提示词（{content}{targetLang}）', type: 'textarea' },
      { key: 'explainPromptTemplate', label: '解释提示词（{content}）', type: 'textarea' },
    ]},
    { section: '标注色板', items: [
      { key: 'annotationColors', label: '标注画笔色板', type: 'colorlist' },
    ]},
  ];

  ready(function () {
    var shell = window.shell;
    if (!shell) { console.error('[settings] window.shell 不可用'); return; }

    var sidebar = document.getElementById('sidebar');
    var panelHeader = document.getElementById('panel-header');
    var panelBody = document.getElementById('panel-body');
    var statusEl = document.getElementById('status');
    var inputs = {}; // key -> element
    var colorListEl = null;
    var activeSection = 0;
    var saveTimers = {}; // key -> setTimeout id（实时持久化的轻量 debounce）

    // 实时持久化单个配置项：debounce 200ms 后调用 shell.setConfig（主进程落盘并即时生效），
    // 不再依赖「保存」按钮。用户感知即时，且无节流卡顿。
    function applyValue(key, value) {
      if (saveTimers[key]) clearTimeout(saveTimers[key]);
      saveTimers[key] = setTimeout(function () {
        shell.setConfig(key, value).then(function () {
          statusEl.textContent = '已应用';
          setTimeout(function () { statusEl.textContent = ''; }, 1500);
        }).catch(function (e) {
          statusEl.textContent = '应用失败：' + e;
        });
      }, 200);
    }

    // 读取色板当前所有颜色（标注色板控件无独立 input，需从 DOM 收集）。
    function readColorList() {
      var arr = [];
      if (!colorListEl) return arr;
      var cols = colorListEl.querySelectorAll('input[type="color"]');
      for (var i = 0; i < cols.length; i++) arr.push(cols[i].value);
      return arr;
    }

    // 标题栏按钮
    document.getElementById('btn-min').onclick = function () { shell.minimize(); };
    document.getElementById('btn-close').onclick = function () { shell.close(); };

    // 主题变量下发
    function applyThemeVars(vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          document.documentElement.style.setProperty(k, vars[k]);
        }
      }
      var bg = vars['--ds-bg'] || '#ffffff';
      var isDark = /^#/.test(bg) ? parseInt(bg.replace('#', ''), 16) < 0x888888 : false;
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    }
    shell.onThemeVars(function (vars) { applyThemeVars(vars); });
    if (shell.requestThemeVars) {
      shell.requestThemeVars().then(function (vars) { applyThemeVars(vars); }).catch(function () {});
    }

    // 快捷键「点按录制」控件
    // onCommit：录制完成（设置新键或清除）后回调，用于实时持久化。
    function accelFromEvent(e) {
      var key = e.key;
      if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta' || key === 'AltGraph') return null;
      var parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      var k = key;
      if (k === ' ') k = 'Space';
      else if (k === 'Escape') return 'Escape';
      else if (k.length === 1) k = k.toUpperCase();
      parts.push(k);
      return parts.join('+');
    }

    function makeShortcutControl(onCommit) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shortcut-btn empty';
      var current = '';
      var recording = false;
      function setText(v) {
        current = v || '';
        if (!current) {
          btn.textContent = '点击设置快捷键';
          btn.classList.add('empty');
        } else {
          btn.textContent = current;
          btn.classList.remove('empty');
        }
      }
      function stop() {
        if (!recording) return;
        recording = false;
        btn.classList.remove('recording');
        document.removeEventListener('keydown', onKey, true);
      }
      function onKey(e) {
        if (!recording) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') { setText(''); stop(); if (onCommit) onCommit(); return; }
        var accel = accelFromEvent(e);
        if (!accel) return;
        setText(accel);
        stop();
        if (onCommit) onCommit();
      }
      btn.addEventListener('click', function () {
        if (recording) { stop(); return; }
        recording = true;
        btn.classList.add('recording');
        btn.textContent = '请按下快捷键…（Esc 清除）';
        document.addEventListener('keydown', onKey, true);
      });
      btn.addEventListener('blur', stop);
      return { btn: btn, get: function () { return current; }, setText: setText };
    }

    // 创建控件
    function createControl(item) {
      if (item.type === 'checkbox') {
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        return cb;
      } else if (item.type === 'number') {
        var num = document.createElement('input');
        num.type = 'number';
        return num;
      } else if (item.type === 'select') {
        var sel = document.createElement('select');
        (item.options || []).forEach(function (o) {
          var opt = document.createElement('option');
          if (o && typeof o === 'object') { opt.value = o.value; opt.textContent = o.label; }
          else { opt.value = o; opt.textContent = o; }
          sel.appendChild(opt);
        });
        return sel;
      } else if (item.type === 'textarea') {
        var ta = document.createElement('textarea');
        return ta;
      } else if (item.type === 'shortcut') {
        var sc = makeShortcutControl(function () { applyValue(item.key, sc.get()); });
        return sc;
      } else {
        var tx = document.createElement('input');
        tx.type = 'text';
        return tx;
      }
    }

    function buildField(item) {
      var field = document.createElement('div');
      field.className = 'field';
      var label = document.createElement('label');
      label.textContent = item.label;
      field.appendChild(label);

      if (item.type === 'colorlist') {
        colorListEl = document.createElement('div');
        colorListEl.className = 'colors';
        field.appendChild(colorListEl);
        inputs[item.key] = {
          get: function () {
            var arr = [];
            var cols = colorListEl.querySelectorAll('input[type="color"]');
            for (var i = 0; i < cols.length; i++) arr.push(cols[i].value);
            return arr;
          }
        };
      } else {
        var ctrl = createControl(item);
        if (item.type === 'shortcut') {
          field.appendChild(ctrl.btn);
          inputs[item.key] = ctrl;
          // 录制完成（设置/清除键）时由 makeShortcutControl 的 onCommit 实时持久化
        } else {
          field.appendChild(ctrl);
          inputs[item.key] = ctrl;
          // 实时生效：改动即持久化（轻量 debounce），不必再点「保存」。
          if (item.type === 'checkbox') {
            ctrl.addEventListener('change', function () { applyValue(item.key, ctrl.checked); });
          } else if (item.type === 'select') {
            ctrl.addEventListener('change', function () { applyValue(item.key, ctrl.value); });
          } else if (item.type === 'number') {
            ctrl.addEventListener('input', function () { applyValue(item.key, Number(ctrl.value)); });
            ctrl.addEventListener('change', function () { applyValue(item.key, Number(ctrl.value)); });
          } else if (item.type === 'colorlist') {
            colorListEl.addEventListener('input', function () { applyValue(item.key, readColorList()); });
            colorListEl.addEventListener('change', function () { applyValue(item.key, readColorList()); });
          } else {
            ctrl.addEventListener('input', function () { applyValue(item.key, ctrl.value); });
            ctrl.addEventListener('change', function () { applyValue(item.key, ctrl.value); });
          }
        }
      }
      return field;
    }

    function renderColors(colors) {
      if (!colorListEl) return;
      colorListEl.innerHTML = '';
      (colors || []).forEach(function (c) { addColorItem(c); });
      var add = document.createElement('button');
      add.id = 'add-color';
      add.textContent = '+ 添加';
      add.onclick = function () { addColorItem('#000000'); };
      colorListEl.appendChild(add);
    }
    function addColorItem(color) {
      var item = document.createElement('span');
      item.className = 'color-item';
      var ci = document.createElement('input');
      ci.type = 'color'; ci.value = color;
      var del = document.createElement('button');
      del.className = 'del'; del.textContent = '×'; del.title = '删除';
      del.onclick = function () { colorListEl.removeChild(item); };
      item.appendChild(ci); item.appendChild(del);
      colorListEl.insertBefore(item, document.getElementById('add-color'));
    }

    // 渲染左侧导航与右侧面板
    function renderNav() {
      sidebar.innerHTML = '';
      SCHEMA.forEach(function (sec, idx) {
        var btn = document.createElement('button');
        btn.className = 'nav-item' + (idx === activeSection ? ' active' : '');
        btn.textContent = sec.section;
        btn.onclick = function () { setSection(idx); };
        sidebar.appendChild(btn);
      });
    }

    function setSection(idx) {
      activeSection = idx;
      renderNav();
      var sec = SCHEMA[idx];
      panelHeader.textContent = sec.section;
      panelBody.innerHTML = '';
      sec.items.forEach(function (item) {
        panelBody.appendChild(buildField(item));
      });
      // 色板需要重新渲染
      if (sec.section === '标注色板') {
        shell.getConfig('annotationColors').then(function (val) { renderColors(val || []); }).catch(function () {});
      }
      // 加载当前 section 的值
      sec.items.forEach(function (item) {
        shell.getConfig(item.key).then(function (val) {
          var el = inputs[item.key];
          if (!el) return;
          if (item.type === 'checkbox') el.checked = !!val;
          else if (item.type === 'shortcut') el.setText(val == null ? '' : String(val));
          else el.value = val == null ? '' : String(val);
        }).catch(function () {});
      });
    }

    renderNav();
    setSection(0);

    // 实时生效：每个控件在 change/input 时经 applyValue 直接持久化并热更新，
    // 不再需要「保存」按钮（问题 E 修复）。
    // 重置默认
    document.getElementById('btn-reset').onclick = function () {
      shell.resetConfig().then(function () {
        setSection(activeSection);
        statusEl.textContent = '已重置为默认';
        setTimeout(function () { statusEl.textContent = ''; }, 2000);
      }).catch(function () {});
    };
  });
})();
