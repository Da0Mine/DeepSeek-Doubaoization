/**
 * 全局快捷键管理（基于 electron.globalShortcut）。
 * 提供 register / unregister / unregisterAll / applyFromConfig。
 * onToggle / onScreenshot / onSummonSub 回调由主进程注入。
 */
import { globalShortcut } from 'electron';
import type { ConfigShape } from '../../shared/types';

export class ShortcutManager {
  private readonly registered: Set<string> = new Set();
  private readonly failed: string[] = [];
  public onScreenshot: (() => void) | null = null;
  public onSummonSub: (() => void) | null = null;
  public onToggleTextSelection: (() => void) | null = null;
  /** 一键开关屏幕共享（主进程注入）。 */
  public onToggleScreenShare: (() => void) | null = null;
  /** 一键呼出「共享WPS文档」选择器（主进程注入）。 */
  public onToggleDocShare: (() => void) | null = null;
  /** 注册失败回调（非法 / OS 占用）：由主进程弹通知。 */
  public onError: ((msg: string) => void) | null = null;

  /** 注册快捷键，返回是否成功（重复注册会先注销旧项）。 */
  public register(accel: string, cb: () => void): boolean {
    if (!accel) return false;
    if (this.registered.has(accel)) {
      globalShortcut.unregister(accel);
      this.registered.delete(accel);
    }
    const ok = globalShortcut.register(accel, cb);
    if (ok) {
      this.registered.add(accel);
      return true;
    }
    // 记录占用失败的快捷键，供启动时弹覆盖窗提示
    if (!this.failed.includes(accel)) this.failed.push(accel);
    this.onError?.(`快捷键注册失败：${accel}（可能已被系统/其他软件占用）`);
    return false;
  }

  /** 返回最近一次 applyFromConfig 中注册失败的快捷键（供启动时检测提示）。 */
  public getFailedShortcuts(): string[] {
    return [...this.failed];
  }

  /** 注销单个快捷键。 */
  public unregister(accel: string): void {
    globalShortcut.unregister(accel);
    this.registered.delete(accel);
  }

  /** 注销全部。 */
  public unregisterAll(): void {
    globalShortcut.unregisterAll();
    this.registered.clear();
  }

  /** 依据配置重新注册全部快捷键（副窗口呼出键 + 截图键 + 划词开关）。注册失败保留已成功的集合并通知。 */
  public applyFromConfig(cfg: ConfigShape): void {
    this.failed.length = 0;
    this.unregisterAll();
    const map: Array<[string, (() => void) | null]> = [
      [cfg.screenshotShortcut, this.onScreenshot],
      [cfg.subWindowShortcut, this.onSummonSub],
      [cfg.textSelectionShortcut, this.onToggleTextSelection],
      [cfg.screenShareShortcut, this.onToggleScreenShare],
      [cfg.docShareShortcut, this.onToggleDocShare],
    ];
    for (const [accel, cb] of map) {
      if (accel && cb) this.register(accel, cb);
    }
  }

  /** 返回当前已注册快捷键集合（调试用）。 */
  public registeredList(): string[] {
    return Array.from(this.registered);
  }
}
