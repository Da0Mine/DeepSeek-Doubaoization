/**
 * 回答完成提醒：当 AI 在某个对话窗口开始生成回答时记录该会话；
 * 回答完成时若「窗口在后台」或「用户已切到其他会话」，弹系统通知提醒，
 * 点击通知可把对应窗口唤回前台并跳转回原会话。
 * 可在 设置 → 应用 → 通知 中关闭（notificationReplyDone）。
 *
 * 每个 webContents 独立维护生成状态，支持主/副窗口同时生成互不干扰。
 */
import { BrowserWindow, Notification, WebContents } from 'electron';
import type { ConfigStore } from '../config/ConfigStore';
import type { WindowManager } from '../windows/WindowManager';

/** 从 URL 提取会话 id（DeepSeek SPA：/a/chat/<id>、/a/chat/s/<id> 或 /c/<id>；无会话 id 返回 null）。
 * 注意 /a/chat/s/<uuid> 必须优先于 /a/chat/ 匹配，否则会把 "s" 误当会话 id。 */
function extractSessionId(url: string): string | null {
  const m = String(url).match(/(?:\/a\/chat\/s\/|\/a\/chat\/|\/c\/)([^/?#]+)/);
  return m ? m[1] : null;
}

/** 单个 webContents 的生成状态。 */
interface AnswerState {
  answering: boolean;
  /** 开始生成时的会话 URL（点击通知跳回用）。 */
  sessionUrl: string;
  /** 开始生成时的会话 id（判断用户是否已切走）。 */
  sessionId: string | null;
}

export class AnswerReminder {
  /** 按 webContents id 维护各窗口的生成状态（多窗口并行互不干扰）。 */
  private states = new Map<number, AnswerState>();
  /** 各 webContents 最近一次提醒时间戳：防重复提醒（30s 内同窗口不再弹）。 */
  private lastNotifyAt = new Map<number, number>();

  constructor(
    private readonly config: ConfigStore,
    private readonly windows: WindowManager
  ) {}

  /** 处理页面上报的生成状态变化。
   * @param started true=开始生成；false=回答完成/停止
   * @param switched true=用户已切到其他会话（取消跟踪，不提醒） */
  public handleStatus(wc: WebContents, started: boolean, switched = false): void {
    if (!wc || wc.isDestroyed()) return;
    try {
      const id = wc.id;
      if (switched) {
        // 用户切换了会话：SPA 切走后页面已看不到原会话的回答，
        // 无法再可靠判定其完成，取消当前跟踪避免误报「完成」
        this.states.delete(id);
        return;
      }
      if (started) {
        // 开始生成：记录会话与窗口，等待完成时判断是否提醒
        const url = wc.getURL();
        this.states.set(id, {
          answering: true,
          sessionUrl: url,
          sessionId: extractSessionId(url),
        });
        return;
      }
      // 回答完成 / 用户停止生成
      const st = this.states.get(id);
      if (!st || !st.answering) return;
      st.answering = false;
      this.states.delete(id);
      this.maybeNotify(wc, st);
    } catch (e) {
      console.error('[AnswerReminder] 处理生成状态异常:', e);
    }
  }

  private maybeNotify(wc: WebContents, st: AnswerState): void {
    // 开关检查（总开关 + 回答完成提醒开关）
    if (!this.config.get('notificationEnabled') || !this.config.get('notificationReplyDone')) {
      return;
    }
    let win: BrowserWindow | null = null;
    try {
      // 优先经 WindowManager 反查宿主窗口（WebContentsView 的 chat 视图用 fromWebContents 不可靠）
      win = this.windows.getWinByWebContents(wc);
      if (!win) win = BrowserWindow.fromWebContents(wc);
    } catch {
      win = null;
    }
    // 窗口在后台：不可见（含最小化）或未聚焦
    const background = !win || win.isDestroyed() || !win.isVisible() || !win.isFocused();
    // 用户已切到其他会话：当前会话 id ≠ 开始生成时的会话 id
    const nowId = extractSessionId(wc.getURL());
    const switched = !!st.sessionId && st.sessionId !== nowId;
    if (!background && !switched) {
      // 用户正盯着该会话完成回答，不打扰
      return;
    }
    const { sessionUrl, sessionId } = st;
    if (!sessionUrl) return;
    // 防重复提醒：同一窗口 30s 内不重复弹通知（避免切对话等操作反复触发）
    const now = Date.now();
    const lastNotify = this.lastNotifyAt.get(wc.id) || 0;
    if (now - lastNotify < 30000) return;
    this.lastNotifyAt.set(wc.id, now);
    try {
      const n = new Notification({
        title: 'AI 回答完成',
        body: '回答已生成完毕，点击查看',
      });
      n.on('click', () => {
        // 唤起对应窗口到前台
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          if (!win.isVisible()) win.show();
          win.focus();
        }
        // 跳转回原会话（仅当当前已不在该会话时才导航，避免无谓刷新）
        if (!wc.isDestroyed()) {
          const curId = extractSessionId(wc.getURL());
          if (!sessionId || sessionId !== curId) {
            wc.loadURL(sessionUrl).catch(() => {});
          }
        }
      });
      n.show();
    } catch (e) {
      console.error('[AnswerReminder] 通知失败:', e);
    }
  }
}
