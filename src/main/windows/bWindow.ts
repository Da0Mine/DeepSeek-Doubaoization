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
  WEBVIEW_PRELOAD,
  iconIfExists,
} from '../constants';
import { IPC } from '../ipc/channels';
import { ThemeManager } from '../theme/ThemeManager';
import { layoutView, scheduleLayoutView } from './mainWindow';
import type { ConfigStore } from '../config/ConfigStore';
import type { ScreenshotRect } from '../../shared/types';

export interface BWindowResult {
  win: BrowserWindow;
  view: WebContentsView;
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
    minHeight: Math.round(240 / (9 / 16)),
    x,
    y,
    frame: !config.get('customTitleBar'),
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
