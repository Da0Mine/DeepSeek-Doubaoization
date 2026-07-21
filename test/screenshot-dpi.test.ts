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
