/* 使用说明引导逻辑：接收主进程下发的步骤数据，GSAP 时间线切换遮罩/高亮框/说明卡片，
 * 并为「划词」「副窗口呼出」步骤播放模拟演示动画。
 * 点击穿透：整个引导窗口由主进程 setIgnoreMouseEvents 控制；
 * 本页监听 mousemove（forward 转发）判断鼠标是否位于说明卡片内，
 * 动态通知主进程切换交互状态，保证「结束 / 上一步 / 下一步」可点击，其余区域可正常操作主界面。
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
      console.error('[onboarding] window.shell 不可用');
      return;
    }
    var gsap = window.gsap;
    if (!gsap) {
      console.error('[onboarding] GSAP 未加载');
    }

    var card = document.getElementById('ob-card');
    var highlight = document.getElementById('ob-highlight');
    var mask = document.getElementById('ob-mask');
    var stepEl = document.getElementById('ob-step');
    var progressFill = document.getElementById('ob-progress-fill');
    var titleEl = document.getElementById('ob-title');
    var bodyEl = document.getElementById('ob-body');
    var prevBtn = document.getElementById('ob-prev');
    var nextBtn = document.getElementById('ob-next');
    var endBtn = document.getElementById('ob-end');

    // 当前说明卡片的矩形（屏幕坐标），用于鼠标穿透判断；判定区域外扩 HIT_PAD，
    // 鼠标接近卡片时提前切换交互，避免点击按钮瞬间穿透到主界面（需点两次才生效）。
    var cardRect = { x: 0, y: 0, w: 0, h: 0 };
    var HIT_PAD = 24;
    var interactive = false;
    var currentLast = false;
    var isDark = false;

    // ---- 主题适配（深色模式） ----
    function applyThemeVars(vars) {
      if (!vars) return;
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          document.documentElement.style.setProperty(k, vars[k]);
        }
      }
      var bg = vars['--ds-bg'] || '';
      if (/^#/.test(bg)) {
        isDark = parseInt(bg.replace('#', ''), 16) < 0x888888;
      }
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }
    shell.onThemeVars(function (vars) { applyThemeVars(vars); });
    if (shell.requestThemeVars) {
      shell.requestThemeVars().then(applyThemeVars).catch(function () {});
    }

    // ---- 控制按钮 ----
    endBtn.addEventListener('click', function () { shell.send('onboarding:close'); });
    prevBtn.addEventListener('click', function () { shell.send('onboarding:step', { dir: -1 }); });
    // 最后一步的「完成」= 结束引导；其余为「下一步」
    nextBtn.addEventListener('click', function () {
      if (currentLast) shell.send('onboarding:close');
      else shell.send('onboarding:step', { dir: 1 });
    });

    // ---- 点击穿透：鼠标位于卡片（外扩 HIT_PAD）内才允许交互 ----
    document.addEventListener('mousemove', function (e) {
      var inCard =
        e.clientX >= cardRect.x - HIT_PAD && e.clientX <= cardRect.x + cardRect.w + HIT_PAD &&
        e.clientY >= cardRect.y - HIT_PAD && e.clientY <= cardRect.y + cardRect.h + HIT_PAD;
      if (inCard !== interactive) {
        interactive = inCard;
        shell.setOnboardingInteractive(inCard);
      }
    });

    // ---- 遮罩显隐：高亮框出现时（其超大 box-shadow 负责框外压暗）淡出整屏遮罩，实现「挖洞聚焦」 ----
    function setMaskVisible(show) {
      var target = show ? 1 : 0;
      if (gsap) {
        gsap.to(mask, { opacity: target, duration: 0.2, ease: 'power1.out', overwrite: 'auto' });
      } else {
        mask.style.opacity = target;
      }
    }

    // ---- 卡片定位：cardPos='left' 固定屏幕左侧（避开演示区/底部菜单）；
    // 否则优先放在高亮区域下方，放不下则放上方；无高亮时偏左下方 ----
    function positionCard(rect, cardPos) {
      var w = card.offsetWidth || 400;
      var h = card.offsetHeight || 240;
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      var x, y;
      if (cardPos === 'left') {
        // 与聚焦框同一高度、位于其左侧（放不下则放右侧）
        if (rect && rect.width > 0) {
          x = rect.x - w - 18;
          if (x < 14) x = rect.x + rect.width + 18;
          y = rect.y + rect.height / 2 - h / 2;
          y = Math.max(14, Math.min(y, vh - h - 14));
        } else {
          x = 14;
          y = Math.max(14, Math.round(vh * 0.5) - Math.round(h / 2));
        }
      } else if (rect && rect.width > 0) {
        var belowY = rect.y + rect.height + 18;
        var aboveY = rect.y - h - 18;
        if (belowY + h <= vh - 14) y = belowY;
        else if (aboveY >= 14) y = aboveY;
        else y = Math.max(14, vh - h - 14);
        var cx = rect.x + rect.width / 2;
        x = Math.max(14, Math.min(cx - w / 2, vw - w - 14));
      } else {
        // 无高亮：卡片偏左下方，避免遮挡屏幕中央/右侧的演示动画
        x = Math.max(14, Math.round(vw * 0.16));
        y = Math.round(vh * 0.7) - Math.round(h / 2);
      }
      card.style.left = x + 'px';
      card.style.top = y + 'px';
      cardRect = { x: x, y: y, w: w, h: h };
    }

    // ---- 演示定位：紧贴说明卡片（划词演示在卡片正上方居中，副窗口演示在卡片右侧垂直居中） ----
    function placeDemo(p, cardRect) {
      var sel = document.getElementById('ob-demo-selection');
      var sub = document.getElementById('ob-demo-sub');
      if (p.demo === 'textSelection' && sel) {
        // 水平对齐卡片中心、垂直紧贴卡片顶部（仅留 8px 呼吸间距），彻底解决「隔得太远」
        var selH = sel.offsetHeight || 150;
        var selW = sel.offsetWidth || 300;
        var top = Math.max(10, cardRect.y - selH - 8);
        var left = cardRect.x + cardRect.w / 2 - selW / 2;
        left = Math.max(10, Math.min(left, window.innerWidth - selW - 10));
        sel.style.left = left + 'px';
        sel.style.right = 'auto';
        sel.style.transform = 'none';
        sel.style.top = top + 'px';
      } else if (p.demo === 'subWindow' && sub) {
        var subW = sub.offsetWidth || 208;
        var subH = sub.offsetHeight || 300;
        var left = cardRect.x + cardRect.w + 26;
        if (left + subW > window.innerWidth - 14) {
          left = Math.max(14, cardRect.x - subW - 26);
        }
        sub.style.left = left + 'px';
        sub.style.right = 'auto';
        sub.style.top = Math.max(10, cardRect.y + cardRect.h / 2 - subH / 2) + 'px';
      }
    }

    // ---- 演示动画：划词（选中文字 + 弹出划词工具栏） ----
    function playSelectionDemo(el) {
      if (!el) return;
      el.style.display = 'block';
      var toolbar = document.getElementById('ob-demo-toolbar');
      var mark = document.getElementById('ob-demo-mark');
      var markColor = isDark ? 'rgba(64,132,255,0.45)' : 'rgba(51,112,255,0.35)';
      // 清理上次未完成的子元素动画，避免与新时间线竞争
      gsap.killTweensOf([el, toolbar, mark]);
      gsap.set(toolbar, { display: 'flex', autoAlpha: 0, y: -14 });
      gsap.set(mark, { backgroundColor: 'rgba(51,112,255,0)' });
      gsap.timeline()
        .fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.28, ease: 'power2.out' })
        .to(mark, { backgroundColor: markColor, duration: 0.35, ease: 'power2.out' }, '+=0.4')
        .to(toolbar, { autoAlpha: 1, y: 0, duration: 0.32, ease: 'back.out(1.7)' }, '-=0.15');
    }

    // ---- 演示动画：副窗口呼出（模拟副窗口从右侧滑入，聚焦框框住演示窗口） ----
    function playSubWindowDemo(el) {
      if (!el) return;
      el.style.display = 'block';
      gsap.set(el, { autoAlpha: 0, x: 110 });
      gsap.to(el, {
        autoAlpha: 1,
        x: 0,
        duration: 0.55,
        ease: 'back.out(1.3)',
        onComplete: function () {
          // 滑入完成后，聚焦框框住演示的副窗口
          var b = el.getBoundingClientRect();
          gsap.set(highlight, {
            display: 'block',
            left: b.left - 6,
            top: b.top - 6,
            width: b.width + 12,
            height: b.height + 12,
          });
          gsap.fromTo(highlight, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' });
          // 聚焦框出现后淡出整屏遮罩，由高亮框的暗色光环接管「挖洞聚焦」
          setMaskVisible(false);
        },
      });
    }

    // ---- 步骤演示控制 ----
    // 返回 true 表示演示自己接管了高亮框（render 不再处理 rect）
    function showDemo(demo) {
      var sel = document.getElementById('ob-demo-selection');
      var sub = document.getElementById('ob-demo-sub');
      if (sel) {
        gsap.killTweensOf(sel);
        sel.style.display = 'none';
      }
      if (sub) {
        gsap.killTweensOf(sub);
        sub.style.display = 'none';
      }
      if (demo === 'textSelection') {
        playSelectionDemo(sel);
        return false;
      }
      if (demo === 'subWindow') {
        playSubWindowDemo(sub);
        return true;
      }
      return false;
    }

    // ---- 渲染一步（GSAP 时间线，避免多次布局抖动） ----
    function render(p) {
      if (!p) return;
      currentLast = !!p.isLast;

      if (gsap) {
        // 清理上一次切换仍在播放的动画（高亮移动 / 卡片淡入 / 演示动画未结束时切步会竞争冲突）
        // 注意：mask 不参与 kill —— 否则会中断页面加载时的遮罩入场动画（fromTo opacity 0→1），
        // 导致遮罩卡在低透明度、看起来像「没有深色半透明背景」。
        var demoSel = document.getElementById('ob-demo-selection');
        var demoSub = document.getElementById('ob-demo-sub');
        gsap.killTweensOf([card, highlight, demoSel, demoSub]);
        gsap.set(card, { y: 0 });
        gsap.set(highlight, { scale: 1 });

        var tl = gsap.timeline();
        // 旧内容淡出
        tl.to(card, { autoAlpha: 0, y: -10, duration: 0.1, ease: 'power1.in' }, 0);
        tl.to(highlight, { autoAlpha: 0, duration: 0.08 }, 0);
        // 更新内容、定位、演示动画、高亮框
        tl.add(function () {
          titleEl.textContent = p.title || '';
          bodyEl.textContent = p.body || '';
          prevBtn.style.display = p.showPrev ? '' : 'none';
          nextBtn.textContent = p.isLast ? '完成' : '下一步';
          stepEl.textContent = '第 ' + (p.index + 1) + ' / ' + p.total + ' 步';
          progressFill.style.width = ((p.index + 1) / p.total) * 100 + '%';

          positionCard(p.rect, p.cardPos);
          placeDemo(p, cardRect);
          var handled = showDemo(p.demo);

          if (!handled) {
            if (p.rect && p.rect.width > 0) {
              // 有 fromRect 时：先显示在起点，再平滑移动到目标（共享屏幕：加号 → 菜单项）
              var start = p.fromRect && p.fromRect.width > 0 ? p.fromRect : p.rect;
              gsap.set(highlight, {
                display: 'block',
                left: start.x,
                top: start.y,
                width: start.width,
                height: start.height,
              });
              gsap.fromTo(highlight, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.15, ease: 'power2.out' });
              if (
                p.fromRect &&
                (p.fromRect.x !== p.rect.x ||
                  p.fromRect.y !== p.rect.y ||
                  p.fromRect.width !== p.rect.width ||
                  p.fromRect.height !== p.rect.height)
              ) {
                gsap.to(highlight, {
                  left: p.rect.x,
                  top: p.rect.y,
                  width: p.rect.width,
                  height: p.rect.height,
                  duration: 0.45,
                  ease: 'power2.inOut',
                  delay: 0.35,
                });
              }
            } else {
              gsap.set(highlight, { display: 'none' });
            }
          }
          // 挖洞聚焦：有高亮框时淡出整屏遮罩，由高亮框的暗色光环接管框外压暗；
          // 副窗口演示步骤的聚焦框由 showDemo 的 onComplete 接管，这里保持遮罩可见。
          var hlVisible = !handled && p.rect && p.rect.width > 0;
          setMaskVisible(!hlVisible);
        });
        // 卡片淡入
        tl.to(card, { autoAlpha: 1, y: 0, duration: 0.24, ease: 'power2.out' });
      } else {
        // 无 GSAP 回退
        titleEl.textContent = p.title || '';
        bodyEl.textContent = p.body || '';
        prevBtn.style.display = p.showPrev ? '' : 'none';
        nextBtn.textContent = p.isLast ? '完成' : '下一步';
        stepEl.textContent = '第 ' + (p.index + 1) + ' / ' + p.total + ' 步';
        progressFill.style.width = ((p.index + 1) / p.total) * 100 + '%';
        positionCard(p.rect, p.cardPos);
        placeDemo(p, cardRect);
        var handled = showDemo(p.demo);
        if (!handled && p.rect && p.rect.width > 0) {
          gsap.set(highlight, {
            display: 'block',
            left: p.rect.x,
            top: p.rect.y,
            width: p.rect.width,
            height: p.rect.height,
          });
          highlight.style.opacity = '1';
          highlight.style.visibility = 'visible';
        } else if (!handled) {
          highlight.style.display = 'none';
        }
        mask.style.opacity = !handled && p.rect && p.rect.width > 0 ? '0' : '1';
        card.style.opacity = '1';
        card.style.visibility = 'visible';
      }
    }

    // ---- 遮罩进入动画 ----
    if (gsap) {
      gsap.fromTo(mask, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' });
    }

    // 订阅主进程步骤数据
    shell.onOnboardingFocus(function (p) {
      render(p);
    });
  });
})();
