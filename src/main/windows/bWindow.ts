/**
 * B 类临时窗口工厂（I-07）：比副窗口更小的 9:16 窗口，出现在截图选区旁，
 * 内嵌 chat.deepseek.com（共享 session），无主副切换，用完即关，不进托盘。
 */
import { BrowserWindow, WebContentsView, screen } from 'electron';
import {
  B_WINDOW_HEIGHT,
  B_WINDOW_WIDTH,
  BWINDOW_HTML,
  DEEPSEEK_URL,
  SHELL_PRELOAD,
  SUB_WINDOW_RATIO,
  TITLEBAR_HEIGHT,
  WEBVIEW_PRELOAD,
  iconIfExists,
} from '../constants';
import { IPC } from '../ipc/channels';
import { ThemeManager } from '../theme/ThemeManager';
import { layoutView, scheduleLayoutView } from './mainWindow';
import { logf } from '../logger';
import type { ConfigStore } from '../config/ConfigStore';
import type { ScreenshotRect } from '../../shared/types';

export interface BWindowResult {
  win: BrowserWindow;
  view: WebContentsView;
}

/**
 * B 窗口去留白·层 1：输入框以下留白 → 展示完整 DeepSeek 页面。
 * 对齐参考项目 DeepSeek-desktop-client-main/main.js 的 injectTranslationAssets：
 *   - insertCSS 注入 `html,body{overflow:auto!important}` 兜底；
 *   - executeJavaScript 递归遍历所有元素，把 overflow:hidden / overflowY:hidden 改回 auto
 *     （页面 JS 可能延迟执行重新设 hidden，故 1s/3s 重试）。
 * 关键：聊天类副窗口（B/常驻 sub）显示「完整聊天页面」，输入框位于底部自然贴底，
 * 而不是删输入框/改布局。
 * export 出来供副窗口（subWindow）复用。
 */
export function injectBWindowScrollFix(wc: Electron.WebContents): void {
  if (wc.isDestroyed()) return;
  // 强制 chat 页面输入框 + disclaimer 紧贴视口底部（用户反馈"不能强制整体往下平移吗"）。
  // 方案：position:fixed bottom:0 把 composer footer（含输入框 + disclaimer）钉死在视口底，
  // chat 滚动区加 padding-bottom 避免被遮挡。比 flex column 更可靠（DeepSeek 用 hash class，
  // flex 作用在不确定的容器上会破坏布局）。
  wc.insertCSS(`
    html, body { overflow: auto !important; overflow-y: auto !important; }
    /* composer footer（输入框工具栏 + disclaimer）钉死视口底 */
    .ec4f5d61, [class*="composer"], [class*="chat-input"], [class*="input-area"] {
      position: fixed !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      z-index: 100 !important;
      background: var(--ds-bg, #1e1e1e) !important;
      padding-bottom: 0 !important;
      margin-bottom: 0 !important;
    }
    /* chat 滚动区加 padding-bottom 给 composer 留空间，避免内容被遮挡 */
    .b13855df, [class*="scroll-area"]:not([class*="gutter"]) {
      padding-bottom: 80px !important;
    }
    /* 兜底：disclaimer / footer 类元素无 padding/margin */
    [class*="disclaimer"], footer:not(button):not(a) {
      padding: 0 !important;
      margin: 0 !important;
    }
  `).catch(() => {});
  wc.executeJavaScript(`(() => {
    function fixScrolling() {
      try {
        document.documentElement.style.overflow = 'auto';
        document.documentElement.style.overflowY = 'auto';
        document.body.style.overflow = 'auto';
        document.body.style.overflowY = 'auto';
        var all = document.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          try {
            var cs = window.getComputedStyle(all[i]);
            if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
              all[i].style.overflow = 'auto';
              all[i].style.overflowY = 'auto';
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    fixScrolling();
    setTimeout(fixScrolling, 1000);
    setTimeout(fixScrolling, 3000);
  })()`).catch(() => {});
}

/**
 * B 窗口去留白·层 2：内容区与输入框之间的留白（AI 回复短、chat 滚动区留空，CSS 改不掉）。
 * 按「输入框容器底部 y」多次测量并 win.setSize 收紧窗口高度，使窗口高度 = 输入框底部 + 边距，
 * 消除输入框下方的空白。1.5/3/6/12/20/30s 多次测量（SPA 渲染、AI 回复流式输出都可能改变高度）。
 * 只收紧不放大：窗口初始高度（B_WINDOW_HEIGHT）就是上限，用户仍可手动拖大。
 * export 出来供副窗口（subWindow）复用。
 */
export function scheduleBWindowAutoSize(win: BrowserWindow, view: WebContentsView): void {
  const measureAndTighten = (): void => {
    try {
      // Bug 修复：用户反馈"setTimeout 回调里 view.webContents.isDestroyed() 抛 TypeError"。
      // 场景：副窗口 swapMainSub 时 entry.view 被替换为新 view，旧 view 通过闭包被引用；
      // 或者 win 在 setTimeout 排队期间被关闭；访问已销毁/替换的 webContents 会抛 TypeError。
      // 用 try/catch 兜底，且每步都做存在性检查，宁可错过一次测量也不崩主进程。
      if (!win || win.isDestroyed()) return;
      const wc = view && view.webContents;
      if (!wc || wc.isDestroyed()) return;
      wc
      .executeJavaScript(`(() => {
        try {
          // 找 DeepSeek chat 页面底部最深的元素 bottom（消除「输入框贴底但 disclaimer/footer
          // 还在外层导致下方留白」的问题）。候选：
          //   1. 输入框容器（getComposerFooter：含 file input 的最近 svg 数最多祖先）
          //   2. disclaimer / footer 元素（"内容由 AI 生成，请仔细甄别"等）
          //   3. [class*="disclaimer" / "footer" / "bottom"]
          // 取所有候选 bottom 最大值 + 边距作为目标视口高度。
          function getComposerBottom() {
            var max = 0;
            // 1) 输入框 toolbar 底部
            var fi = document.querySelector('input[type="file"]');
            var el = fi ? fi.parentElement : null;
            var best = null, bestSvg = -1;
            for (var i = 0; i < 8 && el; i++) {
              var svgs = el.querySelectorAll ? el.querySelectorAll('svg').length : 0;
              if (svgs > bestSvg) { bestSvg = svgs; best = el; }
              el = el.parentElement;
            }
            if (best) {
              var r = best.getBoundingClientRect();
              if (r.bottom > max) max = r.bottom;
            }
            // 2) 文字匹配 disclaimer 叶节点（DeepSeek 用"内容由 AI 生成，请仔细甄别"作为底部提示）
            var textNodes = document.querySelectorAll('div, span, p');
            for (var t = 0; t < textNodes.length; t++) {
              var tn = textNodes[t];
              if (tn.children.length > 0) continue;
              var txt = (tn.textContent || '').trim();
              if (txt.indexOf('AI 生成') >= 0 || txt.indexOf('请仔细甄别') >= 0) {
                var tr = tn.getBoundingClientRect();
                if (tr.bottom > max) max = tr.bottom;
              }
            }
            // 3) disclaimer / footer / [class*="disclaimer"/"footer"/"bottom"]
            var sels = [
              '[class*="disclaimer"]',
              '[class*="footer"]',
              'footer',
              '[class*="bottom"]',
            ];
            for (var k = 0; k < sels.length; k++) {
              var nodes = document.querySelectorAll(sels[k]);
              for (var j = 0; j < nodes.length; j++) {
                var rr = nodes[j].getBoundingClientRect();
                if (rr.bottom > max) max = rr.bottom;
              }
            }
            // 4) documentElement.scrollHeight 兜底（chat 区有内容时也能覆盖）
            var docH = document.documentElement.scrollHeight;
            if (docH > max) max = docH;
            // 6) 兜底找视口内最深的可视元素（disclaimer 未渲染时也能 tight）
            try {
              var fallback = document.querySelectorAll('*');
              for (var z = 0; z < fallback.length; z++) {
                var r = fallback[z].getBoundingClientRect();
                if (r.bottom > 0 && r.bottom <= window.innerHeight && r.height > 0) {
                  if (r.bottom > max) max = r.bottom;
                }
              }
            } catch (e) {}
            return max;
            return max;
          }
          var bottom = getComposerBottom();
          if (bottom <= 0 || bottom > window.innerHeight + 200) return null;
          return { bottom: Math.round(bottom), vh: window.innerHeight };
        } catch (e) { return null; }
      })()`)
      .then((res: unknown) => {
        if (win.isDestroyed()) return;
        const r = res as { bottom: number; vh: number } | null;
        if (!r || typeof r.bottom !== 'number' || r.bottom <= 0) return;
        // 目标高度 = 标题栏 + 内容最底元素 bottom（紧贴，不留 padding）。
        // 收紧阈值放宽：target 比当前小 0 以上即收紧（不要用 target<cur-6，否则 disclaimer
        // 边缘情况 target ≈ cur 时永远 skip）。
        const target = Math.max(280, TITLEBAR_HEIGHT + r.bottom);
        const cur = win.getContentBounds().height;
        if (target < cur - 1) {
          win.setContentSize(B_WINDOW_WIDTH, Math.round(target));
          logf('bwin-size', 'auto-resize', {
            from: cur,
            to: Math.round(target),
            bottom: r.bottom,
            vh: r.vh,
          });
        } else {
          logf('bwin-size', 'auto-resize-skip', {
            from: cur,
            target: Math.round(target),
            bottom: r.bottom,
          });
        }
      })
      .catch(() => {});
    } catch (e) {
      // 窗口被销毁/替换/异常等任意情况：错过本次测量即可，绝不让主进程崩
      return;
    }
  };
  [1500, 3000, 6000, 12000, 20000, 30000].forEach((ms) =>
    setTimeout(measureAndTighten, ms)
  );
}

/** 依据选区算 B 窗口位置：优先选区右侧，越界则左侧，垂直居中并夹进所在屏工作区。 */
function computeBWindowBounds(rect: ScreenshotRect): { x: number; y: number } {
  const gap = 12;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const display = screen.getDisplayMatching({ x: cx, y: cy, width: 1, height: 1 });
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

  let x = rect.x + rect.width + gap; // 右侧优先
  if (x + B_WINDOW_WIDTH > dx + dw) {
    x = rect.x - gap - B_WINDOW_WIDTH; // 越界放左侧
    if (x < dx) x = dx + dw - B_WINDOW_WIDTH; // 仍越界则贴右
  }
  x = Math.max(dx, Math.min(x, dx + dw - B_WINDOW_WIDTH));

  let y = cy - B_WINDOW_HEIGHT / 2; // 垂直居中于选区
  y = Math.max(dy, Math.min(y, dy + dh - B_WINDOW_HEIGHT));

  return { x: Math.round(x), y: Math.round(y) };
}

export function createBWindow(sourceRect: ScreenshotRect, config: ConfigStore): BWindowResult {
  const { x, y } = computeBWindowBounds(sourceRect);
  const win = new BrowserWindow({
    width: B_WINDOW_WIDTH,
    height: B_WINDOW_HEIGHT,
    minWidth: 240,
    minHeight: Math.round(240 / SUB_WINDOW_RATIO),
    x,
    y,
    frame: false,
    title: '结果',
    backgroundColor: '#ffffff',
    show: false,
    icon: iconIfExists(),
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: ['--window-type=b'],
    },
  });

  win.loadFile(BWINDOW_HTML);

  const view = new WebContentsView({
    webPreferences: {
      preload: WEBVIEW_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.contentView.addChildView(view);
  view.webContents.loadURL(DEEPSEEK_URL);
  layoutView(win, view);

  // 去留白·层 1：完整页面滚动修复（overflow auto 注入 + 递归改回，1s/3s 重试）。
  // did-finish-load 与 SPA 路由（did-navigate-in-page）后都注入一次，覆盖重渲染丢样式。
  const injectScrollFix = (): void => injectBWindowScrollFix(view.webContents);
  injectScrollFix();
  view.webContents.on('did-finish-load', injectScrollFix);
  view.webContents.on('did-navigate-in-page', () => {
    // SPA 内部路由也会重建部分布局，延迟一点再修（等 DOM 稳定）
    setTimeout(injectScrollFix, 500);
  });
  // 去留白·层 2：按输入框容器底部 y 多次测量并收紧窗口高度，消除输入框下方空白。
  scheduleBWindowAutoSize(win, view);

  // 窗口状态变化后重新布局（B 窗口无主副切换，view 为固定局部变量，可安全闭包捕获）。
  // 使用 scheduleLayoutView 做延迟防抖，避免 maximize/unmaximize 时拿到不稳定尺寸。
  const relayout = (): void => {
    if (!win.isDestroyed()) scheduleLayoutView(win, view);
  };
  win.on('resize', relayout);
  win.on('resized', relayout);
  win.on('maximize', relayout);
  win.on('unmaximize', relayout);
  win.on('enter-full-screen', relayout);
  win.on('leave-full-screen', relayout);
  win.on('show', relayout);

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      try {
        const theme = new ThemeManager();
        const vars = theme.getCssVars();
        vars['--ds-font-size'] = `${config.get('fontSize')}px`;
        win.webContents.send(IPC.THEME_VARS, vars);
      } catch (e) {
        console.error('[bWindow] 补发主题变量失败:', e);
      }
      win.show();
    }
  });

  // B 窗口为临时窗口：关闭即销毁（不隐藏、不进托盘）。
  win.on('close', () => {
    try {
      if (!win.isDestroyed() && view.webContents) view.webContents.close();
    } catch (e) {
      // 忽略
    }
  });

  return { win, view };
}
