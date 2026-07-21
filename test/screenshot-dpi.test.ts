/**
 * ScreenshotManager DPI 缩放裁剪数学测试（I-03）。
 * 验证 getImageData(rect, scaleFactor) 的裁剪坐标 = rect × scaleFactor（整数化），
 * 以及 getScaleFactorForRect(rect) 取选区中心所在屏 scaleFactor（跨屏 / 回退）。
 * 通过 jest.mock('electron') 提供受控的 desktopCapturer / screen，并拦截
 * source.thumbnail.crop(crop) 捕获真实的裁剪矩形做纯数值断言。
 * 标注合成 composeAnnotated（依赖 overlay 渲染层 canvas）属「待实机验证」，此处不测。
 */
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '../src/main/ipc/channels';

// 隔离 screenshotOverlay：提供可控的 overlay webContents，便于断言「背景图发送时机」。
jest.mock('../src/main/windows/screenshotOverlay', () => {
  const wc = { send: jest.fn(), isDestroyed: () => false };
  (global as { __OVERLAY_WC__?: unknown }).__OVERLAY_WC__ = wc;
  return {
    showOverlay: jest.fn(),
    hideOverlay: jest.fn(),
    getOverlayWebContents: jest.fn(() => wc),
    onOverlayClosed: jest.fn(),
  };
});

jest.mock('electron', () => {
  const f = require('fs') as typeof fs;
  const os = require('os');
  const p = require('path') as typeof path;
  const dir = f.mkdtempSync(p.join(os.tmpdir(), 'ds-dpi-'));
  (global as { __DS_DPI__?: string }).__DS_DPI__ = dir;

  // 捕获 crop 入参，供断言「裁剪坐标 = rect × scaleFactor」。
  (global as { __CROP__?: unknown }).__CROP__ = null;
  const fakeImg = { toPNG: () => Buffer.from(''), toDataURL: () => 'data:' };
  const source = {
    display_id: '1',
    thumbnail: {
      crop: (c: unknown) => {
        (global as { __CROP__?: unknown }).__CROP__ = c;
        return fakeImg;
      },
      // sendOverlayBackground 调用 thumbnail.toDataURL() 生成背景图 dataURL
      toDataURL: () => 'data:image/png;base64,FAKEBG',
    },
  };

  const desktopCapturer = { getSources: jest.fn().mockResolvedValue([source]) };
  const nativeImage = {
    createFromDataURL: jest.fn(() => fakeImg),
    createFromPath: jest.fn(() => fakeImg),
  };
  const makeDisplay = (id: string, scaleFactor: number) => ({
    id,
    scaleFactor,
    size: { width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    workAreaSize: { width: 1920, height: 1080 },
  });
  const screen = {
    getPrimaryDisplay: jest.fn(() => makeDisplay('1', 2)),
    getAllDisplays: jest.fn(() => [makeDisplay('1', 2)]),
    getDisplayMatching: jest.fn(() => makeDisplay('1', 2)),
  };

  class BrowserWindow {
    constructor() {}
    public loadFile(): void {}
    public on(): void {}
    public once(): void {}
  }
  class WebContentsView {
    public webContents = { send: jest.fn(), on: jest.fn(), loadURL: jest.fn() };
  }

  return {
    app: { getPath: jest.fn(() => dir), getName: jest.fn(() => 'DeepSeek') },
    desktopCapturer,
    nativeImage,
    screen,
    clipboard: { writeImage: jest.fn() },
    BrowserWindow,
    WebContentsView,
    nativeTheme: { themeSource: '', shouldUseDarkColors: false, on: () => {}, off: () => {} },
  };
});

import { ScreenshotManager } from '../src/main/screenshot/ScreenshotManager';
import { ConfigStore } from '../src/main/config/ConfigStore';
import type { ScreenshotRect } from '../src/shared/types';

const electron = require('electron');
function lastCrop(): { x: number; y: number; width: number; height: number } {
  return (global as { __CROP__?: { x: number; y: number; width: number; height: number } }).__CROP__ as never;
}

const cfg = new ConfigStore();

/** 让 getDisplayMatching 返回指定屏（含 scaleFactor 与 id 映射）。 */
function setMatching(scaleFactor: number, id = '1'): void {
  (electron.screen.getDisplayMatching as jest.Mock).mockReturnValue({
    id,
    scaleFactor,
    size: { width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    workAreaSize: { width: 1920, height: 1080 },
  });
}

beforeEach(() => {
  (global as { __CROP__?: unknown }).__CROP__ = null;
});

afterAll(() => {
  const dir = (global as { __DS_DPI__?: string }).__DS_DPI__;
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('ScreenshotManager - DPI 缩放裁剪数学（I-03）', () => {
  test('getImageData 裁剪坐标 = 整数化(rect × scaleFactor)', async () => {
    const sm = new ScreenshotManager(cfg);
    await sm.captureSources();
    setMatching(2);
    const rect: ScreenshotRect = { x: 10, y: 20, width: 100, height: 50 };
    const img = sm.getImageData(rect, 2);
    expect(img).toBeTruthy();
    // x=20, y=40, width=200, height=100
    expect(lastCrop()).toEqual({ x: 20, y: 40, width: 200, height: 100 });
  });

  test('高 DPI 1.25 倍精确缩放（含四舍五入）', async () => {
    const sm = new ScreenshotManager(cfg);
    await sm.captureSources();
    setMatching(1.25);
    const rect: ScreenshotRect = { x: 5, y: 5, width: 40, height: 30 };
    sm.getImageData(rect, 1.25);
    // x=round(6.25)=6, y=6, width=round(50)=50, height=round(37.5)=38
    expect(lastCrop()).toEqual({ x: 6, y: 6, width: 50, height: 38 });
  });

  test('getScaleFactorForRect 取选区中心所在屏 scaleFactor（跨屏）', () => {
    const sm = new ScreenshotManager(cfg);
    (electron.screen.getDisplayMatching as jest.Mock).mockReturnValue({
      id: '2',
      scaleFactor: 1.5,
      size: { width: 1920, height: 1080 },
      workArea: { x: 1920, y: 0, width: 1920, height: 1080 },
      workAreaSize: { width: 1920, height: 1080 },
    });
    expect(sm.getScaleFactorForRect({ x: 2000, y: 100, width: 50, height: 50 })).toBe(1.5);
  });

  test('getScaleFactorForRect 在 getDisplayMatching 抛错时回退主屏 scaleFactor', () => {
    const sm = new ScreenshotManager(cfg);
    (electron.screen.getDisplayMatching as jest.Mock).mockImplementation(() => {
      throw new Error('no display');
    });
    (electron.screen.getPrimaryDisplay as jest.Mock).mockReturnValue({
      id: '1',
      scaleFactor: 2,
      size: { width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      workAreaSize: { width: 1920, height: 1080 },
    });
    expect(sm.getScaleFactorForRect({ x: 0, y: 0, width: 10, height: 10 })).toBe(2);
  });

  test('getImageData 在 sources 为空时返回 null 不崩溃', () => {
    const sm = new ScreenshotManager(cfg);
    // 未调用 captureSources，sources 为空
    expect(sm.getImageData({ x: 0, y: 0, width: 10, height: 10 }, 2)).toBeNull();
  });
});

/**
 * 回归：截图遮罩背景图发送时序（修复竞态）。
 * 旧实现：startCapture() 在 showOverlay() 之后立即 send 背景图，而此时 overlay 渲染进程
 * （loadFile 异步）尚未执行 overlay.js，监听器未注册，webContents.send 直接丢弃消息，
 * 导致 #bg.src 永远为空，全屏应用下黑屏修复实际失效。
 * 新实现：仅在 overlay 渲染进程就绪（发 overlay:ready）后，由主进程下发背景图。
 */
describe('ScreenshotManager - 背景图发送时序（修复竞态）', () => {
  function overlayWc(): { send: jest.Mock; isDestroyed: () => boolean } {
    return (global as { __OVERLAY_WC__?: { send: jest.Mock; isDestroyed: () => boolean } }).__OVERLAY_WC__ as never;
  }
  function bgSendCount(): number {
    return overlayWc().send.mock.calls.filter((c) => c[0] === IPC.OVERLAY_SET_BACKGROUND_IMAGE).length;
  }

  test('startCapture 不在 overlay 就绪前发送背景图（避免消息被丢弃）', async () => {
    const sm = new ScreenshotManager(cfg);
    await sm.captureSources();
    await sm.startCapture();
    // 渲染进程尚未就绪（overlay:ready 未到），不应提前发送背景图。
    expect(bgSendCount()).toBe(0);
  });

  test('overlay 就绪后（OVERLAY_READY 处理）才下发全屏背景图 dataURL', async () => {
    const sm = new ScreenshotManager(cfg);
    await sm.captureSources();
    await sm.startCapture();
    overlayWc().send.mockClear();

    // 模拟 handlers 收到 overlay:ready 后的处理：调用 sendOverlayBackground()。
    sm.sendOverlayBackground();

    const calls = overlayWc().send.mock.calls.filter((c) => c[0] === IPC.OVERLAY_SET_BACKGROUND_IMAGE);
    expect(calls).toHaveLength(1);
    const dataUrl = calls[0][1] as string;
    expect(typeof dataUrl).toBe('string');
    expect(dataUrl.startsWith('data:')).toBe(true);
  });
});
