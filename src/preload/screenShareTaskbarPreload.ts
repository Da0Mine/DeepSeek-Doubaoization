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
  sendSwitchVision(): void {
    try {
      ipcRenderer.send(IPC.SCREEN_SHARE_SWITCH_VISION);
    } catch {
      /* 忽略 */
    }
  },
  /** 任务栏按钮悬浮态：让四角共享框同步变为淡红（取消提醒）。 */
  sendHover(on: boolean): void {
    try {
      ipcRenderer.send(IPC.SCREEN_SHARE_HOVER, { on: !!on });
    } catch {
      /* 忽略 */
    }
  },
});

declare global {
  interface Window {
    __dsScreenShare: {
      sendStop(): void;
      sendSwitchVision(): void;
      sendHover(on: boolean): void;
    };
  }
}
