/**
 * 全局快捷键管理（基于 electron.globalShortcut）。
 * 提供 register / unregister / unregisterAll / applyFromConfig。
 * onToggle / onScreenshot / onSummonSub 回调由主进程注入。
 */
import { globalShortcut } from 'electron';
import type { ConfigShape } from '../../shared/types';

export class ShortcutManager {
  private readonly registered: Set<string> = new Set();
  public onScreenshot: (() => void) | null = null;
  public onSummonSub: (() => void) | null = null;
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
    this.onError?.(`快捷键注册失败：${accel}（可能已被系统/其他软件占用）`);
    return false;
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

  /** 依据配置重新注册全部快捷键（副窗口呼出键 + 截图键）。注册失败保留已成功的集合并通知。
   *  注：主窗口「显隐主窗键」已移除（主窗口不需要一键呼出，改由托盘显隐）。 */
  public applyFromConfig(cfg: ConfigShape): void {
    this.unregisterAll();
    const map: Array<[string, (() => void) | null]> = [
      [cfg.screenshotShortcut, this.onScreenshot],
      [cfg.subWindowShortcut, this.onSummonSub],
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
