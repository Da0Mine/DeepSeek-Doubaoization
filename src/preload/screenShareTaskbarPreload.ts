/**
 * 共享屏幕任务栏按钮窗口的预加载脚本。
 * 暴露 IPC 方法供任务栏按钮 HTML 调用（退出共享屏幕）。
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../main/ipc/channels';

contextBridge.exposeInMainWorld('__dsScreenShare', {
  sendStop(): void {
    try {
      ipcRenderer.send(IPC.SCREEN_SHARE_STOP);
    } catch {
      /* 忽略 */
    }
  },
});

declare global {
  interface Window {
    __dsScreenShare: {
      sendStop(): void;
    };
  }
}
