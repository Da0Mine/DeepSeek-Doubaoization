/**
 * 使用说明引导（Onboarding）：覆盖在主窗口上的透明引导层，
 * 用半透明遮罩 + 高亮框聚焦到相应 UI（标题栏按钮 / 聊天页内注入按钮），
 * 旁配毛玻璃说明卡片，引导用户了解主副切换、快捷键、划词、共享屏幕等功能。
 *
 * 实现：独立透明 BrowserWindow（parent 关联主窗口，跟随移动/隐藏/关闭），
 * 通过 win.setIgnoreMouseEvents(true, { forward: true }) 实现点击穿透——
 * 遮罩区域点击直达主界面（不影响用户正常操作）；渲染进程根据鼠标是否位于
 * 说明卡片内动态切换交互状态，保证「结束 / 上一步 / 下一步」按钮可点击。
 */
import { BrowserWindow } from 'electron';
import { ONBOARDING_HTML, SHELL_PRELOAD, TITLEBAR_HEIGHT } from '../constants';
import { IPC } from '../ipc/channels';
import type { ConfigStore } from '../config/ConfigStore';
import type { WindowManager } from '../windows/WindowManager';
import type { OnboardingFocus } from '../../shared/types';

/** 高亮目标描述。 */
interface HighlightSpec {
  kind: 'titlebar' | 'titlebar-btn' | 'chat-el';
  /** kind 为 titlebar-btn / chat-el 时对应的元素 id。 */
  id?: string;
}

interface OnboardingStep {
  /** 步骤标识（用于特殊高亮逻辑）。 */
  key?: string;
  title: string;
  body: string;
  highlight?: HighlightSpec;
  /** 演示动画类型：textSelection=划词演示，subWindow=副窗口呼出演示。 */
  demo?: 'textSelection' | 'subWindow';
  /** 说明卡片摆放：'left'=固定屏幕左侧（避免遮挡演示/菜单），默认自动跟随高亮。 */
  cardPos?: 'left';
}

/** 引导步骤（顺序推进）。 */
const STEPS: OnboardingStep[] = [
  {
    title: '欢迎使用 DeepSeek-Doubaoization 桌面端',
    body: '接下来用几步带你认识核心功能，让日常使用更顺手。点击「下一步」继续，随时可点「结束」跳过。',
  },
  {
    key: 'swap',
    title: '主副窗口切换',
    body: '点击标题栏右侧的 ⇄ 按钮，可在主窗口与副窗口之间来回切换。副窗口更适合边查边聊、多任务并行。',
    highlight: { kind: 'titlebar-btn', id: 'btn-swap' },
  },
  {
    key: 'sub-shortcut',
    title: '一键呼出副窗口',
    body: '无论你在哪个应用，按下 左 Alt + 空格 即可一键呼出或隐藏副窗口，随叫随到。',
    demo: 'subWindow',
  },
  {
    key: 'screenshot',
    title: '一键截图提问',
    body: '按 左 Alt + C 唤起截图，或点击聊天框旁的剪刀按钮。截取后可翻译、提取文字、解释或直接向 AI 提问。',
    highlight: { kind: 'chat-el', id: 'ds-scissors-btn' },
  },
  {
    key: 'text-selection',
    title: '划词即用',
    body: '选中任意文字（无需任何快捷键），划词工具栏会自动弹出，支持复制、翻译、解释、问问 DeepSeek。',
    demo: 'textSelection',
  },
  {
    key: 'screen-share',
    title: '共享屏幕与文档',
    body: '点击聊天框旁的 + 按钮，可「共享屏幕」或共享 WPS Word / Excel / PDF 文档。发送消息时会自动附带当前屏幕截图或所选文档，方便远程演示与求助。',
    cardPos: 'left',
  },
  {
    key: 'done',
    title: '开始使用吧',
    body: '以上就是核心功能。之后可随时在 设置 → 帮助 → 使用说明 中重新查看。祝你使用愉快！',
    highlight: { kind: 'titlebar-btn', id: 'btn-settings' },
  },
];

export class OnboardingManager {
  private win: BrowserWindow | null = null;
  private stepIndex = 0;
  /** 步骤下发序号：仅最新一次请求的结果会发送，避免异步 computeFocus 乱序导致界面错乱。 */
  private focusSeq = 0;
  private interactive = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  /** 结束引导时的回调。 */
  public onClosed: (() => void) | null = null;

  constructor(
    private readonly config: ConfigStore,
    private readonly windows: WindowManager
  ) {}

  /** 引导层是否已打开。 */
  public isOpen(): boolean {
    return !!(this.win && !this.win.isDestroyed());
  }

  /** 打开引导（已打开则回到当前步骤并显示）。 */
  public open(): void {
    const main = this.windows.getMainWindow();
    if (!main || !main.win || main.win.isDestroyed()) return;
    const host = main.win;

    if (this.isOpen()) {
      if (!this.win!.isVisible()) this.win!.show();
      this.win!.focus();
      this.sendFocus(this.stepIndex);
      return;
    }

    // 覆盖主窗口的透明引导层（parent 关联：跟随主窗口移动 / 隐藏 / 关闭）
    const win = new BrowserWindow({
      parent: host,
      x: host.getBounds().x,
      y: host.getBounds().y,
      width: host.getBounds().width,
      height: host.getBounds().height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: SHELL_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        additionalArguments: ['--window-type=onboarding'],
      },
    });
    this.win = win;

    // 默认点击穿透：遮罩不拦截鼠标；forward 将 mousemove 转发给渲染进程判断交互区域。
    this.applyIgnore(true);

    win.loadFile(ONBOARDING_HTML);
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        // showInactive：不抢走主窗口焦点，保证遮罩穿透后用户可直接操作主界面
        win.showInactive();
        this.sendFocus(this.stepIndex);
      }
    });
    win.on('closed', () => {
      this.win = null;
    });

    // 主窗口移动 / 缩放时同步引导层位置与尺寸
    host.on('move', this.syncBounds);
    host.on('resize', this.syncBounds);
    this.syncBounds();
  }

  /** 结束引导：关闭引导层并标记引导完成。 */
  public close(): void {
    // 若正停留在共享屏幕步骤，先收起其展开的加号菜单
    this.closePlusMenu();
    const host = this.windows.getMainWindow()?.win;
    if (host && !host.isDestroyed()) {
      host.removeListener('move', this.syncBounds);
      host.removeListener('resize', this.syncBounds);
    }
    if (this.win && !this.win.isDestroyed()) {
      this.win.close();
    }
    this.win = null;
    // 每次结束都复位到第 0 步：下次重新打开（设置 → 使用说明）从头开始
    this.stepIndex = 0;
    this.config.set('onboardingCompleted', true);
    this.onClosed?.();
  }

  /** 下一步。到达最后一步时再前进则结束引导。 */
  public next(): void {
    if (this.stepIndex >= STEPS.length - 1) {
      this.close();
      return;
    }
    this.closePlusMenu();
    this.stepIndex++;
    this.sendFocus(this.stepIndex);
  }

  /** 上一步。 */
  public prev(): void {
    if (this.stepIndex <= 0) return;
    this.closePlusMenu();
    this.stepIndex--;
    this.sendFocus(this.stepIndex);
  }

  /** 离开「共享屏幕」步骤时收起其展开的加号菜单（点击下一步/上一步/结束均触发）。 */
  private closePlusMenu(): void {
    if (STEPS[this.stepIndex]?.key !== 'screen-share') return;
    const v = this.windows.getMainWindow()?.view;
    if (!v || v.webContents.isDestroyed()) return;
    v.webContents
      .executeJavaScript(
        `(() => { const m = document.getElementById('ds-plus-menu'); if (m) m.style.display = 'none'; return true; })()`
      )
      .catch(() => {});
  }

  /** 渲染进程回报鼠标是否位于交互控件内，据此切换点击穿透。 */
  public setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    this.applyIgnore(interactive);
  }

  // ---------------- 内部实现 ----------------

  /** 点击穿透：interactive=true 时允许点击说明卡片控件；否则事件穿透到下层主界面。 */
  private applyIgnore(interactive: boolean): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    try {
      win.setIgnoreMouseEvents(!interactive, { forward: true });
    } catch {
      /* 平台不支持则保持默认 */
    }
  }

  /** 主窗口移动 / 缩放同步（防抖）。 */
  private syncBounds = (): void => {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      const host = this.windows.getMainWindow()?.win;
      const win = this.win;
      if (!host || host.isDestroyed() || !win || win.isDestroyed()) return;
      win.setBounds(host.getBounds());
    }, 0);
  };

  private sendFocus(index: number): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const wc = win.webContents;
    const seq = ++this.focusSeq;
    this.computeFocus(index).then((payload) => {
      // 仅最新请求的返回才下发：跳过被后续操作取代的旧请求（异步轮询可能慢于快速切步）
      if (seq === this.focusSeq && !wc.isDestroyed()) {
        wc.send(IPC.ONBOARDING_FOCUS, payload);
      }
    });
  }

  private async computeFocus(index: number): Promise<OnboardingFocus> {
    const step = STEPS[index];
    const base = {
      index,
      total: STEPS.length,
      title: step.title,
      body: step.body,
      fromRect: null as { x: number; y: number; width: number; height: number } | null,
      demo: step.demo ?? null,
      cardPos: step.cardPos ?? null,
      showPrev: index > 0,
      isLast: index === STEPS.length - 1,
    };
    // 共享屏幕步骤：点击加号展开菜单，高亮框从加号按钮移动到「共享屏幕」菜单项
    if (step.key === 'screen-share') {
      try {
        const rects = await this.getScreenShareFocus();
        return { ...base, rect: rects.rect, fromRect: rects.fromRect };
      } catch {
        return { ...base, rect: null, fromRect: null };
      }
    }
    if (!step.highlight) return { ...base, rect: null };
    try {
      const rect = await this.getHighlightRect(step.highlight);
      return { ...base, rect };
    } catch {
      // 目标元素未出现（如聊天页未加载完成）：仅展示文字，不高亮。
      return { ...base, rect: null };
    }
  }

  /**
   * 共享屏幕演示：读取加号按钮坐标 → 点击加号展开菜单 →
   * 定位「共享」相关菜单项（共享文档 + 共享屏幕）坐标并取并集框住它们；
   * 菜单未展开时回退高亮加号按钮本身。
   * 注意：TARGET_TYPES 必须与 Injector 中「+」菜单的 data-ds-type 一致——
   * 菜单现已合并为「共享文档」(shareDocAll) +「共享屏幕」(shareScreen) 两项，
   * 旧结构（shareDoc/shareExcel/sharePdf 分开）已废弃，否则轮询超时回退导致高亮框卡在加号上。
   */
  private async getScreenShareFocus(): Promise<{
    fromRect: { x: number; y: number; width: number; height: number };
    rect: { x: number; y: number; width: number; height: number };
  }> {
    const main = this.windows.getMainWindow();
    const v = main?.view;
    if (!v || v.webContents.isDestroyed()) throw new Error('聊天视图不存在');
    const vb = v.getBounds();
    // 网页字号缩放（CSS zoom 注入 html）只缩放渲染：getBoundingClientRect 返回的已是
    // view 视口内「显示/DIP」坐标（实测 elementFromPoint 命中区 = rect 显示区）。
    // 直接加 view 偏移即窗口坐标，无需再乘 zoom（旧代码乘 zoom 会重复放大，高亮框偏移）。
    const plusRect = await this.readElementRect(v.webContents, `document.getElementById('ds-plus-btn')`);
    const fromRect = {
      x: plusRect.x + vb.x,
      y: plusRect.y + vb.y,
      width: plusRect.width,
      height: plusRect.height,
    };
    // 演示：点击加号按钮展开下拉菜单（幂等：菜单已展开则不再点击，避免收起）
    try {
      await v.webContents.executeJavaScript(
        `(() => {
          const menu = document.getElementById('ds-plus-menu');
          const btn = document.getElementById('ds-plus-btn');
          if (!btn) return false;
          if (!menu || menu.style.display !== 'flex') btn.click();
          return true;
        })()`
      );
    } catch {
      /* 页面未就绪则忽略 */
    }
    // 轮询查找「共享」相关菜单项（共享文档 + 共享屏幕），全部出现后计算并集
    const TARGET_TYPES = ['shareDocAll', 'shareScreen'];
    const deadline = Date.now() + 4000;
    for (;;) {
      const found = await v.webContents
        .executeJavaScript(`(() => {
          const menu = document.getElementById('ds-plus-menu');
          if (!menu) return null;
          const targets = ${JSON.stringify(TARGET_TYPES)};
          const rects = {};
          let any = false;
          const btns = menu.querySelectorAll('button[data-ds-type]');
          for (const it of btns) {
            const t = it.getAttribute('data-ds-type');
            if (targets.indexOf(t) === -1) continue;
            const b = it.getBoundingClientRect();
            rects[t] = { x: b.x, y: b.y, width: b.width, height: b.height };
            any = true;
          }
          return any ? rects : null;
        })()`)
        .catch(() => null);
      if (found && TARGET_TYPES.every((t) => found[t] && found[t].width > 0)) {
        // 四个菜单项的并集矩形（CSS 坐标，换算到窗口 DIP 坐标）
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const t of TARGET_TYPES) {
          const r = found[t];
          if (r.x < minX) minX = r.x;
          if (r.y < minY) minY = r.y;
          if (r.x + r.width > maxX) maxX = r.x + r.width;
          if (r.y + r.height > maxY) maxY = r.y + r.height;
        }
        return {
          fromRect,
          rect: {
            x: minX + vb.x,
            y: minY + vb.y,
            width: maxX - minX,
            height: maxY - minY,
          },
        };
      }
      if (Date.now() > deadline) break;
      await new Promise((res) => setTimeout(res, 150));
    }
    // 菜单未完全展开：回退高亮加号按钮本身
    return { fromRect, rect: fromRect };
  }

  /** 读取聊天视图当前页面缩放系数（字号跟随设置），用于把 CSS 坐标换算为窗口 DIP 坐标。
   *  已废弃：网页字号现为 CSS zoom 注入，getBoundingClientRect 直接返回显示/DIP 坐标，
   *  无需换算（保留方法避免误用，勿再调用）。 */
  private async getViewZoom(_wc: Electron.WebContents): Promise<number> {
    const g = Number(this.config.get('fontSize')) || 0;
    const m = Number(this.config.get('fontSizeMain')) || 0;
    return 1.05 + (g + m) * 0.05;
  }

  /** 计算高亮区域（引导层与主窗口重合，坐标即主窗口内坐标）。 */
  private async getHighlightRect(h: HighlightSpec): Promise<{ x: number; y: number; width: number; height: number }> {
    const main = this.windows.getMainWindow();
    if (!main || !main.win || main.win.isDestroyed()) throw new Error('主窗口不存在');
    if (h.kind === 'titlebar') {
      const { width } = main.win.getContentBounds();
      return { x: 0, y: 0, width, height: TITLEBAR_HEIGHT };
    }
    if (h.kind === 'titlebar-btn') {
      return await this.readElementRect(main.win.webContents, `document.getElementById(${JSON.stringify(h.id)})`);
    }
    if (h.kind === 'chat-el') {
      const v = main.view;
      if (!v || v.webContents.isDestroyed()) throw new Error('聊天视图不存在');
      const vb = v.getBounds();
      const r = await this.readElementRect(v.webContents, `document.getElementById(${JSON.stringify(h.id)})`);
      // 网页字号缩放（CSS zoom）只缩放渲染：getBoundingClientRect 返回的已是 view 视口内
      // 显示/DIP 坐标，直接加 view 偏移即窗口坐标（无需乘 zoom）。
      return {
        x: r.x + vb.x,
        y: r.y + vb.y,
        width: r.width,
        height: r.height,
      };
    }
    throw new Error('未知高亮类型');
  }

  /** 从目标 webContents 读取元素矩形，轮询等待元素出现（超时 6s）。 */
  private async readElementRect(
    wc: Electron.WebContents,
    selectorExpr: string
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const deadline = Date.now() + 6000;
    for (;;) {
      const r = await wc
        .executeJavaScript(`(() => {
          const el = ${selectorExpr};
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        })()`)
        .catch(() => null);
      if (r && typeof r.width === 'number' && r.width > 0) return r;
      if (Date.now() > deadline) throw new Error('目标元素未出现');
      await new Promise((res) => setTimeout(res, 150));
    }
  }
}
