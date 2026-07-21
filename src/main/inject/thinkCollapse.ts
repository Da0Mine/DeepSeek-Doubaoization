/**
 * 折叠思考过程（深度思考/思维链）注入。
 * 移植自 DeepSeek-desktop-client 参考实现：
 *   - 向页面注入 CSS，将 .ds-think-content 的 max-height 收为 0（视觉折叠）；
 *   - 注入 MutationObserver + 轮询，找到 .ds-think-content 的父容器首个子元素（标题/切换按钮）并点击，使 UI 状态与折叠一致；
 *   - 开关由 config.collapseThinking 控制（true=折叠，false=展开）。
 * 注意：CSS 用 !important 强制收起，故开启状态下用户无法手动展开（符合“默认折叠”语义）；关闭开关即移除样式并自动展开。
 */
import type { WebContents } from 'electron';

const COLLAPSE_CSS =
  '.ds-think-content{max-height:0 !important;overflow:hidden !important;' +
  'padding-top:0 !important;padding-bottom:0 !important;margin-top:0 !important;' +
  'margin-bottom:0 !important;border:none !important;opacity:0 !important;}';

/** 构建页内注入脚本（幂等：observer 仅注册一次，重复调用仅更新目标状态 + CSS）。 */
export function buildThinkCollapseScript(enabled: boolean): string {
  const css = COLLAPSE_CSS;
  return `(() => {
    try {
      var SHOULD_COLLAPSE = ${enabled ? 'true' : 'false'};
      window.__dsThinkExpand = !SHOULD_COLLAPSE;
      function ensureCss(collapse) {
        var id = 'ds-think-collapse-css';
        var existing = document.getElementById(id);
        if (collapse) {
          if (!existing) {
            var s = document.createElement('style');
            s.id = id;
            s.textContent = ${JSON.stringify(css)};
            (document.head || document.documentElement).appendChild(s);
          }
        } else if (existing) {
          existing.remove();
        }
      }
      ensureCss(SHOULD_COLLAPSE);
      if (window.__dsThinkObserver) return;
      function findToggles(root) {
        var res = [];
        var cs = (root || document).querySelectorAll('.ds-think-content');
        for (var i = 0; i < cs.length; i++) {
          var c = cs[i];
          var cont = c.parentElement;
          if (!cont) continue;
          var first = cont.firstElementChild;
          if (first && first !== c) res.push({ toggle: first, content: c });
        }
        return res;
      }
      function handleOne(it) {
        if (!it.toggle || !it.content) return;
        if (window.__dsThinkHandled && window.__dsThinkHandled.has(it.content)) return;
        (window.__dsThinkHandled || (window.__dsThinkHandled = new WeakSet())).add(it.content);
        try {
          var r = it.content.getBoundingClientRect();
          var st = it.content.ownerDocument.defaultView.getComputedStyle(it.content);
          var vis = st.display !== 'none' && st.visibility !== 'hidden' && r.height > 5;
          if (window.__dsThinkExpand) { if (!vis) it.toggle.click(); }
          else { if (vis) it.toggle.click(); }
        } catch (e) {}
      }
      function handleAll() { var items = findToggles(); for (var i = 0; i < items.length; i++) handleOne(items[i]); }
      handleAll();
      window.__dsThinkObserver = new MutationObserver(function () { handleAll(); });
      window.__dsThinkObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
      setInterval(handleAll, 500);
      console.log('[ThinkCollapse] 监听已启动，目标:' + (SHOULD_COLLAPSE ? '折叠' : '展开'));
    } catch (e) {}
  })()`;
}

/** 对指定 webContents 应用/取消折叠思考。失败静默处理，不阻断主流程。 */
export function applyThinkCollapse(wc: WebContents | null | undefined, enabled: boolean): void {
  if (!wc || wc.isDestroyed()) return;
  try {
    wc.executeJavaScript(buildThinkCollapseScript(enabled)).catch(() => {});
  } catch (e) {
    /* 页面可能尚未就绪，忽略 */
  }
}
