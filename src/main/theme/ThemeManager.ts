/**
 * 主题管理（基于 nativeTheme + CSS 变量）。
 * 支持 light / dark / system；作用对象为标题栏与外壳 CSS。
 * 监听系统主题变化，并通过 broadcaster 将 CSS 变量下发到所有外壳窗口。
 */
import { nativeTheme } from 'electron';
import type { ThemeMode, ThemeVars } from '../../shared/types';

export type ThemeBroadcaster = (vars: ThemeVars) => void;

export class ThemeManager {
  private broadcaster: ThemeBroadcaster | null = null;
  private systemListener: (() => void) | null = null;

  /** 设置 CSS 变量下发器（由主进程注入，遍历所有外壳窗口 webContents.send）。 */
  public setBroadcaster(fn: ThemeBroadcaster): void {
    this.broadcaster = fn;
  }

  /** 应用主题：system 时跟随系统，否则强制 light/dark。 */
  public applyTheme(mode: ThemeMode): void {
    nativeTheme.themeSource = mode;
    this.broadcast();
  }

  /** 监听系统主题变化（仅在 system 模式下有意义，但始终转发）。 */
  public onSystemThemeChange(cb: () => void): void {
    if (this.systemListener) {
      nativeTheme.off('updated', this.systemListener);
    }
    this.systemListener = () => {
      cb();
      this.broadcast();
    };
    nativeTheme.on('updated', this.systemListener);
  }

  /** 生成当前主题对应的 CSS 变量集合。 */
  public getCssVars(): ThemeVars {
    const dark = nativeTheme.shouldUseDarkColors;
    return {
      '--ds-bg': dark ? '#1e1e1e' : '#ffffff',
      '--ds-fg': dark ? '#f2f2f2' : '#1f1f1f',
      '--ds-tb-bg': dark ? '#2a2a2a' : '#f3f3f3',
      '--ds-tb-fg': dark ? '#e8e8e8' : '#333333',
      '--ds-border': dark ? '#3a3a3a' : '#e0e0e0',
      '--ds-accent': dark ? '#4f8cff' : '#3370ff',
      '--ds-overlay': dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)',
    };
  }

  private broadcast(): void {
    if (this.broadcaster) {
      this.broadcaster(this.getCssVars());
    }
  }
}
