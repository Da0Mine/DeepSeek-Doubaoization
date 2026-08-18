/**
 * 划词悬浮工具栏窗口：点击后显示一排横条按钮（复制/翻译/解释等），
 * 点击按钮通过 IPC 通知主进程处理，自动隐藏。
 *
 * 提速优化：窗口创建后复用（关闭事件拦截为隐藏，不销毁），
 * 内容经 IPC（toolbar:update）动态更新，宽度由渲染层测量后回报（toolbar:resize），
 * 避免每次划词都重建窗口 + loadFile 的开销。
 */
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { IPC } from '../ipc/channels';
import { logf } from '../logger';

let toolbarWindow: BrowserWindow | null = null;
let toolbarMouseX = 0;
let toolbarMouseY = 0;
/** 本次划词的选中文本屏幕区域（拖拽起点→终点），供 B 类窗口定位在文本旁。 */
let toolbarSelRect: Electron.Rectangle | null = null;
/** 工具栏当前是否可见（窗口对象可能隐藏但未销毁）。 */
let toolbarVisible = false;
/** 窗口首次加载完成前缓存的待显示数据。 */
let pendingShow: { buttons: { label: string; prompt: string }[]; text: string } | null = null;
/** 应用退出中：放行 close，允许窗口真正销毁。 */
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

/** 获取工具栏窗口是否可见。 */
export function hasToolbarWindow(): boolean {
  return toolbarVisible;
}

/** 隐藏工具栏（窗口复用，不销毁）。 */
export function closeToolbarWindow(): void {
  toolbarVisible = false;
  if (toolbarWindow && !toolbarWindow.isDestroyed()) {
    toolbarWindow.hide();
  }
}

/** 获取工具栏窗口实例（用于 IPC 转发）。 */
export function getToolbarWindow(): BrowserWindow | null {
  return toolbarWindow && !toolbarWindow.isDestroyed() ? toolbarWindow : null;
}

/** 获取工具栏窗口的屏幕边界。 */
export function getToolbarBounds(): Electron.Rectangle {
  if (toolbarWindow && !toolbarWindow.isDestroyed()) {
    return toolbarWindow.getBounds();
  }
  return { x: 0, y: 0, width: 0, height: 0 };
}

/** 获取本次划词选中文本的屏幕区域（供 B 类窗口定位在文本旁；无选区信息时返回 null）。 */
export function getSelectionRect(): Electron.Rectangle | null {
  return toolbarSelRect;
}

/** 创建（或复用）工具栏窗口。 */
function ensureToolbarWindow(): BrowserWindow | null {
  if (toolbarWindow && !toolbarWindow.isDestroyed()) return toolbarWindow;

  toolbarWindow = new BrowserWindow({
    width: 120,
    height: 34,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../../preload/shellPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 使用 'screen-saver' 层级确保不被其他窗口遮挡，并调用 moveTop 移到最前
  toolbarWindow.setAlwaysOnTop(true, 'screen-saver');
  try {
    toolbarWindow.moveTop();
  } catch {
    /* 个别平台不支持 */
  }

  // 复用：任何 close 请求（含渲染层按钮点击后的 shell.close()）都拦截为隐藏；退出时放行
  toolbarWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    toolbarVisible = false;
    toolbarWindow?.hide();
  });
  toolbarWindow.on('closed', () => {
    toolbarWindow = null;
    toolbarVisible = false;
  });

  // 首次加载完成：若已有待显示数据则补发（避免竞态丢内容）
  toolbarWindow.webContents.on('did-finish-load', () => {
    if (pendingShow && toolbarWindow && !toolbarWindow.isDestroyed()) {
      toolbarWindow.webContents.send(IPC.TOOLBAR_UPDATE, pendingShow);
      pendingShow = null;
    }
  });

  toolbarWindow.loadFile(path.join(__dirname, '../../renderer/textSelection/index.html'));
  return toolbarWindow;
}

/** 定位工具栏：左边缘在鼠标位置左移 8px、上方 4px，并做屏幕边界校正（不越过屏幕边界）。
 *  坐标系：mouseX/mouseY 为 DIP；setBounds 也接受 DIP。缩放环境 display.bounds
 *  可能返回物理像素（L057），故用 size/bounds 比例把 workArea 统一换算成 DIP 再夹紧。 */
function positionToolbar(width: number, mouseX: number, mouseY: number): void {
  const win = toolbarWindow;
  if (!win || win.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint({ x: mouseX, y: mouseY });
  // L057：缩放环境 display.bounds 可能返回物理像素，size 恒为物理像素；比例映射得到 DIP 工作区
  const sizeW = display.size.width || 1;
  const sizeH = display.size.height || 1;
  const boundsW = display.bounds.width || 1;
  const boundsH = display.bounds.height || 1;
  const work = display.workArea;
  const wa = {
    x: (work.x / sizeW) * boundsW,
    y: (work.y / sizeH) * boundsH,
    width: (work.width / sizeW) * boundsW,
    height: (work.height / sizeH) * boundsH,
  };
  const toolbarHeight = 34;
  let winX = Math.round(mouseX - 8);
  let winY = Math.round(mouseY - toolbarHeight - 4);
  // 左右边界夹紧：不越过屏幕左右两边
  if (winX < wa.x) winX = wa.x + 4;
  if (winX + width > wa.x + wa.width) {
    winX = wa.x + wa.width - width - 4;
  }
  // 上下边界夹紧：不越过任务栏上方 / 顶部
  if (winY < wa.y) winY = wa.y + 4;
  if (winY + toolbarHeight > wa.y + wa.height) {
    winY = wa.y + wa.height - toolbarHeight - 4;
  }
  win.setBounds({
    x: winX,
    y: winY,
    width: Math.round(width),
    height: toolbarHeight,
  });
}

/**
 * 在鼠标位置显示划词工具栏（窗口复用：已创建则直接更新内容并显示）。
 * @param mouseX 鼠标 X 坐标（屏幕坐标）
 * @param mouseY 鼠标 Y 坐标（屏幕坐标）
 * @param buttons 按钮列表 [{label, prompt}]
 * @param selectedText 当前选中的文本
 * @param selRect 选中文本的屏幕区域（可选，供 B 类窗口定位在文本旁）
 */
export function showToolbarAt(
  mouseX: number,
  mouseY: number,
  buttons: { label: string; prompt: string }[],
  selectedText: string,
  selRect?: Electron.Rectangle | null
): void {
  toolbarMouseX = mouseX;
  toolbarMouseY = mouseY;
  toolbarSelRect = selRect && selRect.width > 0 && selRect.height > 0 ? selRect : null;
  const win = ensureToolbarWindow();
  if (!win) return;

  toolbarVisible = true;
  // 首次加载中（loadFile 未完成）：缓存数据，did-finish-load 后补发
  if (win.webContents.isLoading() || win.webContents.getURL() === '') {
    pendingShow = { buttons, text: selectedText };
    positionToolbar(120, mouseX, mouseY);
    return;
  }
  // 已加载：立即更新内容并显示（窗口复用，无需重建）
  win.webContents.send(IPC.TOOLBAR_UPDATE, { buttons, text: selectedText });
  positionToolbar(120, mouseX, mouseY);
  logf('TOOLBAR', `showToolbarAt text="${selectedText.slice(0, 20)}" visible=${win.isVisible()}`);
  // 先正常显示（showInactive 不抢焦点），再提升层级：
  // 注意顺序——moveTop 在 Windows 上会把隐藏窗口直接显示出来（副作用），
  // 若在 showInactive 前调用会跳过正常显示逻辑导致悬浮框不出现。
  if (!win.isVisible()) win.showInactive();
  try {
    win.moveTop();
  } catch {
    /* 个别平台不支持 */
  }
  logf('TOOLBAR', `after show/moveTop visible=${win.isVisible()} destroyed=${win.isDestroyed()}`);
}

/** 滚动时重新定位工具栏（跟随选中文本移动）。
 *  uIOhook 的 rotation 值通常为 1/-1（每格滚轮），实际滚动距离约 40px；bounds 为 DIP。 */
export function repositionToolbar(deltaY: number): void {
  if (!toolbarWindow || toolbarWindow.isDestroyed() || !toolbarVisible) return;
  const bounds = toolbarWindow.getBounds();
  const newY = bounds.y + Math.round(deltaY * 40);
  toolbarWindow.setPosition(bounds.x, newY);
}

// 渲染层内容渲染完成后回报实际宽度：自适应窗口尺寸，随后显示（首次显示也在此触发）。
ipcMain.on(IPC.TOOLBAR_RESIZE, (e, { width }: { width: number }) => {
  if (!toolbarWindow || toolbarWindow.isDestroyed() || e.sender !== toolbarWindow.webContents) return;
  const w = Math.max(40, Math.round(Number(width) || 120));
  positionToolbar(w, toolbarMouseX, toolbarMouseY);
  if (toolbarVisible && !toolbarWindow.isVisible()) {
    // 先正常显示再提升层级（moveTop 会直接显示隐藏窗口，顺序不能反）
    toolbarWindow.showInactive();
    try {
      toolbarWindow.moveTop();
    } catch {
      /* 忽略 */
    }
  }
});
