// 归档来源：src/main/inject/Injector.ts  行 3015-3154（injectChatModeSwitcher 注入脚本内 token 悬浮块）
        // === token 显示悬浮块（设置中开关，默认关；今日数字，悬浮展示「今日/累计」，位置紧跟输入框右上方） ===
        try {
          var tw = document.createElement('div');
          tw.id = 'ds-token-widget';
          tw.style.cssText = 'position:fixed;display:none;align-items:center;justify-content:center;gap:6px;min-width:34px;height:24px;padding:0 10px;border-radius:12px;background:rgba(28,30,38,0.55);backdrop-filter:blur(14px) saturate(1.5);-webkit-backdrop-filter:blur(14px) saturate(1.5);border:1px solid rgba(255,255,255,0.18);color:#eef0f3;font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1;user-select:none;-webkit-user-select:none;cursor:default;z-index:2147483000;';
          tw.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#5a8cff;flex:none;box-shadow:0 0 6px rgba(90,140,255,0.9);"></span>'
            + '<span class="ds-token-box" style="display:inline-flex;align-items:flex-start;overflow:hidden;height:15px;transform:translateY(1px);"></span>'
            + '<div class="ds-token-tip" style="position:absolute;top:calc(100% + 7px);right:0;display:none;flex-direction:column;gap:4px;padding:9px 12px;border-radius:10px;background:rgba(28,30,38,0.6);backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);border:1px solid rgba(255,255,255,0.16);font-size:11px;font-weight:500;line-height:1.2;white-space:nowrap;">'
            + '<span style="color:#9aa3b2;">今日 <b class="ds-token-today" style="color:#eef0f3;font-variant-numeric:tabular-nums;font-weight:600;margin-left:4px;">0</b></span>'
            + '<span style="color:#9aa3b2;">累计 <b class="ds-token-total" style="color:#eef0f3;font-variant-numeric:tabular-nums;font-weight:600;margin-left:4px;">0</b></span>'
            + '</div>';
          document.body.appendChild(tw);
          tw.style.position = 'fixed';
          var twSlotBox = tw.querySelector('.ds-token-box');
          var twToday = tw.querySelector('.ds-token-today');
          var twTotal = tw.querySelector('.ds-token-total');
          var twTip = tw.querySelector('.ds-token-tip');
          // ===== 老虎机：每个字符一列（列内 0-9/.kMB 循环的竖带），上滑循环到目标字符 =====
          var SLOT_H = 15; // 单格高度
          var SLOT_SEQ = '0123456789.kMB'; // 每个数字/字母出现的顺序（0-9 循环 → 目标）
          var SLOT_BAND = (function () { var a = []; for (var r = 0; r < 22; r++) { for (var s = 0; s < SLOT_SEQ.length; s++) a.push(SLOT_SEQ[s]); } return a; })();
          var twCols = [];
          var twFirst = true; // 首次渲染不滚动，直接落位
          function twNewCol() {
            var col = document.createElement('span');
            col.style.cssText = 'display:inline-block;vertical-align:top;overflow:hidden;height:' + SLOT_H + 'px;width:9px;position:relative;';
            var strip = document.createElement('span');
            strip.style.cssText = 'display:block;line-height:' + SLOT_H + 'px;font-variant-numeric:tabular-nums;will-change:transform;';
            col.appendChild(strip);
            return { col: col, strip: strip, idx: 0, built: false };
          }
          function twFillStrip(co) {
            var frag = document.createDocumentFragment();
            var cellCss = 'display:flex;align-items:center;justify-content:center;height:' + SLOT_H + 'px;line-height:' + SLOT_H + 'px;font-variant-numeric:tabular-nums;color:#eef0f3;font-weight:600;white-space:nowrap;';
            for (var i = 0; i < SLOT_BAND.length; i++) {
              var cell = document.createElement('span');
              cell.style.cssText = cellCss;
              cell.textContent = SLOT_BAND[i];
              frag.appendChild(cell);
            }
            co.strip.appendChild(frag);
            co.built = true;
          }
          function twCharIdxLow(char) {
            var p = SLOT_BAND.indexOf(char); if (p < 0) p = 0;
            var mid = Math.floor(SLOT_BAND.length / 2);
            while (p < mid) p += SLOT_SEQ.length;
            return p;
          }
          function twSetIdxVisible(co, char) {
            co.idx = twCharIdxLow(char);
            co.strip.style.transform = 'translateY(' + (-co.idx * SLOT_H) + 'px)';
          }
          function twRollTo(co, char) {
            if (!co.built) twFillStrip(co);
            if (SLOT_BAND[co.idx] === char) return;
            var seqLen = SLOT_SEQ.length;
            var curPos = SLOT_SEQ.indexOf(SLOT_BAND[co.idx]);
            var tarPos = SLOT_SEQ.indexOf(char);
            var fwd = ((tarPos - curPos) + seqLen) % seqLen;
            var steps = fwd + seqLen; // 至少转一整圈再落位
            var base = co.idx + steps;
            if (base > SLOT_BAND.length - 12) { // 竖带快到底，无声重定位到中部同字符
              twSetIdxVisible(co, char);
              return;
            }
            var dur = Math.min(720, Math.max(320, steps * 30));
            var anim = co.strip.animate(
              [{ transform: 'translateY(' + (-co.idx * SLOT_H) + 'px)' }, { transform: 'translateY(' + (-base * SLOT_H) + 'px)' }],
              { duration: dur, easing: 'cubic-bezier(.12,.85,.3,1)', fill: 'forwards' }
            );
            co.idx = base;
            anim.onfinish = function () { try { anim.cancel(); } catch (e9) {} co.strip.style.transform = 'translateY(' + (-base * SLOT_H) + 'px)'; };
          }
          var twSetNum = function (text) {
            try {
              var targets = text.split('');
              while (twCols.length < targets.length) twCols.push(twNewCol());
              while (twCols.length > targets.length) { var r = twCols.pop(); if (r.col.parentNode) r.col.parentNode.removeChild(r.col); }
              while (twSlotBox.firstChild) twSlotBox.removeChild(twSlotBox.firstChild);
              for (var i = 0; i < twCols.length; i++) {
                var co = twCols[i];
                if (!co.built) twFillStrip(co);
                if (twFirst) twSetIdxVisible(co, targets[i]);
                else twRollTo(co, targets[i]);
                twSlotBox.appendChild(co.col);
              }
              twFirst = false;
            } catch (e4) {
              twSlotBox.textContent = text;
            }
          };
          // 悬浮提示
          tw.addEventListener('pointerenter', function () { try { twTip.style.display = 'flex'; } catch (e5) {} });
          tw.addEventListener('pointerleave', function () { try { twTip.style.display = 'none'; } catch (e5) {} });
          // 定位：右对齐输入框、悬于其上方；锚点暂时失效时保持原位不跳走
          var twLastKey = '';
          var twPlace = function () {
            try {
              var ta = document.querySelector('textarea[placeholder*="发送消息"], textarea[aria-label*="发送消息"], textarea');
              var r = ta ? ta.getBoundingClientRect() : null;
              if (!r || r.width <= 1 || r.height <= 1) return;
              var z = 1; try { z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1; } catch (e2) {}
              if (!(z > 0)) z = 1;
              var R = Math.max(8, Math.round((window.innerWidth - r.right) / z));
              var T = Math.max(6, Math.round(r.top / z - tw.offsetHeight - 8));
              var key = R + ',' + T;
              if (key !== twLastKey) { twLastKey = key; tw.style.right = R + 'px'; tw.style.top = T + 'px'; }
            } catch (e3) {}
          };
          // 数值格式化：<1k 原样，>=1k→k，>=1M→M，>=1B→B；加单位后保留 1 位小数（含末尾 .0）
          var twFmt = function (n) {
            var v = Number(n) || 0;
            if (v < 1000) return String(Math.round(v));
            var u, f;
            if (v >= 1000000000) { u = 'B'; f = v / 1000000000; }
            else if (v >= 1000000) { u = 'M'; f = v / 1000000; }
            else { u = 'k'; f = v / 1000; }
            return f.toFixed(1) + u;
          };
          var twShow = function (enabled, tokens, total) {
            if (enabled) {
              twSetNum(twFmt(tokens));
              if (twToday) twToday.textContent = twFmt(tokens);
              if (twTotal) twTotal.textContent = twFmt(total);
              tw.style.display = 'flex';
            } else { tw.style.display = 'none'; }
            twPlace();
          };
          document.addEventListener('ds-token-widget-state', function (ev) {
            try { var d = ev.detail || {}; twShow(!!d.enabled, Number(d.tokens) || 0, Number(d.totalTokens) || 0); } catch (e6) {}
          });
          var twPoll = function () { try { document.dispatchEvent(new CustomEvent('ds-token-widget-query')); } catch (e7) {} };
          twPoll();
          var twTimer = setInterval(twPoll, 3000); // 每 3s 实时刷新 token 数
          var posTimer = setInterval(twPlace, 150); // 高频跟随输入框位置（切会话/布局变化立即跟上）
          window.addEventListener('resize', function () { twPlace(); });
          window.addEventListener('scroll', function () { twPlace(); }, true);
          window.__dsTokenWidget = { show: twShow, query: twPoll, place: twPlace, destroy: function () { clearInterval(twTimer); clearInterval(posTimer); } };
        } catch (e8) { /* 忽略 */ }
