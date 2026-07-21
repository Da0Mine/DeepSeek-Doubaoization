/**
 * B 类临时窗口定位计算测试（I-07）。
 * computeBWindowBounds 为 bWindow.ts 内部私有函数，这里通过对导出工厂 createBWindow
 * 做桩测 + jest.mock('electron') 提供受控的 screen.getDisplayMatching，验证：
 *   - 优先放在 sourceRect 右侧；
 *   - 右侧越界则放左侧；
 *   - 垂直居中于选区并夹进屏幕工作区；
 *   - 9:16 比例（width*16 === height*9）；
 *   - 返回 bounds 始终落在所属屏幕工作区内（含跨屏场景）。
 * 属纯逻辑验证；真实 GUI 窗口弹出/渲染属「待实机验证」范畴。
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('electron', () => {
  const f = require('fs') as typeof fs;
  const os = require('os');
  const p = require('path') as typeof path;
  const dir = f.mkdtempSync(p.join(os.tmpdir(), 'ds-bwin-'));
  (global as { __DS_BWIN__?: string }).__DS_BWIN__ = dir;

  // 收集所有被 new 出来的 BrowserWindow，供断言读取其构造 options（含 x/y）。
  const wins: unknown[] = ((global as { __BW_LIST__?: unknown[] }).__BW_LIST__ = []);
  class BrowserWindow {
    public options: Record<string, unknown>;
    public webContents: Record<string, unknown>;
    public contentView: Record<string, unknown>;
    private destroyed = false;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.webContents = {
        send: jest.fn(),
        on: jest.fn(),
        loadURL: jest.fn(),
        isDestroyed: () => false,
        close: jest.fn(),
      };
      this.contentView = { addChildView: jest.fn(), removeChildView: jest.fn() };
      wins.push(this);
    }
    public loadFile(): void {}
    public on(): void {}
    public once(): void {} // 不触发 ready-to-show，避免实例化 ThemeManager
    public show(): void {}
    public focus(): void {}
    public hide(): void {}
    public close(): void {
      this.destroyed = true;
    }
    public isDestroyed(): boolean {
      return this.destroyed;
    }
    public isVisible(): boolean {
      return true;
    }
    public setAlwaysOnTop(): void {}
    public setTitle(): void {}
    public setPosition(): void {}
    public getPosition(): number[] {
      return [0, 0];
    }
    public getBounds(): Record<string, unknown> {
      return {
        width: this.options.width,
        height: this.options.height,
        x: this.options.x,
        y: this.options.y,
      };
    }
    public getContentSize(): number[] {
      return [Number(this.options.width) || 360, Number(this.options.height) || 640];
    }
    public setBackgroundColor(): void {}
  }

  class WebContentsView {
    public webContents: Record<string, unknown>;
    constructor() {
      this.webContents = {
        send: jest.fn(),
        on: jest.fn(),
        loadURL: jest.fn(),
        isDestroyed: () => false,
        close: jest.fn(),
      };
    }
    public setBounds(): void {}
  }

  const makeDisplay = (id: string, scaleFactor: number, workArea: Record<string, number>) => ({
    id,
    scaleFactor,
    size: { width: workArea.width, height: workArea.height },
    workArea,
    workAreaSize: { width: workArea.width, height: workArea.height },
  });

  const screen = {
    getPrimaryDisplay: jest.fn(() => makeDisplay('1', 2, { x: 0, y: 0, width: 1920, height: 1080 })),
    getAllDisplays: jest.fn(() => [makeDisplay('1', 2, { x: 0, y: 0, width: 1920, height: 1080 })]),
    getDisplayMatching: jest.fn(() => makeDisplay('1', 2, { x: 0, y: 0, width: 1920, height: 1080 })),
  };

  return {
    app: { getPath: jest.fn(() => dir), getName: jest.fn(() => 'DeepSeek') },
    BrowserWindow,
    WebContentsView,
    screen,
    nativeTheme: { themeSource: '', shouldUseDarkColors: false, on: () => {}, off: () => {} },
  };
});

import { createBWindow } from '../src/main/windows/bWindow';
import { ConfigStore } from '../src/main/config/ConfigStore';
import { B_WINDOW_WIDTH, B_WINDOW_HEIGHT } from '../src/main/constants';
import type { ScreenshotRect } from '../src/shared/types';

const electron = require('electron');

function createdWindows(): unknown[] {
  return (global as { __BW_LIST__?: unknown[] }).__BW_LIST__ || [];
}
function lastBWindow(): { options: { x: number; y: number; width: number; height: number } } {
  const list = createdWindows() as Array<{ options: { x: number; y: number; width: number; height: number } }>;
  return list[list.length - 1];
}

const cfg = new ConfigStore();

/** 设置 getDisplayMatching 返回指定工作区（模拟单屏 / 跨屏）。 */
function setMatchingScreen(workArea: { x: number; y: number; width: number; height: number }, scaleFactor = 2): void {
  (electron.screen.getDisplayMatching as jest.Mock).mockReturnValue({
    id: '1',
    scaleFactor,
    size: { width: workArea.width, height: workArea.height },
    workArea,
    workAreaSize: { width: workArea.width, height: workArea.height },
  });
}

beforeEach(() => {
  // 清空同一个数组引用（mock 的 BrowserWindow 向该引用 push，勿重新赋值）。
  const list = (global as { __BW_LIST__?: unknown[] }).__BW_LIST__;
  if (list) list.length = 0;
});

afterAll(() => {
  const dir = (global as { __DS_BWIN__?: string }).__DS_BWIN__;
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('B 窗口定位 - 经由 createBWindow 读取构造参数', () => {
  test('尺寸为 9:16（width*16 === height*9）', () => {
    setMatchingScreen({ x: 0, y: 0, width: 1920, height: 1080 });
    createBWindow({ x: 100, y: 100, width: 200, height: 150 }, cfg);
    const w = lastBWindow().options;
    expect(w.width).toBe(B_WINDOW_WIDTH);
    expect(w.height).toBe(B_WINDOW_HEIGHT);
    expect(w.width * 16).toBe(w.height * 9);
  });

  test('优先放在 sourceRect 右侧（不越界）', () => {
    setMatchingScreen({ x: 0, y: 0, width: 1920, height: 1080 });
    const rect: ScreenshotRect = { x: 100, y: 100, width: 200, height: 150 };
    createBWindow(rect, cfg);
    const { x, y } = lastBWindow().options;
    // x = rect.x + width + 12 = 312；右侧 312+342=654 ≤ 1920
    expect(x).toBe(312);
    // y = cy(175) - 304 = -129 → 垂直夹到 0
    expect(y).toBe(0);
    // 在屏内
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + B_WINDOW_WIDTH).toBeLessThanOrEqual(1920);
  });

  test('右侧越界则放左侧', () => {
    setMatchingScreen({ x: 0, y: 0, width: 1920, height: 1080 });
    const rect: ScreenshotRect = { x: 1800, y: 500, width: 100, height: 100 };
    createBWindow(rect, cfg);
    const { x, y } = lastBWindow().options;
    // 右: 1800+100+12=1912, +342=2254 > 1920 → 左: 1800-12-342=1446
    expect(x).toBe(1446);
    // y = cy(550) - 304 = 246
    expect(y).toBe(246);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + B_WINDOW_WIDTH).toBeLessThanOrEqual(1920);
  });

  test('垂直居中越上界则夹到屏幕顶部', () => {
    setMatchingScreen({ x: 0, y: 0, width: 1920, height: 1080 });
    const rect: ScreenshotRect = { x: 100, y: -300, width: 50, height: 50 };
    createBWindow(rect, cfg);
    const { x, y } = lastBWindow().options;
    expect(x).toBe(162); // 100+50+12
    expect(y).toBe(0); // cy=-275 → -577 → 夹 0
  });

  test('垂直居中越下界则夹到屏幕底部工作区', () => {
    setMatchingScreen({ x: 0, y: 0, width: 1920, height: 1080 });
    const rect: ScreenshotRect = { x: 100, y: 1000, width: 50, height: 50 };
    createBWindow(rect, cfg);
    const { x, y } = lastBWindow().options;
    expect(x).toBe(162);
    // cy=1025 → 1025-304=721 → 夹到 1080-608=472
    expect(y).toBe(1080 - B_WINDOW_HEIGHT);
  });

  test('跨屏：选区落在第二屏时窗口定位于该屏工作区内', () => {
    // 第二屏位于 x=1920 起，宽 1920；getDisplayMatching 按选区中心返回第二屏。
    (electron.screen.getDisplayMatching as jest.Mock).mockImplementation((r: ScreenshotRect) =>
      r.x >= 1920
        ? { id: '2', scaleFactor: 1, size: { width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1080 }, workAreaSize: { width: 1920, height: 1080 } }
        : { id: '1', scaleFactor: 2, size: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 }, workAreaSize: { width: 1920, height: 1080 } }
    );
    const rect: ScreenshotRect = { x: 1900, y: 100, width: 100, height: 100 };
    createBWindow(rect, cfg);
    const { x, y } = lastBWindow().options;
    // 右: 1900+100+12=2012, +342=2354 ≤ 3840 → 2012；落在第二屏 [1920,3840]
    expect(x).toBe(2012);
    expect(y).toBe(0);
    expect(x).toBeGreaterThanOrEqual(1920);
    expect(x + B_WINDOW_WIDTH).toBeLessThanOrEqual(3840);
  });
});
