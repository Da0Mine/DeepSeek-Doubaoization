/* 截图遮罩交互（原生 JS）：状态机 + 截图冻结停留 + 标注画布 + 动作条。 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shell = window.shell;
    if (!shell) {
      console.error('[overlay] window.shell 不可用');
      return;
    }

    // ---- 状态机 ----
    var state = 'selecting'; // idle -> selecting -> selected -> annotating -> actionChosen
    var rect = null; // {x,y,width,height} 屏幕坐标(CSS)
    var annotations = []; // Annotation[]
    var currentColor = '#ff3b30';
    var currentTool = 'move'; // 默认「移动」模式：点选区内拖动 = 移动选区；点画笔/矩形/椭圆才进入绘图
    var baseDataUrl = null;
    var baseNaturalW = 0;
    var baseNaturalH = 0;

    var isSelecting = false;
    var selStartX = 0, selStartY = 0;
    // 点击 vs 拖拽区分：记录按下位置与「按下时吸附的窗口」，移动超过阈值才视为拖拽框选，
    // 原地松开则按吸附窗口点击框选（修复：悬浮吸附时 mousedown 立即框选，导致无法长按拖拽）。
    var pressX = 0, pressY = 0, pressSnap = null, dragging = false;
    var DRAG_THRESHOLD = 4;

    var isDrawing = false;
    var drawStart = null; // {x,y} 相对选区
    var currentStroke = null; // 进行中的形状/笔画

    // 框调整（移动 / 缩放）状态
    var isAdjusting = false;
    var adjustMode = null; // 'move' | 'resize'
    var adjustDir = null; // resize 方向：n/s/e/w/ne/...
    var adjustStart = null; // {x, y, rect} 拖动起点

    var sel = document.getElementById('selection');
    var hint = document.getElementById('hint');
    var toolbar = document.getElementById('toolbar');
    var actionbar = document.getElementById('actionbar');
    var frozen = document.getElementById('frozen');
    var anno = document.getElementById('anno');
    var ctx = anno.getContext('2d');
    var palette = document.getElementById('palette');
    var snap = document.getElementById('snap');

    // ---- 窗口吸附：主进程下发的窗口边界（overlay 局部坐标，Z 序从顶到底）+ 当前鼠标命中的窗口 ----
    var snapRects = [];
    var snapActive = null;

    // ---- 色板（取自 config.annotationColors，失败回退默认） ----
    // 默认隐藏：仅当选中画笔/矩形/椭圆时才出现，避免工具栏杂乱。
    var defaultColors = ['#ff3b30', '#34c759', '#007aff', '#ffcc00', '#ffffff'];
    function buildPalette(colors) {
      palette.innerHTML = '';
      (colors && colors.length ? colors : defaultColors).forEach(function (c, i) {
        var s = document.createElement('span');
        s.className = 'swatch' + (i === 0 ? ' active' : '');
        s.style.background = c;
        s.dataset.color = c;
        s.onclick = function () { shell.overlaySetColor(c); };
        palette.appendChild(s);
      });
      currentColor = (colors && colors[0]) || defaultColors[0];
      // 仅当当前工具需要选色（画笔/矩形/椭圆）才显示；默认 move 模式保持隐藏
      palette.classList.toggle('hidden', !isDrawingTool(currentTool));
    }
    function isDrawingTool(t) {
      return t === 'pen' || t === 'rect' || t === 'ellipse';
    }
    function updatePaletteVisibility() {
      palette.classList.toggle('hidden', !isDrawingTool(currentTool));
    }
    try {
      shell.getConfig('annotationColors').then(buildPalette).catch(function () { buildPalette(null); });
    } catch (e) { buildPalette(null); }

    // ---- 工具栏按钮 -> 经 shell 转发到主进程再回送（保持 IPC 对称） ----
    var toolBtns = document.querySelectorAll('.tool-btn[data-tool]');
    for (var i = 0; i < toolBtns.length; i++) {
      toolBtns[i].onclick = function () { shell.overlaySetTool(this.dataset.tool); };
    }
    document.getElementById('btn-undo').onclick = function () { shell.overlayUndo(); };
    document.getElementById('btn-clear').onclick = function () { shell.overlayClear(); };
    document.getElementById('btn-cancel').onclick = function () { shell.close(); };

    // 右键 = 取消（截图遮罩层整体）
    window.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      shell.close();
    });

    // ---- 动作条 ----
    var actBtns = document.querySelectorAll('.act-btn[data-action]');
    for (var j = 0; j < actBtns.length; j++) {
      actBtns[j].onclick = function () {
        var action = this.dataset.action;
        if (action === 'cancel') { shell.close(); return; }
        state = 'actionChosen';
        shell.screenshotAction(action, rect, annotations);
      };
    }

    // 截图提问模式：仅保留「发送到当前对话」按钮，隐藏其他动作按钮
    if (shell.screenshotMode === 'question') {
      for (var k = 0; k < actBtns.length; k++) {
        var a = actBtns[k].dataset.action;
        if (a !== 'sendCurrent') {
          actBtns[k].style.display = 'none';
        }
      }
      // 隐藏分割线
      var dividers = document.querySelectorAll('.act-divider');
      for (var d = 0; d < dividers.length; d++) {
        dividers[d].style.display = 'none';
      }
      // 隐藏工具栏（标注工具在截图提问模式下不需要）
      toolbar.classList.add('hidden');
    }

    // ---- 框调整：缩放手柄（8 个）+ 移动边带（4 条）----
    var handles = document.querySelectorAll('#selection .sel-handle');
    for (var h = 0; h < handles.length; h++) {
      handles[h].addEventListener('mousedown', function (e) {
        e.stopPropagation(); // 不冒泡到 window，避免触发新选区/标注
        startAdjust('resize', this.dataset.dir, e);
      });
    }
    var strips = document.querySelectorAll('#selection .sel-strip');
    for (var sp = 0; sp < strips.length; sp++) {
      strips[sp].addEventListener('mousedown', function (e) {
        e.stopPropagation();
        startAdjust('move', this.dataset.dir, e);
      });
    }

    function startAdjust(mode, dir, e) {
      isAdjusting = true;
      adjustMode = mode;
      adjustDir = dir;
      adjustStart = {
        x: e.clientX,
        y: e.clientY,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }

    // ---- 窗口吸附 ----
    // 命中规则：选「链序最顶层（z 最小）且包含鼠标点」的窗口——即鼠标能实际接触到的窗口。
    // 若鼠标点上方有别的窗口（z 更小）挡住，则该窗口不可选（全屏窗口不再误选背后的窗口）。
    // 枚举已在主进程跳过 owned/工具/壳窗口，GetTopWindow 链序即真实可见 Z 序。
    // 兜底：z 数据缺失（旧枚举/异常）时回退「面积最小」。
    function findSnapAt(cx, cy) {
      var hits = [];
      for (var i = 0; i < snapRects.length; i++) {
        var r = snapRects[i];
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
    function updateSnapAt(cx, cy) {
      var s = findSnapAt(cx, cy);
      if (s === snapActive) return;
      snapActive = s;
      if (s) {
        snap.style.display = 'block';
        snap.style.left = s.x + 'px';
        snap.style.top = s.y + 'px';
        snap.style.width = s.width + 'px';
        snap.style.height = s.height + 'px';
      } else {
        snap.style.display = 'none';
      }
    }
    function hideSnap() {
      snapActive = null;
      snap.style.display = 'none';
    }

    // ---- 主进程 -> 渲染 订阅 ----
    // 全屏截图背景图：铺在 #bg 上，替代透明看穿桌面，修复全屏应用黑屏。
    // 背景在 showOverlay 后下发，此时监听已注册；为保险，若 #bg 暂未就绪也先保存。
    shell.onOverlayBackgroundImage(function (dataUrl) {
      var bg = document.getElementById('bg');
      if (bg) bg.src = dataUrl;
    });

    // 窗口吸附边界列表（异步枚举，可能稍晚到达）
    shell.onOverlayWindows(function (list) {
      snapRects = list || [];
    });

    shell.onOverlayImage(function (dataUrl) {
      baseDataUrl = dataUrl;
      frozen.onload = function () {
        baseNaturalW = frozen.naturalWidth;
        baseNaturalH = frozen.naturalHeight;
        positionLayers();
        state = 'annotating';
      };
      frozen.src = dataUrl;
    });

    shell.onSetColor(function (color) {
      currentColor = color;
      markActiveSwatch(color);
    });
    shell.onSetTool(function (tool) {
      currentTool = tool;
      var btns = document.querySelectorAll('.tool-btn[data-tool]');
      for (var k = 0; k < btns.length; k++) {
        btns[k].classList.toggle('active', btns[k].dataset.tool === tool);
      }
      // 联动：颜色选择器只在画笔/矩形/椭圆模式下出现，避免 move 模式下空占地
      updatePaletteVisibility();
    });
    shell.onUndo(function () { annotations.pop(); redraw(); });
    shell.onClear(function () { annotations = []; redraw(); });

    // 主进程请求合成标注（OVERLAY_COMPOSE）：把 base+annotations 合成 PNG 回传
    shell.onCompose(function (anns) {
      return compose(anns || annotations);
    });

    function markActiveSwatch(color) {
      var sw = palette.querySelectorAll('.swatch');
      for (var k = 0; k < sw.length; k++) {
        sw[k].classList.toggle('active', sw[k].dataset.color === color);
      }
    }

    // 暗化蒙版：null=全屏暗化（初始选择态）；rect=聚光挖洞（选区态，内部透出 #bg 亮图）。
    // 关键修复（截图拖动 bug）：选区框移动时，仅「蒙版挖洞 + 蓝色边框 + 标注层」跟随 rect，
    // 底层 #bg 全屏亮图固定不动，因此拖动表现为「框在动、内容不动」，符合预期。
    function applyShade(r) {
      var shade = document.getElementById('shade');
      if (!shade) return;
      if (!r) {
        shade.style.left = '0px';
        shade.style.top = '0px';
        shade.style.width = '100vw';
        shade.style.height = '100vh';
        shade.style.boxShadow = 'none';
        shade.style.display = 'block';
        return;
      }
      shade.style.left = r.x + 'px';
      shade.style.top = r.y + 'px';
      shade.style.width = r.width + 'px';
      shade.style.height = r.height + 'px';
      shade.style.boxShadow = '0 0 0 100vmax rgba(0, 0, 0, 0.35)';
      shade.style.display = 'block';
    }

    function positionLayers() {
      if (!rect) return;
      // 可交互框本体跟随 rect
      sel.style.left = rect.x + 'px';
      sel.style.top = rect.y + 'px';
      sel.style.width = rect.width + 'px';
      sel.style.height = rect.height + 'px';

      // 冻结裁剪图不再随框移动：预览阶段隐藏之，改由固定全屏 #bg 透出洞口显示真实内容。
      // #frozen 仍保留 src，供最终合成 compose() 使用（标注导出走主进程精确裁剪）。
      frozen.style.display = 'none';

      anno.style.left = rect.x + 'px';
      anno.style.top = rect.y + 'px';
      anno.style.width = rect.width + 'px';
      anno.style.height = rect.height + 'px';
      anno.width = rect.width;
      anno.height = rect.height;
      anno.style.display = 'block';
      applyShade(rect);
      layoutChrome();
      redraw();
    }

    // 工具栏贴在框「上方」、动作条贴在框「下方」，居中对齐并随框移动/缩放实时跟随。
    // 两侧均显式设置 left 并把 right 清为 auto，避免 CSS 中 left/right:auto 退化到贴左边缘
    // （表现为「左边边栏被异常展开拉长」）。位置完全由 rect 计算，rect 为空则不动。
    function positionToolbar() {
      if (!rect) return;
      var tbH = toolbar.offsetHeight || 40;
      var cx = rect.x + rect.width / 2;
      // 水平夹紧到视口内，避免工具栏越界（body overflow:hidden 已兜底，此处仅为观感）
      var left = Math.max(8, Math.min(cx, window.innerWidth - 8));
      toolbar.style.right = 'auto';
      toolbar.style.left = left + 'px';
      toolbar.style.transform = 'translateX(-50%)';
      toolbar.style.bottom = 'auto';
      toolbar.style.top = Math.max(4, rect.y - tbH - 8) + 'px';
    }

    function positionActionbar() {
      if (!rect) return;
      var abH = actionbar.offsetHeight || 44;
      var cx = rect.x + rect.width / 2;
      var left = Math.max(8, Math.min(cx, window.innerWidth - 8));
      actionbar.style.right = 'auto';
      actionbar.style.left = left + 'px';
      actionbar.style.transform = 'translateX(-50%)';
      actionbar.style.top = Math.min(window.innerHeight - 4 - abH, rect.y + rect.height + 8) + 'px';
    }

    function layoutChrome() {
      positionToolbar();
      positionActionbar();
    }

    // ---- 选择 / 标注 鼠标逻辑 ----
    window.addEventListener('mousedown', function (e) {
      // 右键不触发选择/标注，交给 contextmenu 取消；工具栏 / 动作条上的点击交给各自按钮
      if (e.button !== 0) { e.preventDefault(); return; }
      if (e.target && (toolbar.contains(e.target) || actionbar.contains(e.target))) return;
      // 阻止拖拽时产生原生文本 / 图像选择（表现为「整屏变蓝、像文本框被勾选」）
      e.preventDefault();

      var insideRegion =
        rect &&
        e.clientX >= rect.x && e.clientX <= rect.x + rect.width &&
        e.clientY >= rect.y && e.clientY <= rect.y + rect.height;

      if (state === 'selecting') {
        // 按下时记录吸附目标与位置，不立即框选：移动超阈值 = 拖拽框选；原地松开 = 点击吸附窗口框选
        pressX = e.clientX;
        pressY = e.clientY;
        pressSnap = snapActive;
        dragging = false;
        // 仅首次框选阶段可拉新框；选区一旦完成，点击选区外不再唤起新一轮截图
        startNewSelection();
        isSelecting = true;
        selStartX = pressX;
        selStartY = pressY;
        sel.style.display = 'block';
        updateSelection(pressX, pressY);
      } else if (rect && insideRegion) {
        if (currentTool === 'move') {
          // 默认移动模式：拖拽选区内任意位置 = 移动整个选区
          startAdjust('move', null, e);
        } else {
          // 在选区内开始标注（画笔/矩形/椭圆）
          isDrawing = true;
          drawStart = { x: e.clientX - rect.x, y: e.clientY - rect.y };
          if (currentTool === 'pen') {
            currentStroke = { tool: 'pen', color: currentColor, points: [drawStart] };
          } else {
            currentStroke = { tool: currentTool, color: currentColor, x: drawStart.x, y: drawStart.y, width: 0, height: 0 };
          }
        }
      }
      // 其余情况（选区已存在，点击选区外）：不做任何事，不重新唤起截图
    });

    window.addEventListener('mousemove', function (e) {
      if (isAdjusting) {
        var dx = e.clientX - adjustStart.x;
        var dy = e.clientY - adjustStart.y;
        var nr = adjustMode === 'move'
          ? { x: adjustStart.rect.x + dx, y: adjustStart.rect.y + dy, width: adjustStart.rect.width, height: adjustStart.rect.height }
          : computeResizedRect(adjustDir, dx, dy, adjustStart.rect);
        rect = clampRect(nr);
        positionLayers(); // 实时跟随：边框 + 冻结图 + 标注 + 工具栏/动作条
        redraw();
        return;
      }
      if (isSelecting) {
        // 移动超过阈值才进入拖拽框选（区分「点击吸附窗口」与「长按拖拽」）
        if (!dragging && (Math.abs(e.clientX - pressX) > DRAG_THRESHOLD || Math.abs(e.clientY - pressY) > DRAG_THRESHOLD)) {
          dragging = true;
        }
        if (dragging) updateSelection(e.clientX, e.clientY);
      } else if (isDrawing && rect) {
        var rx = e.clientX - rect.x;
        var ry = e.clientY - rect.y;
        if (currentTool === 'pen' && currentStroke) {
          currentStroke.points.push({ x: rx, y: ry });
        } else if (currentStroke) {
          currentStroke.x = Math.min(drawStart.x, rx);
          currentStroke.y = Math.min(drawStart.y, ry);
          currentStroke.width = Math.abs(rx - drawStart.x);
          currentStroke.height = Math.abs(ry - drawStart.y);
        }
        redraw();
      } else if (state === 'selecting') {
        // 选择态且未拖拽：实时悬浮吸附窗口
        updateSnapAt(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', function (e) {
      if (isAdjusting) {
        isAdjusting = false;
        adjustMode = null;
        adjustDir = null;
        adjustStart = null;
        // 松手后用新 rect 触发主进程重新裁剪，回传像素准确的冻结图
        shell.overlaySelect(rect);
        return;
      }
      if (isSelecting) {
        isSelecting = false;
        if (dragging) {
          // 拖拽框选完成
          dragging = false;
          finishSelection();
        } else if (pressSnap) {
          // 原地点击：按吸附的窗口边界完成框选
          rect = { x: pressSnap.x, y: pressSnap.y, width: pressSnap.width, height: pressSnap.height };
          hideSnap();
          finishBySnap();
        } else {
          // 无吸附目标且未拖拽：取消本次按下，保持选择态
          sel.style.display = 'none';
          applyShade(null);
        }
      } else if (isDrawing) {
        isDrawing = false;
        if (currentStroke && isValidStroke(currentStroke)) {
          annotations.push(currentStroke);
        }
        currentStroke = null;
        redraw();
      }
    });

    function startNewSelection() {
      rect = null;
      annotations = [];
      baseDataUrl = null;
      frozen.style.display = 'none';
      anno.style.display = 'none';
      toolbar.classList.add('hidden');
      actionbar.classList.add('hidden');
      hint.classList.remove('hidden');
      hint.textContent = '移动鼠标可吸附窗口，点击直接框选；或拖拽手动选择';
      hideSnap();
      applyShade(null); // 回到全屏暗化初始态
      state = 'selecting';
    }

    function updateSelection(cx, cy) {
      var x = Math.min(selStartX, cx);
      var y = Math.min(selStartY, cy);
      var w = Math.abs(cx - selStartX);
      var h = Math.abs(cy - selStartY);
      sel.style.left = x + 'px';
      sel.style.top = y + 'px';
      sel.style.width = w + 'px';
      sel.style.height = h + 'px';
      // 初次拖选实时挖洞：框内立即透出 #bg 亮图（避免拖拽过程中框内仍为暗化）
      applyShade({ x: x, y: y, width: w, height: h });
    }

    function finishSelection() {
      var x = parseInt(sel.style.left, 10) || 0;
      var y = parseInt(sel.style.top, 10) || 0;
      var w = parseInt(sel.style.width, 10) || 0;
      var h = parseInt(sel.style.height, 10) || 0;
      if (w < 5 || h < 5) {
        sel.style.display = 'none';
        return;
      }
      rect = { x: x, y: y, width: w, height: h };
      commitSelection();
    }

    /** 吸附窗口点击完成框选：rect 已按窗口边界设置，直接进入标注态。 */
    function finishBySnap() {
      commitSelection();
    }

    /** 选区完成后的公共收尾：显示选区框/工具栏/动作条，定位并请求主进程裁剪。 */
    function commitSelection() {
      sel.classList.remove('hidden');
      sel.classList.add('interactive');
      sel.style.display = 'block';
      state = 'selected';
      hint.classList.add('hidden');
      toolbar.classList.remove('hidden');
      actionbar.classList.remove('hidden');
      // 先按 rect 立即定位工具栏/动作条（显式设置 left），杜绝它们贴左边缘的退化观感；
      // 再定位框 / 冻结图 / 标注并请求主进程按 scaleFactor 裁剪选区回传冻结图。
      layoutChrome();
      positionLayers();
      shell.overlaySelect(rect);
    }

    function isValidStroke(s) {
      if (s.tool === 'pen') return s.points && s.points.length >= 2;
      return s.width > 2 && s.height > 2;
    }

    // 按方向计算缩放后的矩形（dir 含 n/s/e/w 组合）
    function computeResizedRect(dir, dx, dy, start) {
      var x = start.x, y = start.y, width = start.width, height = start.height;
      if (dir.indexOf('e') >= 0) width = start.width + dx;
      if (dir.indexOf('w') >= 0) { x = start.x + dx; width = start.width - dx; }
      if (dir.indexOf('s') >= 0) height = start.height + dy;
      if (dir.indexOf('n') >= 0) { y = start.y + dy; height = start.height - dy; }
      var MIN = 10;
      if (width < MIN) { if (dir.indexOf('w') >= 0) x = start.x + start.width - MIN; width = MIN; }
      if (height < MIN) { if (dir.indexOf('n') >= 0) y = start.y + start.height - MIN; height = MIN; }
      return { x: x, y: y, width: width, height: height };
    }

    // 夹紧到屏幕可视范围，避免移出导致重裁异常
    function clampRect(r) {
      var W = window.innerWidth, H = window.innerHeight;
      var width = Math.max(10, Math.min(r.width, W));
      var height = Math.max(10, Math.min(r.height, H));
      var x = Math.max(0, Math.min(r.x, W - width));
      var y = Math.max(0, Math.min(r.y, H - height));
      return { x: x, y: y, width: width, height: height };
    }

    // ---- 标注重绘（CSS 像素预览） ----
    function redraw() {
      if (!rect) return;
      ctx.clearRect(0, 0, anno.width, anno.height);
      var all = annotations.slice();
      if (currentStroke) all.push(currentStroke);
      for (var i = 0; i < all.length; i++) drawAnnotation(all[i], 1);
    }

    function drawAnnotation(a, scale) {
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 2 * scale;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (a.tool === 'pen' && a.points) {
        ctx.beginPath();
        for (var i = 0; i < a.points.length; i++) {
          var p = a.points[i];
          if (i === 0) ctx.moveTo(p.x * scale, p.y * scale);
          else ctx.lineTo(p.x * scale, p.y * scale);
        }
        ctx.stroke();
      } else if (a.tool === 'rect') {
        ctx.strokeRect(a.x * scale, a.y * scale, a.width * scale, a.height * scale);
      } else if (a.tool === 'ellipse') {
        var cx = a.x * scale + (a.width * scale) / 2;
        var cy = a.y * scale + (a.height * scale) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, (a.width * scale) / 2, (a.height * scale) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ---- 合成：底图 + 标注 -> PNG dataURL（设备分辨率） ----
    function compose(anns) {
      if (!baseDataUrl) return '';
      var natW = baseNaturalW || (rect ? rect.width : 1);
      var natH = baseNaturalH || (rect ? rect.height : 1);
      var canvas = document.createElement('canvas');
      canvas.width = natW;
      canvas.height = natH;
      var c = canvas.getContext('2d');
      var img = new Image();
      img.src = baseDataUrl;
      // 同步绘制（onload 可能异步，但 frozen 已加载过，这里直接 drawImage 元素）
      try { c.drawImage(frozen, 0, 0, natW, natH); } catch (e) { /* ignore */ }
      var s = natW / (rect ? rect.width : natW);
      for (var i = 0; i < anns.length; i++) drawAnnotationOn(c, anns[i], s);
      return canvas.toDataURL('image/png');
    }

    function drawAnnotationOn(c, a, scale) {
      c.strokeStyle = a.color;
      c.lineWidth = 2 * scale;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      if (a.tool === 'pen' && a.points) {
        c.beginPath();
        for (var i = 0; i < a.points.length; i++) {
          var p = a.points[i];
          if (i === 0) c.moveTo(p.x * scale, p.y * scale);
          else c.lineTo(p.x * scale, p.y * scale);
        }
        c.stroke();
      } else if (a.tool === 'rect') {
        c.strokeRect(a.x * scale, a.y * scale, a.width * scale, a.height * scale);
      } else if (a.tool === 'ellipse') {
        var cx = a.x * scale + (a.width * scale) / 2;
        var cy = a.y * scale + (a.height * scale) / 2;
        c.beginPath();
        c.ellipse(cx, cy, (a.width * scale) / 2, (a.height * scale) / 2, 0, 0, Math.PI * 2);
        c.stroke();
      }
    }

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') shell.close();
    });

    // 所有监听器已注册完毕，通知主进程渲染就绪，主进程据此下发全屏截图背景图。
    // 必须在 onOverlayBackgroundImage 注册之后发送，否则 webContents.send 早于监听会被丢弃（黑屏竞态）。
    shell.overlayReady();
  });
})();
