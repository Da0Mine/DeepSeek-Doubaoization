/**
 * 折叠思考过程（深度思考/思维链）注入。
 * 参考实现：hza2002/deepseek-collapse-think 油猴脚本
 *
 * 核心策略：
 *   1. 用父容器 JS 属性标记已处理过的 think 块（React 替换子元素时不丢失）
 *   2. 用户点击展开 → 在父容器设 __dsSkipAutoFold = true → 不再自动折叠
 *   3. 继续对话 → 新 think 块的父容器无标记 → 自动折叠
 *   4. 切换会话（URL 变化）→ 清除所有标记 → 重新折叠
 *   5. 排除搜索/浏览结果（标题含"搜索到"/"浏览"文本）
 */
import type { WebContents } from 'electron';

export function buildThinkCollapseScript(enabled: boolean): string {
  return `(() => {
    try {
      var SHOULD_COLLAPSE = ${enabled ? 'true' : 'false'};

      if (window.__dsThinkObserver) {
        window.__dsThinkObserver.disconnect();
        window.__dsThinkObserver = null;
      }
      if (window.__dsThinkUserListener) {
        document.removeEventListener('click', window.__dsThinkUserListener, true);
        window.__dsThinkUserListener = null;
      }
      if (window.__dsThinkPollTimer) {
        clearInterval(window.__dsThinkPollTimer);
        window.__dsThinkPollTimer = null;
      }

      if (!SHOULD_COLLAPSE) {
        console.log('[ThinkCollapse] 已禁用');
        return;
      }

      var currentUrl = location.href;

      function isExpanded(content) {
        try {
          var r = content.getBoundingClientRect();
          var st = window.getComputedStyle(content);
          return st.display !== 'none' && st.visibility !== 'hidden' && r.height > 5;
        } catch (e) { return false; }
      }

      function isSearchResult(content) {
        try {
          var parent = content.parentElement;
          if (!parent) return false;
          var text = parent.textContent || '';
          if (text.indexOf('搜索到') >= 0 || text.indexOf('浏览') >= 0) return true;
          return false;
        } catch (e) { return false; }
      }

      function findToggle(content) {
        if (!content) return null;
        var container = content.parentElement;
        for (var i = 0; i < 3 && container; i++) {
          var toggle = container.querySelector('[class*="5ab5d64"]');
          if (toggle && !content.contains(toggle) && toggle !== content) return toggle;

          var candidates = container.querySelectorAll(':scope > div > div, :scope > div');
          for (var j = 0; j < candidates.length; j++) {
            var el = candidates[j];
            if (el === content || content.contains(el) || el.contains(content)) continue;
            if (!el.querySelector('svg')) continue;
            var t = (el.textContent || '').trim();
            if (t.indexOf('搜索到') >= 0 || t.indexOf('浏览') >= 0) continue;
            return el;
          }
          container = container.parentElement;
        }
        return null;
      }

      // 获取 think 块的稳定父容器（React 替换子元素时不会替换这个）
      function getContainer(content) {
        if (!content) return null;
        // 容器是 content 的父元素，在消息列表中稳定存在
        var container = content.parentElement;
        // 如果父元素不是消息容器，再向上找一层
        if (container && !container.querySelector('[class*="5ab5d64"]') && !container.querySelector('svg')) {
          container = container.parentElement;
        }
        return container;
      }

      // 折叠所有未标记的展开的 think 块
      function collapseAll() {
        var cs = document.querySelectorAll('.ds-think-content');
        for (var i = 0; i < cs.length; i++) {
          var c = cs[i];
          if (isSearchResult(c)) continue;
          // 用户曾展开过此 think 块（父容器有标记），不再自动折叠
          var container = getContainer(c);
          if (container && container.__dsSkipAutoFold) continue;
          if (!isExpanded(c)) continue;
          var toggle = findToggle(c);
          if (!toggle) continue;
          try {
            toggle.click();
            // 折叠后标记父容器，不再重复折叠
            if (container) container.__dsSkipAutoFold = true;
            console.log('[ThinkCollapse] 已折叠 think 块 #' + i);
          } catch (e) {}
        }
      }

      // 监听用户点击 toggle：在父容器上设标记，不再自动折叠
      window.__dsThinkUserListener = function(e) {
        var el = e.target;
        for (var i = 0; i < 6 && el; i++) {
          var parent = el.parentElement;
          if (!parent) break;
          var content = parent.querySelector(':scope > .ds-think-content');
          if (content && !isSearchResult(content)) {
            var container = getContainer(content);
            if (container) container.__dsSkipAutoFold = true;
            if (window.__dsThinkPollTimer) {
              clearInterval(window.__dsThinkPollTimer);
              window.__dsThinkPollTimer = null;
            }
            console.log('[ThinkCollapse] 用户点击 think 块，已标记不再自动折叠');
            return;
          }
          el = parent;
        }
      };
      document.addEventListener('click', window.__dsThinkUserListener, true);

      // URL 变化监听
      if (!window.__dsThinkUrlWrapped) {
        window.__dsThinkUrlWrapped = true;
        window.__dsThinkUrlTimers = [];
        var origPush = history.pushState;
        var origReplace = history.replaceState;
        history.pushState = function() { origPush.apply(this, arguments); window.__dsThinkOnUrlChange && window.__dsThinkOnUrlChange(); };
        history.replaceState = function() { origReplace.apply(this, arguments); window.__dsThinkOnUrlChange && window.__dsThinkOnUrlChange(); };
        window.addEventListener('popstate', function() { window.__dsThinkOnUrlChange && window.__dsThinkOnUrlChange(); });
      }

      window.__dsThinkOnUrlChange = function() {
        var newUrl = location.href;
        if (newUrl !== currentUrl) {
          currentUrl = newUrl;
          // 切换会话，清除所有父容器标记
          var cs = document.querySelectorAll('.ds-think-content');
          for (var i = 0; i < cs.length; i++) {
            var container = getContainer(cs[i]);
            if (container) container.__dsSkipAutoFold = false;
          }
          if (window.__dsThinkUrlTimers) {
            for (var k = 0; k < window.__dsThinkUrlTimers.length; k++) {
              clearTimeout(window.__dsThinkUrlTimers[k]);
            }
          }
          window.__dsThinkUrlTimers = [];
          window.__dsThinkUrlTimers.push(setTimeout(function() { collapseAll(); }, 500));
          console.log('[ThinkCollapse] URL 变化，重置容器标记，重新折叠');
        }
      };

      // 首次执行
      collapseAll();

      // 定期检查兜底（前 3 秒每 500ms 检查一次）
      var pollCount = 0;
      window.__dsThinkPollTimer = setInterval(function() {
        collapseAll();
        pollCount++;
        if (pollCount >= 6) {
          clearInterval(window.__dsThinkPollTimer);
          window.__dsThinkPollTimer = null;
        }
      }, 500);

      // MutationObserver 监听新增 think 块
      var debounceTimer = null;
      window.__dsThinkObserver = new MutationObserver(function(mutations) {
        var hasNewThink = false;
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType !== 1) continue;
            if ((node.classList && node.classList.contains('ds-think-content')) ||
                (node.querySelector && node.querySelector('.ds-think-content'))) {
              hasNewThink = true;
              break;
            }
          }
          if (hasNewThink) break;
        }
        if (!hasNewThink) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          collapseAll();
          debounceTimer = null;
        }, 100);
      });
      window.__dsThinkObserver.observe(document.body, { childList: true, subtree: true });

      console.log('[ThinkCollapse] 已启动，折叠模式');
    } catch (e) {
      console.error('[ThinkCollapse] 初始化失败:', e);
    }
  })()`;
}

export function applyThinkCollapse(wc: WebContents | null | undefined, enabled: boolean): void {
  if (!wc || wc.isDestroyed()) return;
  try {
    wc.executeJavaScript(buildThinkCollapseScript(enabled)).catch(() => {});
  } catch (e) {
    /* 忽略 */
  }
}