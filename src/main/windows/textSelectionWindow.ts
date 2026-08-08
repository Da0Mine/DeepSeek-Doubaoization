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

let toolbarWindow: BrowserWindow | null = null;
let toolbarMouseX = 0;
let toolbarMouseY = 0;
let toolbarScale = 1;
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

/** 定位工具栏：左边缘在鼠标位置左移 8px、上方 4px，并做屏幕边界校正。 */
function positionToolbar(width: number, mouseX: number, mouseY: number): void {
  const win = toolbarWindow;
  if (!win || win.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint({ x: mouseX, y: mouseY });
  const scale = display.scaleFactor || 1;
  toolbarScale = scale;
  const workArea = display.workArea;
  const toolbarHeight = 34;
  let winX = Math.round(mouseX / scale - 8);
  let winY = Math.round(mouseY / scale - toolbarHeight - 4);
  if (winX < workArea.x) winX = workArea.x + 4;
  if (winX + width > workArea.x + workArea.width) {
    winX = workArea.x + workArea.width - width - 4;
  }
  if (winY < workArea.y) winY = workArea.y + 4;
  win.setBounds({
    x: Math.round(winX * scale),
    y: Math.round(winY * scale),
    width: Math.round(width * scale),
    height: Math.round(toolbarHeight * scale),
  });
}

/**
 * 在鼠标位置显示划词工具栏（窗口复用：已创建则直接更新内容并显示）。
 * @param mouseX 鼠标 X 坐标（屏幕坐标）
 * @param mouseY 鼠标 Y 坐标（屏幕坐标）
 * @param buttons 按钮列表 [{label, prompt}]
 * @param selectedText 当前选中的文本
 */
export function showToolbarAt(
  mouseX: number,
  mouseY: number,
  buttons: { label: string; prompt: string }[],
  selectedText: string
): void {
  toolbarMouseX = mouseX;
  toolbarMouseY = mouseY;
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
  if (!win.isVisible()) win.showInactive();
}

/** 滚动时重新定位工具栏（跟随选中文本移动）。
 *  uIOhook 的 rotation 值通常为 1/-1（每格滚轮），实际滚动距离约 40px，故乘以 40。 */
export function repositionToolbar(deltaY: number): void {
  if (!toolbarWindow || toolbarWindow.isDestroyed() || !toolbarVisible) return;
  const bounds = toolbarWindow.getBounds();
  // 乘以 40 映射到实际像素滚动距离，并考虑屏幕缩放
  const newY = bounds.y + Math.round(deltaY * 40 * toolbarScale);
  toolbarWindow.setPosition(bounds.x, newY);
}

// 渲染层内容渲染完成后回报实际宽度：自适应窗口尺寸，随后显示（首次显示也在此触发）。
ipcMain.on(IPC.TOOLBAR_RESIZE, (e, { width }: { width: number }) => {
  if (!toolbarWindow || toolbarWindow.isDestroyed() || e.sender !== toolbarWindow.webContents) return;
  const w = Math.max(40, Math.round(Number(width) || 120));
  positionToolbar(w, toolbarMouseX, toolbarMouseY);
  if (toolbarVisible && !toolbarWindow.isVisible()) {
    toolbarWindow.showInactive();
  }
});
