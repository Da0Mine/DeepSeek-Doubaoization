/**
 * 截图遮罩透明窗口：全屏半透明 + 矩形选区 + 动作条。
 * 用户选择动作并拖拽选区后，经 shellPreload 暴露的 screenshotAction() 回报主进程。
 * 多显示器/高 DPI：当前先用主屏全屏简化，坐标换算见 overlay.js 注释（待联调）。
 */
import { BrowserWindow, screen } from 'electron';
import { OVERLAY_HTML, SHELL_PRELOAD, iconIfExists } from '../constants';

let overlayWin: BrowserWindow | null = null;
let closeListeners: Array<() => void> = [];

/** 注册遮罩关闭回调（取消 / 选区完成均触发），用于恢复被隐藏的应用窗口。 */
export function onOverlayClosed(cb: () => void): void {
  closeListeners.push(cb);
}

/** 显示截图遮罩（已显示则聚焦）。 */
export function showOverlay(): void {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.focus();
    return;
  }
  // 用整屏 bounds（含任务栏）而非 workAreaSize，使选区能覆盖到任务栏区域
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;
  overlayWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreen: true,
    fullscreenable: true,
    show: false,
    icon: iconIfExists(),
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: ['--window-type=overlay'],
    },
  });
  overlayWin.loadFile(OVERLAY_HTML);
  overlayWin.once('ready-to-show', () => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.show();
      // 抬到 screen-saver 层级并全屏，确保遮罩盖在任务栏之上，选区能覆盖到屏幕最底部
      try {
        overlayWin.setFullScreen(true);
        overlayWin.setAlwaysOnTop(true, 'screen-saver');
      } catch (e) {
        /* ignore */
      }
      overlayWin.focus();
    }
  });
  overlayWin.on('closed', () => {
    overlayWin = null;
    closeListeners.forEach((f) => {
      try {
        f();
      } catch (e) {
        /* ignore */
      }
    });
  });
}

/** 隐藏并销毁遮罩窗口。 */
export function hideOverlay(): void {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.close();
  }
  overlayWin = null;
}

/** 返回遮罩窗口的 webContents（供 ScreenshotManager 下发截图 / 请求合成标注）。 */
export function getOverlayWebContents(): Electron.WebContents | null {
  if (overlayWin && !overlayWin.isDestroyed()) return overlayWin.webContents;
  return null;
}
