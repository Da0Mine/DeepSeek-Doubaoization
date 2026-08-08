/**
 * 划词剪贴板检测器：轮询系统剪贴板，当文本内容变化时通知主进程显示工具栏。
 * 无需快捷键，用户选中文本后按 Ctrl+C 复制，即可自动触发。
 */
import { clipboard } from 'electron';
import { logf } from '../logger';

export type TextSelectionCallback = (text: string) => void;

export class TextSelectionWatcher {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastText = '';
  private enabled = false;
  public onTextSelected: TextSelectionCallback | null = null;

  /** 启动轮询（默认 400ms 间隔）。 */
  public start(intervalMs = 400): void {
    if (this.intervalHandle) return;
    this.enabled = true;
    this.lastText = clipboard.readText();
    this.intervalHandle = setInterval(() => this.poll(), intervalMs);
    logf('TS_WATCH', '划词剪贴板检测已启动');
  }

  /** 停止轮询。 */
  public stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.enabled = false;
    logf('TS_WATCH', '划词剪贴板检测已停止');
  }

  /** 重启轮询（配置变化时调用）。 */
  public restart(intervalMs = 400): void {
    this.stop();
    this.start(intervalMs);
  }

  /** 是否正在运行。 */
  public isRunning(): boolean {
    return this.intervalHandle !== null;
  }

  private poll(): void {
    if (!this.enabled) return;
    try {
      const text = clipboard.readText();
      if (text && text !== this.lastText && text.length > 0) {
        logf('TS_WATCH', `检测到新剪贴板文本: "${text.slice(0, 40)}..."`);
        this.lastText = text;
        this.onTextSelected?.(text);
      }
    } catch {
      // 剪贴板不可用时静默忽略
    }
  }

  /** 暂停一次检测（工具栏显示后避免重复触发）。 */
  public pauseOne(): void {
    // 直接更新 lastText 为当前剪贴板内容，避免下次轮询重复触发
    try {
      this.lastText = clipboard.readText();
    } catch {
      // ignore
    }
  }
}