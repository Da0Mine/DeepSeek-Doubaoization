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
    // 仅弹出遮罩；背景图不在此时发送——overlay 渲染进程就绪后会发 overlay:ready，
    // 主进程收到后才下发背景图，避免 webContents.send 早于监听器注册被丢弃（竞态会导致黑屏修复失效）。
    showOverlay();
  }

  /**
   * 取主屏 source 的完整 thumbnail（设备像素尺寸）转 dataURL，下发给 overlay 作为遮罩背景。
   * overlay 窗口大小 = 主屏 display.bounds（逻辑像素），而 thumbnail = bounds × scaleFactor，
   * 故渲染层用 CSS object-fit: cover 即可铺满（宽高比一致，精确对齐）。
   * 透明窗口在全屏独占（视频/游戏）下 DWM 合成失效会变黑，铺背景图可彻底规避。
   * 注意：本方法只在收到 overlay:ready（渲染进程已注册监听）后由 handlers 调用（见 ScreenshotManager/README）。
   */
  public sendOverlayBackground(): void {
    const primary = screen.getPrimaryDisplay();
    const source: Electron.DesktopCapturerSource | undefined =
      (primary.id != null && this.sourceByDisplay.get(String(primary.id))) || this.sources[0];
    if (!source) return;
    const dataUrl = source.thumbnail.toDataURL();
    const wc = getOverlayWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send(IPC.OVERLAY_SET_BACKGROUND_IMAGE, dataUrl);
    }
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

  /** 把截图写入临时文件（供注入上传使用，如「发送到对话/新对话」），返回路径。 */
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

  /**
   * 隐藏遮罩。
   * 注：screenshotSavePath 配置项已移除，截图不再落盘到任何路径（仅发送到剪贴板 / 对话）。
   * 原 saveToFile / captureRegion / resolveSaveDir 的落盘逻辑已一并移除。
   */
  public hideOverlayNow(): void {
    hideOverlay();
  }

  private normalizeRect(rect: ScreenshotRect): ScreenshotRect {
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    return { x, y, width, height };
  }
}
