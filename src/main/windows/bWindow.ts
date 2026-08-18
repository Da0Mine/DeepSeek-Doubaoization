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
import { scheduleLayoutView, focusChatInputOnShow, installWebShortcuts } from './mainWindow';
import { installLinkOpenHandler } from './browserWindow';
import { logf } from '../logger';
import type { ConfigStore } from '../config/ConfigStore';
import type { ScreenshotRect } from '../../shared/types';

/** B 窗口标题栏高度（bwindow.css #titlebar height: 36px）。 */
const B_TITLEBAR_HEIGHT = 36;

export interface BWindowResult {
  win: BrowserWindow;
  view: WebContentsView;
}

/**
 * 去留白（实测根因，2026-08-01）：DeepSeek 深色主题下 body 背景 = rgb(21,21,23)，
 * 但窗口底部（composer 下方无内容区域）渲染出的颜色比内容区亮 10+ 亮度级，
 * 视觉上就是"灰色留白"。根因是页面底层某些容器背景透出，与内容区不一致。
 * 修复：把 html/body 背景强制为内容区背景色（读 body 计算背景，动态取主题色），
 * 让底部留白区与内容区颜色完全一致。经 CDP 像素采样验证：设后底部区域颜色
 * 从 (35,35,37) 降至 (21,21,23)，与 body 背景一致，视觉留白消除。
 * 不再改 flex 布局（实验证明会打乱 DeepSeek 的 absolute/relative 定位），
 * 不再用 position:fixed composer（会破坏聊天滚动）。
 * export 出来供副窗口（subWindow）和主窗口复用。
 */
export function injectBWindowScrollFix(wc: Electron.WebContents): void {
  if (wc.isDestroyed()) return;
  wc.insertCSS(`
    html, body { overflow: auto !important; overflow-y: auto !important; }
  `).catch(() => {});
  // 统一 html/body 背景为内容区背景，消除底部留白色差
  const js = `(() => {
    function apply() {
      try {
        if (!document.body) return;
        var bg = getComputedStyle(document.body).backgroundColor;
        if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = 'rgb(21, 21, 23)';
        document.documentElement.style.backgroundColor = bg;
        document.body.style.backgroundColor = bg;
        // 主题色变量兜底：部分页面用 var(--ds-bg) 定义背景
        var ds = getComputedStyle(document.documentElement).getPropertyValue('--ds-bg').trim();
        if (ds && ds !== 'transparent' && ds !== '') {
          document.documentElement.style.setProperty('--ds-bg', bg);
        }
      } catch (e) {}
    }
    apply();
    setTimeout(apply, 1000);
    setTimeout(apply, 3000);
    try {
      var mo = new MutationObserver(function () { apply(); });
      mo.observe(document.body, { childList: true, subtree: false });
    } catch (e) {}
  })()`;
  wc.executeJavaScript(js).catch(() => {});
}

/**
 * B/副窗口去留白·层 2：消息区 flex 修复后 composer 下方仍可能有几像素残余空白（页面 JS
 * 计算的 composer 位置未精确贴底）。测量 composer 容器实际 bottom，把窗口高度收紧到
 * 「titlebar + composer bottom + 小边距」，让窗口底部正好切在 composer 底部。
 * 1.5/3/6/12/20/30s 多次测量（SPA 渲染、AI 回复流式都可能改变高度）。
 * 只收紧不放大：窗口初始高度是上限，用户可手动拖大。
 */
export function scheduleBWindowAutoSize(win: BrowserWindow, view: WebContentsView, titlebarHeight = B_TITLEBAR_HEIGHT): void {
  const measureAndTighten = (): void => {
    try {
      if (!win || win.isDestroyed()) return;
      const wc = view && view.webContents;
      if (!wc || wc.isDestroyed()) return;
      wc
      .executeJavaScript(`(() => {
        try {
          // Find the composer by walking up from the textbox. A page-wide background layer
          // must not be mistaken for the bottom of the actual input UI.
          var input = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
          if (!input) return { kind: 'no-input', vh: window.innerHeight };
          var inputRect = input.getBoundingClientRect();
          var el = input;
          var composer = null;
          for (var i = 0; i < 10 && el; i++, el = el.parentElement) {
            var r = el.getBoundingClientRect();
            var hasButtonRow = !!el.querySelector('.ec4f5d61, button, [role="button"]');
            var isWideEnough = r.width >= inputRect.width - 4;
            var isComposerSized = r.height >= inputRect.height + 24;
            if (r.bottom > 0 && isWideEnough && (hasButtonRow || isComposerSized)) {
              composer = r;
              break;
            }
          }
          if (!composer) return {
            kind: 'no-composer',
            vh: window.innerHeight,
            inputTop: Math.round(inputRect.top),
            inputHeight: Math.round(inputRect.height),
            inputBottom: Math.round(inputRect.bottom)
          };
          if (composer.bottom <= 0 || composer.bottom > window.innerHeight + 20) return {
            kind: 'composer-outside-viewport',
            vh: window.innerHeight,
            composerBottom: Math.round(composer.bottom),
            inputTop: Math.round(inputRect.top),
            inputHeight: Math.round(inputRect.height),
            inputBottom: Math.round(inputRect.bottom)
          };
          return {
            kind: 'ok',
            contentBottom: Math.round(composer.bottom),
            composerTop: Math.round(composer.top),
            composerHeight: Math.round(composer.height),
            vh: window.innerHeight,
            inputTop: Math.round(inputRect.top),
            inputHeight: Math.round(inputRect.height),
            inputBottom: Math.round(inputRect.bottom)
          };
        } catch (e) { return null; }
      })()`)
      .then((res: unknown) => {
        if (win.isDestroyed()) return;
        const r = res as { contentBottom: number; vh: number } | null;
        if (!r || typeof r.contentBottom !== 'number' || r.contentBottom <= 0) return;
        const target = Math.max(280, titlebarHeight + r.contentBottom + 4);
        const curSize = win.getContentSize();
        const curHeight = curSize[1];
        const curWidth = curSize[0];
        if (target < curHeight - 1) {
          win.setContentSize(curWidth, Math.round(target));
          logf('bwin-size', 'auto-resize', {
            width: curWidth,
            from: curHeight,
            to: Math.round(target),
            contentBottom: r.contentBottom,
            vh: r.vh,
          });
        } else {
          logf('bwin-size', 'auto-resize-skip', {
            from: curHeight,
            target: Math.round(target),
            contentBottom: r.contentBottom,
          });
        }
      })
      .catch(() => {});
    } catch (e) {
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
  const keepOnTop = config.get('alwaysOnTop') === true;
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
    // 构造时即设置 alwaysOnTop，确保 bwindow.js 初始化 shell.isAlwaysOnTop() 返回正确值，
    // 渲染进程 UI 状态（pinned class）与主进程实际状态从首帧起就同步。
    // 之前在 ready-to-show 中才设置，导致 bwindow.js 读到 false，图标显示空心，
    // 但实际窗口是置顶的，用户点击 pin 按钮时 IPC handler 读到 true → next=false
    // → setAlwaysOnTop(false) → 窗口掉到底层，且图标不切换（这就是「置底 + 图标不切换」根因）。
    alwaysOnTop: keepOnTop,
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: ['--window-type=b'],
    },
  });
  // macOS 上需要 'screen-saver' 层级才能真正压过其他 always-on-top 窗口（构造选项只能给 boolean）。
  // Windows 上层级参数被忽略，setAlwaysOnTop(boolean) 等价于构造选项 alwaysOnTop:boolean。
  if (keepOnTop) win.setAlwaysOnTop(true, 'screen-saver');

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
  scheduleLayoutView(win, view, B_TITLEBAR_HEIGHT);
  // 页面完整加载后聚焦输入框（show 聚焦是快速路径；页面加载中时脚本轮询会随导航销毁，
  // did-finish-load 兜底可靠聚焦）。
  view.webContents.on('did-finish-load', () => {
    if (!view.webContents.isDestroyed()) focusChatInputOnShow(view.webContents);
  });
  // 链接打开方式（内置浏览器窗口 / 系统默认浏览器）
  installLinkOpenHandler(view.webContents);
  // 内嵌页快捷键：Ctrl+R 重载 / Ctrl+F 页面查找
  installWebShortcuts(view.webContents, view);

  // 去留白·层 1：完整页面滚动修复（overflow auto 注入 + 递归改回，1s/3s 重试）。
  // did-finish-load 与 SPA 路由（did-navigate-in-page）后都注入一次，覆盖重渲染丢样式。
  const injectScrollFix = (): void => injectBWindowScrollFix(view.webContents);
  injectScrollFix();
  view.webContents.on('did-finish-load', injectScrollFix);
  view.webContents.on('did-navigate-in-page', () => {
    // SPA 内部路由也会重建部分布局，延迟一点再修（等 DOM 稳定）
    setTimeout(injectScrollFix, 500);
  });
  // 去留白·层 2：按页面实际渲染高度多次测量并收紧窗口高度，消除输入框下方空白。
  // B 类窗口标题栏高 36px（bwindow.css），显式传入避免用默认 40 多算留白。

  // 窗口状态变化后重新布局（B 窗口无主副切换，view 为固定局部变量，可安全闭包捕获）。
  // 使用 scheduleLayoutView 做延迟防抖，避免 maximize/unmaximize 时拿到不稳定尺寸。
  // 使用 B_TITLEBAR_HEIGHT（36px，与 bwindow.css 一致），避免默认 40px 多算留白。
  const relayout = (): void => {
    if (!win.isDestroyed()) scheduleLayoutView(win, view, B_TITLEBAR_HEIGHT);
  };
  win.on('resize', relayout);
  win.on('resized', relayout);
  win.on('maximize', relayout);
  win.on('unmaximize', relayout);
  win.on('enter-full-screen', relayout);
  win.on('leave-full-screen', relayout);
  win.on('show', relayout);
  // 打开窗口即可直接输入：B 窗口 show 时聚焦聊天输入框（view 为固定局部变量，可直接捕获）。
  win.on('show', () => focusChatInputOnShow(view.webContents));

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      try {
        const theme = new ThemeManager();
        const vars = theme.getCssVars();
        // B 类临时窗口字号 = 全局 + B 类窗口细分
        vars['--ds-font-size'] = `${15 + (config.get('fontSize') || 0) + (config.get('fontSizeB') || 0)}px`;
        vars['--ds-font-offset'] = String((config.get('fontSize') || 0) + (config.get('fontSizeB') || 0));
        win.webContents.send(IPC.THEME_VARS, vars);
      } catch (e) {
        console.error('[bWindow] 补发主题变量失败:', e);
      }
      // alwaysOnTop 已在构造时按配置设置（同步），这里只需 show + moveTop + focus 夺前台。
      // 不再临时改 alwaysOnTop 然后回落——那种做法会让主进程实际状态与渲染进程 UI 状态不同步，
      // 用户点击 pin 按钮时 IPC handler 读到的 isAlwaysOnTop() 与渲染进程以为的状态相反，
      // 导致「点击置顶按钮反而置底」+「图标不切换」。
      win.show();
      try { win.moveTop(); } catch { /* 个别平台不支持，忽略 */ }
      win.focus();
    }
  });

  // B 窗口为临时窗口：关闭即销毁（不隐藏、不进托盘）。
  // 注意：不在 close 中显式调用 view.webContents.close()，否则会抢在
  // WindowManager 的 cleanBWindowHistory 处理器之前销毁 webContents，
  // 导致 deleteConversation 因 wc.isDestroyed() 跳过，对话记录无法自动删除。
  // Electron 销毁窗口时会自动清理子视图，不需要额外关闭 webContents。
  win.on('close', () => {
    // 无需显式关闭 webContents——交给 WindowManager 的生命周期管理或 Electron 默认清理。
  });

  return { win, view };
}
