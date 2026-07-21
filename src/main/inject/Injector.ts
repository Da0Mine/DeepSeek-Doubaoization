/**
 * 注入器：将截图 / 提示词注入到 chat.deepseek.com 的对话框。
 * 通过 wc.executeJavaScript + deepseek-selectors 实现；每个操作尝试多个候选选择器，
 * 全部失败返回 false（由调用方决定轻提示，不阻断）。
 *
 * ⚠️ 待实机验证：选择器与 React 受控组件赋值方式均基于推测，需在目标站点核对修正。
 */
import type { WebContents } from 'electron';
import type { PromptTemplates } from '../prompts/promptTemplates';
import type { WindowType } from '../../shared/types';
import {
  ASSISTANT_MESSAGE_SELECTORS,
  DEEP_THINK_SELECTORS,
  FILE_INPUT_SELECTORS,
  LOGIN_BUTTON_TEXTS,
  MODEL_SWITCH_SELECTORS,
  SEND_BUTTON_SELECTORS,
  TEXT_INPUT_SELECTORS,
  UPLOAD_BUTTON_SELECTORS,
} from './deepseek-selectors';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class Injector {
  constructor(private readonly templates: PromptTemplates) {}

  /**
   * 向对话框发送文本（可选附带图片）。内部统一走 submitToChat（I-06 强化自动发送）。
   * @returns 是否成功（找到输入框并可靠触发发送）。
   */
  public async sendToChat(wc: WebContents, text: string, img?: string): Promise<boolean> {
    return this.submitToChat(wc, text, img);
  }

  /**
   * 统一提交入口（I-06）：上传图(可选) → 填文 → 轮询等待发送按钮可用并点击。
   * @returns 是否成功触发发送。
   */
  public async submitToChat(wc: WebContents, text: string, img?: string): Promise<boolean> {
    if (img) {
      const ok = await this.uploadImage(wc, img);
      if (!ok) return false;
      // 不再固定等待 2s：轮询等待附件预览出现在输入框（即上传完成），通常远快于 2s，最多 3s 兜底。
      await this.waitForUploadSettle(wc);
    }
    const setOk = await this.fillText(wc, text);
    if (!setOk) return false;
    await sleep(200);
    return this.clickSend(wc);
  }

  /**
   * 仅上传图片到对话框（不填文、不点击发送）。
   * 用于「截图发送到对话」：用户要求只把原图附到当前/新对话，由用户自行决定是否发送。
   */
  public async uploadImageOnly(wc: WebContents, filePath: string): Promise<boolean> {
    const ok = await this.uploadImage(wc, filePath);
    if (!ok) return false;
    // 轮询等待附件预览出现在输入框（即上传完成），通常远快于固定等待
    await this.waitForUploadSettle(wc);
    return true;
  }

  /**
   * 轮询等待 B 窗口 chat 视图就绪：文件框 + 输入框均出现即视为页面已挂载并登录，
   * 用于替代截图注入流程里固定的 2.5s 等待，消除停顿卡顿。
   */
  public async waitForAppReady(wc: WebContents, timeoutMs = 8000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const ok = await wc.executeJavaScript(`(() => {
          return !!document.querySelector('input[type="file"]') &&
                 !!document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
        })()`);
        if (ok) return true;
      } catch (e) {
        /* 页面尚未就绪，继续轮询 */
      }
      await sleep(200);
    }
    return false;
  }

  /**
   * 轮询等待图片上传完成：DeepSeek 在附件上传完成后会在输入框工具栏渲染预览 <img>，
   * 出现即可点发送（避免上传未完成就被发送打断）。最多等待 timeoutMs 兜底。
   */
  public async waitForUploadSettle(wc: WebContents, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const done = await wc.executeJavaScript(`(() => {
          try {
            function getComposerFooter() {
              var fi = document.querySelector('input[type="file"]');
              if (!fi) return null;
              var el = fi.parentElement; var best = null, bestSvg = 0;
              for (var i = 0; i < 6 && el; i++) { var s = el.querySelectorAll('svg').length; if (s > bestSvg) { bestSvg = s; best = el; } el = el.parentElement; }
              return best;
            }
            var footer = getComposerFooter();
            if (!footer) return false;
            var imgs = footer.querySelectorAll('img');
            for (var i = 0; i < imgs.length; i++) { if (imgs[i].complete && imgs[i].naturalWidth > 0) return true; }
            return false;
          } catch (e) { return false; }
        })()`);
        if (done) return;
      } catch (e) {
        /* 忽略，继续轮询 */
      }
      await sleep(250);
    }
  }

  /** 上传图片到文件输入（依赖 webviewPreload 暴露的 window.__ds.uploadFile）。返回是否成功挂上文件。 */
  public async uploadImage(wc: WebContents, filePath: string): Promise<boolean> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = `(() => {
        try {
          if (!(window.__ds && typeof window.__ds.uploadFile === 'function')) {
            return JSON.stringify({ ok: false, reason: 'no-preload' });
          }
          var ok = window.__ds.uploadFile(${JSON.stringify(filePath)});
          var fi = document.querySelector('input[type="file"]');
          var attached = !!(fi && fi.files && fi.files.length > 0);
          return JSON.stringify({ ok: Boolean(ok) || attached, preload: ok, attached: attached });
        } catch (e) { return JSON.stringify({ ok: false, err: String(e) }); }
      })()`;
      try {
        const res = await wc.executeJavaScript(code);
        let obj: any;
        try {
          obj = JSON.parse(res);
        } catch {
          obj = res;
        }
        // 测试桩直接返回裸布尔，视为确定性结果立即返回
        if (typeof obj === 'boolean') return obj;
        if (obj && obj.ok) {
          console.log('[Injector] uploadImage preload=' + obj.preload + ' attached=' + obj.attached);
          return true;
        }
        if (attempt === 7) console.log('[Injector] uploadImage 失败，末次: ' + res);
      } catch (e) {
        console.error('[Injector] uploadImage 异常', e);
      }
      await sleep(250);
    }
    return false;
  }

  /**
   * 切换至 DeepSeek 的「识图模式」（与快速模式 / 专家模式并列的一级入口标签，位于输入框上方）。
   * 实测：仅在「识图模式」下挂图才会进入视觉理解；停留在快速模式（简单模式）时上传图片
   * 不会触发视觉能力，故截图动作必须显式点开「识图模式」标签。
   * 定位策略：匹配文本含「识图模式 / 识图 / 图片理解 / vision」的可点击元素，派发完整事件
   * 序列（pointerdown→mousedown→mouseup→click）点击，并轮询重试直到找到入口。
   */
  /**
   * 切换到「识图模式」。
   * 对齐 DeepSeek-desktop-client 参考实现：识图入口是 radio[data-model-type="vision"][role="radio"]，
   * 且必须用 wc.sendInputEvent 按坐标派发可信鼠标事件（合成 dispatchEvent 会被 setPointerCapture 拦截）。
   * 流程：找 radio →（找不到则点「新建对话」展开）→ 取消隐藏祖先 → 取坐标 → 可信点击 → 轮询 aria-checked。
   */
  public async switchToVisionModel(wc: WebContents): Promise<boolean> {
    const VISION_RADIO = '[data-model-type="vision"][role="radio"]';

    // 1. 查找 vision radio；找不到则尝试点击「新建对话」展开模型选择器
    let found = false;
    for (let attempt = 0; attempt < 3 && !found; attempt++) {
      const exists = await wc.executeJavaScript(`(() => {
        const radio = document.querySelector('${VISION_RADIO}');
        if (radio) return true;
        const container = document.querySelector('[role="radiogroup"]');
        return !!container;
      })()`);
      const existsOk = typeof exists === 'boolean' ? exists : !!(exists && exists.found);
      if (existsOk) {
        found = true;
        break;
      }
      console.log('[Injector] switchToVisionModel: 未找到 vision radio，尝试点击「新建对话」');
      await this.clickNewConversationButton(wc);
      for (let poll = 0; poll < 15 && !found; poll++) {
        const appeared = await wc.executeJavaScript(`(() => {
          const radio = document.querySelector('${VISION_RADIO}');
          const container = document.querySelector('[role="radiogroup"]');
          return !!(radio || container);
        })()`);
        const appearedOk = typeof appeared === 'boolean' ? appeared : !!(appeared && appeared.found);
        if (appearedOk) {
          found = true;
          break;
        }
        await sleep(200);
      }
    }
    if (!found) {
      console.log('[Injector] switchToVisionModel: 未找到识图模式 radio（可能账号未灰度到）');
      return false;
    }

    // 2. 若已是选中态，直接返回
    const alreadyActive = await wc.executeJavaScript(`(() => {
      const radio = document.querySelector('${VISION_RADIO}');
      return radio ? radio.getAttribute('aria-checked') === 'true' : false;
    })()`);
    const alreadyOk = typeof alreadyActive === 'boolean' ? alreadyActive : !!(alreadyActive && alreadyActive.found);
    if (alreadyOk) {
      console.log('[Injector] switchToVisionModel -> 已是识图模式');
      return true;
    }

    // 3. 临时取消隐藏祖先，便于取坐标并点击
    await wc.executeJavaScript(`(() => {
      window.__dsHiddenAncestors = [];
      const radio = document.querySelector('${VISION_RADIO}');
      if (!radio) return;
      let el = radio;
      while (el && el !== document.documentElement) {
        const cs = window.getComputedStyle(el);
        const overrides = {};
        if (cs.display === 'none') { overrides.display = el.style.display; el.style.setProperty('display', 'block', 'important'); }
        if (cs.height === '0px') { overrides.height = el.style.height; el.style.setProperty('height', 'auto', 'important'); }
        if (cs.minHeight === '0px') { overrides.minHeight = el.style.minHeight; el.style.setProperty('min-height', 'auto', 'important'); }
        if (cs.maxHeight === '0px') { overrides.maxHeight = el.style.maxHeight; el.style.setProperty('max-height', 'none', 'important'); }
        if (cs.overflow === 'hidden') { overrides.overflow = el.style.overflow; el.style.setProperty('overflow', 'visible', 'important'); }
        if (cs.opacity === '0') { overrides.opacity = el.style.opacity; el.style.setProperty('opacity', '1', 'important'); }
        if (cs.visibility === 'hidden' || cs.visibility === 'collapse') { overrides.visibility = el.style.visibility; el.style.setProperty('visibility', 'visible', 'important'); }
        if (cs.pointerEvents === 'none') { overrides.pointerEvents = el.style.pointerEvents; el.style.setProperty('pointer-events', 'auto', 'important'); }
        const transform = cs.transform;
        if (transform && transform !== 'none' && (transform.includes('scale(0') || transform.includes('scale3d(0'))) { overrides.transform = el.style.transform; el.style.setProperty('transform', 'none', 'important'); }
        const clipPath = cs.clipPath;
        if (clipPath && clipPath !== 'none' && clipPath.includes('0')) { overrides.clipPath = el.style.clipPath; el.style.setProperty('clip-path', 'none', 'important'); }
        if (Object.keys(overrides).length > 0) window.__dsHiddenAncestors.push({ el, overrides });
        el = el.parentElement;
      }
    })()`);
    await sleep(150);

    // 4. 取坐标
    let rect: any = null;
    for (let i = 0; i < 15; i++) {
      const r = await wc.executeJavaScript(`(() => {
        const radio = document.querySelector('${VISION_RADIO}');
        if (!radio) return null;
        const cs = window.getComputedStyle(radio);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return { hidden: true };
        const b = radio.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2, width: b.width, height: b.height };
      })()`);
      if (r && (r as any).hidden) {
        await sleep(200);
        continue;
      }
      if (r && (r as any).width > 0 && (r as any).height > 0) {
        rect = r;
        break;
      }
      await sleep(200);
    }
    if (!rect) {
      console.log('[Injector] switchToVisionModel: 未找到可见的识图模式按钮');
      return false;
    }

    // 5. 禁用 setPointerCapture，聚焦，用 sendInputEvent 派发可信鼠标事件
    const cx = Math.round(rect.x);
    const cy = Math.round(rect.y);
    await this.disablePointerCapture(wc);
    await sleep(60);
    try {
      (wc as any).focus();
    } catch (e) {
      /* ignore */
    }
    this.sendMouse(wc, 'mouseMove', cx, cy);
    await sleep(60);
    this.sendMouse(wc, 'mouseDown', cx, cy);
    await sleep(60);
    this.sendMouse(wc, 'mouseUp', cx, cy);
    await sleep(80);

    // 6. 轮询 aria-checked === 'true'
    let success = await this.pollVisionChecked(wc);
    if (!success) {
      // 键盘兜底：聚焦 + Space
      console.log('[Injector] switchToVisionModel: 鼠标点击未生效，尝试键盘激活');
      await wc.executeJavaScript(`(() => { const radio = document.querySelector('${VISION_RADIO}'); if (radio) radio.focus(); })()`);
      await sleep(100);
      try {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Space' } as any);
        await sleep(80);
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Space' } as any);
      } catch (e) {
        /* ignore */
      }
      await sleep(150);
      success = await this.pollVisionChecked(wc);
    }

    console.log('[Injector] switchToVisionModel -> ' + (success ? '已切换' : '失败'));
    return success;
  }

  /**
   * 设置对话窗口「深度思考」开关状态（true=开启，false=关闭）。
   * 用于 B 类临时窗口 / 新副窗口 / 默认模型模式应用（Bug3 修复：setDeepThink 已实现但此前从未被调用）。
   *
   * 识别与切换策略（对齐参考项目 ensureTogglesState）：
   *   - 选择器恒为 `.ds-toggle-button`（CSS module 哈希前缀由构建期添加，运行时形如 `.<hash>.ds-toggle-button`，
   *     querySelectorAll('.ds-toggle-button') 仍可命中），再按 textContent 含「深度思考」锁定目标开关；
   *   - 当前状态以 `aria-pressed === 'true'` 判定，兼容 class `ds-toggle-button--selected`；
   *   - 若目标状态与当前不一致，调用原生 `el.click()` 切换（参考实现即用 btn.click()）。
   * 全程诊断日志 + 多轮重试；失败静默返回 false（不阻断主流程）。
   * 注意：不依赖 aria-label（不同账号 / 灰度下 aria-label 文案不稳定，正是旧实现漏匹配的根因）。
   */
  public async setDeepThink(wc: WebContents, enabled: boolean): Promise<boolean> {
    const SEL = '.ds-toggle-button';
    const findCode = `(() => {
      try {
        function isDeepThink(el){
          var t = (el.textContent || '').trim();
          return t.indexOf('深度思考') >= 0 || t.indexOf('DeepThink') >= 0
              || t.toLowerCase().indexOf('deep think') >= 0;
        }
        var cands = Array.from(document.querySelectorAll('${SEL}'));
        var el = null;
        for (var i = 0; i < cands.length; i++) { if (isDeepThink(cands[i])) { el = cands[i]; break; } }
        if (!el) return JSON.stringify({ found: false, on: false });
        function isOn(e){
          if (e.getAttribute) {
            if (e.getAttribute('aria-pressed') === 'true') return true;
            if (e.getAttribute('aria-checked') === 'true') return true;
          }
          if (e.classList && (e.classList.contains('ds-toggle-button--selected')
              || e.classList.contains('active') || e.classList.contains('on')
              || e.classList.contains('checked') || e.classList.contains('pressed'))) return true;
          return false;
        }
        return JSON.stringify({ found: true, on: isOn(el) });
      } catch (e) { return JSON.stringify({ found: false, on: false, err: String(e) }); }
    })()`;

    const clickCode = `(() => {
      try {
        function isDeepThink(el){
          var t = (el.textContent || '').trim();
          return t.indexOf('深度思考') >= 0 || t.indexOf('DeepThink') >= 0
              || t.toLowerCase().indexOf('deep think') >= 0;
        }
        var cands = Array.from(document.querySelectorAll('${SEL}'));
        var el = null;
        for (var i = 0; i < cands.length; i++) { if (isDeepThink(cands[i])) { el = cands[i]; break; } }
        if (!el) return false;
        // 原生 click：参考实现即用 btn.click()，可正确触发 React 事件委托
        el.click();
        return true;
      } catch (e) { return false; }
    })()`;

    try {
      const res = await wc.executeJavaScript(findCode);
      let obj: any;
      try { obj = JSON.parse(res); } catch { obj = res; }
      // 测试桩直接返回裸布尔，视为确定性结果
      if (typeof obj === 'boolean') return obj;
      if (!obj || !obj.found) {
        console.log('[Injector] setDeepThink: 未找到深度思考开关（账号可能未灰度到）');
        return false;
      }
      if (obj.on === enabled) {
        console.log('[Injector] setDeepThink -> 已是 ' + (enabled ? '开启' : '关闭'));
        return true;
      }
      await wc.executeJavaScript(clickCode);
      for (let poll = 0; poll < 15; poll++) {
        await sleep(150);
        const cur = await wc.executeJavaScript(findCode);
        let c: any;
        try { c = JSON.parse(cur); } catch { c = cur; }
        if (typeof c === 'boolean') return c;
        if (c && c.found && c.on === enabled) {
          console.log('[Injector] setDeepThink -> 已切换为 ' + (enabled ? '开启' : '关闭'));
          return true;
        }
      }
      console.log('[Injector] setDeepThink -> 点击后状态未确认');
      return false;
    } catch (e) {
      console.error('[Injector] setDeepThink 异常', e);
      return false;
    }
  }

  /**
   * 通用模型模式切换：simple(快速模式) / expert(专家模式) / vision(识图模式)。
   * 对齐 DeepSeek 真实 UI（参考项目 resource/DeepSeek-UI-元素参考.md）：
   *   <div data-model-type="default" role="radio" aria-checked="true">快速模式</div>
   *   <div data-model-type="expert"  role="radio">专家模式</div>
   *   <div data-model-type="vision"  role="radio">识图模式</div>
   * 切换策略（参考 DeepSeek-desktop-client 实现，并修复问题 A）：
   *   - 已是目标模式则直接返回；
   *   - 小窗 / 历史会话下模型选择器可能「折叠」，radio 不在 DOM 或不可见；
   *     故每轮先尝试「展开选择器」（点当前选中 radio 或折叠芯片），再轮询等待目标 radio 可见后可信点击；
   *   - 整体重试多轮（每轮内再轮询），覆盖新建对话后 DOM 尚未渲染、切换回旧会话等场景，
   *     不再「找不到按钮」就立刻放弃。
   */
  public async switchModelMode(wc: WebContents, mode: 'simple' | 'expert' | 'vision'): Promise<boolean> {
    if (mode === 'vision') return this.switchToVisionModel(wc);
    const MODE_TYPE = mode === 'expert' ? 'expert' : 'default';
    const TARGET = `[data-model-type="${MODE_TYPE}"][role="radio"]`;

    // 已是该模式则直接返回（兼容裸布尔/对象返回）
    const already = await this.readRadioChecked(wc, TARGET);
    if (already === true) {
      console.log('[Injector] switchModelMode(' + mode + ') -> 已是该模式');
      return true;
    }

    // 多轮重试：每轮先展开选择器，再等待目标 radio 可见并可信点击，最后确认选中。
    for (let attempt = 0; attempt < 6; attempt++) {
      await this.expandModelSelector(wc);

      const rect = await this.waitRadioVisible(wc, TARGET, 15);
      if (!rect) {
        // 即便展开后仍不可见：可能尚未渲染 / 被禁用 / 真不存在；稍后再试
        await sleep(300);
        continue;
      }

      const cx = Math.round(rect.x);
      const cy = Math.round(rect.y);
      await this.disablePointerCapture(wc);
      await sleep(60);
      try { (wc as any).focus(); } catch (e) {}
      this.sendMouse(wc, 'mouseMove', cx, cy);
      await sleep(60);
      this.sendMouse(wc, 'mouseDown', cx, cy);
      await sleep(60);
      this.sendMouse(wc, 'mouseUp', cx, cy);
      await sleep(150);

      if (await this.waitRadioChecked(wc, TARGET, 20)) {
        console.log('[Injector] switchModelMode -> ' + mode);
        return true;
      }
      await sleep(300);
    }

    console.log('[Injector] switchModelMode(' + mode + '): 未找到可见的模型按钮');
    return false;
  }

  /** 读取指定 radio 的 aria-checked：true/false；查询失败或不存在返回 null。兼容裸布尔/对象返回。 */
  private async readRadioChecked(wc: WebContents, selector: string): Promise<boolean | null> {
    try {
      const res = await wc.executeJavaScript(`(() => {
        const r = document.querySelector('${selector}');
        return r ? r.getAttribute('aria-checked') === 'true' : null;
      })()`);
      if (res === null || res === undefined) return null;
      if (typeof res === 'boolean') return res;
      if (typeof res === 'object' && res !== null && 'found' in (res as any)) return !!(res as any).found;
      return Boolean(res);
    } catch {
      return null;
    }
  }

  /** 轮询等待目标 radio 出现且可见，返回中心坐标；超时返回 null。 */
  private async waitRadioVisible(
    wc: WebContents,
    selector: string,
    tries = 15
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await wc.executeJavaScript(`(() => {
          const radio = document.querySelector('${selector}');
          if (!radio) return null;
          const cs = window.getComputedStyle(radio);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return { hidden: true };
          const b = radio.getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2, width: b.width, height: b.height };
        })()`);
        if (r && (r as any).hidden) {
          await sleep(200);
          continue;
        }
        if (r && (r as any).width > 0 && (r as any).height > 0) return r as any;
      } catch {
        /* 忽略，继续轮询 */
      }
      await sleep(200);
    }
    return null;
  }

  /** 轮询确认目标 radio 已选中（最多约 2 秒）。 */
  private async waitRadioChecked(wc: WebContents, selector: string, tries = 20): Promise<boolean> {
    for (let poll = 0; poll < tries; poll++) {
      await sleep(100);
      const checked = await this.readRadioChecked(wc, selector);
      if (checked === true) return true;
    }
    return false;
  }

  /**
   * 展开模型选择器（折叠态下目标 radio 不可见，必须先把下拉点开才能点到目标）。
   * 对齐参考项目实现：仅点击「当前已选中的 radio」([role="radio"][aria-checked="true"]) 来展开，
   * 不做任何模糊文本匹配的「芯片」回退——旧实现的文本匹配会误命中菜单项 / 标签 / tooltip 等
   * 其它元素，点错位置留下半开下拉，正是把 UI 搞乱、新建对话失败的根因之一。
   * 若找不到已选中 radio（极少见），则直接返回，交由后续轮询等待目标 radio 出现。
   */
  private async expandModelSelector(wc: WebContents): Promise<void> {
    const cur = await wc
      .executeJavaScript(`(() => {
        const r = document.querySelector('[role="radio"][aria-checked="true"]');
        if (!r) return null;
        const b = r.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) return null;
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      })()`)
      .catch(() => null as { x: number; y: number } | null);
    if (cur && typeof cur.x === 'number') {
      await this.clickAt(wc, cur.x, cur.y);
      await sleep(180);
    }
  }

  /** 用可信鼠标事件在视口坐标 (x,y) 处点击（先 disablePointerCapture）。 */
  private async clickAt(wc: WebContents, x: number, y: number): Promise<void> {
    const cx = Math.round(x);
    const cy = Math.round(y);
    await this.disablePointerCapture(wc);
    await sleep(60);
    try { (wc as any).focus(); } catch (e) {}
    this.sendMouse(wc, 'mouseMove', cx, cy);
    await sleep(60);
    this.sendMouse(wc, 'mouseDown', cx, cy);
    await sleep(60);
    this.sendMouse(wc, 'mouseUp', cx, cy);
  }

  /** 轮询 vision radio 的 aria-checked 是否为 true（最多 2 秒）。 */
  private async pollVisionChecked(wc: WebContents): Promise<boolean> {
    const VISION_RADIO = '[data-model-type="vision"][role="radio"]';
    for (let poll = 0; poll < 20; poll++) {
      await sleep(100);
      const checked = await wc.executeJavaScript(`(() => {
        const radio = document.querySelector('${VISION_RADIO}');
        return radio ? radio.getAttribute('aria-checked') === 'true' : false;
      })()`);
      const checkedOk = typeof checked === 'boolean' ? checked : !!(checked && checked.found);
      if (checkedOk) return true;
    }
    return false;
  }

  /**
   * 在 page 内临时禁用 Element.prototype.setPointerCapture，避免可信点击被指针捕获拦截。
   * 关键修复（qa-fallback 回归）：原实现每次调用都把「当前」setPointerCapture 存进
   * window.__dsOrigSPC 并注册一个 once 恢复监听；一次 switchModelMode 中会多次调用，
   * 多个 once 监听在同一 pointerdown 里依次触发，彼此覆盖导致最终恢复成 undefined，
   * 于是「setPointerCapture is not a function」崩溃被自身抵消（问题 B 复发）。
   * 现改为幂等：① 只捕获「首次」的原始函数到 window.__dsSPCOriginal；② 每次都临时置为 no-op；
   * ③ 恢复监听只武装一次，恢复时永远恢复成「原始函数」（绝不会变成 undefined）。
   */
  private async disablePointerCapture(wc: WebContents): Promise<void> {
    try {
      await wc.executeJavaScript(`(() => {
        try {
          if (typeof Element === 'undefined') return;
          // 只捕获一次原始函数（可能是真实函数，也可能是 preload 兜底装上的 no-op）
          if (!window.__dsSPCOriginal && Element.prototype.setPointerCapture) {
            window.__dsSPCOriginal = Element.prototype.setPointerCapture;
          }
          // 本次可信点击期间临时置为 no-op，避免某些元素上调用抛错
          Element.prototype.setPointerCapture = function () {};
          // 恢复逻辑只武装一次：下次 pointerdown 后恢复为原始函数（绝不置 undefined）
          if (!window.__dsSPCResetArmed) {
            window.__dsSPCResetArmed = true;
            document.addEventListener('pointerdown', function () {
              if (window.__dsSPCOriginal) Element.prototype.setPointerCapture = window.__dsSPCOriginal;
              window.__dsSPCResetArmed = false;
            }, { once: true });
          }
        } catch (e) {}
      })()`);
    } catch (e) {
      /* ignore */
    }
  }

  /** 用 wc.sendInputEvent 派发可信鼠标事件（坐标相对 webContents 视口）。 */
  private sendMouse(wc: WebContents, type: 'mouseMove' | 'mouseDown' | 'mouseUp', x: number, y: number): void {
    try {
      wc.sendInputEvent({ type, x, y, button: 'left', clickCount: type === 'mouseDown' ? 1 : 0 } as any);
    } catch (e) {
      /* ignore */
    }
  }

  /** 点击右上角「新建对话」按钮（带加号图标），用于展开折叠的模型选择器。 */
  private async clickNewConversationButton(wc: WebContents): Promise<boolean> {
    try {
      const rect = await wc.executeJavaScript(`(() => {
        const allBtns = Array.from(document.querySelectorAll('.ds-button--iconLabelPrimary, .ds-button--iconLabel, ._4f3769f'));
        for (const btn of allBtns) {
          const r = btn.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const hasPlusIcon = btn.querySelector('svg[class*="plus"], svg[data-icon*="plus"], svg[viewBox="0 0 24 24"] path[d*="M12 5v14M5 12h14"]');
          if (hasPlusIcon) return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
        }
        const xlButtons = Array.from(document.querySelectorAll('.ds-button--xl'));
        if (xlButtons.length >= 2) {
          xlButtons.sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x);
          const btn = xlButtons[0];
          const r = btn.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
        }
        const allButtons = Array.from(document.querySelectorAll('[role="button"]'));
        const topRight = allButtons.filter(b => {
          const r = b.getBoundingClientRect();
          return r.width > 30 && r.height > 30 && r.x > window.innerWidth * 0.7 && r.y < 80;
        }).sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0];
        if (topRight) {
          const r = topRight.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent.trim();
          if (text === '新建对话' || text === 'New Chat' || text === '新对话') {
            const parent = node.parentElement;
            if (parent) {
              const r = parent.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
            }
          }
        }
        return null;
      })()`);
      if (!rect || (rect as any).width <= 0 || (rect as any).height <= 0) return false;
      const cx = Math.round((rect as any).x);
      const cy = Math.round((rect as any).y);
      await this.disablePointerCapture(wc);
      await sleep(60);
      try {
        (wc as any).focus();
      } catch (e) {
        /* ignore */
      }
      this.sendMouse(wc, 'mouseMove', cx, cy);
      await sleep(60);
      this.sendMouse(wc, 'mouseDown', cx, cy);
      await sleep(60);
      this.sendMouse(wc, 'mouseUp', cx, cy);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 提取图片文字：切换视觉模型 + 发送提取提示词（附图）。 */
  public async extractText(wc: WebContents, img: string): Promise<boolean> {
    await this.switchToVisionModel(wc);
    return this.submitToChat(wc, this.templates.extractTextPrompt(), img);
  }

  /** 翻译：将文本填入翻译模板并发送。 */
  public async translate(wc: WebContents, text: string, lang: string): Promise<boolean> {
    const tpl = this.templates.translatePrompt(lang);
    const prompt = this.templates.render(tpl, { content: text });
    return this.submitToChat(wc, prompt);
  }

  /** 解释：将文本填入解释模板并发送。 */
  public async explain(wc: WebContents, text: string): Promise<boolean> {
    const prompt = this.templates.render(this.templates.explainPrompt(), { content: text });
    return this.submitToChat(wc, prompt);
  }

  /**
   * 在对话框输入框工具栏的上传按钮左侧插入剪刀截图按钮（I-01）。
   * 定位策略（按成功率）：
   *  A. 页面 file input 的「可点击祖先」——上传按钮几乎必含隐藏 file input，最可靠；
   *  B. contenteditable 输入框所在工具栏的第一个按钮（通常是上传）。
   * 点击经 DOM 自定义事件 -> webviewPreload -> IPC(SCISSORS_TRIGGER) 触发截图。
   * MutationObserver 应对 SPA 重渲染导致的按钮丢失并重注入。
   * 全程 console.log('[Injector] ...')，由 WindowManager.attachWebConsole 转发到终端，
   * 便于在无真实 DOM 时诊断（若仍失败，把 [web:LOG] [Injector] 日志发回即可精修）。
   */
  public async injectScissorsButton(wc: WebContents, onTrigger: () => void): Promise<boolean> {
    // onTrigger 在 Node 侧无法跨桥序列化；真实触发走 IPC(SCISSORS_TRIGGER)。
    void onTrigger;
    const code = `(() => {
      try {
        // 稳健定位上传按钮：策略A 由 file input 向上找 clickable 祖先；策略B 取 footer 中「发送前一位」按钮
        function disabledOf(b){ return b.disabled===true || b.getAttribute('aria-disabled')==='true' || (b.classList && b.classList.contains('disabled')); }
        function isToggle(b){ var a=(b.getAttribute('aria-label')||'').toLowerCase(); var t=(b.textContent||'').trim().toLowerCase(); return a.indexOf('思考')>=0||a.indexOf('搜索')>=0||a.indexOf('深度')>=0||a.indexOf('智能')>=0||t.indexOf('思考')>=0||t.indexOf('搜索')>=0; }
        // 实机确认：DeepSeek 输入框与按钮工具栏是兄弟节点，按钮不在输入框祖先链上
        // （input#0 footerBtns=0 已验证）。故以 input[type=file] 上传文件框为可靠锚点。
        function getUploadButton(){
          var fi = document.querySelector('input[type="file"]');
          if (!fi) return null;
          // 1) 向上找最近的可点击祖先：button/label/role=button，或「直接包住 file input 且含图标」的 div/span
          var el = fi.parentElement;
          while (el && el !== document.body) {
            var tag = el.tagName;
            if (tag === 'BUTTON' || tag === 'LABEL' || (el.getAttribute && el.getAttribute('role') === 'button')) return el;
            if ((tag === 'DIV' || tag === 'SPAN') && el.children && Array.prototype.indexOf.call(el.children, fi) >= 0 && el.querySelector('svg') != null) return el;
            el = el.parentElement;
          }
          // 2) 兜底：找含 file input、且周围有多个图标/按钮的容器，返回包住 file input 的最小元素
          var p = fi.parentElement;
          for (var i = 0; i < 6 && p; i++) {
            var icons = p.querySelectorAll('svg').length;
            var btns = p.querySelectorAll('button, [role="button"]').length;
            if (icons >= 3 || btns >= 3) {
              var cur = fi.parentElement;
              while (cur && cur.parentElement && cur.parentElement !== p) cur = cur.parentElement;
              return cur || p;
            }
            p = p.parentElement;
          }
          return null;
        }
        function getToolbar(uploadBtn){
          // 诊断用：取含 svg 最多的祖先（完整输入框栏：左侧 toggle/上传组 + 右侧发送组）
          var best=null, bestSvg=0;
          var p = uploadBtn ? uploadBtn.parentElement : document.body;
          for (var i = 0; i < 8 && p; i++) {
            var svg = p.querySelectorAll('svg').length;
            if (svg > bestSvg){ bestSvg = svg; best = p; }
            p = p.parentElement;
          }
          return best;
        }
        function inject() {
          if (document.getElementById('ds-scissors-btn')) return true;
          var anchor = getUploadButton();
          if (!anchor) {
            if (!window.__dsScissorsWarn) window.__dsScissorsWarn = 0;
            if (window.__dsScissorsWarn < 3) {
              var up = getUploadButton(); var f = getToolbar(up);
              var fb = f ? Array.from(f.querySelectorAll('button')).map(function (b, i) { return i + ':' + b.tagName + (disabledOf(b) ? 'D' : '') + (b.querySelector('input[type="file"]') ? 'F' : '') + (isToggle(b) ? 'T' : '') + (b.querySelector('svg') ? 'S' : ''); }).join(' ') : 'none';
              console.log('[Injector] no upload anchor; toolbarBtns=' + fb);
              window.__dsScissorsWarn++;
            }
            return false;
          }
          var btn = document.createElement('button');
          btn.id = 'ds-scissors-btn';
          btn.type = 'button';
          btn.textContent = '\\u2702'; // ✂
          btn.title = '截图';
          btn.setAttribute('aria-label', '截图');
          btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;margin:0 4px;vertical-align:middle;background:transparent;border:none;outline:none;box-shadow:none;color:#ffffff;opacity:0.85;transition:opacity 0.18s;cursor:pointer;font-size:18px;line-height:1;user-select:none;-webkit-user-select:none;z-index:2147483647;';
          btn.onmouseenter = function () { this.style.opacity = '1'; };
          btn.onmouseleave = function () { this.style.opacity = '0.85'; };
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            document.dispatchEvent(new CustomEvent('ds-scissors-trigger'));
          });
          if (anchor.parentElement) anchor.parentElement.insertBefore(btn, anchor);
          else anchor.insertAdjacentElement('beforebegin', btn);
          console.log('[Injector] 剪刀按钮已插入（对话框内）；锚点=' + anchor.tagName + '|' + (anchor.getAttribute('aria-label') || '') + '|' + (anchor.className && anchor.className.toString ? anchor.className.toString() : '').slice(0, 40));
          return true;
        }
        // 一次性纯 ASCII 诊断 dump（避免中文在 GBK 终端乱码）：打印 file input 祖先链 + 全部可点击元素
        if (!window.__dsDumpDone) {
          window.__dsDumpDone = true;
          var fis = Array.from(document.querySelectorAll('input[type="file"]'));
          console.log('[Injector-DUMP] fileInputs=' + fis.length);
          fis.forEach(function (fi, idx) {
            console.log('[Injector-DUMP] fi#' + idx + ' tag=' + fi.tagName + ' id=' + (fi.id || '') + ' cls=' + (fi.className && fi.className.toString ? fi.className.toString() : '').slice(0, 40) + ' offsetParent=' + (fi.offsetParent !== null));
            var chain = [];
            var el = fi.parentElement;
            for (var i = 0; i < 8 && el; i++) {
              chain.push('#' + i + ':' + el.tagName + (el.id ? '#' + el.id : '') + '.' + (el.className && el.className.toString ? el.className.toString() : '').slice(0, 22) + '[role=' + (el.getAttribute('role') || '') + '][btns=' + el.querySelectorAll('button').length + '][svg=' + el.querySelectorAll('svg').length + ']');
              el = el.parentElement;
            }
            console.log('[Injector-DUMP] fi#' + idx + ' ancestors=' + chain.join(' '));
          });
          var up = getUploadButton();
          console.log('[Injector-DUMP] uploadBtn=' + (up ? (up.tagName + '#' + (up.id || '') + '.' + (up.className && up.className.toString ? up.className.toString() : '').slice(0, 28) + '[role=' + (up.getAttribute('role') || '') + ']') : 'null'));
          var tb = getToolbar(up);
          var tbs = tb ? Array.from(tb.querySelectorAll('button, [role="button"], div[onclick], span[onclick]')) : [];
          console.log('[Injector-DUMP] toolbarBtns=' + tbs.length + ' ' + tbs.map(function (b, i) { return i + ':' + b.tagName + (disabledOf(b) ? 'D' : '') + (b.querySelector('input[type="file"]') ? 'F' : '') + (isToggle(b) ? 'T' : '') + (b.querySelector('svg') ? 'S' : ''); }).join(' '));
          var cls = Array.from(document.querySelectorAll('button, [role="button"], a[href], div[onclick], span[onclick]')).slice(0, 40);
          console.log('[Injector-DUMP] clickables=' + cls.length);
          cls.forEach(function (b, i) {
            console.log('[Injector-DUMP]  cb#' + i + ' ' + b.tagName + (b.id ? '#' + b.id : '') + '.' + (b.className && b.className.toString ? b.className.toString() : '').slice(0, 26) + ' aria=' + (b.getAttribute('aria-label') || '') + (b.querySelector('input[type="file"]') ? ' [F]' : '') + (b.querySelector('svg') ? ' [S]' : ''));
          });
        }
        inject();
        var mo = new MutationObserver(function () {
          if (!document.getElementById('ds-scissors-btn')) inject();
        });
        mo.observe(document.body, { childList: true, subtree: true });
        window.__dsScissorsMO = mo;
        return document.getElementById('ds-scissors-btn') != null;
      } catch (e) { console.error('[Injector] inject 异常', e); return false; }
    })()`;
    try {
      return Boolean(await wc.executeJavaScript(code));
    } catch (e) {
      console.error('[Injector] injectScissorsButton 失败:', e);
      return false;
    }
  }

  /**
   * 在 chat.deepseek.com 页面内注入「新建对话」监听。
   * 仅监听「新建对话」按钮点击（捕获阶段，兼容动态渲染），
   * 触发后经 window.__ds.reportNewConversation()（webviewPreload 暴露）经 IPC 通知主进程，
   * 由 WindowManager.applyDefaultModelMode 自动切换到用户在设置中配置的默认模型模式。
   *
   * 关键修正（问题 1 根因）：
   *   旧实现额外监听 window.hashchange 并在每次 URL 变化时上报，导致「点侧边栏切到旧会话」
   *   这类普通导航也被误判为「新建对话」，进而对旧会话误切默认模型，并与随后的真正新建对话
   *   形成并发 / 双重触发，把模型选择器点击搞乱（留下半开下拉、找不到按钮）。
   *   现改为「只在真正点中『新建对话』按钮时才上报」，与参考项目「显式点击新建对话按钮」一致，
   *   不再因任意导航误触发。
   * 已绑定则直接返回，避免重复注入。返回是否注入成功（调用不抛错）。
   */
  public async injectNewConversationWatcher(wc: WebContents): Promise<boolean> {
    const code = `(() => {
      try {
        if (window.__dsNewConvBound) return true;
        window.__dsNewConvBound = true;
        function report() {
          try {
            if (window.__ds && typeof window.__ds.reportNewConversation === 'function') {
              window.__ds.reportNewConversation();
            }
          } catch (e2) {}
        }
        function isNewChatButton(el) {
          if (!el || !el.getAttribute) return false;
          var txt = (el.textContent || '').replace(/\\s+/g, '').toLowerCase();
          // 容错：用 includes 而非严格相等，兼容「新建对话」前后带图标/空格/其它文案的变体
          if (txt.includes('新建对话') || txt === '新对话' || txt === 'newchat') return true;
          var aria = (el.getAttribute('aria-label') || '').toLowerCase();
          if (aria.indexOf('新建对话') >= 0 || aria.indexOf('newchat') >= 0) return true;
          return false;
        }
        // 仅捕获阶段监听「新建对话」按钮点击；不监听 URL 变化事件，避免普通会话切换误触发。
        document.addEventListener('click', function (e) {
          try {
            var node = e.target;
            while (node && node !== document.body) {
              if (node.getAttribute && isNewChatButton(node)) { setTimeout(report, 350); return; }
              node = node.parentElement;
            }
          } catch (err) {}
        }, true);
        return true;
      } catch (e) { return false; }
    })()`;
    try {
      return Boolean(await wc.executeJavaScript(code));
    } catch (e) {
      console.error('[Injector] injectNewConversationWatcher 失败:', e);
      return false;
    }
  }

  /** 探测登录态：无登录按钮且存在输入框视为已登录。 */
  public async detectLogin(wc: WebContents): Promise<boolean> {
    const loginTexts = JSON.stringify(LOGIN_BUTTON_TEXTS);
    const code = `(() => {
      try {
        const texts = ${loginTexts};
        const btns = Array.from(document.querySelectorAll('button, a'));
        const hasLogin = btns.some(b => texts.some(t => (b.textContent || '').trim().toLowerCase().includes(t.toLowerCase())));
        const input = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
        return !hasLogin && !!input;
      } catch (e) { return false; }
    })()`;
    try {
      return Boolean(await wc.executeJavaScript(code));
    } catch (e) {
      return false;
    }
  }

  /** 读取最近一条 AI 回复文本（用于翻译回填，待实机验证选择器）。 */
  public async readLatestResponse(wc: WebContents): Promise<string> {
    const code = `(() => {
      try {
        const sels = ${JSON.stringify(ASSISTANT_MESSAGE_SELECTORS)};
        for (const s of sels) {
          const nodes = document.querySelectorAll(s);
          if (nodes && nodes.length) {
            return (nodes[nodes.length - 1].innerText || nodes[nodes.length - 1].textContent || '').trim();
          }
        }
      } catch (e) {}
      return '';
    })()`;
    try {
      return String(await wc.executeJavaScript(code) || '');
    } catch (e) {
      return '';
    }
  }

  // -------------------- 内部辅助 --------------------

  /** 在输入框填入文本（兼容 React 受控组件）。轮询等待输入框出现并重试（覆盖 B 窗口加载时机）。 */
  private async fillText(wc: WebContents, text: string): Promise<boolean> {
    const t = JSON.stringify(text);
    for (let attempt = 0; attempt < 12; attempt++) {
      const res = await wc.executeJavaScript(`(() => {
        try {
          // 稳健定位聊天输入框：排除底部搜索框（其祖先可能有按钮但无上传文件框）。
          // 优先选「祖先含 input[type=file] 的工具栏」的输入框 = 聊天输入框。
          function disabledOf(b){ return b.disabled===true || b.getAttribute('aria-disabled')==='true'; }
          function getComposerFooter(input){
            if(!input) return null;
            var chain=[]; var p=input.parentElement;
            for(var i=0;i<6 && p;i++){ chain.push(p); p=p.parentElement; }
            var best=null,bestN=-1;
            for(var j=0;j<chain.length;j++){ var n=chain[j].querySelectorAll('button').length; if(n>bestN){bestN=n;best=chain[j];} }
            return best;
          }
          function findChatInput() {
            // 优先：DeepSeek 聊天输入框专属 aria（避开底部搜索框）
            var sp = document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], [contenteditable][aria-label*="发送消息"]');
            if (sp) return sp;
            // 兜底：footer 按钮最多的输入框 = 聊天框
            var cands = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
            var best = null, bestN = -1;
            for (var ci = 0; ci < cands.length; ci++) {
              var f = getComposerFooter(cands[ci]);
              if (!f) continue;
              var n = f.querySelectorAll('button').length;
              if (n > bestN) { bestN = n; best = cands[ci]; }
            }
            return best;
          }
          var el = findChatInput();
          if (!el) return JSON.stringify({ ok: false, reason: 'no-input' });
          var value = ${t};
          el.focus();
          if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
            el.textContent = value;
          } else {
            try {
              var proto = Object.getPrototypeOf(el);
              var desc = Object.getOwnPropertyDescriptor(proto, 'value');
              if (desc && desc.set) { desc.set.call(el, value); }
              else { el.value = value; }
            } catch (e) { try { el.value = value; } catch (e2) {} }
          }
          // React 受控组件：派发 input/change + 真实 InputEvent，确保 onChange 被触发
          el.dispatchEvent(new Event('input', { bubbles: true }));
          try { el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })); } catch (e) {}
          el.dispatchEvent(new Event('change', { bubbles: true }));
          try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '', code: 'Unidentified' })); } catch (e) {}
          // 验证 React 是否已接收：value/textContent 与目标一致才算成功
          var actual = (el.value !== undefined ? el.value : el.textContent) || '';
          if (String(actual) !== String(value)) return JSON.stringify({ ok: false, reason: 'value-mismatch' });
          return JSON.stringify({ ok: true });
        } catch (e) { return JSON.stringify({ ok: false, reason: 'err:' + e }); }
      })()`);
      let obj: any;
      try { obj = JSON.parse(res); } catch { obj = res; }
      // 测试桩直接返回裸布尔 true/false，视为确定性结果立即返回，避免无谓重试/超时
      if (typeof obj === 'boolean') return obj;
      if (obj && obj.ok) return true;
      if (attempt === 11) console.log('[Injector] fillText 失败，末次:', res);
      await sleep(500);
    }
    return false;
  }

  /**
   * 点击发送按钮（I-06/I-07）：优先按 aria-label 含「发送/send」定位，
   * 兜底取输入框工具栏的「最后一个按钮」（发送通常在最右）。
   * 轮询等待按钮出现并可用（非 disabled）后 click，规避 React 受控组件未刷新导致的空发。
   * 全程诊断日志（[Injector]）经 WindowManager.attachWebConsole 转发终端。
   */
  /**
   * 点击发送按钮（I-06/I-07）：优先按 class 含 --primary 定位，
   * 兜底取工具栏「最右一个非上传、非 toggle、非禁用、非剪刀」按钮。
   * 关键修正：DeepSeek 发送键是 DIV（非 button），且可能监听 mousedown/pointerdown 而非 click；
   * 故触发时派发完整事件序列（pointerdown→mousedown→mouseup→click）+ .click()，
   * 并轮询验证「是否真的发送」（输入框被清空 / 发送键转 disabled / 出现停止按钮），
   * 未发送则重试，避免「点了但没发」的静默失败。
   */
  public async clickSend(wc: WebContents): Promise<boolean> {
    let last = '';
    for (let attempt = 0; attempt < 33; attempt++) {
      const res = await wc.executeJavaScript(`(async () => {
        try {
          function disabledOf(b){ return b.disabled===true || b.getAttribute('aria-disabled')==='true' || (b.classList && b.classList.contains('disabled')); }
          function isToggle(b){ var a=(b.getAttribute('aria-label')||'').toLowerCase(); var t=(b.textContent||'').trim().toLowerCase(); return a.indexOf('思考')>=0||a.indexOf('搜索')>=0||a.indexOf('深度')>=0||a.indexOf('智能')>=0||t.indexOf('思考')>=0||t.indexOf('搜索')>=0; }
          function getUploadButton(){
            var fi=document.querySelector('input[type="file"]');
            if(!fi) return null;
            var el=fi.parentElement;
            while(el && el!==document.body){ var tag=el.tagName; if(tag==='BUTTON'||tag==='LABEL'||(el.getAttribute&&el.getAttribute('role')==='button')) return el; if((tag==='DIV'||tag==='SPAN')&&el.children&&Array.prototype.indexOf.call(el.children,fi)>=0&&el.querySelector('svg')!=null) return el; el=el.parentElement; }
            var p=fi.parentElement;
            for(var i=0;i<6 && p;i++){ var icons=p.querySelectorAll('svg').length; var btns=p.querySelectorAll('button, [role="button"]').length; if(icons>=3||btns>=3){ var cur=fi.parentElement; while(cur&&cur.parentElement&&cur.parentElement!==p) cur=cur.parentElement; return cur||p; } p=p.parentElement; }
            return null;
          }
          function getFooter(){
            var best=null,bestSvg=0;
            var p=(getUploadButton()||document.body).parentElement;
            for(var i=0;i<8 && p;i++){ var svg=p.querySelectorAll('svg').length; if(svg>bestSvg){bestSvg=svg;best=p;} p=p.parentElement; }
            return best;
          }
          function findSend(){
            var primary=document.querySelector('.ds-button--primary, [class*="--primary"]');
            if(primary && !disabledOf(primary)) return {b:primary, via:'primary'};
            var all=Array.from(document.querySelectorAll('button, [role="button"], .ds-button'));
            for(var i=0;i<all.length;i++){ var a=(all[i].getAttribute('aria-label')||'').toLowerCase(); if((a.indexOf('发送')>=0||a.indexOf('send')>=0)&&!disabledOf(all[i])) return {b:all[i],via:'label'}; }
            var footer=getFooter();
            if(footer){
              var btns=Array.from(footer.querySelectorAll('button, [role="button"], div[onclick], span[onclick]')).filter(function(c){ return c.id!=='ds-scissors-btn'; });
              for(var m=btns.length-1;m>=0;m--){ if(btns[m]!==getUploadButton() && !isToggle(btns[m]) && !disabledOf(btns[m])) return {b:btns[m],via:'rightmost'}; }
            }
            return null;
          }
          function fireClick(el){
            var types=['pointerdown','mousedown','mouseup','click'];
            for(var i=0;i<types.length;i++){ try{ el.dispatchEvent(new MouseEvent(types[i],{bubbles:true,cancelable:true,view:window})); }catch(e){} }
            try{ el.click(); }catch(e){}
          }
          var s=findSend();
          if(!s){ console.log('[Injector] clickSend: no-send'); return JSON.stringify({found:false, sent:false}); }
          var ta=document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], textarea');
          var preVal=ta?(ta.value||''):'';
          fireClick(s.b);
          var sent=false;
          for(var k=0;k<8;k++){
            await new Promise(function(r){ setTimeout(r,200); });
            var ta2=document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], textarea');
            var nowVal=ta2?(ta2.value||''):'';
            if(preVal && preVal.length>0 && nowVal.length===0){ sent=true; break; }
            var sb=document.querySelector('.ds-button--primary, [class*="--primary"]');
            if(sb && disabledOf(sb)){ sent=true; break; }
            if(document.querySelector('[class*="stop" i], button[aria-label*="停止"], [class*="abort" i]')){ sent=true; break; }
          }
          console.log('[Injector] clickSend -> ' + s.via + ' sent=' + sent);
          return JSON.stringify({found:true, sent:sent});
        } catch(e){ return JSON.stringify({found:false, sent:false, err:String(e)}); }
      })()`);
      let obj: any;
      try {
        obj = JSON.parse(res);
      } catch {
        obj = res;
      }
      // 测试桩直接返回裸布尔，视为确定性结果；真实场景返回 {found, sent} 结构
      if (typeof obj === 'boolean') return obj;
      if (obj && obj.sent) return true;
      last = res;
      await sleep(150);
    }
    console.log('[Injector] clickSend 失败，末次状态:', last);
    return false;
  }

}
