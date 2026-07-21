/**
 * 截图管理：基于 desktopCapturer 截屏、选区裁剪、标注合成、落盘、剪贴板。
 * - 修正高 DPI：thumbnail 以主屏「设备像素」尺寸采集，裁剪坐标 = 选区 × scaleFactor（I-03）。
 * - 标注合成：composeAnnotated 委托渲染层（overlay）在截图上绘制标注并返回合成图（I-05）。
 */
import { clipboard, desktopCapturer, nativeImage, screen } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Annotation, ScreenshotRect } from '../../shared/types';
import type { ConfigStore } from '../config/ConfigStore';
import { IPC } from '../ipc/channels';
import { showOverlay, hideOverlay, getOverlayWebContents, onOverlayClosed } from '../windows/screenshotOverlay';
import type { WindowManager } from '../windows/WindowManager';

export class ScreenshotManager {
  private sources: Electron.DesktopCapturerSource[] = [];
  /** display_id -> source 映射，用于按选区归属屏选取对应 source。 */
  private sourceByDisplay: Map<string, Electron.DesktopCapturerSource> = new Map();
  private selectedRect: ScreenshotRect | null = null;
  private lastImage: Electron.NativeImage | null = null;
  private counter = 0;
  private composeResolver: ((dataUrl: string) => void) | null = null;

  private windows?: WindowManager;

  constructor(private readonly config: ConfigStore) {
    // 遮罩关闭（取消 / 选区完成）时恢复被隐藏的应用窗口
    onOverlayClosed(() => this.windows?.restoreChatWindowsAfterScreenshot());
  }

  /** 注入 WindowManager 引用（用于截图期间隐藏 / 恢复应用窗口）。 */
  public setWindowManager(w: WindowManager): void {
    this.windows = w;
  }

  /** 开始截图流程：先隐藏应用窗口，再采集屏幕，最后弹出遮罩。 */
  public async startCapture(): Promise<void> {
    // 先隐藏应用自身窗口，避免它们被截进图里；给 Windows 合成器一帧时间确保生效
    this.windows?.hideChatWindowsForScreenshot();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await this.captureSources();
    showOverlay();
  }

  /**
   * 采集屏幕源。thumbnail 以主屏「设备像素」尺寸采集，使裁剪坐标 = 选区 × scaleFactor 精确对齐（I-03）。
   * 同时按 display_id 建立 source 映射，供多屏选区归属（I-03）。
   */
  public async captureSources(): Promise<Electron.DesktopCapturerSource[]> {
    const primary = screen.getPrimaryDisplay();
    const thumbSize = {
      width: Math.round(primary.size.width * primary.scaleFactor),
      height: Math.round(primary.size.height * primary.scaleFactor),
    };
    this.sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: thumbSize,
    });
    this.sourceByDisplay.clear();
    for (const s of this.sources) {
      if (s.display_id) this.sourceByDisplay.set(s.display_id, s);
    }
    return this.sources;
  }

  /** 记录用户选区（屏幕坐标，CSS 像素）。 */
  public selectRegion(rect: ScreenshotRect): void {
    this.selectedRect = rect;
  }

  /** 取选区中心所在屏的 scaleFactor（I-03）。 */
  public getScaleFactorForRect(rect: ScreenshotRect): number {
    try {
      const display = screen.getDisplayMatching({
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        width: 1,
        height: 1,
      });
      return display.scaleFactor;
    } catch (e) {
      return screen.getPrimaryDisplay().scaleFactor;
    }
  }

  /**
   * 按 scaleFactor 缩放裁剪（cropRect = rect × scaleFactor），rect 为 CSS 像素。
   * 选取选区归属屏对应的 source；找不到时回退主源。
   */
  public getImageData(rect: ScreenshotRect, scaleFactor: number): Electron.NativeImage | null {
    if (this.sources.length === 0) return null;
    const display = screen.getDisplayMatching({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      width: 1,
      height: 1,
    });
    const source =
      (display.id != null && this.sourceByDisplay.get(String(display.id))) ||
      this.sourceByDisplay.get(String(screen.getPrimaryDisplay().id)) ||
      this.sources[0];
    const norm = this.normalizeRect(rect);
    const crop = {
      x: Math.round(norm.x * scaleFactor),
      y: Math.round(norm.y * scaleFactor),
      width: Math.max(1, Math.round(norm.width * scaleFactor)),
      height: Math.max(1, Math.round(norm.height * scaleFactor)),
    };
    this.lastImage = source.thumbnail.crop(crop);
    return this.lastImage;
  }

  /**
   * 将标注合成进截图，返回合成图（I-05）。
   * 实际像素绘制在 overlay 渲染层完成（主进程无 canvas）；若 overlay 不可用则回退为未标注底图。
   */
  public async composeAnnotated(
    rect: ScreenshotRect,
    annotations: Annotation[]
  ): Promise<Electron.NativeImage | null> {
    const wc = getOverlayWebContents();
    if (wc && !wc.isDestroyed()) {
      try {
        const dataUrl = await new Promise<string>((resolve) => {
          this.composeResolver = resolve;
          wc.send(IPC.OVERLAY_COMPOSE, { annotations });
          // 超时兜底：若 overlay 未回应，回退底图。
          setTimeout(() => {
            if (this.composeResolver) {
              this.composeResolver('');
              this.composeResolver = null;
            }
          }, 2000);
        });
        if (dataUrl) return nativeImage.createFromDataURL(dataUrl);
      } catch (e) {
        console.error('[ScreenshotManager] 标注合成失败，回退底图:', e);
      }
    }
    const sf = this.getScaleFactorForRect(rect);
    return this.getImageData(rect, sf);
  }

  /** 由 handlers 在收到 overlay 合成结果时调用。 */
  public resolveCompose(dataUrl: string): void {
    if (this.composeResolver) {
      this.composeResolver(dataUrl);
      this.composeResolver = null;
    }
  }

  /** 选区 -> 裁剪 -> 落盘，返回文件路径。 */
  public async saveToFile(): Promise<string> {
    const img = this.lastImage;
    if (!img) throw new Error('截图失败：未获取到图像');
    const saveDir = this.resolveSaveDir();
    fs.mkdirSync(saveDir, { recursive: true });
    const fileName = `deepseek-screenshot-${Date.now()}-${++this.counter}.png`;
    const filePath = path.join(saveDir, fileName);
    fs.writeFileSync(filePath, img.toPNG());
    return filePath;
  }

  /** 把截图写入临时文件（供注入上传使用），返回路径。 */
  public writeTempImage(img: Electron.NativeImage): string {
    const tmpDir = path.join(os.tmpdir(), 'deepseek-screenshot');
    fs.mkdirSync(tmpDir, { recursive: true });
    const fileName = `shot-${crypto.randomBytes(6).toString('hex')}.png`;
    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, img.toPNG());
    return filePath;
  }

  /** 将最近一次截图写入剪贴板。 */
  public copyToClipboard(image?: Electron.NativeImage): void {
    const img = image ?? this.lastImage;
    if (img) clipboard.writeImage(img);
  }

  /** 保存选区并裁剪落盘（供 handlers 调用）。 */
  public async captureRegion(rect: ScreenshotRect): Promise<string> {
    this.selectRegion(rect);
    const sf = this.getScaleFactorForRect(rect);
    this.getImageData(rect, sf);
    return this.saveToFile();
  }

  /** 隐藏遮罩。 */
  public hideOverlayNow(): void {
    hideOverlay();
  }

  private resolveSaveDir(): string {
    const cfgPath = this.config.get('screenshotSavePath');
    if (cfgPath && cfgPath.trim().length > 0) {
      return cfgPath;
    }
    const pictures = path.join(os.homedir(), 'Pictures', 'DeepSeek');
    return pictures;
  }

  private normalizeRect(rect: ScreenshotRect): ScreenshotRect {
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    return { x, y, width, height };
  }
}
