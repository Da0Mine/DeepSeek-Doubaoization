/**
 * 共享屏幕管理器：在共享屏幕模式下，用户每次按 Enter 发送消息时，
 * 先截取全屏截图，再将截图作为图片上传到对话框，与消息一起发送。
 * 四角显示蓝色对角框指示器，任务栏上方显示「正在共享屏幕」按钮。
 */
import { BrowserWindow, desktopCapturer, screen } from 'electron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { WindowManager } from '../windows/WindowManager';
import type { Injector } from '../inject/Injector';
import { logf } from '../logger';
import { SCREEN_SHARE_TASKBAR_PRELOAD } from '../constants';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class ScreenShareManager {
  private active = false;
  private indicatorWin: BrowserWindow | null = null;
  private taskbarWin: BrowserWindow | null = null;
  private windows?: WindowManager;
  private injector?: Injector;

  /** 注入依赖 */
  public setDependencies(windows: WindowManager, injector: Injector): void {
    this.windows = windows;
    this.injector = injector;
  }

  /** 是否处于共享屏幕模式 */
  public isActive(): boolean {
    return this.active;
  }

  /** 进入共享屏幕模式 */
  public start(): void {
    if (this.active) return;
    this.active = true;
    this.showIndicators();
    this.showTaskbarButton();
    this.injectEnterInterceptor();
    logf('ScreenShare', '进入共享屏幕模式');
  }

  /** 退出共享屏幕模式 */
  public stop(): void {
    if (!this.active) return;
    this.active = false;
    this.hideIndicators();
    this.hideTaskbarButton();
    this.removeEnterInterceptor();
    logf('ScreenShare', '退出共享屏幕模式');
  }

  /** 切换共享屏幕模式 */
  public toggle(): void {
    if (this.active) this.stop();
    else this.start();
  }

  /** 显示四角指示器 */
  private showIndicators(): void {
    if (this.indicatorWin && !this.indicatorWin.isDestroyed()) return;

    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.bounds;

    this.indicatorWin = new BrowserWindow({
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
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // 设置鼠标穿透，让点击能穿透到下面的窗口
    this.indicatorWin.setIgnoreMouseEvents(true, { forward: true });

    // 加载指示器 HTML
    const htmlPath = path.join(__dirname, '..', '..', 'renderer', 'screenShare', 'indicators.html');
    this.indicatorWin.loadFile(htmlPath);

    this.indicatorWin.once('ready-to-show', () => {
      if (this.indicatorWin && !this.indicatorWin.isDestroyed()) {
        this.indicatorWin.show();
        this.indicatorWin.setAlwaysOnTop(true, 'screen-saver');
      }
    });

    this.indicatorWin.on('closed', () => {
      this.indicatorWin = null;
    });
  }

  /** 显示任务栏按钮 */
  private showTaskbarButton(): void {
    if (this.taskbarWin && !this.taskbarWin.isDestroyed()) return;

    const display = screen.getPrimaryDisplay();
    const { width } = display.bounds;
    const workArea = display.workArea;
    // 按钮底部放在工作区底部上方 6px（即任务栏顶部上方 6px）
    const btnY = workArea.y + workArea.height - 56;

    // 任务栏按钮窗口：小尺寸，位于屏幕底部中央（任务栏正上方）
    this.taskbarWin = new BrowserWindow({
      width: 200,
      height: 50,
      x: Math.round(width / 2 - 100),
      y: btnY,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: SCREEN_SHARE_TASKBAR_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // 加载任务栏按钮 HTML
    const htmlPath = path.join(__dirname, '..', '..', 'renderer', 'screenShare', 'taskbarButton.html');
    this.taskbarWin.loadFile(htmlPath);

    this.taskbarWin.once('ready-to-show', () => {
      if (this.taskbarWin && !this.taskbarWin.isDestroyed()) {
        this.taskbarWin.show();
        this.taskbarWin.setAlwaysOnTop(true, 'screen-saver');
      }
    });

    this.taskbarWin.on('closed', () => {
      this.taskbarWin = null;
    });
  }

  /** 隐藏指示器 */
  private hideIndicators(): void {
    if (this.indicatorWin && !this.indicatorWin.isDestroyed()) {
      this.indicatorWin.close();
    }
    this.indicatorWin = null;
  }

  /** 隐藏任务栏按钮 */
  private hideTaskbarButton(): void {
    if (this.taskbarWin && !this.taskbarWin.isDestroyed()) {
      this.taskbarWin.close();
    }
    this.taskbarWin = null;
  }

  /** 临时隐藏指示器和本软件窗口（截图前调用） */
  public hideIndicatorsTemporarily(): void {
    if (this.indicatorWin && !this.indicatorWin.isDestroyed()) {
      this.indicatorWin.hide();
    }
    if (this.taskbarWin && !this.taskbarWin.isDestroyed()) {
      this.taskbarWin.hide();
    }
    // 隐藏本软件所有窗口，避免被截进截图里
    this.windows?.hideChatWindowsForScreenshot();
  }

  /** 恢复指示器和本软件窗口显示（截图后调用） */
  public restoreIndicators(): void {
    if (this.indicatorWin && !this.indicatorWin.isDestroyed() && this.active) {
      this.indicatorWin.show();
    }
    if (this.taskbarWin && !this.taskbarWin.isDestroyed() && this.active) {
      this.taskbarWin.show();
    }
    // 恢复本软件窗口
    this.windows?.restoreChatWindowsAfterScreenshot();
  }

  /** 注入 Enter 键拦截器到当前活跃的 webview */
  private injectEnterInterceptor(): void {
    const wc = this.windows?.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return;

    const code = `(() => {
      // 版本号机制：每次注入递增版本号，旧拦截器自动失效
      window.__dsScreenShareVersion = (window.__dsScreenShareVersion || 0) + 1;
      var ver = window.__dsScreenShareVersion;
      window.__dsScreenShareActive = true;

      // 查找输入框
      function findInput() {
        return document.querySelector('textarea') ||
               document.querySelector('[contenteditable="true"]') ||
               document.querySelector('[role="textbox"]');
      }

      // 在输入框上直接拦截 keydown 事件（目标阶段），确保 React 也无法处理
      var input = findInput();
      if (input) {
        input.addEventListener('keydown', function(e) {
          if (!window.__dsScreenShareActive || window.__dsScreenShareVersion !== ver) return;
          if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }, false);
      }

      // 同时在 document 捕获阶段拦截（兜底，防止事件冒泡到 React 委托）
      document.addEventListener('keydown', function(e) {
        if (!window.__dsScreenShareActive || window.__dsScreenShareVersion !== ver) return;
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        // 处理锁：防止并发重复提交
        if (window.__dsScreenShareProcessing) return;

        var input = findInput();
        if (!input) return;

        // 检查输入框是否有内容
        var text = '';
        if (input.tagName === 'TEXTAREA') {
          text = input.value;
        } else {
          text = input.textContent || '';
        }
        if (!text.trim()) return;

        // 立即阻止所有后续事件处理
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // 锁定处理，防止并发重复提交
        window.__dsScreenShareProcessing = true;

        // 将输入框置为只读，彻底阻止页面处理任何输入
        input.readOnly = true;

        // 通知主进程：需要截屏+上传+发送
        if (window.__ds && window.__ds.send) {
          window.__ds.send('screenShare:enterPressed', { text: text });
        }

        // 清空输入框
        if (input.tagName === 'TEXTAREA') {
          input.value = '';
        } else {
          input.textContent = '';
        }

        // 5s 超时自动解锁（防止异常卡死）
        setTimeout(function() {
          window.__dsScreenShareProcessing = false;
          var inp = findInput();
          if (inp) inp.readOnly = false;
        }, 5000);

        return false;
      }, true);

      return true;
    })()`;

    wc.executeJavaScript(code).catch((e) => {
      console.error('[ScreenShare] 注入拦截器失败:', e);
    });
  }

  /** 移除 Enter 键拦截器 */
  private removeEnterInterceptor(): void {
    const wc = this.windows?.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return;

    wc.executeJavaScript(`
      window.__dsScreenShareInterceptor = false;
      window.__dsScreenShareActive = false;
      // 恢复输入框 readonly 状态
      var input = document.querySelector('textarea');
      if (input) input.readOnly = false;
      var input2 = document.querySelector('[contenteditable="true"]');
      if (input2) input2.readOnly = false;
    `).catch(() => {});
  }

  /** 主副窗口切换后重新绑定拦截器到新活跃的 webview */
  public rebindInterceptor(): void {
    if (!this.active) return;
    // 移除旧拦截器
    this.removeEnterInterceptor();
    // 延迟后重新注入到新活跃窗口
    setTimeout(() => {
      this.injectEnterInterceptor();
    }, 300);
  }

  /** 处理 Enter 键按下事件：截屏 + 上传 + 发送 */
  public async handleEnterPressed(text: string): Promise<void> {
    const wc = this.windows?.getActiveWebContents();
    if (!wc || wc.isDestroyed() || !this.injector) return;

    console.time('screenShare:total');
    try {
      // 1. 隐藏指示器
      console.time('screenShare:hide');
      this.hideIndicatorsTemporarily();
      await sleep(30);
      console.timeEnd('screenShare:hide');

      // 2. 截取全屏
      console.time('screenShare:capture');
      const img = await this.captureFullScreen();
      console.timeEnd('screenShare:capture');
      if (!img) {
        logf('ScreenShare', '截屏失败');
        this.restoreIndicators();
        return;
      }

      // 3. 保存为临时文件
      console.time('screenShare:save');
      const tempPath = this.saveTempImage(img);
      console.timeEnd('screenShare:save');
      if (!tempPath) {
        logf('ScreenShare', '保存临时图片失败');
        this.restoreIndicators();
        return;
      }

      // 4. 恢复输入框 readonly 状态（必须在 submitToChat 之前，否则 React 不会启用发送按钮）
      try {
        await wc.executeJavaScript(`var input = document.querySelector('textarea'); if (input) input.readOnly = false;`);
      } catch {}

      // 5. 上传图片 + 填入文本 + 点击发送（使用 submitToChat 一次性完成）
      console.time('screenShare:submitToChat');
      const ok = await this.injector.submitToChat(wc, text, tempPath);
      console.timeEnd('screenShare:submitToChat');
      if (!ok) {
        logf('ScreenShare', '发送失败');
        this.restoreIndicators();
        return;
      }

      // 6. 恢复输入框 readonly 状态和处理锁
      try {
        wc.executeJavaScript(`var input = document.querySelector('textarea'); if (input) input.readOnly = false; window.__dsScreenShareProcessing = false;`).catch(() => {});
      } catch {}

      // 6. 恢复指示器
      this.restoreIndicators();

      // 7. 清理临时文件
      try { fs.unlinkSync(tempPath); } catch {}

      console.timeEnd('screenShare:total');
      logf('ScreenShare', '消息+截图已发送');
    } catch (e) {
      console.error('[ScreenShare] 处理 Enter 事件失败:', e);
      this.restoreIndicators();
    }
  }

  /** 截取全屏 */
  private async captureFullScreen(): Promise<Electron.NativeImage | null> {
    try {
      const primary = screen.getPrimaryDisplay();
      const thumbSize = {
        width: Math.round(primary.size.width * primary.scaleFactor),
        height: Math.round(primary.size.height * primary.scaleFactor),
      };

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: thumbSize,
      });

      if (sources.length === 0) return null;
      return sources[0].thumbnail;
    } catch (e) {
      console.error('[ScreenShare] 截屏异常:', e);
      return null;
    }
  }

  /** 保存图片到临时文件 */
  private saveTempImage(img: Electron.NativeImage): string | null {
    try {
      const tempDir = path.join(os.tmpdir(), 'deepseek-screen-share');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const filePath = path.join(tempDir, `screenshot-${Date.now()}.png`);
      fs.writeFileSync(filePath, img.toPNG());
      return filePath;
    } catch (e) {
      console.error('[ScreenShare] 保存临时图片失败:', e);
      return null;
    }
  }
}
