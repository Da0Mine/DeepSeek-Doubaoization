/**
 * 注入器：将截图 / 提示词注入到 chat.deepseek.com 的对话框。
 * 通过 wc.executeJavaScript + deepseek-selectors 实现；每个操作尝试多个候选选择器，
 * 全部失败返回 false（由调用方决定轻提示，不阻断）。
 *
 * ⚠️ 待实机验证：选择器与 React 受控组件赋值方式均基于推测，需在目标站点核对修正。
 */
import { app, type WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
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
import { logf } from '../logger';
import { DEEPSEEK_URL } from '../constants';
import { TASK_MODE_ICON_DATA_URL } from '../extensions/taskModeIcon';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** WPS 启动程序路径（本机装有 WPS 时用于提取程序图标，可选增强）。 */
const WPS_LAUNCH_EXE = 'D:\\wps\\wps64位\\WPS Office\\ksolaunch.exe';

/** 内置 WPS logo（随安装包分发，任何电脑都能读到，不依赖 WPS 安装路径）。
 * 相对本文件：dist/main/inject -> dist/renderer/assets/icons/wps-logo.png（与 getDocIconDataUrls 同级）。 */
const WPS_LOGO_PNG = path.join(__dirname, '..', '..', 'renderer', 'assets', 'icons', 'wps-logo.png');

let wpsIconDataUrlCache: string | null = null;

/**
 * 提取 WPS 图标为 PNG data URL，供「+」菜单共享项使用。结果模块级缓存。
 * 优先级：
 *  1. 内置 wps-logo.png（随安装包分发，跨电脑稳定——解决「打包到其他电脑后图标不显示」）；
 *  2. 本机 WPS 安装路径提取程序图标（装有 WPS 时更贴近真实图标）。
 * 全部失败返回 null，调用方回退到原 SVG 图标。
 */
async function getWpsIconDataUrl(): Promise<string | null> {
  if (wpsIconDataUrlCache) return wpsIconDataUrlCache;
  // 1) 内置 wps-logo.png：不依赖 WPS 安装路径，打包后任何电脑均可用
  try {
    if (fs.existsSync(WPS_LOGO_PNG)) {
      const buf = fs.readFileSync(WPS_LOGO_PNG);
      wpsIconDataUrlCache = 'data:image/png;base64,' + buf.toString('base64');
      return wpsIconDataUrlCache;
    }
  } catch (e) {
    /* 内置图标缺失则继续尝试 exe 提取 */
  }
  // 2) 本机 WPS 安装路径提取程序图标（可选增强，失败不影响）
  try {
    if (fs.existsSync(WPS_LAUNCH_EXE)) {
      const img = await app.getFileIcon(WPS_LAUNCH_EXE, { size: 'normal' });
      if (!img.isEmpty()) {
        const resized = img.resize({ width: 16, height: 16 });
        wpsIconDataUrlCache = resized.toDataURL();
        return wpsIconDataUrlCache;
      }
    }
  } catch (e) {
    /* 忽略 */
  }
  return null;
}

/** 文档格式图标的 data URL 缓存（docx/xlsx/pdf/pptx）。 */
let docIconDataUrlCache: Record<string, string> | null = null;

/**
 * 读取各格式文档图标（src/renderer/assets/doc-icons/*.svg）为 base64 data URL，
 * 供「共享文档」下拉列表每项前置格式图标。失败返回空对象（调用方回退纯文字）。
 */
function getDocIconDataUrls(): Record<string, string> {
  if (docIconDataUrlCache) return docIconDataUrlCache;
  const result: Record<string, string> = {};
  try {
    const dir = path.join(__dirname, '..', '..', 'renderer', 'assets', 'doc-icons');
    // 文件名 -> 内部 key（docIconOf 按扩展名取 key）
    const files: Record<string, string> = {
      docx: 'word.svg',
      xlsx: '表格.svg',
      pdf: 'pdf.svg',
      pptx: 'ppt.svg',
    };
    for (const [key, f] of Object.entries(files)) {
      try {
        const buf = fs.readFileSync(path.join(dir, f));
        result[key] = 'data:image/svg+xml;base64,' + buf.toString('base64');
      } catch {
        /* 单个图标缺失忽略 */
      }
    }
    docIconDataUrlCache = result;
  } catch {
    /* 忽略 */
  }
  return result;
}

export class Injector {
  constructor(private readonly templates: PromptTemplates) {}

  /**
   * 无痕徽章状态注入的串行链（按 webContents.id）。
   * 快速开关无痕模式时主进程会连续调用 setIncognitoState，executeJavaScript 为异步，若乱序执行
   * 会导致页面 window.__dsIncognitoActive 与徽章停留在历史值 →「打开没有蓝框 / 一直显示取消无痕」。
   * 用 promise 链强制按调用顺序应用，保证最终状态与最后一次开关一致。
   */
  private incognitoStateChain = new Map<number, Promise<void>>();

  /**
   * 内置 DeepSeek++ 插件是否启用。关闭插件时断开一切「基于插件设计」的注入：
   * 模式切换按钮 / token 小窗 / 占位文字 / 记忆提示词等（这些 UI 依赖插件的联网与 Shell 能力）。
   * 由主进程在初始化与开关插件时调用 setDsppEnabled 维护。
   */
  private dsppEnabled = true;

  /** 设置内置插件启用状态；返回 false 表示已断开（插件关闭）。 */
  public setDsppEnabled(enabled: boolean): void {
    this.dsppEnabled = !!enabled;
  }

  /** 内置插件当前是否启用（main.ts 据此决定是否应用「增强/任务「默认模式等）。 */
  public isDsppEnabled(): boolean {
    return this.dsppEnabled;
  }

  /**
   * 向对话框发送文本（可选附带图片）。内部统一走 submitToChat（I-06 强化自动发送）。
   * @returns 是否成功（找到输入框并可靠触发发送）。
   */
  public async sendToChat(wc: WebContents, text: string, img?: string): Promise<boolean> {
    return this.submitToChat(wc, text, img);
  }

  /**
   * 统一提交入口（I-06）：上传图(可选) → 填文 → 轮询等待发送按钮可用并点击。
   * @param maxWaitLoops 等待发送按钮可用的轮询次数（×100ms，默认 30≈3s；大附件上传时调大）。
   * @returns 是否成功触发发送。
   */
  public async submitToChat(wc: WebContents, text: string, img?: string | string[], maxWaitLoops = 30): Promise<boolean> {
    console.time('submitToChat:total');
    if (img) {
      console.time('submitToChat:uploadImage');
      const ok = await this.uploadImage(wc, img);
      console.timeEnd('submitToChat:uploadImage');
      if (!ok) return false;
      console.time('submitToChat:waitForUploadSettle');
      await this.waitForUploadSettle(wc);
      console.timeEnd('submitToChat:waitForUploadSettle');
    }
    // 合并 fillText + clickSend 为单个 executeJavaScript 调用，消除 IPC 开销
    console.time('submitToChat:fillTextAndSend');
    const ret = await this.fillTextAndSend(wc, text, maxWaitLoops);
    console.timeEnd('submitToChat:fillTextAndSend');
    console.timeEnd('submitToChat:total');
    return ret;
  }

  /** 合并 fillText + clickSend 为单个 executeJavaScript 调用，消除 IPC 开销 */
  public async fillTextAndSend(wc: WebContents, text: string, maxWaitLoops = 30): Promise<boolean> {
    const t = JSON.stringify(text);
    const loops = Math.max(3, Math.floor(maxWaitLoops));
    const res = await wc.executeJavaScript(`(async () => {
      try {
        function disabledOf(b){ return b.disabled===true || b.getAttribute('aria-disabled')==='true' || (b.classList && b.classList.contains('disabled')); }
        function getComposerFooter(input){
          if(!input) return null;
          var chain=[]; var p=input.parentElement;
          for(var i=0;i<8 && p;i++){ chain.push(p); p=p.parentElement; }
          var best=null,bestN=-1;
          for(var j=0;j<chain.length;j++){ var n=chain[j].querySelectorAll('button').length; if(n>bestN){bestN=n;best=chain[j];} }
          return best;
        }
        function findChatInput() {
          var sp = document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], [contenteditable][aria-label*="发送消息"]');
          if (sp) return sp;
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
        function findSend(){
          // 精准：发送/停止是唯一「圆形主按钮」，用稳定 ds- 语义类组合锁定（比任意 --primary 更精准）
          var primary=document.querySelector('[role="button"].ds-button--circle.ds-button--primary, .ds-button--circle.ds-button--primary, .ds-button--primary, [class*="--primary"]');
          if(primary && !disabledOf(primary)) return {b:primary, via:'primary'};
          var all=Array.from(document.querySelectorAll('button, [role="button"], .ds-button'));
          for(var i=0;i<all.length;i++){ var a=(all[i].getAttribute('aria-label')||'').toLowerCase(); if((a.indexOf('发送')>=0||a.indexOf('send')>=0)&&!disabledOf(all[i])) return {b:all[i],via:'label'}; }
          return null;
        }
        function fireClick(el){
          var types=['pointerdown','mousedown','mouseup'];
          for(var i=0;i<types.length;i++){ try{ el.dispatchEvent(new MouseEvent(types[i],{bubbles:true,cancelable:true,view:window})); }catch(e){} }
          try{ el.click(); }catch(e){}
        }
        // 1. 填入文本
        var el = findChatInput();
        if (!el) return JSON.stringify({ok: false, reason: 'no-input'});
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
        el.dispatchEvent(new Event('input', { bubbles: true }));
        try { el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })); } catch (e) {}
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // 2. 在页面事件循环中轮询等待发送按钮可用（最多 ${loops} × 100ms，自动等待 React 重渲染/附件上传）
        // 立即在页面异步任务中运行，自动等待 React 重渲染完成
        for (var wait = 0; wait < ${loops}; wait++) {
          await new Promise(function(r){ setTimeout(r, 100); });
          var s = findSend();
          if (!s) continue;
          var ta = document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], textarea');
          var preVal = ta ? (ta.value || '') : '';
          fireClick(s.b);
          var sent = false;
          for (var k = 0; k < 2; k++) {
            await new Promise(function(r){ setTimeout(r, 100); });
            var ta2 = document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], textarea');
            var nowVal = ta2 ? (ta2.value || '') : '';
            if (preVal && preVal.length > 0 && nowVal.length === 0) { sent = true; break; }
            var sb = document.querySelector('.ds-button--primary, [class*="--primary"]');
            if (sb && disabledOf(sb)) { sent = true; break; }
            if (document.querySelector('[class*="stop" i], button[aria-label*="停止"], [class*="abort" i]')) { sent = true; break; }
          }
          if (sent) { console.log('[Injector] fillTextAndSend -> ' + s.via + ' sent=' + sent + ' wait=' + wait); return JSON.stringify({ok:true}); }
        }
        console.log('[Injector] fillTextAndSend: timeout');
        return JSON.stringify({ok: false, reason: 'timeout'});
      } catch(e){ return JSON.stringify({ok: false, reason: 'err:' + String(e)}); }
    })()`);
    let obj: any;
    try { obj = JSON.parse(res); } catch { obj = res; }
    if (typeof obj === 'boolean') return obj;
    if (obj && obj.ok) return true;
    console.log('[Injector] fillTextAndSend 失败:', res);
    return false;
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
   * 注入「共享文档」选择浮层：在输入框上方显示 WPS 文档下拉框（默认选中最后打开的/激活的文档），
   * 并安装 Enter / 发送按钮拦截器——发送时通知主进程读取所选文档最新内容，组合后发送。
   * mode='all' 时为合并模式：docs 携带每项类型（word/excel/pdf），按所选文档类型发送与刷新；
   * 否则为旧版单类型模式（Word/Excel/PDF 各自独立）。
   * 取消按钮移除浮层并失效拦截器。
   */
  public async injectDocSharePicker(wc: WebContents, docs: { name: string; full: string; type?: 'word' | 'excel' | 'pdf' }[], mode: 'all' | 'word' | 'excel' | 'pdf' = 'all'): Promise<boolean> {
    const docsJson = JSON.stringify(docs.map((d) => ({ name: d.name, type: d.type || mode })));
    const modeJson = JSON.stringify(mode);
    const labelText = mode === 'all' ? '共享' : mode === 'excel' ? '共享WPS Excel' : mode === 'pdf' ? '共享WPS PDF' : '共享WPS Word';
    // 各格式文档图标（data URL），下拉列表每项前置对应格式图标
    const docIconsJson = JSON.stringify(getDocIconDataUrls());
    const code = `(() => {
      try {
        var shareMode = ${modeJson};
        // 文档格式图标映射：按扩展名取对应格式图标
        var docIcons = ${docIconsJson};
        function docIconOf(name) {
          var ext = (String(name).split('.').pop() || '').toLowerCase();
          if (ext === 'xlsx' || ext === 'xls') return docIcons.xlsx;
          if (ext === 'pdf') return docIcons.pdf;
          if (ext === 'pptx' || ext === 'ppt') return docIcons.pptx;
          return docIcons.docx;
        }
        // 映射为「+」菜单项的 type（shareDocAll/shareDoc/shareExcel/sharePdf），用于菜单蓝色高亮与再点取消
        var shareItemType = shareMode === 'all' ? 'shareDocAll' : shareMode === 'excel' ? 'shareExcel' : shareMode === 'pdf' ? 'sharePdf' : 'shareDoc';
        // 清理上一次注入的浮层（版本号机制让旧拦截器失效）
        window.__dsDocShareVersion = (window.__dsDocShareVersion || 0) + 1;
        var ver = window.__dsDocShareVersion;
        // 清除上一次注入的刷新定时器：旧格式的定时器残留会持续请求刷新，
        // 且刷新结果广播给所有已注册回调，造成其他格式的悬浮框被反复改选中项（抢控制权）
        if (window.__dsDocShareRefreshTimer) {
          clearInterval(window.__dsDocShareRefreshTimer);
          window.__dsDocShareRefreshTimer = null;
        }
        var old = document.getElementById('ds-doc-picker');
        if (old) old.remove();
        if (window.__dsDocClickHide) {
          document.removeEventListener('click', window.__dsDocClickHide);
          window.__dsDocClickHide = null;
        }
        var oldDropdown = document.getElementById('ds-doc-dropdown');
        if (oldDropdown) oldDropdown.remove();

        // CSS zoom 坐标换算：字号缩放通过注入 documentElement.style.zoom 实现（WindowManager.applyFontZoom）。
        // zoom ≠ 1 时 getBoundingClientRect 返回「缩放后」坐标，而 position:fixed 的 left/top 是「布局」坐标
        // （渲染时被 zoom 放大），直接混用会导致浮层向右下偏移（加号菜单 / 悬浮框 / 下拉框全部中招）。
        // 统一把 rect 除以当前 zoom，得到布局坐标后再用于 fixed 定位。
        function layoutRect(el) {
          var r = el.getBoundingClientRect();
          try {
            var z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            if (z !== 1 && z > 0) {
              return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z, x: r.x / z, y: r.y / z };
            }
          } catch (e) {}
          return r;
        }

        function findInput() {
          return document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], textarea, [contenteditable="true"], [role="textbox"]');
        }
        function currentText() {
          var inp = findInput();
          if (!inp) return '';
          if (inp.tagName === 'TEXTAREA') return inp.value || '';
          return inp.textContent || '';
        }

        // 1. 创建浮层（标题 + 自定义下拉 + 取消）——半透明毛玻璃 + 圆角卡片
        var docs = ${docsJson};
        var selectedName = docs.length ? docs[0].name : '';
        // 合并模式下每个文档自带类型（word/excel/pdf）；单类型模式下统一为 shareMode
        var selectedType = docs.length ? (docs[0].type || shareMode) : 'word';
        // 多选共享状态：multiMode=是否多选模式；checkedNames=勾选的文档名->true
        var multiMode = false;
        var checkedNames = {};
        // 文档名 -> 类型映射（发送时按所选文档类型取数）
        var docTypeOf = {};
        for (var di = 0; di < docs.length; di++) { docTypeOf[docs[di].name] = docs[di].type || shareMode; }
        // 更新悬浮窗显示的共享文件名（多选时显示「xxx等N个文件」）
        function updateDisplayText() {
          if (multiMode) {
            var checkedList = [];
            for (var i = 0; i < docs.length; i++) { if (checkedNames[docs[i].name]) checkedList.push(docs[i]); }
            if (checkedList.length === 0) curText.textContent = '未选择文档';
            else curText.textContent = checkedList[0].name + '等' + checkedList.length + '个文件';
          } else {
            curText.textContent = selectedName || '暂无打开的文档';
          }
        }
        var picker = document.createElement('div');
        picker.id = 'ds-doc-picker';
        picker.style.cssText = 'position:fixed;display:flex;align-items:center;gap:6px;padding:5px 8px 5px 12px;background:rgba(28,30,38,0.55);backdrop-filter:blur(20px) saturate(1.6);-webkit-backdrop-filter:blur(20px) saturate(1.6);border:1px solid rgba(255,255,255,0.18);border-radius:10px;z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;';
        var label = document.createElement('span');
        label.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#c8cdd6;white-space:nowrap;font-weight:500;';
        label.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><span>' + ${JSON.stringify(labelText)} + '</span>';

        // 显示框（点击展开下拉，替代原生 select）——宽度收窄，展开的下拉列表宽度不受其限制
        var current = document.createElement('div');
        current.id = 'ds-doc-current';
        current.style.cssText = 'display:inline-flex;align-items:center;gap:4px;max-width:150px;height:24px;padding:0 8px;background:rgba(255,255,255,0.07);color:#e8eaed;border:1px solid rgba(255,255,255,0.14);border-radius:7px;font-size:12px;cursor:pointer;transition:border-color 0.15s,background 0.15s;user-select:none;-webkit-user-select:none;';
        var curText = document.createElement('span');
        curText.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;';
        curText.textContent = docs.length ? docs[0].name : '暂无打开的文档';
        var caret = document.createElement('span');
        caret.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;display:block;"><polyline points="6 9 12 15 18 9"/></svg>';
        current.appendChild(curText);
        current.appendChild(caret);
        if (docs.length > 0) {
          current.onmouseenter = function () { this.style.borderColor = 'rgba(90,140,255,0.55)'; this.style.background = 'rgba(255,255,255,0.12)'; };
          current.onmouseleave = function () { this.style.borderColor = 'rgba(255,255,255,0.14)'; this.style.background = 'rgba(255,255,255,0.07)'; };
        } else {
          current.style.cursor = 'default';
          current.style.opacity = '0.6';
        }

        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = '取消';
        cancel.style.cssText = 'display:inline-flex;align-items:center;background:transparent;border:none;color:#9aa0ad;font-size:12px;cursor:pointer;padding:4px 8px;border-radius:7px;font-family:inherit;transition:color 0.15s,background 0.15s;';
        cancel.onmouseenter = function () { this.style.color = '#fff'; this.style.background = 'rgba(255,255,255,0.1)'; };
        cancel.onmouseleave = function () { this.style.color = '#9aa0ad'; this.style.background = 'transparent'; };
        picker.appendChild(label);
        picker.appendChild(current);
        picker.appendChild(cancel);
        document.body.appendChild(picker);

        // 展开的下拉列表（自定义 div，样式与上方悬浮框一致：同背景色/透明度/阴影）。
        // 列表区默认最多显示 5 个文档，更多则列表内滚动；底部按钮固定在列表下方。
        var dropdown = document.createElement('div');
        dropdown.id = 'ds-doc-dropdown';
        dropdown.style.cssText = 'position:fixed;display:none;min-width:200px;max-width:250px;overflow-y:auto;background:rgba(28,30,38,0.55);backdrop-filter:blur(20px) saturate(1.6);-webkit-backdrop-filter:blur(20px) saturate(1.6);border:1px solid rgba(255,255,255,0.18);border-radius:10px;z-index:2147483646;box-shadow:0 8px 28px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;';
        // 文档列表独立滚动区：多选按钮固定在其下方，不会覆盖/吞掉最后一项。
        // 默认最多显示 5 个文档（item 高约 28px），更多则滚动。
        var listBox = document.createElement('div');
        listBox.id = 'ds-doc-list';
        listBox.style.cssText = 'max-height:140px;overflow-y:auto;padding:4px;';
        dropdown.appendChild(listBox);
        // 构建下拉列表选项（初始与实时刷新共用；list 元素为 { name, type }）
        // 单文件模式：点击某项=选中并收起；多选模式：点击某项=勾选/取消（立即生效，不收起）。
        // 文档数量 >= 2 时列表底部追加「共享多个/全选」按钮（固定在滚动区下方，始终可见）。
        function buildDropdownItems(list) {
          listBox.innerHTML = '';
          if (!list || list.length === 0) {
            var emptyItem = document.createElement('div');
            emptyItem.textContent = '暂无打开的文档';
            emptyItem.style.cssText = 'padding:8px 12px;font-size:12px;color:#8a8f9c;border-radius:6px;';
            listBox.appendChild(emptyItem);
            if (dropdown.style.display === 'block') placeDropdown();
            return;
          }
          for (var i = 0; i < list.length; i++) {
            (function (d) {
              var isChecked = !!checkedNames[d.name];
              var isSelected = !multiMode && selectedName === d.name;
              var item = document.createElement('div');
              item.setAttribute('data-doc', d.name);
              item.title = d.name; // 文件名过长被截断时，悬浮显示完整名字
              item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;line-height:16px;cursor:pointer;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background 0.12s,color 0.12s;' + ((isChecked || isSelected) ? 'background:rgba(90,140,255,0.18);color:#fff;' : 'color:#d5d9e0;');
              // 勾选标记框（多选模式显示，位于图标之前）
              var box = document.createElement('span');
              box.style.cssText = 'display:' + (multiMode ? 'inline-flex' : 'none') + ';align-items:center;justify-content:center;width:14px;height:14px;border:1px solid ' + (isChecked ? 'rgba(90,140,255,0.9)' : 'rgba(255,255,255,0.35)') + ';border-radius:4px;background:' + (isChecked ? 'rgba(90,140,255,0.9)' : 'transparent') + ';color:#fff;font-size:10px;line-height:1;flex:none;';
              box.textContent = isChecked ? '\u2713' : '';
              item.appendChild(box);
              // 格式图标（docx/xlsx/pdf/pptx）
              var ico = document.createElement('img');
              ico.src = docIconOf(d.name);
              ico.width = 16;
              ico.height = 16;
              ico.style.cssText = 'width:16px;height:16px;object-fit:contain;flex:none;display:block;';
              item.appendChild(ico);
              var txt = document.createElement('span');
              txt.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
              txt.textContent = d.name;
              item.appendChild(txt);
              item.onmouseenter = function () { if (!isChecked && !isSelected) this.style.background = 'rgba(90,140,255,0.22)'; };
              item.onmouseleave = function () { this.style.background = (isChecked || isSelected) ? 'rgba(90,140,255,0.18)' : 'transparent'; };
              item.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (multiMode) {
                  // 多选模式：勾选/取消勾选，立即生效，不关闭下拉（可连续勾选）
                  if (checkedNames[d.name]) delete checkedNames[d.name];
                  else checkedNames[d.name] = true;
                  // 只勾选 1 个时自动回退到单文件共享模式
                  var cnt = 0, only = '';
                  for (var k in checkedNames) { if (checkedNames[k]) { cnt++; only = k; } }
                  if (cnt === 1) {
                    multiMode = false;
                    selectedName = only;
                    selectedType = docTypeOf[only] || 'word';
                    checkedNames = {};
                  }
                  buildDropdownItems(list);
                  updateDisplayText();
                } else {
                  selectedName = d.name;
                  selectedType = docTypeOf[d.name] || 'word';
                  curText.textContent = d.name;
                  hideDropdown();
                }
              });
              listBox.appendChild(item);
            })(list[i]);
          }
          // 底部按钮：文档 >= 2 时显示（固定在滚动区下方，不会被滚动吞掉）。
          // 单文件模式：单个「共享多个」按钮；多选模式：三个按钮「全选 | 确定 | 退出」。
          var oldBar = document.getElementById('ds-doc-multi-bar');
          if (oldBar) oldBar.remove();
          var oldBtn = document.getElementById('ds-doc-multi-btn');
          if (oldBtn) oldBtn.remove();
          if (list.length >= 2) {
            var allChecked = true;
            for (var ai = 0; ai < list.length; ai++) { if (!checkedNames[list[ai].name]) { allChecked = false; break; } }
            if (!multiMode) {
              // 单文件模式：点击「共享多个」进入多选
              var multiBtn = document.createElement('button');
              multiBtn.type = 'button';
              multiBtn.id = 'ds-doc-multi-btn';
              multiBtn.textContent = '共享多个';
              multiBtn.style.cssText = 'display:block;width:100%;padding:6px 12px;border:none;border-top:1px solid rgba(255,255,255,0.1);background:transparent;color:#9db5ff;font-size:12px;cursor:pointer;text-align:center;border-radius:0 0 10px 10px;transition:background 0.12s;font-family:inherit;';
              multiBtn.onmouseenter = function () { this.style.background = 'rgba(90,140,255,0.28)'; };
              multiBtn.onmouseleave = function () { this.style.background = 'transparent'; };
              multiBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                // 进入多选：当前选中的单文档预勾选
                multiMode = true;
                checkedNames = {};
                if (selectedName && docTypeOf[selectedName]) checkedNames[selectedName] = true;
                buildDropdownItems(list);
                updateDisplayText();
              });
              dropdown.appendChild(multiBtn);
            } else {
              // 多选模式：左「全选」/ 中「确定」/ 右「退出」
              var bar = document.createElement('div');
              bar.id = 'ds-doc-multi-bar';
              bar.style.cssText = 'display:flex;gap:6px;padding:6px 8px;border-top:1px solid rgba(255,255,255,0.1);border-radius:0 0 10px 10px;';
              var btnBase = 'flex:1;height:26px;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;transition:background 0.12s,color 0.12s;';
              // 全选 / 全不选（点击一次全选，再点击一次全不选）
              var allBtn = document.createElement('button');
              allBtn.type = 'button';
              allBtn.textContent = allChecked ? '全不选' : '全选';
              allBtn.style.cssText = btnBase + 'background:rgba(255,255,255,0.06);color:#9db5ff;';
              allBtn.onmouseenter = function () { this.style.background = 'rgba(90,140,255,0.24)'; };
              allBtn.onmouseleave = function () { this.style.background = 'rgba(255,255,255,0.06)'; };
              allBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (allChecked) checkedNames = {};
                else { checkedNames = {}; for (var si = 0; si < list.length; si++) checkedNames[list[si].name] = true; }
                buildDropdownItems(list);
                updateDisplayText();
              });
              // 确定：确认当前勾选并收起下拉（勾选已立即生效）
              var okBtn = document.createElement('button');
              okBtn.type = 'button';
              okBtn.textContent = '确定';
              okBtn.style.cssText = btnBase + 'background:rgba(90,140,255,0.92);color:#fff;';
              okBtn.onmouseenter = function () { this.style.background = 'rgba(110,155,255,1)'; };
              okBtn.onmouseleave = function () { this.style.background = 'rgba(90,140,255,0.92)'; };
              okBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                hideDropdown();
              });
              // 退出：退出多选模式，恢复单文件选择
              var exitBtn = document.createElement('button');
              exitBtn.type = 'button';
              exitBtn.textContent = '退出';
              exitBtn.style.cssText = btnBase + 'background:rgba(255,255,255,0.06);color:#c8cdd6;';
              exitBtn.onmouseenter = function () { this.style.background = 'rgba(255,255,255,0.14)'; };
              exitBtn.onmouseleave = function () { this.style.background = 'rgba(255,255,255,0.06)'; };
              exitBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                // 退出多选模式：清除勾选，恢复单文件模式（selectedName 保持进入多选前的单文档）
                multiMode = false;
                checkedNames = {};
                buildDropdownItems(list);
                updateDisplayText();
              });
              bar.appendChild(allBtn);
              bar.appendChild(okBtn);
              bar.appendChild(exitBtn);
              dropdown.appendChild(bar);
            }
          }
          // 重建后内容高度可能变化（单按钮↔三按钮等），下拉框打开中需立即重锚位置，避免框漂移"卡一下"
          if (dropdown.style.display === 'block') placeDropdown();
        }
        buildDropdownItems(docs);
        document.body.appendChild(dropdown);

        // 下拉框定位：固定向上展开（picker 靠近窗口底部，向下展开必然被副窗口下边界截断）。
        // 上方空间不足时按可用空间收缩整体高度，内容整体滚动（按钮滚动可达）。
        // 统一使用布局坐标（layoutRect）：与 position:fixed 的 left/top、offsetWidth/offsetHeight、
        // window.innerWidth/innerHeight 同坐标系（实测 offset 系列与 innerWidth 不受 CSS zoom 影响）。
        function placeDropdown() {
          var r = layoutRect(current);
          var dw = dropdown.offsetWidth || 220;
          var left = Math.max(8, r.left);
          if (left + dw > window.innerWidth - 8) left = window.innerWidth - dw - 8;
          var spaceUp = r.top - 14;
          if (spaceUp < 80) spaceUp = 80;
          dropdown.style.maxHeight = spaceUp + 'px';
          var dh = dropdown.offsetHeight || 200;
          var top = r.top - dh - 6;
          if (top < 8) top = 8;
          dropdown.style.left = left + 'px';
          dropdown.style.top = top + 'px';
        }
        function showDropdown() {
          if (!docs.length) return;
          // 打开前重建列表，让选中高亮/勾选状态与当前一致
          // （单文件切换后仅更新上方文字并收起，未重建；若不重建，重开时高亮仍是旧的，要等 5s 定时刷新才变）
          buildDropdownItems(docs);
          dropdown.style.display = 'block';
          placeDropdown();
        }
        function hideDropdown() { dropdown.style.display = 'none'; }
        current.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (dropdown.style.display === 'block') hideDropdown();
          else showDropdown();
        });
        // 点击浮层/列表外部关闭下拉
        function docClickHide() { hideDropdown(); }
        window.__dsDocClickHide = docClickHide;
        document.addEventListener('click', window.__dsDocClickHide);

        // 共享期间实时检测新打开的文档：每 5s 请求主进程刷新列表，新文档即时出现在下拉框。
        // 注意：刷新结果会广播给所有已注册回调（含旧注入/其他格式的残留），
        // 必须按「版本号 + 模式」双重过滤，其他格式的刷新结果一律忽略，
        // 否则会出现「打开其他格式时，该格式一直抢着改本格式悬浮框的选中项」的反复切换。
        if (window.__ds && window.__ds.onDocShareRefresh) {
          window.__ds.onDocShareRefresh(function (payload) {
            if (window.__dsDocShareVersion !== ver) return; // 旧注入的回调作废
            var newDocs = payload && payload.mode === shareMode && Array.isArray(payload.docs) ? payload.docs : null;
            if (!newDocs) return; // 模式不匹配（其他格式的刷新结果）忽略
            // 同步类型映射
            for (var ti = 0; ti < newDocs.length; ti++) { if (newDocs[ti] && newDocs[ti].name) docTypeOf[newDocs[ti].name] = newDocs[ti].type || shareMode; }
            // 清理已关闭文档的勾选状态
            var aliveNames = {};
            for (var aj = 0; aj < newDocs.length; aj++) { if (newDocs[aj] && newDocs[aj].name) aliveNames[newDocs[aj].name] = true; }
            var newChecked = {};
            for (var ck in checkedNames) { if (checkedNames[ck] && aliveNames[ck]) newChecked[ck] = true; }
            checkedNames = newChecked;
            var sel = selectedName;
            var exists = sel && newDocs.some(function (d) { return d && d.name === sel; });
            docs = newDocs;
            buildDropdownItems(newDocs);
            if (multiMode) {
              // 多选模式：保持勾选；若全部文档消失则回退单文件模式
              var mcnt = 0; for (var mk in checkedNames) { if (checkedNames[mk]) mcnt++; }
              if (mcnt === 0) {
                multiMode = false;
                selectedName = exists ? sel : (newDocs.length ? newDocs[0].name : '');
                selectedType = exists ? (docTypeOf[sel] || 'word') : (newDocs.length ? (newDocs[0].type || 'word') : 'word');
              }
              updateDisplayText();
            } else if (!exists && newDocs.length) {
              selectedName = newDocs[0].name;
              selectedType = newDocs[0].type || 'word';
              updateDisplayText();
            } else if (newDocs.length === 0) {
              selectedName = '';
              selectedType = 'word';
              updateDisplayText();
            }
            // 有文档时恢复显示框可交互样式（此前可能处于「暂无文档」的置灰状态）
            current.style.cursor = newDocs.length > 0 ? 'pointer' : 'default';
            current.style.opacity = newDocs.length > 0 ? '' : '0.6';
          });
        }
        window.__dsDocShareRefreshTimer = setInterval(function () {
          if (window.__ds && window.__ds.send) window.__ds.send('docShare:refresh', { mode: shareMode });
        }, 5000);

        // 2. 定位：浮层始终贴到「输入框区域最顶端元素」（含上传附件后新出现的附件条）的上边界，
        //    附件条出现时浮层自动上移，不再遮挡附件框；滚动/缩放/尺寸变化实时跟随
        var posTimer = null;
        function position() {
          var inp = findInput();
          if (!inp) return;
          // 向上找「同时含文件输入与文本输入」的 composer 容器
          var composer = inp.parentElement;
          for (var i = 0; i < 8 && composer; i++) {
            if (composer.querySelector && composer.querySelector('input[type="file"]') && composer.querySelector('textarea, [contenteditable="true"]')) break;
            composer = composer.parentElement;
          }
          if (!composer) composer = inp.parentElement;
          var cRect = layoutRect(composer);
          var inpRect = layoutRect(inp);
          // 在 composer 内找「完全位于输入框上方、可见且高度足够的元素」：
          // 取其中 bottom 最大（最贴近输入框顶部）的一个作为锚点（上传附件后出现的附件条即命中），
          // 不再要求顶部必须对齐 composer 顶部，避免附件条未贴顶时锚点取错导致浮层压住附件。
          var topEl = null;
          var topElBottom = -1;
          if (composer.querySelectorAll) {
            var kids = composer.querySelectorAll('div, section');
            for (var j = 0; j < kids.length; j++) {
              var el = kids[j];
              if (!el || el.id === 'ds-doc-picker' || el.id === 'ds-doc-dropdown') continue;
              // 跳过不可见元素（DeepSeek 的附件容器平时 visibility:hidden 占位，上传后才可见）
              var cs = null;
              try { cs = window.getComputedStyle(el); } catch (e) {}
              if (cs && (cs.visibility === 'hidden' || cs.display === 'none')) continue;
              var br = layoutRect(el);
              if (br.height < 8 || br.width < 8) continue;
              // 底部不越过输入框顶部，视为输入框上方的附件条/块
              if (br.bottom <= inpRect.top + 2 && br.bottom > topElBottom) {
                topEl = el; topElBottom = br.bottom;
              }
            }
          }
          var anchor = topElBottom > 0 && topEl ? layoutRect(topEl) : cRect;
          var h = picker.offsetHeight || 40;
          var top = anchor.top - h - 6;
          if (top < 8) top = anchor.bottom + 6;
          picker.style.left = Math.max(8, anchor.left) + 'px';
          picker.style.top = top + 'px';
          if (dropdown.style.display === 'block') placeDropdown();
        }
        position();
        window.addEventListener('scroll', position, true);
        window.addEventListener('resize', position);
        // 输入框文字增多高度变化时，ResizeObserver 实时重新定位，避免浮层遮挡
        try {
          var inpTarget = findInput();
          if (inpTarget && typeof ResizeObserver === 'function') {
            var ro = new ResizeObserver(function () { position(); });
            ro.observe(inpTarget);
            picker.__dsRo = ro;
          }
        } catch (e) {}
        // 兜底轮询（极低频率，开销可忽略），保证任何布局变化后位置最终正确
        posTimer = setInterval(function () { position(); }, 500);

        // 3. 激活共享文档模式（无文档时 selectedName 为空，不拦截发送）。
        //    若注入完成前用户已再次点击取消/切换（__dsRequestedShare 与本次类型不符），
        //    则不激活本次共享，仅清理本次注入产生的 UI（不触碰最新请求的全局状态）。
        if (window.__dsRequestedShare !== shareItemType) {
          window.__dsDocShareVersion++;
          cleanupShareUi();
          return false;
        }
        window.__dsDocShareActive = true;
        window.__dsDocShareProcessing = false;
        // 同步「+」菜单共享文档项的蓝色高亮（__dsDocShareActive 已置真，isMenuHighlighted 据此置亮）
        window.__dsRequestedShare = shareItemType;
        if (window.__dsSyncShareMenu) window.__dsSyncShareMenu();

        // 提交期间隐藏浮层/下拉列表；发送完成后由主进程调用 __dsDocPickerShow() 恢复显示
        // 注意：恢复时下拉列表必须保持收起（不恢复展开状态），避免发送后自动展开/位置错乱到左上角
        function hidePickerForSubmit() {
          var p = document.getElementById('ds-doc-picker');
          if (p) { p.__dsPrevDisplay = p.style.display; p.style.display = 'none'; }
          var dd = document.getElementById('ds-doc-dropdown');
          if (dd && dd.style.display !== 'none') dd.style.display = 'none';
        }
        window.__dsDocPickerShow = function () {
          var p = document.getElementById('ds-doc-picker');
          if (p) {
            p.style.display = p.__dsPrevDisplay || 'flex';
            try { position(); } catch (e) {}
          }
          // 下拉列表保持收起，避免发送后自动展开或残留在左上角
          var dd = document.getElementById('ds-doc-dropdown');
          if (dd) dd.style.display = 'none';
        };

        // 检测 AI 是否正在输出：存在「停止/终止」按钮即视为生成中
        function isGenerating() {
          try {
            if (document.querySelector('[class*="stop" i], [class*="abort" i], [class*="stopgenerate" i], button[aria-label*="停止"], button[aria-label*="终止"]')) return true;
            var primary = document.querySelector('.ds-button--primary, [class*="--primary"]');
            if (primary) {
              var t = (primary.textContent || '') + ' ' + (primary.getAttribute('aria-label') || '');
              if (/停止|终止|abort|stop/i.test(t)) return true;
            }
            return false;
          } catch (e) { return false; }
        }

        function trySend() {
          if (!window.__ds || !window.__ds.send) return false;
          if (window.__dsDocShareProcessing) return false;
          var text = currentText();
          window.__dsDocShareProcessing = true;
          hidePickerForSubmit(); // 提交期间隐藏共享文档悬浮窗，发送完成后由主进程恢复
          if (multiMode) {
            // 多选：收集所有勾选文档（含类型），首次由主进程全部上传，之后按改动增量上传
            var names = [], types = [];
            for (var qi = 0; qi < docs.length; qi++) {
              if (checkedNames[docs[qi].name]) {
                names.push(docs[qi].name);
                types.push(docTypeOf[docs[qi].name] || 'word');
              }
            }
            if (names.length === 0) {
              window.__dsDocShareProcessing = false;
              hidePickerForSubmit();
              if (window.__dsDocPickerShow) window.__dsDocPickerShow();
              return false;
            }
            window.__ds.send('docShare:send', { text: text, docNames: names, docTypes: types, multi: true });
          } else {
            var docName = selectedName || '';
            if (!docName) {
              window.__dsDocShareProcessing = false;
              hidePickerForSubmit();
              if (window.__dsDocPickerShow) window.__dsDocPickerShow();
              return false; // 未选择有效文档（如「暂无打开的文档」）则不拦截
            }
            window.__ds.send('docShare:send', { text: text, docName: docName, mode: selectedType || 'word' });
          }
          // 立即清空输入框并恢复可写（主进程读取文档后重新填文并发送）
          var inp = findInput();
          if (inp) {
            if (inp.tagName === 'TEXTAREA') { inp.value = ''; }
            else { inp.textContent = ''; }
            try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
          }
          // 30s 超时兜底解锁（正常发送完成后主进程会主动解锁），同时恢复浮层显示
          setTimeout(function () {
            window.__dsDocShareProcessing = false;
            if (window.__dsDocPickerShow) window.__dsDocPickerShow();
          }, 30000);
          return true;
        }

        // 4. Enter 拦截（仅当 AI 已输出结束且输入框有内容时拦截；fillTextAndSend 不派发 keydown）
        document.addEventListener('keydown', function (e) {
          if (!window.__dsDocShareActive || window.__dsDocShareVersion !== ver) return;
          // 页面内查找栏（Ctrl+F）输入框里的 Enter（查找下一个）不拦截
          if (e.target && e.target.closest && e.target.closest('#ds-find-bar')) return;
          if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.isTrusted !== true) return;
          if (isGenerating()) return; // AI 输出中不拦截（终止对话等放行）
          if (!findInput()) return;
          if (!currentText().trim()) return; // 输入框为空不拦截
          if (trySend()) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
          }
        }, true);

        // 5. 发送按钮点击拦截（isTrusted 区分真实点击 vs 合成点击，避免与 fillTextAndSend 冲突）
        document.addEventListener('click', function (e) {
          if (!window.__dsDocShareActive || window.__dsDocShareVersion !== ver) return;
          if (e.isTrusted !== true) return;
          var t = e.target;
          if (!t || !t.closest) return;
          var btn = t.closest('.ds-button--primary, [class*="--primary"], button[aria-label*="发送"], [role="button"][aria-label*="发送"]');
          if (!btn) return;
          if (btn.disabled === true || btn.getAttribute('aria-disabled') === 'true') return;
          // AI 输出中（停止/终止按钮与主按钮同样式）一律放行，不拦截
          if (isGenerating()) return;
          // 输入框为空时不拦截（空输入状态点主按钮无发送意图）
          if (!currentText().trim()) return;
          // 再排除含「停止/终止」字样的按钮（双保险）
          var bt = (btn.textContent || '') + ' ' + (btn.getAttribute('aria-label') || '');
          if (/停止|终止|abort|stop/i.test(bt)) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          trySend();
        }, true);

        // 6. 取消：移除浮层/下拉列表 + 失效拦截器 + 通知主进程。
        //    cleanupShareUi()：仅清理本次注入产生的 UI/定时器（供注入被新请求取代时自取消用，
        //    不触碰全局状态 __dsShareActiveMode/__dsRequestedShare）；
        //    stopShare()：完整取消共享（用户点「取消」/「+」菜单再次点击），并清空全局状态。
        function cleanupShareUi() {
          var p = document.getElementById('ds-doc-picker');
          if (p) {
            if (p.__dsRo) { try { p.__dsRo.disconnect(); } catch (er) {} }
            p.remove();
          }
          var dd = document.getElementById('ds-doc-dropdown');
          if (dd) dd.remove();
          if (window.__dsDocClickHide) { document.removeEventListener('click', window.__dsDocClickHide); window.__dsDocClickHide = null; }
          if (window.__dsDocShareRefreshTimer) { clearInterval(window.__dsDocShareRefreshTimer); window.__dsDocShareRefreshTimer = null; }
          if (posTimer) { clearInterval(posTimer); posTimer = null; }
          window.removeEventListener('scroll', position, true);
          window.removeEventListener('resize', position);
          if (window.__ds && window.__ds.send) window.__ds.send('docShare:stop', { mode: shareMode });
        }
        function stopShare() {
          window.__dsDocShareActive = false;
          window.__dsDocShareVersion++;
          window.__dsRequestedShare = null;
          if (window.__dsSyncShareMenu) window.__dsSyncShareMenu();
          cleanupShareUi();
        }
        window.__dsDocShareStop = stopShare;
        cancel.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          stopShare();
        });

        return true;
      } catch (e) {
        console.error('[Injector] 注入共享文档浮层失败:', e);
        return false;
      }
    })()`;
    try {
      return Boolean(await wc.executeJavaScript(code));
    } catch (e) {
      console.error('[Injector] injectDocSharePicker 失败:', e);
      return false;
    }
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
            // 文件已挂到 input[type=file]（图片/任意附件都适用）
            var fi = document.querySelector('input[type="file"]');
            if (fi && fi.files && fi.files.length > 0) return true;
            function getComposerFooter() {
              var fi2 = document.querySelector('input[type="file"]');
              if (!fi2) return null;
              var el = fi2.parentElement; var best = null, bestSvg = 0;
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
      await sleep(100);
    }
  }

  /** 上传文件到文件输入（依赖 webviewPreload 暴露的 window.__ds.uploadFile/uploadFiles）。
   *  filePath 传单个路径或路径数组（多文件，如「共享多个文档」）。返回是否成功挂上文件。 */
  public async uploadImage(wc: WebContents, filePath: string | string[]): Promise<boolean> {
    const paths = Array.isArray(filePath) ? filePath : [filePath];
    const pathsJson = JSON.stringify(paths);
    const multi = paths.length > 1;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = `(() => {
        try {
          var __paths = ${pathsJson};
          if (!(window.__ds && typeof window.__ds.uploadFiles === 'function')) {
            return JSON.stringify({ ok: false, reason: 'no-preload' });
          }
          var ok = ${multi ? 'window.__ds.uploadFiles(__paths)' : 'window.__ds.uploadFile(__paths[0])'};
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
          console.log('[Injector] uploadImage preload=' + obj.preload + ' attached=' + obj.attached + ' files=' + paths.length);
          return true;
        }
        if (attempt === 7) console.log('[Injector] uploadImage 失败，末次: ' + res);
      } catch (e) {
        console.error('[Injector] uploadImage 异常', e);
      }
      await sleep(100);
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
   * 读取当前对话的模型模式（快速/专家/识图）。
   * 新对话（模型选择器在 DOM 中）：读取 radio 的 aria-checked；
   * 已有对话（radio 已被页面卸载）：读取 header 对话标题下方的模式文本标签
   * （.the-header 内精确匹配「快速模式 / 专家模式 / 识图模式」，实测该标签随对话存在）。
   * 均无法判定时返回 null。
   */
  public async getCurrentModelMode(wc: WebContents): Promise<'simple' | 'expert' | 'vision' | null> {
    try {
      const res: any = await wc.executeJavaScript(`(() => {
        try {
          var radios = Array.from(document.querySelectorAll('[data-model-type][role="radio"]'));
          for (var i = 0; i < radios.length; i++) {
            if (radios[i].getAttribute('aria-checked') === 'true') {
              var t = radios[i].getAttribute('data-model-type');
              if (t === 'expert') return 'expert';
              if (t === 'vision') return 'vision';
              return 'simple';
            }
          }
          var header = document.querySelector('.the-header') || document.querySelector('header');
          if (header) {
            var spans = header.querySelectorAll('span');
            for (var j = 0; j < spans.length; j++) {
              var txt = (spans[j].textContent || '').trim();
              if (txt === '\u5feb\u901f\u6a21\u5f0f') return 'simple';
              if (txt === '\u4e13\u5bb6\u6a21\u5f0f') return 'expert';
              if (txt === '\u8bc6\u56fe\u6a21\u5f0f') return 'vision';
            }
          }
          return null;
        } catch (e) { return null; }
      })()`);
      if (res === 'simple' || res === 'expert' || res === 'vision') return res;
      return null;
    } catch (e) {
      console.error('[Injector] getCurrentModelMode 异常:', e);
      return null;
    }
  }

  /** 当前对话是否支持切换模型（模型选择器 radio 仍在 DOM；发送消息后会被页面卸载）。 */
  public async canSwitchModel(wc: WebContents): Promise<boolean> {
    try {
      const res: any = await wc.executeJavaScript(`(() => {
        try {
          return !!(document.querySelector('[role="radiogroup"]') || document.querySelector('[data-model-type][role="radio"]'));
        } catch (e) { return false; }
      })()`);
      return res === true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 切换到「识图模式」。
   * 对齐 DeepSeek-desktop-client 参考实现：识图入口是 radio[data-model-type="vision"][role="radio"]，
   * 且必须用 wc.sendInputEvent 按坐标派发可信鼠标事件（合成 dispatchEvent 会被 setPointerCapture 拦截）。
   * 流程：找 radio →（找不到则点「新建对话」展开）→ 取消隐藏祖先 → 取坐标 → 可信点击 → 轮询 aria-checked。
   */
  public async switchToVisionModel(wc: WebContents, opts?: { allowNewConversation?: boolean }): Promise<boolean> {
    // 安全门：页面有打开中的弹窗（删除确认 modal / 二级菜单等）时跳过，避免自动
    // 点击/键盘事件落在弹窗上或触发弹窗按钮（如删除确认被自动确认）。
    const modalOpen = await this.hasOpenOverlay(wc);
    if (modalOpen) {
      console.log('[Injector] switchToVisionModel: 页面有打开中的弹窗，跳过');
      return false;
    }
    const allowNewConversation = opts?.allowNewConversation !== false;
    const VISION_RADIO = '[data-model-type="vision"][role="radio"]';

    // 1. 查找 vision radio；找不到时若允许，则点击「新建对话」展开模型选择器（共享屏幕等已有对话场景不允许）
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
      if (!allowNewConversation) {
        // 已有对话场景：模型选择器已被页面卸载，无法切换，直接失败
        return false;
      }
      console.log('[Injector] switchToVisionModel: 未找到 vision radio，尝试点击「新建对话」');
      await this.clickNewConversationButton(wc);
      await sleep(300);
      const domState = await wc.executeJavaScript(`(() => {
        const radio = document.querySelector('${VISION_RADIO}');
        const radioAll = Array.from(document.querySelectorAll('[data-model-type]')).map(function(e){ return e.getAttribute('data-model-type'); });
        const container = document.querySelector('[role="radiogroup"]');
        const url = location.href.slice(0, 80);
        const btns = Array.from(document.querySelectorAll('.ds-button--iconLabelPrimary, .ds-button--iconLabel, ._4f3769f')).filter(function(b){ var r=b.getBoundingClientRect(); return r.width>0&&r.height>0; });
        const buttonInfo = btns.map(function(b){ return { label:(b.getAttribute('aria-label')||'').slice(0,20), txt:b.textContent.trim().slice(0,12), cls:(b.className||'').slice(0,20), html:b.outerHTML.slice(0,120) }; });
        return JSON.stringify({ radio: !!radio, radioAll: radioAll, container: !!container, url: url, buttons: buttonInfo });
      })()`);
      console.log('[Injector] switchToVisionModel 点击后 DOM 探测:', domState);
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

    // 4~6 步结束后（含提前 return / 抛异常）必须恢复第 3 步强制可见的祖先样式：
    // 不恢复会让网页隐藏容器（模型选择下拉、滚动裁剪层）的 display/overflow 等被
    // 永久改写，破坏内部滚动容器 → 整页溢出变成全局滚动、右侧内部滚动条消失。
    try {
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
        // 键盘兜底：聚焦 + Space。
        // 安全前提：仅当 radio 真正获得焦点（document.activeElement === radio）才发 Space。
        // 否则若焦点停留在其他元素（如删除确认 modal 的确认按钮 / 菜单项），发送 Space 会
        // 误触发该元素——曾导致「用户没点删除，删除确认却被自动确认」（删除对话触发 SPA 路由
        // 变化 → applyDefaultModelMode → 本函数 → 鼠标点击被 modal 挡住 → Space 误触确认按钮）。
        console.log('[Injector] switchToVisionModel: 鼠标点击未生效，尝试键盘激活');
        const focused = await wc.executeJavaScript(`(() => {
          try {
            const radio = document.querySelector('${VISION_RADIO}');
            if (!radio) return false;
            radio.focus();
            return document.activeElement === radio;
          } catch (e) { return false; }
        })()`);
        if (focused === true) {
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
        } else {
          console.log('[Injector] switchToVisionModel: radio 未获得焦点（可能被弹窗遮挡），跳过键盘兜底');
        }
      }

      console.log('[Injector] switchToVisionModel -> ' + (success ? '已切换' : '失败'));
      return success;
    } finally {
      await this.restoreHiddenAncestors(wc);
    }
  }

  /**
   * 检测页面是否有「打开中的弹窗/浮层」（删除确认 modal、二级菜单等 portal 容器）。
   * 用于模型自动切换前的安全门：弹窗打开时不执行任何自动点击/键盘事件，
   * 避免误触弹窗按钮（如删除确认）或干扰菜单交互。
   * 判定：DeepSeek 的 modal 系统（.ds-modal-overlay 遮罩 + .ds-modal-wrapper 卡片）
   * 常驻 body，关闭态尺寸为 0；打开态才有可见尺寸。仅这两类，避免误判。
   */
  private async hasOpenOverlay(wc: WebContents): Promise<boolean> {
    try {
      const res: any = await wc.executeJavaScript(`(() => {
        try {
          function visibleSize(el) {
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 ? r.width * r.height : 0;
          }
          var ov = document.querySelector('.ds-modal-overlay');
          if (ov && visibleSize(ov) > 20000) return true;
          var wrappers = document.querySelectorAll('.ds-modal-wrapper');
          for (var i = 0; i < wrappers.length; i++) {
            var w = wrappers[i];
            if (visibleSize(w) > 20000) {
              var cs = getComputedStyle(w);
              if (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') return true;
            }
          }
          return false;
        } catch (e) { return false; }
      })()`);
      return res === true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 恢复 switchToVisionModel 第 3 步强制可见的祖先元素样式。
   * 记录时保存的是覆盖前的原始内联值（可能为 ''），恢复用 style[key] = val 整体
   * 写回（连同移除 !important 标志）；元素即使已被 React 重渲染移出 DOM 也无害。
   */
  private async restoreHiddenAncestors(wc: WebContents): Promise<void> {
    try {
      await wc.executeJavaScript(`(() => {
        try {
          const list = window.__dsHiddenAncestors || [];
          for (const item of list) {
            try {
              const el = item && item.el;
              const ov = (item && item.overrides) || {};
              if (!el || !el.style) continue;
              for (const key of Object.keys(ov)) el.style[key] = ov[key];
            } catch (e) {}
          }
          window.__dsHiddenAncestors = [];
          return true;
        } catch (e) { return false; }
      })()`);
    } catch (e) {
      /* 页面导航/销毁时忽略 */
    }
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
        // 切会话时页面刚重渲染，深度思考开关可能尚未出现，轮询等待其出现再设置（最多 ~2.4s），
        // 避免「未找到开关」导致会话切换后不按用户设置同步。
        for (let a = 0; a < 16; a++) {
          await sleep(150);
          const res2 = await wc.executeJavaScript(findCode);
          try { obj = JSON.parse(res2); } catch { obj = res2; }
          if (obj && obj.found) break;
        }
      }
      if (!obj || !obj.found) {
        logf('setDeepThink', `未找到深度思考开关（等待后仍未出现，可能账号未灰度到）；enabled=${enabled}`);
        return false;
      }
      logf('setDeepThink', `当前 on=${obj.on} 目标 enabled=${enabled}`);
      if (obj.on === enabled) {
        logf('setDeepThink', `已是 ${enabled ? '开启' : '关闭'}`);
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
          logf('setDeepThink', `已切换为 ${enabled ? '开启' : '关闭'}`);
          return true;
        }
      }
      logf('setDeepThink', `点击后状态未确认（enabled=${enabled}）`);
      return false;
    } catch (e) {
      console.error('[Injector] setDeepThink 异常', e);
      return false;
    }
  }

  /**
   * 设置对话窗口「智能搜索」（联网搜索）开关状态（true=开启，false=关闭）。
   * 识别与切换策略对齐 setDeepThink 与参考实现 ensureTogglesState：
   *   - 选择器恒为 `.ds-toggle-button`，按 textContent 含「智能搜索」/「联网」/search 锁定目标；
   *   - 状态以 aria-pressed==='true' 判定（兼容 aria-checked / class）；
   *   - 目标状态与当前不一致时 el.click() 切换。
   * 全程诊断日志 + 多轮重试；失败静默返回 false。
   */
  public async setSmartSearch(wc: WebContents, enabled: boolean): Promise<boolean> {
    const SEL = '.ds-toggle-button';
    const findCode = `(() => {
      try {
        function isSmartSearch(el){
          var t = (el.textContent || '').trim();
          return t.indexOf('智能搜索') >= 0 || t.indexOf('联网') >= 0
              || t.toLowerCase().indexOf('search') >= 0;
        }
        var cands = Array.from(document.querySelectorAll('${SEL}'));
        var el = null;
        for (var i = 0; i < cands.length; i++) { if (isSmartSearch(cands[i])) { el = cands[i]; break; } }
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
        function isSmartSearch(el){
          var t = (el.textContent || '').trim();
          return t.indexOf('智能搜索') >= 0 || t.indexOf('联网') >= 0
              || t.toLowerCase().indexOf('search') >= 0;
        }
        var cands = Array.from(document.querySelectorAll('${SEL}'));
        var el = null;
        for (var i = 0; i < cands.length; i++) { if (isSmartSearch(cands[i])) { el = cands[i]; break; } }
        if (!el) return false;
        el.click();
        return true;
      } catch (e) { return false; }
    })()`;

    try {
      const res = await wc.executeJavaScript(findCode);
      let obj: any;
      try { obj = JSON.parse(res); } catch { obj = res; }
      if (typeof obj === 'boolean') return obj;
      if (!obj || !obj.found) {
        // 切会话时页面刚重渲染，智能搜索开关可能尚未出现，轮询等待其出现再设置（最多 ~2.4s）。
        for (let a = 0; a < 16; a++) {
          await sleep(150);
          const res2 = await wc.executeJavaScript(findCode);
          try { obj = JSON.parse(res2); } catch { obj = res2; }
          if (obj && obj.found) break;
        }
      }
      if (!obj || !obj.found) {
        logf('setSmartSearch', `未找到智能搜索开关（等待后仍未出现）；enabled=${enabled}`);
        return false;
      }
      logf('setSmartSearch', `当前 on=${obj.on} 目标 enabled=${enabled}`);
      if (obj.on === enabled) {
        logf('setSmartSearch', `已是 ${enabled ? '开启' : '关闭'}`);
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
          logf('setSmartSearch', `已切换为 ${enabled ? '开启' : '关闭'}`);
          return true;
        }
      }
      logf('setSmartSearch', `点击后状态未确认（enabled=${enabled}）`);
      return false;
    } catch (e) {
      console.error('[Injector] setSmartSearch 异常', e);
      return false;
    }
  }

  /** 查询当前智能搜索开关状态（true=开，false=关，null=未找到）。 */
  public async getSmartSearchState(wc: WebContents): Promise<boolean | null> {
    const SEL = '.ds-toggle-button';
    const findCode = `(() => {
      try {
        function isSmartSearch(el){
          var t = (el.textContent || '').trim();
          return t.indexOf('智能搜索') >= 0 || t.indexOf('联网') >= 0
              || t.toLowerCase().indexOf('search') >= 0;
        }
        var cands = Array.from(document.querySelectorAll('${SEL}'));
        var el = null;
        for (var i = 0; i < cands.length; i++) { if (isSmartSearch(cands[i])) { el = cands[i]; break; } }
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
    try {
      const res = await wc.executeJavaScript(findCode);
      let obj: any;
      try { obj = JSON.parse(res); } catch { obj = res; }
      if (obj && obj.found) return obj.on === true;
      return null;
    } catch (e) {
      console.error('[Injector] getSmartSearchState 异常', e);
      return null;
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
    // 安全门：页面有打开中的弹窗（删除确认 modal / 二级菜单等 portal 浮层）时跳过模型切换。
    // 否则模型切换的鼠标点击/键盘事件会落在弹窗上，甚至自动触发弹窗按钮（如删除确认）——
    // 曾导致「用户没点删除，删除确认却被自动确认」。
    const modalOpen = await this.hasOpenOverlay(wc);
    if (modalOpen) {
      logf('switchModel', '页面有打开中的弹窗，跳过模型切换');
      return false;
    }
    if (mode === 'vision') return this.switchToVisionModel(wc);
    const MODE_TYPE = mode === 'expert' ? 'expert' : 'default';
    const TARGET = `[data-model-type="${MODE_TYPE}"][role="radio"]`;
    logf('switchModel', `mode=${mode} target=${TARGET}`);

    // 已是该模式则直接返回（兼容裸布尔/对象返回）
    const already = await this.readRadioChecked(wc, TARGET);
    if (already === true) {
      logf('switchModel', `mode=${mode} -> 已是该模式（无需点击）`);
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
        logf('switchModel', `mode=${mode} -> 切换成功`);
        return true;
      }
      await sleep(300);
    }

    logf('switchModel', `mode=${mode} -> 失败：未找到可见的模型按钮（或点击未生效）`);
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
    // 点击完成后立即恢复原始 setPointerCapture——
    // 若等到「下次用户 pointerdown」才恢复，期间任何依赖 pointer capture 的
    // React 交互（如下拉菜单、拖拽）都会静默失效（表现为点击无反应）。
    await this.restorePointerCapture(wc);
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

  /** 立即恢复 Element.prototype.setPointerCapture 为原始函数（可信点击完成后调用）。 */
  private async restorePointerCapture(wc: WebContents): Promise<void> {
    try {
      await wc.executeJavaScript(`(() => {
        try {
          if (window.__dsSPCOriginal) Element.prototype.setPointerCapture = window.__dsSPCOriginal;
          window.__dsSPCResetArmed = false;
        } catch (e) {}
      })()`);
    } catch (e) {
      /* ignore */
    }
  }
  private sendMouse(wc: WebContents, type: 'mouseMove' | 'mouseDown' | 'mouseUp', x: number, y: number): void {
    try {
      wc.sendInputEvent({ type, x, y, button: 'left', clickCount: type === 'mouseDown' ? 1 : 0 } as any);
    } catch (e) {
      /* ignore */
    }
  }

  /** 点击「新建对话」按钮（侧边栏顶部，带加号图标），用于展开折叠的模型选择器。
 *  只匹配侧边栏(窗口左 300px 内)且带加号图标的按钮，绝不误点顶部栏的「分享」等按钮。 */
  public async clickNewConversationButton(wc: WebContents): Promise<boolean> {
    try {
      // DOM 真实点击（dispatchEvent pointerdown/mousedown/click）。共享屏幕时目标窗口若不在前台焦点，
      // sendMouse 到屏幕坐标无效，故优先用 DOM 注入，避免「点击无反应」。
      const domClicked = await wc.executeJavaScript(`(() => {
        function fireClick(el){
          if(!el) return false;
          var types=['pointerdown','mousedown','mouseup'];
          for(var i=0;i<types.length;i++){ try{ el.dispatchEvent(new MouseEvent(types[i],{bubbles:true,cancelable:true,view:window})); }catch(e){} }
          try{ el.click(); }catch(e){}
          return true;
        }
        // 判断元素内的加号图标：svg path 含两条正交的端点线段（M..v..M..h..，即 + 形）
        function hasPlusIcon(btn){
          if(!btn || !btn.querySelectorAll) return false;
          var svgs = btn.querySelectorAll('svg');
          for(var s=0;s<svgs.length;s++){
            var vb=(svgs[s].getAttribute('viewBox')||'').trim();
            if(vb!=='0 0 24 24' && vb!=='0 0 16 16' && vb!=='0 0 20 20') continue;
            var paths=svgs[s].querySelectorAll('path');
            for(var p=0;p<paths.length;p++){
              var d=(paths[p].getAttribute('d')||'');
              // 加号常见 path：如 "M12 5v14M5 12h14"（两条正交线）或类似
              if(d.indexOf('v')>=0 && d.indexOf('h')>=0 && /M[^m]*v[^m]*M[^m]*h/.test(d)) return true;
            }
          }
          return false;
        }
        // 候选：侧边栏内的按钮（left < 300px，侧边栏宽约 274px）
        var cands = Array.from(document.querySelectorAll('.ds-button--iconLabelPrimary, .ds-button--iconLabel, ._4f3769f, button, [role="button"]'));
        for (var i=0;i<cands.length;i++){
          var b=cands[i]; var r=b.getBoundingClientRect();
          if(r.width<=0||r.height<=0) continue;
          if(r.left >= 300) continue;          // 排除顶部栏右侧的分享/其它按钮
          console.log('[NewConv-cand] left='+Math.round(r.left)+' top='+Math.round(r.top)+' cls='+((b.className||'').slice(0,40))+' plus='+hasPlusIcon(b)+' html='+b.outerHTML.slice(0,140));
          if(hasPlusIcon(b)) return fireClick(b);
        }
        // 兜底：遍历文本树精确匹配「新建对话 / New Chat / 新对话」
        var walker=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        var node;
        while((node=walker.nextNode())){
          var txt=node.textContent.trim();
          if(txt==='新建对话'||txt==='New Chat'||txt==='新对话'){
            var p=node.parentElement;
            if(p){ var rr=p.getBoundingClientRect(); if(rr.width>0&&rr.height>0 && rr.left<300) return fireClick(p); }
          }
        }
        return false;
      })()`);
      console.log('[Injector] clickNewConversationButton domClicked =', domClicked);
      // 兜底：sendMouse 模拟（仅当 DOM 点击未命中时）——同一加号/侧边栏匹配逻辑
      if (!(domClicked === true)) {
        const rect = await wc.executeJavaScript(`(() => {
          function hasPlusIcon(btn){
            var svgs = btn?btn.querySelectorAll('svg'):[];
            for(var i=0;i<svgs.length;i++){
              var vb=(svgs[i].getAttribute('viewBox')||'').trim();
              if(vb!=='0 0 24 24'&&vb!=='0 0 16 16'&&vb!=='0 0 20 20') continue;
              var paths=svgs[i].querySelectorAll('path');
              for(var p=0;p<paths.length;p++){ var d=(paths[p].getAttribute('d')||''); if(d.indexOf('v')>=0&&d.indexOf('h')>=0&&/M[^m]*v[^m]*M[^m]*h/.test(d)) return true; }
            }
            return false;
          }
          var cands = Array.from(document.querySelectorAll('.ds-button--iconLabelPrimary, .ds-button--iconLabel, ._4f3769f, button, [role="button"]'));
          for (var i=0;i<cands.length;i++){
            var b=cands[i]; var r=b.getBoundingClientRect();
            if(r.width<=0||r.height<=0) continue;
            if(r.left>=300) continue;
            if(hasPlusIcon(b)) return { x: r.x + r.width/2, y: r.y + r.height/2, width: r.width, height: r.height };
          }
          return null;
        })()`);
        if (!rect || (rect as any).width <= 0 || (rect as any).height <= 0) {
          // 找不到侧边栏「新建对话」按钮：直接用 URL 导航到 DeepSeek 根路由（新建对话/首页，
          // 模型选择器 aria 存在），这是应用已验证的「新建对话」可靠入口（避免猜测按钮选择器误点分享）。
          console.log('[Injector] clickNewConversationButton: 未找到新建对话按钮，改用 loadURL 新建对话页');
          try {
            await wc.loadURL(DEEPSEEK_URL);
            return true;
          } catch (err) {
            return false;
          }
        }
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
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 等待 SPA 切换到「新建对话」页（点击新建对话按钮后调用）：
   * 轮询 URL 不再是历史会话页（DeepSeek 点新建对话后 URL 回到根路由，不带 /a/chat/<id>）。
   * 点击未生效时 URL 不变，会等到超时返回 false，由调用方继续后续流程（不阻塞上传）。
   */
  public async waitForNewConversation(wc: WebContents, timeoutMs = 3000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const url = wc.getURL().split('#')[0];
        if (!/\/a\/chat\/.+/.test(url)) return true;
      } catch {
        /* ignore */
      }
      await sleep(200);
    }
    return false;
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
  public async injectScissorsButton(wc: WebContents, onTrigger: () => void, injectPlusButton: boolean = true): Promise<boolean> {
    // onTrigger 在 Node 侧无法跨桥序列化；真实触发走 IPC(SCISSORS_TRIGGER)。
    void onTrigger;
    // 提取 WPS 程序图标作为「共享 WPS」系列菜单项图标；失败时回退到原 SVG 图标
    const wpsIconUrl = await getWpsIconDataUrl();
    const wpsShareIcon = wpsIconUrl
      ? '<img src="' + wpsIconUrl + '" alt="" style="display:inline-block;width:14px;height:14px;object-fit:contain;vertical-align:middle;"/>'
      : '';
    const wpsDocIcon = wpsShareIcon || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
    const code = `(() => {
      const SHOULD_INJECT_PLUS_BUTTON = ${injectPlusButton};
      try {
        // 稳健定位上传按钮：策略A 由 file input 向上找 clickable 祖先；策略B 取 footer 中「发送前一位」按钮
        function disabledOf(b){ return b.disabled===true || b.getAttribute('aria-disabled')==='true' || (b.classList && b.classList.contains('disabled')); }
        function isToggle(b){ var a=(b.getAttribute('aria-label')||'').toLowerCase(); var t=(b.textContent||'').trim().toLowerCase(); return a.indexOf('思考')>=0||a.indexOf('搜索')>=0||a.indexOf('深度')>=0||a.indexOf('智能')>=0||t.indexOf('思考')>=0||t.indexOf('搜索')>=0; }
        // 安全过滤：只允许对「真正的回形针上传按钮」做隐藏，绝不藏工具栏容器、绝不藏发送按钮（用户只要求藏上传 UI，上传入口统一走「+」菜单）。
        function looksLikeSend(b){ if(!b) return false; var a=(b.getAttribute&&b.getAttribute('aria-label')||'').toLowerCase(); var t=(b.textContent||'').trim().toLowerCase(); return a.indexOf('发送')>=0||a.indexOf('send')>=0||a.indexOf('voice')>=0||a.indexOf('话筒')>=0||a.indexOf('语音')>=0||a.indexOf('mic')>=0; }
        function isOurs(b){ return b && (b.id==='ds-scissors-btn'||b.id==='ds-plus-btn'); }
        // 精确找「回形针上传按钮」：优先返回真正包住 file input 的那个按钮；否则在锚点(或其父工具栏)内取第一个
        // 「非思考/搜索切换、非发送、非我们自己注入」的图标按钮。只返回单个离散按钮，绝不返回容器 → 发送按钮不受影响。
        function safeUpload(anchor){
          if (!anchor) return null;
          var scope = (anchor.tagName==='BUTTON'||anchor.tagName==='LABEL'||(anchor.getAttribute&&anchor.getAttribute('role')==='button'))
            ? (anchor.parentElement||document.body)
            : (anchor.querySelector ? anchor : null);
          if (!scope) return null;
          var btns = Array.prototype.slice.call(scope.querySelectorAll('button,[role="button"]'));
          var fall = null;
          for (var i=0;i<btns.length;i++){
            var b=btns[i];
            if (isOurs(b)||looksLikeSend(b)||isToggle(b)) continue;
            if (b.querySelector && b.querySelector('input[type="file"]')) return b;
            if (!fall) fall = b;
          }
          if (fall) return fall;
          // 兜底：锚点本身若已是离散按钮且非发送/非自己
          if (!anchor.querySelector('button,[role="button"]')&&!isOurs(anchor)&&!looksLikeSend(anchor)) return anchor;
          return null;
        }
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
        function getModelMode(){
          // 读取当前选中的模型模式：radio 的 aria-checked 决定（对齐 switchModelMode 的选择器）
          var radios = Array.from(document.querySelectorAll('[data-model-type][role="radio"]'));
          for (var i = 0; i < radios.length; i++) {
            if (radios[i].getAttribute('aria-checked') === 'true') {
              var t = radios[i].getAttribute('data-model-type');
              if (t === 'expert') return 'expert';
              if (t === 'vision') return 'vision';
              return 'simple';
            }
          }
          return null; // 未知（选择器未就绪等）：保守返回 null
        }
        function isExpertMode(){ return getModelMode() === 'expert'; }
        function syncScissorsVisibility(){
          var btn = document.getElementById('ds-scissors-btn');
          var plusBtn = document.getElementById('ds-plus-btn');
          var menu = document.getElementById('ds-plus-menu');
          if (isExpertMode()) {
            if (btn) btn.remove();
            if (plusBtn) plusBtn.remove();
            if (menu) menu.remove();
            return;
          }
          // 持续隐藏网页原生上传按钮（回形针）：仅注入「+」按钮的窗口执行，上传入口统一走「+」菜单。
          // 放在注入判断之外：即使工具栏重渲染只重建了上传按钮，也会被立即重新隐藏。
          if (SHOULD_INJECT_PLUS_BUTTON) {
            var anchor = safeUpload(getUploadButton());
            if (anchor && anchor.style && anchor.style.display !== 'none') {
              anchor.style.display = 'none';
              if (anchor.setAttribute) anchor.setAttribute('aria-hidden', 'true');
            }
          }
          if (!btn) inject();
        }
        function inject() {
          if (isExpertMode()) {
            // 专家模式不允许上传图片/附件，不显示截图按钮
            console.log('[Injector] 专家模式下不注入剪刀按钮');
            return false;
          }
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
          // 尺寸自适应：与原生上传按钮（回形针）同高对齐（用户要求保留 ✂ 字符图标，只对齐位置）。
          // anchor.offsetHeight 是布局值（不受 CSS zoom 影响），与按钮 CSS 尺寸同坐标系。
          var btnSize = Math.max(24, Math.min(40, Math.round(anchor.offsetHeight || 32)));
          var btnFont = Math.round(btnSize * 0.56); // 32px 按钮 → 18px 字号的 ✂
          var btn = document.createElement('button');
          btn.id = 'ds-scissors-btn';
          btn.type = 'button';
          // \u2702 = ✂，\uFE0E = VS15 强制文本呈现（Electron 37 下避免被渲染成彩色 emoji）
          btn.textContent = '\u2702\uFE0E'; // ✂︎
          btn.title = '截图';
          btn.setAttribute('aria-label', '截图');
          // ✂ 字符在字体中视觉重心略偏下，整体上移 1px 与相邻按钮视觉平齐（transform 不回流）
          btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:' + btnSize + 'px;height:' + btnSize + 'px;padding:0;margin:0 2px;vertical-align:middle;background:transparent;border:none;outline:none;box-shadow:none;color:#ffffff;opacity:0.85;border-radius:50%;transition:background 0.18s,opacity 0.18s;cursor:pointer;font-size:' + btnFont + 'px;line-height:1;font-family:"Segoe UI Symbol","Segoe UI",sans-serif;user-select:none;-webkit-user-select:none;z-index:2147483647;transform:translateY(-1px);';
          btn.onmouseenter = function () { this.style.opacity = '1'; this.style.background = 'rgba(255,255,255,0.1)'; };
          btn.onmouseleave = function () { this.style.opacity = '0.85'; this.style.background = 'transparent'; };
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            document.dispatchEvent(new CustomEvent('ds-scissors-trigger'));
          });
          if (anchor.parentElement) anchor.parentElement.insertBefore(btn, anchor);
          else anchor.insertAdjacentElement('beforebegin', btn);
          console.log('[Injector] 剪刀按钮已插入（对话框内）；锚点=' + anchor.tagName + '|' + (anchor.getAttribute('aria-label') || '') + '|' + (anchor.className && anchor.className.toString ? anchor.className.toString() : '').slice(0, 40));

          // 再在剪刀按钮左侧插入「+」按钮（二级菜单：截图提问/共享屏幕/上传文件）
          // B类窗口不注入加号按钮
          if (SHOULD_INJECT_PLUS_BUTTON) {
          (function injectPlusButton() {
            // 注入前清理上一次残留（DeepSeek React 可能重渲染掉加号按钮而不清 body 里的旧菜单，
            // 导致重复注入出多个 #ds-plus-menu / 按钮，getElementById 命中旧的 → 蓝框/标签不同步）。
            // 按钮若仍在（正常情况）直接 return，不做清理。
            if (document.getElementById('ds-plus-btn')) return;
            try {
              document.querySelectorAll('#ds-plus-menu').forEach(function (el) { el.remove(); });
              document.querySelectorAll('#ds-plus-btn').forEach(function (el) { el.remove(); });
            } catch (e2) {}
            // 与剪刀按钮同尺寸（剪刀已按原生上传按钮自适应），保证三者视觉对齐
            var scissorEl = document.getElementById('ds-scissors-btn');
            var btnSize = scissorEl ? scissorEl.offsetWidth : 32;
            var btnFont = Math.round(btnSize * 0.7); // 32px 按钮 → 22px 字号的 +
            var plusBtn = document.createElement('button');
            plusBtn.id = 'ds-plus-btn';
            plusBtn.type = 'button';
            plusBtn.textContent = '+';
            plusBtn.title = '更多操作';
            plusBtn.setAttribute('aria-label', '更多操作');
            // + 字符视觉重心略偏上，整体下移 1px 与剪刀/回形针视觉平齐（transform 不回流）
            plusBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:' + btnSize + 'px;height:' + btnSize + 'px;padding:0;margin:0;vertical-align:middle;background:transparent;border:none;outline:none;box-shadow:none;color:#ffffff;opacity:0.85;border-radius:50%;transition:background 0.18s,opacity 0.18s;cursor:pointer;font-size:' + btnFont + 'px;line-height:1;font-weight:400;user-select:none;-webkit-user-select:none;z-index:2147483647;transform:translateY(1px);';
            plusBtn.onmouseenter = function () { this.style.opacity = '1'; this.style.background = 'rgba(255,255,255,0.1)'; };
            plusBtn.onmouseleave = function () { this.style.opacity = '0.85'; this.style.background = 'transparent'; };

            // 创建下拉菜单
            var menu = document.createElement('div');
            menu.id = 'ds-plus-menu';
            menu.style.cssText = 'position:fixed;display:none;flex-direction:column;background:#2a2a2a;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:3px 0;width:max-content;min-width:0;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,0.35);';
            var items = [
              // 无痕模式：置于加号菜单最上方。图标为「虚线绘制的聊天框」样式（用户指定）。
              { label: '无痕模式', type: 'incognito', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },

              { label: '共享文档', type: 'shareDocAll', icon: '${wpsDocIcon}' },
              { label: '共享屏幕', type: 'shareScreen', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
              { label: '上传文件', type: 'uploadFile', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' },
            ];
            // 高亮判定（统一入口）：
            //  - incognito：由 window.__dsIncognitoActive 布尔标志决定（主进程在
            //    离开无痕会话/关闭窗口/退出时经 setIncognitoState 重置该标志）；
            //  - 共享类（shareDocAll/shareScreen）：由 window.__dsShareActiveMode 决定。
            function isMenuHighlighted(t) {
              if (t === 'incognito') return window.__dsIncognitoActive === true;
              // 共享文档/共享屏幕各自独立置亮，可同时开启同时显示蓝框（不再用单值互斥）
              if (t === 'shareDocAll') return window.__dsDocShareActive === true;
              if (t === 'shareScreen') return window.__dsScreenShareActive === true;
              return false;
            }
            // 开启中悬浮时显示「取消无痕」/「取消任务」/「取消共享」文字的菜单项 type 集合（共享类 + 无痕/任务模式）
            var hoverActionTypes = ['shareDocAll', 'shareScreen', 'incognito'];
            function hoverActionText(t) {
              if (t === 'incognito') return '取消无痕';
              return '取消共享';
            }
            // 共享状态同步：window.__dsShareActiveMode 标记当前共享模式（'shareDocAll'/'shareScreen'/null），
            // 据此给对应「共享」菜单项加蓝色高亮框；统一由此函数刷新，供共享浮层（picker）注入/共享屏幕启停时调用。
            function syncShareMenuHighlight(menuEl) {
              // 允许调用方传入当前实际可见的菜单元素：若页面残留了早期重复注入的 #ds-plus-menu，
              // getElementById 只会命中第一个（旧/隐藏的），导致用户看到的菜单蓝框/标签从不刷新。
              menuEl = menuEl || document.getElementById('ds-plus-menu');
              if (!menuEl) return;
              var btns = menuEl.querySelectorAll('button');
              for (var si = 0; si < btns.length; si++) {
                var b = btns[si];
                var t = b.getAttribute('data-ds-type');
                if (!t) continue;
                // 悬浮文字类型菜单项：恢复原始标签文字（悬浮时的「取消无痕/取消共享」在鼠标离开后由本函数还原）
                if (hoverActionTypes.indexOf(t) !== -1) {
                  var lbl = b.querySelector('.ds-menu-label');
                  if (lbl && lbl.getAttribute('data-ds-label')) lbl.textContent = lbl.getAttribute('data-ds-label');
                }
                if (isMenuHighlighted(t)) {
                  b.style.borderColor = 'rgba(90,140,255,0.85)';
                  b.style.background = 'rgba(90,140,255,0.16)';
                  b.style.color = '#ffffff';
                } else {
                  b.style.borderColor = 'transparent';
                  b.style.background = 'transparent';
                  b.style.color = '#e0e0e0';
                }
              }
            }
            window.__dsSyncShareMenu = syncShareMenuHighlight;
            window.__dsSyncIncognitoMenu = syncShareMenuHighlight;
            for (var mi = 0; mi < items.length; mi++) {
              (function (item) {
                var menuItem = document.createElement('button');
                menuItem.type = 'button';
                menuItem.setAttribute('data-ds-type', item.type);
                menuItem.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 13px;border:1px solid transparent;border-radius:8px;background:transparent;color:#e0e0e0;font-size:13px;cursor:pointer;text-align:left;white-space:nowrap;transition:background 0.12s,border-color 0.12s;';
                menuItem.onmouseenter = function () {
                  var t = this.getAttribute('data-ds-type');
                  var isActive = isMenuHighlighted(t);
                  this.style.background = isActive ? 'rgba(90,140,255,0.26)' : 'rgba(255,255,255,0.1)';
                  // 开启中悬浮：显示「取消无痕/取消共享」，提示点击即可关闭（无痕模式同理）
                  if (isActive && hoverActionTypes.indexOf(t) !== -1) {
                    var lbl = this.querySelector('.ds-menu-label');
                    if (lbl) lbl.textContent = hoverActionText(t);
                  }
                };
                menuItem.onmouseleave = function () {
                  this.style.background = 'transparent';
                  syncShareMenuHighlight(menu); // 恢复共享/无痕开启中选项的蓝色高亮与原始标签文字
                };
                // WPS 程序图标（<img>）保持原色，不加暗化
                var isWpsIcon = item.icon.indexOf('<img') === 0;
                menuItem.innerHTML = '<span style="display:inline-flex;align-items:center;width:18px;height:14px;' + (isWpsIcon ? '' : 'opacity:0.7;') + '">' + item.icon + '</span><span class="ds-menu-label" data-ds-label="' + item.label + '">' + item.label + '</span>';
                menuItem.addEventListener('click', function (e) {
                  e.preventDefault();
                  e.stopPropagation();
                  // 无痕模式：交由主进程切换（toggle 意图）。
                  // 主进程以自己维护的状态为唯一真源，读取当前是否开启后判定新状态并回写，
                  // 避免页面本地标志屡次开关后与主进程脱钩（蓝框消失 / 一直显示取消无痕）。
                  // 只要无痕保持开启直到退出会话/切换对话/关闭窗口/退出程序，才会删除该对话记录。
                  if (item.type === 'incognito') {
                    menu.style.display = 'none';
                    syncShareMenuHighlight(menu); // 立刻还原悬浮标签「取消无痕」与蓝色高亮，避免悬停残留卡死
                    try { window.__ds && window.__ds.toggleIncognito(); } catch (e2) {}
                    // 让主进程回写后以真实状态刷新蓝框（打开菜单时还会再向主进程复核）
                    if (window.__ds && typeof window.__ds.getIncognitoState === 'function') {
                      window.__ds.getIncognitoState().then(function (st) {
                        console.log('[Injector] incognito 点击后主进程状态=' + st + ' 页面旧标志=' + window.__dsIncognitoActive);
                        window.__dsIncognitoActive = !!st;
                        syncShareMenuHighlight(menu);
                      }).catch(function () { console.log('[Injector] 查询 incognito 状态失败'); });
                    }
                    return;
                  }
                  menu.style.display = 'none';
                  // 共享类菜单项：再次点击同一项=取消共享；切换类型时先取消旧共享。
                  // 高亮用各共享类型的独立激活标志（共享文档/共享屏幕可同时开启），
                  // 取消判断也据此判定，不再依赖旧的单值 __dsShareActiveMode。
                  if (item.type === 'shareDocAll') {
                    if (isMenuHighlighted(item.type)) {
                      // 已是激活状态：取消共享文档
                      if (window.__dsDocShareStop) window.__dsDocShareStop();
                      window.__dsRequestedShare = null;
                      syncShareMenuHighlight(menu);
                      return;
                    }
                    if (window.__dsDocShareActive && window.__dsDocShareStop) window.__dsDocShareStop();
                    window.__dsRequestedShare = item.type;
                    syncShareMenuHighlight(menu);
                  }
                  if (item.type === 'uploadFile') {
                    document.dispatchEvent(new CustomEvent('ds-plus-trigger', { detail: { type: 'uploadFile' } }));
                  } else if (item.type === 'shareScreen') {
                    document.dispatchEvent(new CustomEvent('ds-plus-trigger', { detail: { type: 'shareScreen' } }));
                  } else if (item.type === 'shareDocAll') {
                    document.dispatchEvent(new CustomEvent('ds-plus-trigger', { detail: { type: 'shareDocAll' } }));
                  }
                });
                menu.appendChild(menuItem);
              })(items[mi]);
            }
            document.body.appendChild(menu);

            // 点击「+」按钮切换菜单（向上展开）
            // 注意：字号缩放会给 documentElement 注入 CSS zoom，此时 getBoundingClientRect 返回
            // 「缩放后」坐标而 fixed 定位是「布局」坐标，必须除以 zoom 换算，否则菜单整体向右下偏移。
            plusBtn.addEventListener('click', function (e) {
              e.preventDefault();
              e.stopPropagation();
              var r = plusBtn.getBoundingClientRect();
              var z = 1;
              try { z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1; } catch (e2) {}
              var rect = z !== 1 && z > 0 ? { left: r.left / z, top: r.top / z } : { left: r.left, top: r.top };
              if (menu.style.display === 'flex') {
                menu.style.display = 'none';
                syncShareMenuHighlight(menu); // 关闭时还原悬浮标签，防止「取消无痕」残留
              } else {
                // 诊断：检测是否残留了重复注入的菜单/按钮（旧可能性导致蓝框不同步）
                try {
                  console.log('[Injector] 重复检查 全菜单数=' + document.querySelectorAll('#ds-plus-menu').length + ' 全加号按钮数=' + document.querySelectorAll('#ds-plus-btn').length + ' 全无痕菜单项数=' + document.querySelectorAll('button[data-ds-type="incognito"]').length);
                } catch (e2) {}
                syncShareMenuHighlight(menu); // 打开菜单时刷新共享选项的蓝色高亮状态
                // 先显示菜单以测量高度，再向上定位（offsetHeight 是布局值，不受 zoom 影响）
                menu.style.display = 'flex';
                menu.style.visibility = 'hidden';
                var menuHeight = menu.offsetHeight;
                menu.style.visibility = 'visible';
                menu.style.left = rect.left + 'px';
                menu.style.top = (rect.top - menuHeight - 4) + 'px';
                // 打开时向主进程复核真实的无痕状态，刷新蓝框高亮（防止页面标志陈旧/错乱）
                if (window.__ds && typeof window.__ds.getIncognitoState === 'function') {
                  window.__ds.getIncognitoState().then(function (st) {
                    console.log('[Injector] 打开菜单复核 incognito 状态=' + st + ' 页面旧标志=' + window.__dsIncognitoActive);
                    window.__dsIncognitoActive = !!st;
                    syncShareMenuHighlight(menu);
                  }).catch(function () { console.log('[Injector] 打开菜单复核 incognito 状态失败'); });
                }
              }
            });

            // 点击菜单外部关闭
            document.addEventListener('click', function () {
              menu.style.display = 'none';
              syncShareMenuHighlight(menu); // 关闭时还原悬浮标签，防止「取消无痕」残留
            }, false);

            // 插入到剪刀按钮之前
            var scissorBtn = document.getElementById('ds-scissors-btn');
            if (scissorBtn && scissorBtn.parentElement) {
              scissorBtn.parentElement.insertBefore(plusBtn, scissorBtn);
            }
            console.log('[Injector] 「+」按钮已插入');
          })();
          } // end if (SHOULD_INJECT_PLUS_BUTTON)
          // 隐藏网页原生的上传按钮（回形针）：上传入口统一走「+」菜单（用户需求）。
          // 仅当注入「+」按钮时隐藏；B 类窗口无「+」按钮，保留原上传入口。
          if (SHOULD_INJECT_PLUS_BUTTON) {
            var safeAnchor = safeUpload(anchor);
            if (safeAnchor && safeAnchor.style) {
              safeAnchor.style.display = 'none';
              if (safeAnchor.setAttribute) safeAnchor.setAttribute('aria-hidden', 'true');
            }
          }
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
        syncScissorsVisibility();
        var mo = new MutationObserver(function () {
          syncScissorsVisibility();
        });
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-checked'] });
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
   * 在聊天输入框「智能搜索」按钮右侧注入「模式切换」下拉（普通模式 / 联网模式）。
   * - 普通模式：插件的「搜索互联网 + 获取网页」两个开关都关闭；
   * - 联网模式：两个开关都打开，并关闭网页原生「智能搜索」按钮。
   * 样式参照「+」菜单与共享屏幕悬浮框：深色毛玻璃 + 白色细边框 + 蓝色高亮当前项。
   * 页面事件经 ds-chat-mode-trigger(CustomEvent) → webviewPreload → IPC.CHAT_MODE_SET → 主进程处理。
   * 主进程切换后经 syncChatModeToPage 调 window.__dsSyncChatMode(mode) 回写按钮/菜单高亮。
   */
  public async injectTokenWidget(wc: WebContents): Promise<boolean> {
    // 插件关闭：不注入 token 小窗（依赖插件功能）。
    if (!this.dsppEnabled) return Promise.resolve(false);
    const code = `(() => {
      try {
        if (document.getElementById('ds-token-widget')) return true;
        var tw = document.createElement('div');
        tw.id = 'ds-token-widget';
        tw.style.cssText = 'position:fixed;display:none;align-items:center;justify-content:center;gap:6px;min-width:34px;height:24px;padding:0 10px;border-radius:12px;background:rgba(28,30,38,0.55);backdrop-filter:blur(14px) saturate(1.5);-webkit-backdrop-filter:blur(14px) saturate(1.5);border:1px solid rgba(255,255,255,0.18);color:#eef0f3;font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1;user-select:none;-webkit-user-select:none;cursor:default;z-index:2147483000;';
        tw.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#5a8cff;flex:none;box-shadow:0 0 6px rgba(90,140,255,0.9);"></span>'
          + '<span class="ds-token-box" style="display:inline-flex;align-items:flex-start;overflow:hidden;height:15px;transform:translateY(1px);"></span>'
          + '<div class="ds-token-tip" style="position:absolute;top:calc(100% + 7px);right:0;display:none;flex-direction:column;gap:4px;padding:9px 12px;border-radius:10px;background:rgba(28,30,38,0.6);backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);border:1px solid rgba(255,255,255,0.16);font-size:11px;font-weight:500;line-height:1.2;white-space:nowrap;">'
          + '<span style="color:#9aa3b2;">今日 <b class="ds-token-today" style="color:#eef0f3;font-variant-numeric:tabular-nums;font-weight:600;margin-left:4px;">0</b></span>'
          + '<span style="color:#9aa3b2;">累计 <b class="ds-token-total" style="color:#eef0f3;font-variant-numeric:tabular-nums;font-weight:600;margin-left:4px;">0</b></span>'
          + '</div>';
        document.body.appendChild(tw);
        tw.style.position = 'fixed';
        var twSlotBox = tw.querySelector('.ds-token-box');
        var twToday = tw.querySelector('.ds-token-today');
        var twTotal = tw.querySelector('.ds-token-total');
        var twTip = tw.querySelector('.ds-token-tip');
        var SLOT_H = 15;
        var SLOT_SEQ = '0123456789.kMB';
        var SLOT_BAND = (function () { var a = []; for (var r = 0; r < 22; r++) { for (var s = 0; s < SLOT_SEQ.length; s++) a.push(SLOT_SEQ[s]); } return a; })();
        var twCols = [];
        var twFirst = true;
        function twNewCol() {
          var col = document.createElement('span');
          col.style.cssText = 'display:inline-block;vertical-align:top;overflow:hidden;height:' + SLOT_H + 'px;width:9px;position:relative;';
          var strip = document.createElement('span');
          strip.style.cssText = 'display:block;line-height:' + SLOT_H + 'px;font-variant-numeric:tabular-nums;will-change:transform;';
          col.appendChild(strip);
          return { col: col, strip: strip, idx: 0, built: false };
        }
        function twFillStrip(co) {
          var frag = document.createDocumentFragment();
          var cellCss = 'display:flex;align-items:center;justify-content:center;height:' + SLOT_H + 'px;line-height:' + SLOT_H + 'px;font-variant-numeric:tabular-nums;color:#eef0f3;font-weight:600;white-space:nowrap;';
          for (var i = 0; i < SLOT_BAND.length; i++) {
            var cell = document.createElement('span');
            cell.style.cssText = cellCss;
            cell.textContent = SLOT_BAND[i];
            frag.appendChild(cell);
          }
          co.strip.appendChild(frag);
          co.built = true;
        }
        function twCharIdxLow(char) {
          var p = SLOT_BAND.indexOf(char); if (p < 0) p = 0;
          var mid = Math.floor(SLOT_BAND.length / 2);
          while (p < mid) p += SLOT_SEQ.length;
          return p;
        }
        function twSetIdxVisible(co, char) {
          co.idx = twCharIdxLow(char);
          co.strip.style.transform = 'translateY(' + (-co.idx * SLOT_H) + 'px)';
        }
        function twRollTo(co, char) {
          if (!co.built) twFillStrip(co);
          if (SLOT_BAND[co.idx] === char) return;
          var seqLen = SLOT_SEQ.length;
          var curPos = SLOT_SEQ.indexOf(SLOT_BAND[co.idx]);
          var tarPos = SLOT_SEQ.indexOf(char);
          var fwd = ((tarPos - curPos) + seqLen) % seqLen;
          var steps = fwd + seqLen;
          var base = co.idx + steps;
          if (base > SLOT_BAND.length - 12) { twSetIdxVisible(co, char); return; }
          var dur = Math.min(720, Math.max(320, steps * 30));
          var anim = co.strip.animate(
            [{ transform: 'translateY(' + (-co.idx * SLOT_H) + 'px)' }, { transform: 'translateY(' + (-base * SLOT_H) + 'px)' }],
            { duration: dur, easing: 'cubic-bezier(.12,.85,.3,1)', fill: 'forwards' }
          );
          co.idx = base;
          anim.onfinish = function () { try { anim.cancel(); } catch (e9) {} co.strip.style.transform = 'translateY(' + (-base * SLOT_H) + 'px)'; };
        }
        var twSetNum = function (text) {
          try {
            var targets = text.split('');
            while (twCols.length < targets.length) twCols.push(twNewCol());
            while (twCols.length > targets.length) { var r = twCols.pop(); if (r.col.parentNode) r.col.parentNode.removeChild(r.col); }
            while (twSlotBox.firstChild) twSlotBox.removeChild(twSlotBox.firstChild);
            for (var i = 0; i < twCols.length; i++) {
              var co = twCols[i];
              if (!co.built) twFillStrip(co);
              if (twFirst) twSetIdxVisible(co, targets[i]);
              else twRollTo(co, targets[i]);
              twSlotBox.appendChild(co.col);
            }
            twFirst = false;
          } catch (e4) { twSlotBox.textContent = text; }
        };
        tw.addEventListener('pointerenter', function () { try { twTip.style.display = 'flex'; } catch (e5) {} });
        tw.addEventListener('pointerleave', function () { try { twTip.style.display = 'none'; } catch (e5) {} });
        var twLastKey = '';
        function twLayoutRect(el) {
          var rr = el.getBoundingClientRect();
          try {
            var zz = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            if (zz !== 1 && zz > 0) return { left: rr.left / zz, top: rr.top / zz, right: rr.right / zz, bottom: rr.bottom / zz, width: rr.width / zz, height: rr.height / zz };
          } catch (eZ) {}
          return rr;
        }
        function twFindComposer() {
          var ta = document.querySelector('textarea[placeholder*="发送消息"], textarea[aria-label*="发送消息"], textarea, [contenteditable="true"], [role="textbox"]');
          if (!ta) return null;
          var comp = ta.parentElement;
          for (var ci = 0; ci < 8 && comp; ci++) {
            // composer = 同时含「上传/附加等按钮」与输入框的容器。专家模式下页面没有 input[type=file]，
            // 不能把 file 作为必需项，否则定位失败 → token 跑位。用 button/role=button 兜底代替。
            if (comp.querySelector && comp.querySelector('input[type="file"], button, [role="button"]') && comp.querySelector('textarea, [contenteditable="true"]')) break;
            comp = comp.parentElement;
          }
          if (!comp) comp = ta.parentElement;
          return { ta: ta, comp: comp };
        }
        var twPlace = function () {
          try {
            var hit = twFindComposer();
            if (!hit) return;
            var cRect = twLayoutRect(hit.comp);
            if (!cRect || cRect.width <= 1 || cRect.height <= 1) return;
            var bw = tw.offsetWidth || 34;
            var bh = tw.offsetHeight || 24;
            var rightAnchor = cRect.right - 8;
            var left = Math.max(8, rightAnchor - bw);
            var top = cRect.top - bh - 8;
            if (top < 8) top = cRect.bottom + 8;
            var key = left + ',' + top;
            if (key !== twLastKey) {
              twLastKey = key;
              tw.style.right = '';
              tw.style.left = left + 'px';
              tw.style.top = top + 'px';
            }
          } catch (e3) {}
        };
        var twFmt = function (n) {
          var v = Number(n) || 0;
          if (v < 1000) return String(Math.round(v));
          var u, f;
          if (v >= 1000000000) { u = 'B'; f = v / 1000000000; }
          else if (v >= 1000000) { u = 'M'; f = v / 1000000; }
          else { u = 'k'; f = v / 1000; }
          return f.toFixed(1) + u;
        };
        var twPoll = function () { try { document.dispatchEvent(new CustomEvent('ds-token-widget-query')); } catch (e7) {} };
        var twTimer = null;
        var posTimer = null;
        function twStartTimers() {
          if (twTimer) return;
          twPoll();
          twTimer = setInterval(twPoll, 3000);
          posTimer = setInterval(twPlace, 150);
        }
        function twStopTimers() {
          if (twTimer) { clearInterval(twTimer); twTimer = null; }
          if (posTimer) { clearInterval(posTimer); posTimer = null; }
        }
        var twEnabledNow = false, twTokensNow = 0, twTotalNow = 0;
        var twShow = function (enabled, tokens, total) {
          twEnabledNow = enabled === true;
          twTokensNow = Number(tokens) || 0;
          twTotalNow = Number(total) || 0;
          if (enabled) {
            twSetNum(twFmt(twTokensNow));
            if (twToday) twToday.textContent = twFmt(twTokensNow);
            if (twTotal) twTotal.textContent = twFmt(twTotalNow);
            tw.style.display = 'flex';
            twStartTimers();
          } else {
            tw.style.display = 'none';
            twStopTimers();
          }
          twPlace();
        };
        document.addEventListener('ds-token-widget-state', function (ev) {
          try { var d = ev.detail || {}; twShow(!!d.enabled, Number(d.tokens) || 0, Number(d.totalTokens) || 0); } catch (e6) {}
        });
        window.addEventListener('resize', function () { twPlace(); });
        window.addEventListener('scroll', function () { twPlace(); }, true);
        var twBodyObserver = null;
        try {
          if (typeof MutationObserver === 'function') {
            twBodyObserver = new MutationObserver(function () {
              try {
                if (!document.getElementById('ds-token-widget') && tw && !tw.isConnected) {
                  if (tw.parentNode !== document.body) document.body.appendChild(tw);
                  twShow(twEnabledNow, twTokensNow, twTotalNow);
                }
              } catch (eS) {}
            });
            twBodyObserver.observe(document.body, { childList: true, subtree: false });
          }
        } catch (eM) { /* 忽略 */ }
        twPoll();
        window.__dsTokenWidget = { show: twShow, query: twPoll, place: twPlace, destroy: function () { twStopTimers(); if (twBodyObserver) { try { twBodyObserver.disconnect(); } catch (eB2) {} } } };
        return true;
      } catch (e8) { return false; }
    })()`;
    const res = await wc.executeJavaScript(code).catch(() => false);
    return !!res;
  }

  public async injectChatModeSwitcher(wc: WebContents, isSub = false, isBWindow = false): Promise<boolean> {
    // 插件关闭：断开基于插件设计的模式切换按钮 / token 小窗 / 占位文字等注入。
    if (!this.dsppEnabled) return Promise.resolve(false);
    const code = `(() => {
      try {
        if (window.__dsChatModeUI) return true;
        // 副窗口（isSub=true）：窄视口二级展开框改为「点击同位进入子菜单」+ 返回按钮；
        // B 类窗口（isBWindow=true）：强制普通模式 + 记忆关闭。
        var IS_SUB = ${isSub};
        var IS_BWINDOW = ${isBWindow};
        try {
          document.querySelectorAll('#ds-chat-mode-menu').forEach(function (el) { el.remove(); });
          document.querySelectorAll('#ds-chat-mode-btn').forEach(function (el) { el.remove(); });
        } catch (e2) {}
        // 只匹配「智能搜索」按钮（遮罩/提示专用：不覆盖深度思考等其他 toggle）
        function findSmartOnly() {
          var cands = Array.from(document.querySelectorAll('.ds-toggle-button'));
          for (var i = 0; i < cands.length; i++) {
            var t = (cands[i].textContent || '').trim();
            if (t.indexOf('智能搜索') >= 0 || t.indexOf('联网') >= 0 || t.toLowerCase().indexOf('search') >= 0) return cands[i];
          }
          return null;
        }
        // 锚点：优先「智能搜索」toggle；专家模式等无智能搜索时，退而求其次定位到
        // 任意可见的 toggle（如「深度思考」，位于工具栏左侧，不会超视口）。
        function findToggle() {
          var cands = Array.from(document.querySelectorAll('.ds-toggle-button'));
          for (var i = 0; i < cands.length; i++) {
            var t = (cands[i].textContent || '').trim();
            if (t.indexOf('智能搜索') >= 0 || t.indexOf('联网') >= 0 || t.toLowerCase().indexOf('search') >= 0) return cands[i];
          }
          for (var j = 0; j < cands.length; j++) {
            var r = cands[j].getBoundingClientRect();
            if (r.width > 1 && r.height > 1) return cands[j];
          }
          return null;
        }
        function findScissor() { return document.getElementById('ds-scissors-btn'); }
        // 兜底锚点：输入框 textarea（专家模式等无智能搜索 toggle 的场景也能显示）。
        // 直接返回输入框本身，place() 会做矩形有效性过滤（隐藏元素 rect 为 0 会被跳过）。
        function findFallback() {
          var ta = document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], [contenteditable="true"][aria-label*="发送消息"]');
          if (ta) return ta;
          return document.querySelector('textarea');
        }
        // 图标（16px，与原生按钮图标同尺寸）：普通模式=虚线圆（跟随外圈色，灰白）；
        // 增强检索=整图标固定蓝色 rgb(103,158,254)（圆圈+闪电），不随选中态变白，两模式一眼区分（普通=虚线圆、增强=实心蓝闪电）。
        var icoOff = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.5" stroke-dasharray="3.4 2.6"/></svg>';
        var icoOn = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="rgb(103,158,254)" stroke-width="1.4"><circle cx="8" cy="8" r="6.5"/><path d="M9.5 2.5L5 9h3l-1 4.5 4.5-6.5h-3l1-4.5z" fill="rgb(103,158,254)" stroke="none"/></svg>';
        // 任务模式图标：参考导出图（白色造型、透明底，内嵌 base64）。激活时用 CSS 滤镜染蓝。
        // vertical-align:middle + margin-top:1px 让图标比邻文稍下沉、垂直居中。
        var icoTask = '<img src="${TASK_MODE_ICON_DATA_URL}" style="display:inline-flex;width:16px;height:16px;border-radius:0;vertical-align:middle;margin-top:1px;object-fit:contain;"/>';
        // 下拉框「增强检索」项图标：平时白色（跟随文字色），选中激活时变蓝（见 sync 对 .ds-cm-it-ico 的处理）。
        var icoOnlineMenu = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.5"/><path d="M9.5 2.5L5 9h3l-1 4.5 4.5-6.5h-3l1-4.5z" fill="currentColor" stroke="none"/></svg>';
        // 下拉框「普通模式」项图标：与外面胶囊一致（虚线圆 stroke-dasharray），跟随外圈色（灰白/白）
        var icoMenuNormal = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.5" stroke-dasharray="3.4 2.6"/></svg>';
        // 按钮：样式对齐原生 ds-toggle-button（实测：胶囊 18px 圆角 / 34px 高 / 13px 500 / padding 10px；
        // 未激活=透明底+白边白字，激活=深蓝灰底 rgb(40,49,66)+亮蓝字 rgb(103,158,254)+蓝灰边 rgb(72,104,178)）
        // 定位：改为「流内」——把按钮作为 toggle 的同级节点插入工具栏右侧，参与原生布局，浏览器自动跟随，
        // 同剪刀/加号按钮；place() 只负责插入 + React 重渲染清掉后重插入兜底，不再需要 JS 重定位。
        var btn = document.createElement('button');
        btn.id = 'ds-chat-mode-btn';
        btn.type = 'button';
        btn.setAttribute('aria-haspopup', 'true');
        btn.style.cssText = 'display:none;align-items:center;gap:4px;height:34px;padding:0 10px;margin:0;vertical-align:middle;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:18px;color:rgb(249,250,251);font-size:13px;font-weight:500;line-height:1;cursor:pointer;user-select:none;-webkit-user-select:none;white-space:nowrap;transition:background 0.18s,border-color 0.18s,color 0.18s;';
        // 胶囊默认只显示两个字（普通/增强），完整名称在下拉菜单里；右侧箭头朝右（▶）
        btn.innerHTML = '<span class="ds-cm-ico" style="display:inline-flex;align-items:center;justify-content:center;">' + icoOff + '</span><span class="ds-cm-label">普通</span><span class="ds-cm-arrow" style="display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;opacity:0.65;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg></span>';
        btn.onmouseenter = function () { if (btn.__dsMode !== 'online') this.style.background = 'rgba(255,255,255,0.08)'; };
        btn.onmouseleave = function () { if (btn.__dsMode !== 'online') this.style.background = 'rgba(255,255,255,0.04)'; };
        var menu = document.createElement('div');
        menu.id = 'ds-chat-mode-menu';
        // 中性半透明毛玻璃（对齐共享文档悬浮框样式）：深灰半透明 rgba(28,30,38,0.55) + blur + 白细边框 + 内高光
        menu.style.cssText = 'position:fixed;display:none;flex-direction:column;background:rgba(28,30,38,0.55);backdrop-filter:blur(20px) saturate(1.6);-webkit-backdrop-filter:blur(20px) saturate(1.6);border:1px solid rgba(255,255,255,0.18);border-radius:12px;padding:4px;min-width:150px;z-index:2147483647;box-shadow:0 8px 28px rgba(0,0,0,0.35),inset 0 1px 0 rgba(255,255,255,0.1);';
        function makeItem(mode, label, ico) {
          var it = document.createElement('button');
          it.type = 'button';
          it.setAttribute('data-ds-cm-mode', mode);
          // margin:2px 0 让两个菜单项分开，选中框不再紧贴「重叠」
          it.style.cssText = 'display:flex;align-items:center;gap:8px;margin:2px 0;padding:7px 10px;border:1px solid transparent;border-radius:8px;background:transparent;color:rgb(249,250,251);font-size:13px;cursor:pointer;text-align:left;white-space:nowrap;transition:background 0.12s,border-color 0.12s,color 0.12s;';
          it.innerHTML = '<span class="ds-cm-it-ico" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-top:1px;opacity:0.85;">' + ico + '</span><span>' + label + '</span>';
          // 去掉选中的打勾（有蓝框高亮即可），省一点横向空间
          // hover 不覆盖选中态：选中项 hover 加深蓝底，未选中项 hover 白色半透明，避免两态叠加
          it.onmouseenter = function () {
            var m = this.getAttribute('data-ds-cm-mode');
            var cur = window.__dsChatMode === 'online' || window.__dsChatMode === 'task' ? window.__dsChatMode : 'normal';
            // hover：选中项用共享文档「选择文档」蓝色系加深，未选中项白色半透明
            if (m === cur) this.style.background = 'rgba(90,140,255,0.32)';
            else this.style.background = 'rgba(255,255,255,0.16)';
          };
          it.onmouseleave = function () { this.style.background = 'transparent'; sync(); };
          return it;
        }
        menu.appendChild(makeItem('normal', '普通模式', icoMenuNormal));
        menu.appendChild(makeItem('online', '增强搜索', icoOnlineMenu));
        menu.appendChild(makeItem('task', '任务模式', icoTask));
        document.body.appendChild(menu);
        // === B 类窗口 / 无痕开启时的模式与记忆锁定 ===
        //  - B 类窗口：强制普通模式（增强/任务项禁用）+ 记忆关闭
        //  - 无痕开启：记忆关闭，且禁切任务（普通/增强可用但记忆关）
        var modeLocked = function (m) {
          if (IS_BWINDOW) return m !== 'normal';            // B 类窗口仅可用普通
          if (window.__dsIncognitoActive === true) return m === 'task'; // 无痕禁任务
          return false;
        };
        var memoLocked = function () { return IS_BWINDOW || window.__dsIncognitoActive === true; };
        // 受限点击提示吐司（「该模式下不支持开启此项功能」）
        var lockToast = document.createElement('div');
        lockToast.id = 'ds-cm-lock-toast';
        lockToast.style.cssText = 'position:fixed;display:none;align-items:center;padding:7px 12px;border-radius:9px;background:rgba(24,26,33,0.94);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,0.18);box-shadow:0 10px 26px rgba(0,0,0,0.4);color:#ffd194;font-size:12px;font-weight:500;line-height:1.4;white-space:nowrap;pointer-events:none;z-index:2147483647;';
        document.body.appendChild(lockToast);
        var lockToastTimer = null;
        var showLockToast = function (x, y) {
          lockToast.textContent = '该模式下不支持开启此项功能';
          lockToast.style.display = 'flex';
          var w = lockToast.offsetWidth || 200, h = lockToast.offsetHeight || 34;
          lockToast.style.left = Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8)) + 'px';
          lockToast.style.top = Math.max(8, Math.min(y - h - 10, window.innerHeight - h - 8)) + 'px';
          if (lockToastTimer) clearTimeout(lockToastTimer);
          lockToastTimer = setTimeout(function () { lockToast.style.display = 'none'; }, 1600);
        };
        // === 模式项鼠标悬浮解释（悬浮约 350ms 后在按钮上方显示说明，离开即隐藏） ===
        var modeTip = document.createElement('div');
        modeTip.id = 'ds-cm-mode-tip';
        modeTip.style.cssText = 'position:fixed;display:none;align-items:center;gap:6px;padding:7px 11px;border-radius:10px;background:rgba(24,26,33,0.92);backdrop-filter:blur(20px) saturate(1.5);-webkit-backdrop-filter:blur(20px) saturate(1.5);border:1px solid rgba(255,255,255,0.16);box-shadow:0 12px 30px rgba(0,0,0,0.45);color:#dfe3ea;font-size:11.5px;font-weight:500;line-height:1.45;white-space:nowrap;pointer-events:none;z-index:2147483647;';
        modeTip.textContent = '';
        document.body.appendChild(modeTip);
        var MODE_DESC = {
          normal: '原生网页版问答',
          online: '增加网络搜索和链接解析工具，多轮搜索结果更加准确',
          task: '调用python控制本地电脑，编辑读取本地文件，执行各种电脑操作',
        };
        var tipTimer = null;
        var tipDelayTimer = null;
        var tipTarget = null;
        // 悬浮一小段时间后再召唤（延迟 350ms），避免鼠标扫过菜单时频繁闪现
        var tipShow = function (btn, mode) {
          var d = MODE_DESC[mode]; if (!d) return;
          tipTarget = btn;
          if (tipTimer) clearTimeout(tipTimer);
          if (tipDelayTimer) clearTimeout(tipDelayTimer);
          tipDelayTimer = setTimeout(function () {
            if (tipTarget !== btn) return;
            modeTip.textContent = d;
            modeTip.style.display = 'flex';
            try {
              var r = btn.getBoundingClientRect();
              var w = modeTip.offsetWidth, h = modeTip.offsetHeight;
              // 置于当前按钮上方一点（gap 8px），并整体夹在视口内
              var L = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
              var T = Math.max(8, Math.min(r.top - h - 8, window.innerHeight - h - 8));
              modeTip.style.left = L + 'px';
              modeTip.style.top = T + 'px';
            } catch (e) { /* 定位失败则居中 */ }
          }, 350);
        };
        var tipHide = function () {
          if (tipDelayTimer) { clearTimeout(tipDelayTimer); tipDelayTimer = null; }
          if (tipTimer) clearTimeout(tipTimer);
          modeTip.style.display = 'none';
          tipTarget = null;
        };
        menu.querySelectorAll('button[data-ds-cm-mode]').forEach(function (mi) {
          mi.addEventListener('mouseenter', function () { tipShow(mi, mi.getAttribute('data-ds-cm-mode')); });
          mi.addEventListener('mouseleave', tipHide);
        });
        // 菜单关闭时隐藏提示
        var _sqrtSync = sync; sync = function () { modeTip.style.display = 'none'; _sqrtSync(); };
        // === 普通模式旁「记忆功能」二级悬浮框（嵌套进普通模式项，紧贴其右侧） ===
        // 普通模式下默认仍注入「记忆提示词」，此处供用户在此关闭（关闭则不再注入该前置提示）。
        var normIt = menu.querySelector('button[data-ds-cm-mode="normal"]');
        if (normIt) normIt.style.position = 'relative'; // 让二级框以本项为定位锚点，紧贴右侧
        var memoFly = document.createElement('div');
        memoFly.id = 'ds-cm-memo-fly'; // 供 document 捕获监听识别，避免点击框内被误判为切模式/关闭
        memoFly.style.cssText = 'position:absolute;left:calc(100% + 6px);top:0;display:none;flex-direction:column;gap:1px;background:rgba(24,26,33,0.92);backdrop-filter:blur(22px) saturate(1.6);-webkit-backdrop-filter:blur(22px) saturate(1.6);border:1px solid rgba(255,255,255,0.16);border-radius:12px;padding:6px;min-width:176px;z-index:2147483647;box-shadow:0 14px 34px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);';
        var memoRow = document.createElement('div'); // 用 div 避免 button 嵌套 span 非法；点击须阻断冒泡
        memoRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px 11px;color:rgb(248,249,250);font-size:13px;font-weight:500;cursor:pointer;border-radius:9px;text-align:left;white-space:nowrap;transition:background 0.12s, transform 0.05s;';
        var memoLbl = document.createElement('span');
        memoLbl.textContent = '记忆功能';
        memoRow.appendChild(memoLbl);
        var sw = document.createElement('span');
        sw.style.cssText = 'position:relative;width:34px;height:20px;border-radius:10px;flex:none;background:rgba(255,255,255,0.22);transition:background 0.18s;';
        var knob = document.createElement('span');
        knob.style.cssText = 'position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left 0.18s;box-shadow:0 1px 3px rgba(0,0,0,0.35);';
        sw.appendChild(knob);
        memoRow.appendChild(sw);
        memoFly.appendChild(memoRow);
        if (normIt) normIt.appendChild(memoFly); // 嵌套进普通模式项 → 与菜单共享坐标系、紧贴右侧
        if (window.__dsMemo === undefined) window.__dsMemo = false; // 默认关（普通模式记忆默认不注入）
        function syncMemoUI() {
          // B 类窗口 / 无痕开启 → 记忆强制关（置灰，走锁提示）；否则按偏好
          var locked = memoLocked();
          var on = locked ? false : !!window.__dsMemo;
          sw.style.background = on ? 'rgb(103,158,254)' : 'rgba(255,255,255,0.22)';
          knob.style.left = on ? '16px' : '2px';
          sw.style.opacity = locked ? '0.45' : '1';
          memoRow.style.cursor = locked ? 'not-allowed' : 'pointer';
        }
        memoRow.onmouseenter = function () { if (!memoLocked()) memoRow.style.background = 'rgba(255,255,255,0.10)'; };
        memoRow.onmouseleave = function () { memoRow.style.background = 'transparent'; };
        memoRow.onmousedown = function () { if (!memoLocked()) memoRow.style.transform = 'scale(0.985)'; };
        memoRow.onmouseup = function () { memoRow.style.transform = ''; };
        memoRow.onclick = function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation(); // 阻断冒泡，避免触发「切到普通模式」
          if (ev && ev.preventDefault) ev.preventDefault();
          if (memoLocked()) { showLockToast(ev.clientX, ev.clientY); return; } // 受限：不支持开启
          window.__dsMemo = !window.__dsMemo;
          syncMemoUI();
          document.dispatchEvent(new CustomEvent('ds-memory-toggle', { detail: { on: !!window.__dsMemo } }));
        };
        syncMemoUI();
        if (normIt) {
          // 「>」子菜单箭头（右侧），提示本项有二级菜单；弱化不抢视觉
          try {
            var chev = document.createElement('span');
            chev.innerHTML = '<svg width="7" height="11" viewBox="0 0 7 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.45;display:block;"><path d="M0.5 1l4.5 4.5-4.5 4.5"/></svg>';
            chev.style.cssText = 'display:inline-flex;align-items:center;margin-left:auto;';
            normIt.appendChild(chev);
          } catch (e) { /* 忽略 */ }
          // 二级框是「普通模式」项的子元素：进入即显示，离开延迟隐藏（避免移到框上的途中/框 6px 间隔时中途消失）
          var memoHoverTimer = null;
          var hideMemoLater = function () {
            if (memoHoverTimer) clearTimeout(memoHoverTimer);
            memoHoverTimer = setTimeout(function () { memoFly.style.display = 'none'; }, 320);
          };
          var placeMemo = function () {
            // 窄视口（副窗口）不悬浮显示侧栏，走「点击同位子菜单」；主窗口宽视口保持悬浮
            if (inSubViewport()) { memoFly.style.display = 'none'; return; }
            // 其它展开框出现时，当前展开框立即消失（不残留鼠标移开的 320ms 延迟）
            if (skillFly && skillFly.style) skillFly.style.display = 'none';
            if (wtFly && wtFly.style) wtFly.style.display = 'none';
            memoFly.style.display = 'flex';
            var ih = normIt.offsetHeight, fh = memoFly.offsetHeight, fw = memoFly.offsetWidth;
            memoFly.style.top = Math.round((ih - fh) / 2) + 'px'; // 垂直居中：右框中心≈左按钮中心
            memoFly.style.left = ''; memoFly.style.right = '';
            var rect = normIt.getBoundingClientRect();
            if (rect.right + 8 + fw <= window.innerWidth) {
              memoFly.style.left = 'calc(100% + 6px)'; // 右侧放得下 → 贴右
            } else {
              memoFly.style.right = 'calc(100% + 6px)'; // 副窗口窄 → 翻到普通模式项左侧，不被右边窗口吞掉
            }
          }; // 悬浮显示始终挂载（placeXxx 运行时按视口宽度决定是否生效），保证副窗口切回主窗口后悬浮逻辑恢复
          normIt.addEventListener('mouseenter', placeMemo);
          normIt.addEventListener('mouseleave', hideMemoLater);
          memoFly.addEventListener('mouseenter', function () { if (memoHoverTimer) { clearTimeout(memoHoverTimer); memoHoverTimer = null; } });
          memoFly.addEventListener('mouseleave', hideMemoLater);
          // 记忆二级框：阻断 mousedown/click/pointerdown 冒泡，避免点击时整个下拉/二级框消失，并保证开关切换生效
          memoFly.addEventListener('mousedown', function (e) { e.stopPropagation(); });
          memoFly.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
          memoFly.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); });
        }
        // 菜单隐藏时同步隐藏记忆悬浮框
        new MutationObserver(function () {
          if (menu.style.display === 'none') memoFly.style.display = 'none';
        }).observe(menu, { attributes: true, attributeFilter: ['style'] });
        // === 任务模式旁 skill 自动激活二级悬浮框（首条/每条两个开关） ===
        var tskIt = menu.querySelector('button[data-ds-cm-mode="task"]');
        if (tskIt) tskIt.style.position = 'relative';
        var skillFly = document.createElement('div');
        skillFly.id = 'ds-cm-skill-fly'; // 供 document 捕获监听识别，点击框内不切模式/不关闭
        skillFly.style.cssText = 'position:absolute;left:calc(100% + 6px);top:0;display:none;flex-direction:column;gap:1px;background:rgba(24,26,33,0.92);backdrop-filter:blur(22px) saturate(1.6);-webkit-backdrop-filter:blur(22px) saturate(1.6);border:1px solid rgba(255,255,255,0.16);border-radius:12px;padding:6px;min-width:232px;z-index:2147483647;box-shadow:0 14px 34px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);';
        if (window.__dsSkillAuto === undefined) window.__dsSkillAuto = { first: true, every: true };
        function makeSkillRow(label, key) {
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px 11px;color:rgb(248,249,250);font-size:12.5px;font-weight:500;cursor:pointer;border-radius:9px;text-align:left;white-space:nowrap;transition:background 0.12s;';
          var t = document.createElement('span');
          t.textContent = label;
          row.appendChild(t);
          var sw = document.createElement('span');
          sw.style.cssText = 'position:relative;width:34px;height:20px;border-radius:10px;flex:none;background:rgba(255,255,255,0.22);transition:background 0.18s;';
          var knob = document.createElement('span');
          knob.style.cssText = 'position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left 0.18s;box-shadow:0 1px 3px rgba(0,0,0,0.35);';
          sw.appendChild(knob);
          row.appendChild(sw);
          row._key = key; row._sw = sw; row._knob = knob;
          return row;
        }
        var firstRow = makeSkillRow('新对话首条消息自动激活', 'first');
        var everyRow = makeSkillRow('当前对话每条消息自动激活', 'every');
        // 「技能」分组标题：说明下方两个开关作用于 skill / 技能
        var sTitle = document.createElement('div');
        sTitle.style.cssText = 'padding:3px 11px 4px;font-size:11px;color:rgba(255,255,255,0.5);font-weight:600;letter-spacing:0.5px;';
        sTitle.textContent = '技能';
        skillFly.appendChild(sTitle);
        skillFly.appendChild(firstRow);
        skillFly.appendChild(everyRow);
        if (tskIt) tskIt.appendChild(skillFly);
        function skillRowPaint(row, on) {
          row._sw.style.background = on ? 'rgb(103,158,254)' : 'rgba(255,255,255,0.22)';
          row._knob.style.left = on ? '16px' : '2px';
        }
        function skillSync() {
          var s = window.__dsSkillAuto;
          skillRowPaint(firstRow, s.first);
          skillRowPaint(everyRow, s.every);
        }
        [firstRow, everyRow].forEach(function (row) {
          row.onmouseenter = function () { row.style.background = 'rgba(255,255,255,0.10)'; };
          row.onmouseleave = function () { row.style.background = 'transparent'; };
          row.onmousedown = function () { row.style.transform = 'scale(0.985)'; };
          row.onmouseup = function () { row.style.transform = ''; };
          row.onclick = function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            if (ev && ev.preventDefault) ev.preventDefault();
            var s = window.__dsSkillAuto;
            if (row._key === 'first') s.first = !s.first;
            else { s.every = !s.every; if (s.every) s.first = true; } // 开「每条」联动开「首条」
            skillSync();
            document.dispatchEvent(new CustomEvent('ds-skill-auto-toggle', { detail: { first: s.first, every: s.every } }));
          };
        });
        skillSync();
        // 与插件侧 skill 自动激活设置同步：发起查询，收到插件实际状态后覆盖默认值并刷新开关
        document.addEventListener('ds-skill-auto-state', function (evt) {
          try {
            var d = evt.detail;
            var s = window.__dsSkillAuto;
            if (typeof d.first === 'boolean') s.first = d.first;
            if (typeof d.every === 'boolean') s.every = d.every;
            skillSync();
          } catch (e3) { /* 忽略 */ }
        });
        document.dispatchEvent(new CustomEvent('ds-skill-auto-query'));
        if (tskIt) {
          // 「>」子菜单箭头（右侧），提示本项有二级菜单
          try {
            var chevT = document.createElement('span');
            chevT.style.cssText = 'display:inline-flex;align-items:center;margin-left:auto;';
            chevT.innerHTML = '<svg width="7" height="11" viewBox="0 0 7 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.45;display:block;"><path d="M0.5 1l4.5 4.5-4.5 4.5"/></svg>';
            tskIt.appendChild(chevT);
          } catch (e) { /* 忽略 */ }
          var skillHoverTimer = null;
          var hideSkillLater = function () {
            if (skillHoverTimer) clearTimeout(skillHoverTimer);
            skillHoverTimer = setTimeout(function () { skillFly.style.display = 'none'; }, 320);
          };
          var placeSkill = function () {
            if (inSubViewport()) { skillFly.style.display = 'none'; return; }
            if (memoFly && memoFly.style) memoFly.style.display = 'none';
            if (wtFly && wtFly.style) wtFly.style.display = 'none';
            skillFly.style.display = 'flex';
            var ih = tskIt.offsetHeight, fh = skillFly.offsetHeight, fw = skillFly.offsetWidth;
            skillFly.style.top = Math.round((ih - fh) / 2) + 'px';
            skillFly.style.left = ''; skillFly.style.right = '';
            var rect = tskIt.getBoundingClientRect();
            if (rect.right + 8 + fw <= window.innerWidth) {
              skillFly.style.left = 'calc(100% + 6px)';
            } else {
              skillFly.style.right = 'calc(100% + 6px)';
            }
          };
          tskIt.addEventListener('mouseenter', placeSkill);
          tskIt.addEventListener('mouseleave', hideSkillLater);
          skillFly.addEventListener('mouseenter', function () { if (skillHoverTimer) { clearTimeout(skillHoverTimer); skillHoverTimer = null; } });
          skillFly.addEventListener('mouseleave', hideSkillLater);
          skillFly.addEventListener('mousedown', function (e) { e.stopPropagation(); });
          skillFly.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
          skillFly.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); });
        }
        // 菜单隐藏时同步隐藏 skill 悬浮框
        new MutationObserver(function () {
          if (menu.style.display === 'none') skillFly.style.display = 'none';
        }).observe(menu, { attributes: true, attributeFilter: ['style'] });
        // === 增强搜索旁网页工具二级悬浮框（搜索互联网 web_search / 获取网页 web_fetch 两个开关） ===
        var onlIt = menu.querySelector('button[data-ds-cm-mode="online"]');
        if (onlIt) onlIt.style.position = 'relative';
        var wtFly = document.createElement('div');
        wtFly.id = 'ds-cm-webtool-fly'; // 供 document 捕获监听识别，点击框内不切模式/不关闭
        wtFly.style.cssText = 'position:absolute;left:calc(100% + 6px);top:0;display:none;flex-direction:column;gap:1px;background:rgba(24,26,33,0.92);backdrop-filter:blur(22px) saturate(1.6);-webkit-backdrop-filter:blur(22px) saturate(1.6);border:1px solid rgba(255,255,255,0.16);border-radius:12px;padding:6px;min-width:220px;z-index:2147483647;box-shadow:0 14px 34px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);';
        if (window.__dsWebTools === undefined) window.__dsWebTools = { search: true, fetch: true };
        function makeWebRow(label) {
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px 11px;color:rgb(248,249,250);font-size:12.5px;font-weight:500;cursor:pointer;border-radius:9px;text-align:left;white-space:nowrap;transition:background 0.12s;';
          var t = document.createElement('span');
          t.textContent = label;
          row.appendChild(t);
          var sw = document.createElement('span');
          sw.style.cssText = 'position:relative;width:34px;height:20px;border-radius:10px;flex:none;background:rgba(255,255,255,0.22);transition:background 0.18s;';
          var knob = document.createElement('span');
          knob.style.cssText = 'position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left 0.18s;box-shadow:0 1px 3px rgba(0,0,0,0.35);';
          sw.appendChild(knob);
          row.appendChild(sw);
          row._sw = sw; row._knob = knob;
          return row;
        }
        var searchRow = makeWebRow('搜索互联网');
        var fetchRow = makeWebRow('获取网页');
        wtFly.appendChild(searchRow);
        wtFly.appendChild(fetchRow);
        if (onlIt) onlIt.appendChild(wtFly);
        // === 窄窗口/副窗口：二级内容「同位」渲染进一级菜单（替换三项模式项），返回按钮回一级 ===
        // 窄视口（副窗口为主窗口切换/直接呼出）统一用「在一级菜单里渲染新的」，避免侧栏被窗缘截断。
        function subFlyFor(m) { return m === 'task' ? skillFly : (m === 'online' ? wtFly : memoFly); }
        function makeBackRow(fly) {
          if (fly._dsHasBack) return fly._dsHasBack;
          var back = document.createElement('div');
          back.className = 'ds-cm-sub-back'; // 默认隐藏，仅在「一级菜单内原地渲染」时通过 CSS 显示
          back.setAttribute('data-ds-sub-back', '1');
          back.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 11px;margin:1px 2px 4px;border-radius:9px;color:rgba(255,255,255,0.75);font-size:13px;font-weight:500;cursor:pointer;user-select:none;-webkit-user-select:none;transition:background 0.12s;';
          back.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></span><span>返回</span>';
          back.onmouseenter = function () { this.style.background = 'rgba(255,255,255,0.10)'; };
          back.onmouseleave = function () { this.style.background = 'transparent'; };
          back.onclick = function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            if (ev && ev.preventDefault) ev.preventDefault();
            leaveSub(); // 返回上一级：收起二级、露出三个模式项
          };
          fly.insertBefore(back, fly.firstChild);
          fly._dsHasBack = back;
          return back;
        }
        // 二级内容的一级宿主：菜单内的普通流式容器 → 二级面板放进它即「原地替换」三个模式项
        var subHost = document.createElement('div');
        subHost.id = 'ds-cm-subhost';
        subHost.style.cssText = 'display:none;flex-direction:column;gap:1px;width:100%;';
        menu.appendChild(subHost);
        // 鼠标进入任一二级面板（悬浮侧栏或原位子菜单）时，立即收掉模式项的解释提示
        [memoFly, skillFly, wtFly, subHost].forEach(function (f) { if (f) f.addEventListener('mouseenter', tipHide); });
        // 记录各二级框的原宿主（对应的一级模式项），返回一级及重复进入时便于归位
        if (memoFly) memoFly._origParent = normIt;
        if (skillFly) skillFly._origParent = tskIt;
        if (wtFly) wtFly._origParent = onlIt;
        // 窄视口判定：副窗口恒窄（360px 上下）；主窗口在极窄时同样受益（侧栏不被截断）
        function inSubViewport() { return window.innerWidth < 760; }
        function leaveSub() {
          if (subHost && subHost._curFly) {
            var cur = subHost._curFly;
            cur.classList && cur.classList.remove('ds-cm-fly-inmenu'); // 恢复二级面板原有盒子样式
            subHost.removeChild(cur);
            if (cur._origParent) cur._origParent.appendChild(cur); // 归位回模式项
            cur.style.display = 'none';
            subHost._curFly = null;
          }
          if (subHost) subHost.style.display = 'none';
          // 还原为 flex（不能用 ''，那会清掉 makeItem 里 cssText 设置的内联 display:flex，
          // 导致按钮退回默认 inline-block，图标/文字/箭头挤到一块并随视图迁移带到主窗口）
          if (normIt) normIt.style.display = 'flex';
          if (tskIt) tskIt.style.display = 'flex';
          if (onlIt) onlIt.style.display = 'flex';
        }
        function enterSub(m) {
          var fly = subFlyFor(m) || memoFly;
          makeBackRow(fly);
          // 若已在二级且目标相同，仅确保显示
          if (subHost._curFly !== fly) {
            if (subHost._curFly) { // 迁走上一块二级面板（回归其模式项）
              var old = subHost._curFly;
              old.classList && old.classList.remove('ds-cm-fly-inmenu');
              subHost.removeChild(old);
              if (old._origParent) old._origParent.appendChild(old);
              old.style.display = 'none';
              subHost._curFly = null;
            }
            if (fly.parentNode) fly.parentNode.removeChild(fly); // 从模式项里摘出
            fly.classList && fly.classList.add('ds-cm-fly-inmenu'); // 去掉盒子样式 → 在菜单内[原框]渲染
            subHost.appendChild(fly);
            fly.style.display = 'flex';
            subHost._curFly = fly;
          }
          // 隐藏三个模式项 → 菜单里只剩二级内容（原位替换）
          [normIt, tskIt, onlIt].forEach(function (it) { if (it) it.style.display = 'none'; });
          subHost.style.display = 'flex';
        }
        // 菜单关闭时统一收起二级，保证下次打开为干净的一级状态
        new MutationObserver(function () {
          if (menu.style.display === 'none') leaveSub();
        }).observe(menu, { attributes: true, attributeFilter: ['style'] });
        function wtRowPaint(row, on) {
          row._sw.style.background = on ? 'rgb(103,158,254)' : 'rgba(255,255,255,0.22)';
          row._knob.style.left = on ? '16px' : '2px';
        }
        function wtSync() {
          var w = window.__dsWebTools;
          wtRowPaint(searchRow, w.search);
          wtRowPaint(fetchRow, w.fetch);
        }
        [searchRow, fetchRow].forEach(function (row, idx) {
          row.onmouseenter = function () { row.style.background = 'rgba(255,255,255,0.10)'; };
          row.onmouseleave = function () { row.style.background = 'transparent'; };
          row.onmousedown = function () { row.style.transform = 'scale(0.985)'; };
          row.onmouseup = function () { row.style.transform = ''; };
          row.onclick = function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            if (ev && ev.preventDefault) ev.preventDefault();
            var w = window.__dsWebTools;
            if (idx === 0) w.search = !w.search; else w.fetch = !w.fetch;
            wtSync();
            document.dispatchEvent(new CustomEvent('ds-web-tools-toggle', { detail: { search: w.search, fetch: w.fetch } }));
          };
        });
        wtSync();
        // 与插件侧网页工具设置同步：发起查询，收到实际状态后覆盖默认值并刷新开关
        document.addEventListener('ds-web-tools-state', function (evt) {
          try {
            var d = evt.detail;
            var w = window.__dsWebTools;
            if (typeof d.search === 'boolean') w.search = d.search;
            if (typeof d.fetch === 'boolean') w.fetch = d.fetch;
            wtSync();
          } catch (e3) { /* 忽略 */ }
        });
        document.dispatchEvent(new CustomEvent('ds-web-tools-query'));
        if (onlIt) {
          try {
            var chevW = document.createElement('span');
            chevW.style.cssText = 'display:inline-flex;align-items:center;margin-left:auto;';
            chevW.innerHTML = '<svg width="7" height="11" viewBox="0 0 7 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.45;display:block;"><path d="M0.5 1l4.5 4.5-4.5 4.5"/></svg>';
            onlIt.appendChild(chevW);
          } catch (e) { /* 忽略 */ }
          var wtHoverTimer = null;
          var hideWtLater = function () {
            if (wtHoverTimer) clearTimeout(wtHoverTimer);
            wtHoverTimer = setTimeout(function () { wtFly.style.display = 'none'; }, 320);
          };
          var placeWt = function () {
            if (inSubViewport()) { wtFly.style.display = 'none'; return; }
            if (memoFly && memoFly.style) memoFly.style.display = 'none';
            if (skillFly && skillFly.style) skillFly.style.display = 'none';
            wtFly.style.display = 'flex';
            var ih = onlIt.offsetHeight, fh = wtFly.offsetHeight, fw = wtFly.offsetWidth;
            wtFly.style.top = Math.round((ih - fh) / 2) + 'px';
            wtFly.style.left = ''; wtFly.style.right = '';
            var rect = onlIt.getBoundingClientRect();
            if (rect.right + 8 + fw <= window.innerWidth) {
              wtFly.style.left = 'calc(100% + 6px)';
            } else {
              wtFly.style.right = 'calc(100% + 6px)';
            }
          };
          onlIt.addEventListener('mouseenter', placeWt);
          onlIt.addEventListener('mouseleave', hideWtLater);
          wtFly.addEventListener('mouseenter', function () { if (wtHoverTimer) { clearTimeout(wtHoverTimer); wtHoverTimer = null; } });
          wtFly.addEventListener('mouseleave', hideWtLater);
          wtFly.addEventListener('mousedown', function (e) { e.stopPropagation(); });
          wtFly.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
          wtFly.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); });
        }
        new MutationObserver(function () {
          if (menu.style.display === 'none') wtFly.style.display = 'none';
        }).observe(menu, { attributes: true, attributeFilter: ['style'] });
        // 模式按钮图标切换的丝滑过渡 keyframes
        var micoStyle = document.createElement('style');
        micoStyle.textContent = '@keyframes dsPivot{from{opacity:0;transform:scale(0.5) rotate(-10deg)}to{opacity:1;transform:scale(1) rotate(0)}}'
          // 窄窗口/副窗口：二级内容在「一级菜单」内原地渲染时，去掉二级面板自带的盒子样式，
          // 使其看起来如同菜单原有行元素（复用一级菜单的毛玻璃框，避免又弹出一个新菜单框）。
          + '#ds-cm-subhost .ds-cm-fly-inmenu{position:static!important;left:auto!important;top:auto!important;right:auto!important;width:auto!important;min-width:100%!important;background:transparent!important;border:none!important;border-radius:0!important;box-shadow:none!important;padding:2px!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}'
          // 返回按钮默认隐藏（主窗口悬浮二级框不带它），仅在「一级菜单内原地渲染」时显示
          + '.ds-cm-sub-back{display:none!important;} #ds-cm-subhost .ds-cm-fly-inmenu .ds-cm-sub-back{display:flex!important;}';
        document.body.appendChild(micoStyle);
        // 增强检索模式下：透明遮罩盖住原生「智能搜索」按钮，阻止用户自行开启；
        // 点击遮罩弹出黄色半透明圆角提示（可穿透、几秒后消失）。
        var mask = document.createElement('div');
        mask.id = 'ds-cm-mask';
        mask.style.cssText = 'position:fixed;display:none;z-index:2147483646;cursor:not-allowed;';
        mask.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          showToast();
        }, true);
        document.body.appendChild(mask);
        var toast = document.createElement('div');
        toast.id = 'ds-cm-toast';
        // 黄色半透明提示：白字（参考共享屏幕悬浮窗白字）+ 轻投影保证可读，去掉 blur 避免叠影
        toast.style.cssText = 'position:fixed;display:none;align-items:center;gap:6px;padding:9px 16px;border-radius:12px;background:rgba(255,176,32,0.5);border:1px solid rgba(255,255,255,0.3);box-shadow:0 6px 20px rgba(0,0,0,0.28);color:#ffffff;font-size:13px;font-weight:500;line-height:1.3;text-shadow:0 1px 2px rgba(0,0,0,0.35);pointer-events:none;white-space:nowrap;z-index:2147483647;';
        toast.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span><span>增强搜索中不支持开启原生联网</span>';
        document.body.appendChild(toast);
        // === token 显示悬浮块（设置中开关，默认关；今日数字，悬浮展示「今日/累计」，位置紧跟输入框右上方） ===
        try {
          if (window.__dsTokenWidget) throw 0; // 已由独立 injectTokenWidget 注入，跳过避免重复
          var tw = document.createElement('div');
          tw.id = 'ds-token-widget';
          tw.style.cssText = 'position:fixed;display:none;align-items:center;justify-content:center;gap:6px;min-width:34px;height:24px;padding:0 10px;border-radius:12px;background:rgba(28,30,38,0.55);backdrop-filter:blur(14px) saturate(1.5);-webkit-backdrop-filter:blur(14px) saturate(1.5);border:1px solid rgba(255,255,255,0.18);color:#eef0f3;font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1;user-select:none;-webkit-user-select:none;cursor:default;z-index:2147483000;';
          tw.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#5a8cff;flex:none;box-shadow:0 0 6px rgba(90,140,255,0.9);"></span>'
            + '<span class="ds-token-box" style="display:inline-flex;align-items:flex-start;overflow:hidden;height:15px;transform:translateY(1px);"></span>'
            + '<div class="ds-token-tip" style="position:absolute;top:calc(100% + 7px);right:0;display:none;flex-direction:column;gap:4px;padding:9px 12px;border-radius:10px;background:rgba(28,30,38,0.6);backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);border:1px solid rgba(255,255,255,0.16);font-size:11px;font-weight:500;line-height:1.2;white-space:nowrap;">'
            + '<span style="color:#9aa3b2;">今日 <b class="ds-token-today" style="color:#eef0f3;font-variant-numeric:tabular-nums;font-weight:600;margin-left:4px;">0</b></span>'
            + '<span style="color:#9aa3b2;">累计 <b class="ds-token-total" style="color:#eef0f3;font-variant-numeric:tabular-nums;font-weight:600;margin-left:4px;">0</b></span>'
            + '</div>';
          document.body.appendChild(tw);
          tw.style.position = 'fixed';
          var twSlotBox = tw.querySelector('.ds-token-box');
          var twToday = tw.querySelector('.ds-token-today');
          var twTotal = tw.querySelector('.ds-token-total');
          var twTip = tw.querySelector('.ds-token-tip');
          // ===== 老虎机：每个字符一列（列内 0-9/.kMB 循环的竖带），上滑循环到目标字符 =====
          var SLOT_H = 15; // 单格高度
          var SLOT_SEQ = '0123456789.kMB'; // 每个数字/字母出现的顺序（0-9 循环 → 目标）
          var SLOT_BAND = (function () { var a = []; for (var r = 0; r < 22; r++) { for (var s = 0; s < SLOT_SEQ.length; s++) a.push(SLOT_SEQ[s]); } return a; })();
          var twCols = [];
          var twFirst = true; // 首次渲染不滚动，直接落位
          function twNewCol() {
            var col = document.createElement('span');
            col.style.cssText = 'display:inline-block;vertical-align:top;overflow:hidden;height:' + SLOT_H + 'px;width:9px;position:relative;';
            var strip = document.createElement('span');
            strip.style.cssText = 'display:block;line-height:' + SLOT_H + 'px;font-variant-numeric:tabular-nums;will-change:transform;';
            col.appendChild(strip);
            return { col: col, strip: strip, idx: 0, built: false };
          }
          function twFillStrip(co) {
            var frag = document.createDocumentFragment();
            var cellCss = 'display:flex;align-items:center;justify-content:center;height:' + SLOT_H + 'px;line-height:' + SLOT_H + 'px;font-variant-numeric:tabular-nums;color:#eef0f3;font-weight:600;white-space:nowrap;';
            for (var i = 0; i < SLOT_BAND.length; i++) {
              var cell = document.createElement('span');
              cell.style.cssText = cellCss;
              cell.textContent = SLOT_BAND[i];
              frag.appendChild(cell);
            }
            co.strip.appendChild(frag);
            co.built = true;
          }
          function twCharIdxLow(char) {
            var p = SLOT_BAND.indexOf(char); if (p < 0) p = 0;
            var mid = Math.floor(SLOT_BAND.length / 2);
            while (p < mid) p += SLOT_SEQ.length;
            return p;
          }
          function twSetIdxVisible(co, char) {
            co.idx = twCharIdxLow(char);
            co.strip.style.transform = 'translateY(' + (-co.idx * SLOT_H) + 'px)';
          }
          function twRollTo(co, char) {
            if (!co.built) twFillStrip(co);
            if (SLOT_BAND[co.idx] === char) return;
            var seqLen = SLOT_SEQ.length;
            var curPos = SLOT_SEQ.indexOf(SLOT_BAND[co.idx]);
            var tarPos = SLOT_SEQ.indexOf(char);
            var fwd = ((tarPos - curPos) + seqLen) % seqLen;
            var steps = fwd + seqLen; // 至少转一整圈再落位
            var base = co.idx + steps;
            if (base > SLOT_BAND.length - 12) { // 竖带快到底，无声重定位到中部同字符
              twSetIdxVisible(co, char);
              return;
            }
            var dur = Math.min(720, Math.max(320, steps * 30));
            var anim = co.strip.animate(
              [{ transform: 'translateY(' + (-co.idx * SLOT_H) + 'px)' }, { transform: 'translateY(' + (-base * SLOT_H) + 'px)' }],
              { duration: dur, easing: 'cubic-bezier(.12,.85,.3,1)', fill: 'forwards' }
            );
            co.idx = base;
            anim.onfinish = function () { try { anim.cancel(); } catch (e9) {} co.strip.style.transform = 'translateY(' + (-base * SLOT_H) + 'px)'; };
          }
          var twSetNum = function (text) {
            try {
              var targets = text.split('');
              while (twCols.length < targets.length) twCols.push(twNewCol());
              while (twCols.length > targets.length) { var r = twCols.pop(); if (r.col.parentNode) r.col.parentNode.removeChild(r.col); }
              while (twSlotBox.firstChild) twSlotBox.removeChild(twSlotBox.firstChild);
              for (var i = 0; i < twCols.length; i++) {
                var co = twCols[i];
                if (!co.built) twFillStrip(co);
                if (twFirst) twSetIdxVisible(co, targets[i]);
                else twRollTo(co, targets[i]);
                twSlotBox.appendChild(co.col);
              }
              twFirst = false;
            } catch (e4) {
              twSlotBox.textContent = text;
            }
          };
          // 悬浮提示
          tw.addEventListener('pointerenter', function () { try { twTip.style.display = 'flex'; } catch (e5) {} });
          tw.addEventListener('pointerleave', function () { try { twTip.style.display = 'none'; } catch (e5) {} });
          // 定位：与「无痕模式」悬浮徽章完全一致——锚定 composer 容器、右侧对齐其右缘、悬于其上方 8px。
          // composer = 含上传框+输入框的外层容器；找不到时回退到输入框父容器。全程 zoom 感知，
          // 这样引用条插入输入框上方后，token 仍吸附在 composer 顶边之上，不会与引用条重合。
          var twLastKey = '';
          function twLayoutRect(el) {
            var rr = el.getBoundingClientRect();
            try {
              var zz = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
              if (zz !== 1 && zz > 0) return { left: rr.left / zz, top: rr.top / zz, right: rr.right / zz, bottom: rr.bottom / zz, width: rr.width / zz, height: rr.height / zz };
            } catch (eZ) {}
            return rr;
          }
          function twFindComposer() {
            // 优先 textarea；专家/深度思考等对话输入框可能是 contenteditable / role=textbox，一并纳入兜底
            var ta = document.querySelector('textarea[placeholder*="发送消息"], textarea[aria-label*="发送消息"], textarea');
            if (!ta) ta = document.querySelector('[contenteditable="true"], [role="textbox"], textarea');
            if (!ta) return null;
            var comp = ta.parentElement;
            for (var ci = 0; ci < 8 && comp; ci++) {
              // 专家模式下页面没有 input[type=file]，file 不能作为必需项；用 button/role=button 兜底判断 composer。
              if (comp.querySelector && comp.querySelector('input[type="file"], button, [role="button"]') && comp.querySelector('textarea, [contenteditable="true"]')) break;
              comp = comp.parentElement;
            }
            if (!comp) comp = ta.parentElement;
            return { ta: ta, comp: comp };
          }
          var twPlace = function () {
            try {
              var hit = twFindComposer();
              if (!hit) return;
              var cRect = twLayoutRect(hit.comp);
              if (!cRect || cRect.width <= 1 || cRect.height <= 1) return;
              var bw = tw.offsetWidth || 34;
              var bh = tw.offsetHeight || 24;
              var rightAnchor = cRect.right - 8;      // 右缘对齐 composer，留 8px（与无痕一致）
              var left = Math.max(8, rightAnchor - bw); // 左侧越界钳制
              var top = cRect.top - bh - 8;           // 悬于 composer 上方 8px（与无痕一致）
              if (top < 8) top = cRect.bottom + 8;
              var key = left + ',' + top;
              if (key !== twLastKey) {
                twLastKey = key;
                tw.style.right = '';                  // 改用 left 定位，与无痕一致
                tw.style.left = left + 'px';
                tw.style.top = top + 'px';
              }
            } catch (e3) {}
          };
          // 数值格式化：<1k 原样，>=1k→k，>=1M→M，>=1B→B；加单位后保留 1 位小数（含末尾 .0）
          var twFmt = function (n) {
            var v = Number(n) || 0;
            if (v < 1000) return String(Math.round(v));
            var u, f;
            if (v >= 1000000000) { u = 'B'; f = v / 1000000000; }
            else if (v >= 1000000) { u = 'M'; f = v / 1000000; }
            else { u = 'k'; f = v / 1000; }
            return f.toFixed(1) + u;
          };
          var twPoll = function () { try { document.dispatchEvent(new CustomEvent('ds-token-widget-query')); } catch (e7) {} };
          var twTimer = null;
          var posTimer = null;
          // 状态驱动：token 小窗开启才跑 3s 数据轮询 + 150ms 位置轮询；关闭立即停，长开不空转。
          function twStartTimers() {
            if (twTimer) return;
            twPoll();
            twTimer = setInterval(twPoll, 3000);
            posTimer = setInterval(twPlace, 150);
          }
          function twStopTimers() {
            if (twTimer) { clearInterval(twTimer); twTimer = null; }
            if (posTimer) { clearInterval(posTimer); posTimer = null; }
          }
          var twShow = function (enabled, tokens, total) {
            twEnabledNow = enabled === true;
            twTokensNow = Number(tokens) || 0;
            twTotalNow = Number(total) || 0;
            if (enabled) {
              twSetNum(twFmt(twTokensNow));
              if (twToday) twToday.textContent = twFmt(twTokensNow);
              if (twTotal) twTotal.textContent = twFmt(twTotalNow);
              tw.style.display = 'flex';
              twStartTimers();
            } else {
              tw.style.display = 'none';
              twStopTimers();
            }
            twPlace();
          };
          var twEnabledNow = false, twTokensNow = 0, twTotalNow = 0;
          document.addEventListener('ds-token-widget-state', function (ev) {
            try { var d = ev.detail || {}; twShow(!!d.enabled, Number(d.tokens) || 0, Number(d.totalTokens) || 0); } catch (e6) {}
          });
          window.addEventListener('resize', function () { twPlace(); });
          window.addEventListener('scroll', function () { twPlace(); }, true);
          // 自愈：专家/深度思考等模式切换时页面可能重建/清掉注入的 token 节点，一旦缺失自动重建并恢复显示。
          var twBodyObserver = null;
          try {
            if (typeof MutationObserver === 'function') {
              twBodyObserver = new MutationObserver(function () {
                try {
                  if (!document.getElementById('ds-token-widget') && tw && !tw.isConnected) {
                    if (tw.parentNode !== document.body) document.body.appendChild(tw);
                    twShow(twEnabledNow, twTokensNow, twTotalNow);
                  }
                } catch (eS) {}
              });
              twBodyObserver.observe(document.body, { childList: true, subtree: false });
            }
          } catch (eM) { /* 忽略 */ }
          twPoll(); // 首次拉取开关状态（receive 到 ds-token-widget-state 后按 enabled 决定是否启动轮询）
          window.__dsTokenWidget = { show: twShow, query: twPoll, place: twPlace, destroy: function () { twStopTimers(); if (twBodyObserver) { try { twBodyObserver.disconnect(); } catch (eB2) {} } } };
        } catch (e8) { /* 忽略 */ }
        // === 占位文字覆盖层：把「给 DeepSeek 发送消息」显示改为「输入 / 召唤技能」 ===
        // 不直接改 textarea 的 placeholder 属性（内部有 11 处选择器依赖 placeholder*="发送消息"
        // 来定位主聊天输入框、区分底部搜索框），而是注入一个透明文字层，输入为空时显示、有值时隐藏。
        var ph = document.createElement('div');
        ph.id = 'ds-cm-placeholder';
        // 改为绝对定位插入输入框父容器：随输入框自然移动（不同步按视口追踪），吃滚动/布局自动跟随。
        ph.style.cssText = 'position:absolute;top:0;left:0;display:none;align-items:center;pointer-events:none;z-index:2147483646;color:rgba(148,151,158,0.55);font-weight:400;letter-spacing:0;white-space:nowrap;';
        ph.textContent = '输入 / 召唤技能';
        // 隐藏原生 placeholder 文字（变透明），避免与注入层「输入 / 召唤技能」重叠。
        // 只针对包含「发送消息」的主聊天输入框（React 重建后属性仍在），不影响页面底部搜索框的占位。
        var phHideStyle = document.createElement('style');
        phHideStyle.id = 'ds-cm-hidden-ph';
        phHideStyle.textContent = 'textarea[placeholder*="发送消息"]::placeholder{color:transparent!important;} textarea[placeholder*="发送消息"]::-webkit-input-placeholder{color:transparent!important;} textarea[placeholder*="发送消息"]::-moz-placeholder{color:transparent!important;} textarea[placeholder*="发送消息"]:-ms-input-placeholder{color:transparent!important;}';
        (document.head || document.documentElement).appendChild(phHideStyle);
        function syncPlaceholder() {
          try {
            var ta = null;
            var candP = document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], textarea');
            if (candP) ta = candP;
            // 专家/深度思考等对话输入框可能是 contenteditable / role=textbox，一并兜底
            if (!ta) ta = document.querySelector('[contenteditable="true"], [role="textbox"], textarea');
            if (!ta || !ta.isConnected) { ph.style.display = 'none'; return; }
            var hasText = ta.value !== undefined ? ta.value.length > 0 : ((ta.textContent || '').trim().length > 0);
            if (hasText) { ph.style.display = 'none'; return; }
            var st = getComputedStyle(ta);
            var r = ta.getBoundingClientRect();
            var z = 1;
            try { z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1; } catch (e2) {}
            if (!(z > 0)) z = 1;
            ph.style.fontSize = st.fontSize;
            var pl = (parseFloat(st.paddingLeft) || 0);
            var pt = (parseFloat(st.paddingTop) || 0);
            // 宿主 = 输入框父容器；让其为定位锚点，把占位文字插进去，随输入框自然移动。
            var host = ta.parentElement;
            if (!host) { ph.style.display = 'none'; return; }
            try {
              var hr = getComputedStyle(host);
              if (hr.position === 'static') host.style.position = 'relative';
            } catch (eH) {}
            if (ph.parentNode !== host) { try { host.appendChild(ph); } catch (eA) {} }
            // 相对宿主定位：ta.offsetLeft/top 是相对宿主(已 relative)的偏移，加 padding 对齐输入内容
            ph.style.left = Math.round(ta.offsetLeft + pl + 3) + 'px';
            ph.style.top = Math.round(ta.offsetTop + pt + 2) + 'px';
            ph.style.display = 'block';
          } catch (e3) { ph.style.display = 'none'; }
        }
        // 输入内容时同步显隐（捕获阶段，兼容动态 textarea）
        document.addEventListener('input', function (e) {
          try {
            if (e.target && e.target.nodeName === 'TEXTAREA') { placeNow(); }
          } catch (e4) {}
        }, true);
        var toastTimer = null;
        function showToast() {
          toast.style.display = 'flex';
          toast.style.visibility = 'hidden';
          var tw = toast.offsetWidth;
          toast.style.visibility = 'visible';
          var sm = findSmartOnly();
          var z = 1;
          try { z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1; } catch (e2) {}
          if (!(z > 0)) z = 1;
          if (sm) {
            var r = sm.getBoundingClientRect();
            var left = (r.left + r.width / 2 - tw / 2) / z;
            var top = (r.top - toast.offsetHeight - 8) / z;
            if (left < 8) left = 8;
            toast.style.left = Math.round(left) + 'px';
            toast.style.top = Math.round(top) + 'px';
          } else {
            toast.style.left = Math.round(window.innerWidth / 2 - tw / 2) + 'px';
            toast.style.top = '100px';
          }
          if (toastTimer) clearTimeout(toastTimer);
          toastTimer = setTimeout(function () { toast.style.display = 'none'; }, 3000);
        }
        // 遮罩位置随「智能搜索」按钮同步（增强模式下显示，其余模式隐藏）
        function syncMask() {
          var sm = findSmartOnly();
          // 增强检索 / 任务模式都禁用原生联网 → 显示遮罩
          var mode = window.__dsChatMode === 'online' || window.__dsChatMode === 'task' ? 'online' : 'normal';
          if (mode === 'online' && sm) {
            var r = sm.getBoundingClientRect();
            var z = 1;
            try { z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1; } catch (e2) {}
            if (!(z > 0)) z = 1;
            mask.style.left = Math.round(r.left / z) + 'px';
            mask.style.top = Math.round(r.top / z) + 'px';
            mask.style.width = Math.round(r.width / z) + 'px';
            mask.style.height = Math.round(r.height / z) + 'px';
            mask.style.display = 'block';
          } else {
            mask.style.display = 'none';
          }
        }
        function sync() {
          var mode = window.__dsChatMode === 'online' ? 'online' : (window.__dsChatMode === 'task' ? 'task' : 'normal');
          var enhanced = mode === 'online' || mode === 'task';
          btn.__dsMode = mode;
          var lbl = btn.querySelector('.ds-cm-label');
          if (lbl) lbl.textContent = mode === 'online' ? '增强' : (mode === 'task' ? '任务' : '普通');
          var ico = btn.querySelector('.ds-cm-ico');
          // 只有模式真的变了才重建图标 + 播放入场动画；避免「鼠标掠过下拉项触发 sync」导致的反复缩放
          var modeChanged = window.__dsLastChatMode !== mode;
          window.__dsLastChatMode = mode;
          if (ico) {
            if (modeChanged) {
              ico.innerHTML = enhanced ? (mode === 'task' ? icoTask : icoOn) : icoOff;
              // 图标切换的丝滑入场：重新触发一个「缩小到原大小」的过渡动画
              ico.style.animation = 'none';
              void ico.offsetWidth; // 强制 reflow 以重启动画
              ico.style.animation = 'dsPivot 0.24s cubic-bezier(0.22,1,0.36,1)';
            }
          }
          // 任务模式激活 → 把白色造型图标用 CSS 滤镜染成蓝色（与增强检索一致的蓝色系）
          if (ico && mode === 'task') {
            var im = ico.querySelector('img');
            if (im) im.style.filter = 'invert(1) brightness(0) saturate(100%) invert(49%) sepia(97%) saturate(2900%) hue-rotate(208deg) brightness(100%) contrast(108%)';
          } else if (ico) {
            var uim = ico.querySelector('img');
            if (uim) uim.style.filter = '';
          }
          var its = menu.querySelectorAll('button[data-ds-cm-mode]');
          for (var i = 0; i < its.length; i++) {
            var it = its[i];
            var m = it.getAttribute('data-ds-cm-mode');
            var check = it.querySelector('.ds-cm-check');
            var itico = it.querySelector('.ds-cm-it-ico');
            var locked = modeLocked(m); // B 类窗口/无痕下不可用的模式项置灰
            if (locked) {
              it.style.borderColor = 'transparent';
              it.style.background = 'transparent';
              it.style.color = 'rgba(249,250,251,0.30)';
              it.style.cursor = 'not-allowed';
              if (itico) {
                itico.style.color = 'rgba(249,250,251,0.35)';
                var limg = itico.querySelector('img');
                if (limg) limg.style.filter = 'grayscale(1) opacity(0.4)';
              }
              if (check) check.style.opacity = '0';
              continue;
            }
            if (m === mode) {
              it.style.borderColor = 'rgba(90,140,255,0.9)';
              it.style.background = 'rgba(90,140,255,0.18)';
              it.style.color = '#ffffff';
              // 选中项图标点亮为蓝色（文字保持白），满足「增强检索/任务 平时白、激活蓝」的区分
              if (itico) {
                itico.style.color = 'rgb(103,158,254)';
                // 任务模式项是 <img>，需用滤镜把白色染蓝
                var nimg = itico.querySelector('img');
                if (nimg) nimg.style.filter = 'invert(1) brightness(0) saturate(100%) invert(49%) sepia(97%) saturate(2900%) hue-rotate(208deg) brightness(100%) contrast(108%)';
              }
              if (check) check.style.opacity = '1';
            } else {
              it.style.borderColor = 'transparent';
              it.style.background = 'transparent';
              it.style.color = 'rgb(249,250,251)';
              it.style.cursor = 'pointer';
              if (itico) {
                itico.style.color = '';
                var uimg = itico.querySelector('img');
                if (uimg) uimg.style.filter = '';
              }
              if (check) check.style.opacity = '0';
            }
          }
          if (enhanced) {
            btn.style.borderColor = 'rgb(72,104,178)';
            btn.style.background = 'rgb(40,49,66)';
            btn.style.color = 'rgb(103,158,254)';
          } else {
            btn.style.borderColor = 'rgba(255,255,255,0.12)';
            btn.style.background = 'rgba(255,255,255,0.04)';
            btn.style.color = 'rgb(249,250,251)';
          }
          syncMask();
          syncMemoUI(); // 无痕等状态变化时同步记忆开关的置灰/状态
        }
        window.__dsSyncChatMode = sync;
        function toggleMenu() {
          var r = btn.getBoundingClientRect();
          var z = 1;
          try { z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1; } catch (e2) {}
          var rect = z !== 1 && z > 0 ? { left: r.left / z, top: r.top / z } : { left: r.left, top: r.top };
          if (menu.style.display === 'flex') {
            menu.style.display = 'none';
          } else {
            sync();
            menu.style.display = 'flex';
            menu.style.visibility = 'hidden';
            var mh = menu.offsetHeight;
            menu.style.visibility = 'visible';
            menu.style.left = Math.max(8, rect.left - 8) + 'px';
            menu.style.top = (rect.top - mh - 4) + 'px';
            // 每次打开菜单都重新从插件侧读取 skill 自动激活状态，覆盖页面残留旧值
            document.dispatchEvent(new CustomEvent('ds-skill-auto-query'));
            // 同时刷新网页工具（web_search/web_fetch）状态
            document.dispatchEvent(new CustomEvent('ds-web-tools-query'));
          }
        }
        // 事件委托（捕获阶段）：SPA 切换会话后按钮被 React 移动/重建也始终可点，不依赖按钮自身监听
        document.addEventListener('click', function (e) {
          var target = e.target;
          try {
            if (!target || !target.closest) { menu.style.display = 'none'; return; }
            // 点击记忆二级框：任何位置都不关闭菜单、也不触发切模式；不拦停事件，让它继续到达内部开关（否则点不动）
            if (target.closest('#ds-cm-memo-fly')) {
              e.preventDefault();
              return;
            }
            // 点击「自动匹配skill」二级框：同上，不关闭菜单、不切模式，让内部开关生效
            if (target.closest('#ds-cm-skill-fly')) {
              e.preventDefault();
              return;
            }
            // 点击「网页工具」二级框：同上，不关闭菜单、不切模式，让内部开关生效
            if (target.closest('#ds-cm-webtool-fly')) {
              e.preventDefault();
              return;
            }
            var inBtn = target.closest('#ds-chat-mode-btn');
            var inMenu = target.closest('#ds-chat-mode-menu');
            if (inBtn) {
              e.preventDefault();
              e.stopPropagation();
              toggleMenu();
              return;
            }
            if (inMenu) {
              var it = target.closest('button[data-ds-cm-mode]');
              if (it) {
                e.preventDefault();
                e.stopPropagation();
                var m = it.getAttribute('data-ds-cm-mode');
                var cur = window.__dsChatMode === 'online' || window.__dsChatMode === 'task' ? window.__dsChatMode : 'normal';
                if (modeLocked(m)) { showLockToast(e.clientX, e.clientY); return; } // 受限项：置灰 + 提示，不支持切换
                if (m === cur) {
                  // 窄窗口/副窗口：点当前已选模式 → 原位进入该模式的次级子菜单（节省空间，不被截断）
                  if (inSubViewport()) { enterSub(m); return; }
                  menu.style.display = 'flex'; return; // 主窗口点当前已选模式：保持展开，不关闭
                }
                if (inSubViewport()) leaveSub(); // 切到其他模式前收起可能展开的二级
                menu.style.display = 'none';
                document.dispatchEvent(new CustomEvent('ds-chat-mode-trigger', { detail: { mode: m } }));
              }
              return;
            }
            menu.style.display = 'none';
          } catch (e3) { menu.style.display = 'none'; }
        }, true);
        // 窄窗口（副窗口）：收成 34px 圆形图标（与原生按钮同尺寸、同 10px 间距），隐藏文字与箭头
        function applyResponsive() {
          var narrow = window.innerWidth < 760;
          var lbl = btn.querySelector('.ds-cm-label');
          var arrow = btn.querySelector('.ds-cm-arrow');
          if (narrow) {
            if (lbl) lbl.style.display = 'none';
            if (arrow) arrow.style.display = 'none';
            btn.style.width = '34px';
            btn.style.height = '34px';
            btn.style.padding = '0';
            btn.style.justifyContent = 'center';
            btn.style.borderRadius = '50%';
          } else {
            if (lbl) lbl.style.display = '';
            if (arrow) arrow.style.display = '';
            btn.style.width = '';
            btn.style.height = '34px';
            btn.style.padding = '0 12px';
            btn.style.justifyContent = '';
            btn.style.borderRadius = '18px';
          }
        }
        // 单次重排：模式按钮/占位文字/token 悬浮块一起同步更新。
        function dsRepaintNow() {
          try { applyResponsive(); } catch (eRp0) {}
          try { place(); } catch (eRp1) { console.log('[cm-place] dsRepaintNow 异常', String(eRp1)); }
          try { if (window.__dsTokenWidget) window.__dsTokenWidget.place(); } catch (eRp2) {}
        }
        // 布局事件统一入口：rAF 合并 + 有限收敛。开侧边栏/插件侧窗口时 React 数帧内分步重排，
        // 锚点逐级移位；这里在坐标仍变化时多追几帧（convergeLeft），稳定即停，避免“只读到中间帧”
        // 的滞后，也避免死循环刷屏/按钮闪烁。注意：不监 body（body 尺寸常被持续噪声触发，会无限循环）。
        var pending = false;
        var convergeLeft = 0;
        var moTick = 0;
        // 收敛执行本体：rAF 合并；坐标仍在移动则多追几帧（convergeLeft），稳定即停。
        function doRepaint() {
          var b = (btn.style.left || '') + '|' + (btn.style.top || '');
          try { dsRepaintNow(); } catch (eLo) { console.log('[cm-place] scheduled 异常', String(eLo)); }
          var a = (btn.style.left || '') + '|' + (btn.style.top || '');
          if (b !== a) convergeLeft = 10;
          else if (convergeLeft > 0) convergeLeft--;
          if (convergeLeft > 0) { pending = false; schedulePlace(); }
        }
        function schedulePlace() {
          if (pending) return;
          pending = true;
          requestAnimationFrame(function () { pending = false; doRepaint(); });
        }
        // 立即重排（真实位移信号：窗口 resize / 文档根 RO / 输入框 RO / input）——开侧边栏/插件侧窗秒跟。
        function placeNow() {
          if (convergeLeft > 0) return; // 已在收敛中，交给循环
          if (moTick) { clearTimeout(moTick); moTick = 0; }
          schedulePlace();
        }
        // 噪声去抖（MutationObserver：页面动画/后台常每帧触发）——120ms 合并一次，压刷屏又不耽误真变化。
        function placeDebounced() {
          if (pending) return;                          // 已有排队的 rAF，合并
          if (convergeLeft > 0) { schedulePlace(); return; } // 收敛中 → 立即跟
          if (moTick) return;                           // 去抖窗口内已排过
          moTick = setTimeout(function () { moTick = 0; schedulePlace(); }, 120);
        }
        window.addEventListener('resize', placeNow);
        if (typeof ResizeObserver !== 'undefined') {
          var ro = new ResizeObserver(placeNow);
          ro.observe(document.documentElement);
          window.__dsChatModeRO = ro;
        }
        // 放置策略：流内注入——把按钮作为锚点（智能搜索 toggle → 剪刀 → textarea）的同级节点插入其右侧，
        // 参与原生工具栏布局，浏览器自动跟随（同 剪刀/加号 按钮）。React 重渲染冲掉按钮时，
        // 由 MutationObserver → place() 重新插入兜底。无有效锚点时隐藏按钮。
        function place() {
          var cands = [findToggle(), findScissor(), findFallback()];
          var anchor = null;
          for (var i = 0; i < cands.length; i++) {
            var c = cands[i];
            if (!c) continue;
            var cr = c.getBoundingClientRect();
            if (cr.width > 1 && cr.height > 1) { anchor = c; break; }
          }
          if (!anchor) {
            btn.style.display = 'none';
            syncMask();
            syncPlaceholder();
            return false;
          }
          // 流内插入：确保按钮正好是锚点的下一个兄弟（anchor.nextSibling === btn 即已就位）。
          // 否则插到锚点之后（btn 不在容器内时 insertBefore 会自动把它搬回来）。
          var container = anchor.parentElement;
          if (container && anchor.nextSibling !== btn) {
            try { container.insertBefore(btn, anchor.nextSibling); } catch (e2) {}
          }
          btn.style.display = 'inline-flex';
          // 清掉历史 fixed 定位遗留的 left/top（旧版曾用固定定位）
          btn.style.left = '';
          btn.style.top = '';
          applyResponsive();
          syncMask();
          syncPlaceholder();
          return true;
        }
        place();
        // MutationObserver 统一走 placeDebounced（120ms 去抖 + rAF 合并 + 有限收敛），不直接回调 place()：
        // place() 首次插入节点会再次触发 MO，若直接回调会形成「移动按钮→触发 mutation→再移动→…」风暴。
        var mo = new MutationObserver(placeDebounced);
        mo.observe(document.body, { childList: true, subtree: true });
        // === 输入框实时跟随（参考「+」共享文档浮层：对输入框挂 ResizeObserver 原位重排） ===
        // 根因：textarea 多行输入增高时只改 inline style，不触发 body 子树 MutationObserver，
        // documentElement 尺寸也不随之变化 → 模式按钮 / 占位文字 / token 悬浮块只靠低频轮询或
        // scroll/resize 事件才重定位，滞后于随输入框一起流动的原生「+」工具栏。
        // 现对实时输入框（及其容器）挂 ResizeObserver，输入框增高/工具栏显隐时即可帧级同步重排。
        var dsInputRO = null;
        var dsInputROTarget = null;
        function dsEnsInputRO() {
          try {
            var cand = document.querySelector('textarea[placeholder*="发送消息"], textarea[aria-label*="发送消息"], textarea');
            if (!cand || !cand.isConnected) return;
            if (cand === dsInputROTarget && dsInputRO) return;
            if (dsInputRO) { try { dsInputRO.disconnect(); } catch (eROd) {} dsInputRO = null; }
            if (typeof ResizeObserver !== 'function') return;
            var ro = new ResizeObserver(function () {
              // 输入框/容器尺寸变化 → 立即同步重排（模式按钮/占位文字 + token 悬浮块）
              placeNow();
            });
            ro.observe(cand);
            // 容器高度变化（如切会话、副窗口工具栏显隐）同样驱动跟随
            try { if (cand.parentElement) ro.observe(cand.parentElement); } catch (ePa) {}
            dsInputRO = ro; dsInputROTarget = cand;
          } catch (eRO2) { /* 忽略 */ }
        }
        dsEnsInputRO();
        // 低频兜底刷新观察目标：React 静默重建/替换 textarea 后重新挂载 RO
        setInterval(dsEnsInputRO, 1000);
        // === 智能搜索钳制看门狗：任务/增强检索模式下，原生「智能搜索」任何时候被打开启
        //    （含 Ctrl+R 刷新后页面把开关重置为默认开这种导航竞态）都立即检测并点掉，杜绝漏网。
        //    普通模式不干预，让用户能自行开关。
        (function () {
          function isToggleOn(el) {
            if (el.getAttribute) {
              if (el.getAttribute('aria-pressed') === 'true') return true;
              if (el.getAttribute('aria-checked') === 'true') return true;
            }
            if (el.classList && (el.classList.contains('ds-toggle-button--selected')
                || el.classList.contains('active') || el.classList.contains('on')
                || el.classList.contains('checked') || el.classList.contains('pressed'))) return true;
            return false;
          }
          var onStreak = 0;
          function clampSmartSearch() {
            try {
              var mode = window.__dsChatMode;
              if (mode !== 'online' && mode !== 'task') { onStreak = 0; return; } // 普通模式不干预
              var sm = findSmartOnly();
              if (!sm) { onStreak = 0; return; }
              if (isToggleOn(sm)) {
                // 必须连续 2 个周期(≈800ms)仍为开才点掉：避免误伤切回普通时主进程的「恢复打开」，
                // 因为那瞬间 __dsChatMode 可能还短暂停留在 online/task。
                onStreak++;
                if (onStreak >= 2) { sm.click(); onStreak = 0; }
              } else {
                onStreak = 0;
              }
            } catch (e) { onStreak = 0; }
          }
          clampSmartSearch();
          setInterval(clampSmartSearch, 400);
        })();
        window.__dsChatModeUI = true;
        console.log('[Injector] 模式切换下拉已注入');
        return true;
      } catch (e) { console.error('[Injector] injectChatModeSwitcher 异常', e); return false; }
    })()`;
    try {
      return Boolean(await wc.executeJavaScript(code));
    } catch (e) {
      console.error('[Injector] injectChatModeSwitcher 失败:', e);
      return false;
    }
  }

  /** 主进程 → 页面：同步模式切换按钮/菜单的当前模式高亮（'normal' | 'online' | 'task'）。 */
  public async syncChatModeToPage(wc: WebContents, mode: 'normal' | 'online' | 'task'): Promise<boolean> {
    try {
      const v = mode === 'online' ? "'online'" : mode === 'task' ? "'task'" : "'normal'";
      await wc.executeJavaScript(
        `(() => { try { window.__dsChatMode = ${v}; if (window.__dsSyncChatMode) window.__dsSyncChatMode(); return true; } catch (e) { return false; } })()`
      );
      return true;
    } catch (e) {
      console.error('[Injector] syncChatModeToPage 失败:', e);
      return false;
    }
  }

  /**
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
            console.log('[PAGE-NEWCONV] 调用 reportNewConversation');
            if (window.__ds && typeof window.__ds.reportNewConversation === 'function') {
              window.__ds.reportNewConversation();
            } else {
              console.log('[PAGE-NEWCONV] window.__ds.reportNewConversation 不存在（preload 未就绪？）');
            }
          } catch (e2) { console.log('[PAGE-NEWCONV] report 异常 ' + e2); }
        }
        function isNewChatButton(el) {
          if (!el || !el.getAttribute) return false;
          var txt = (el.textContent || '').replace(/\\s+/g, '').toLowerCase();
          // 长度守卫：真正的「新建对话」按钮文本很短。巨型祖先容器（如侧栏大 div）的 textContent
          // 会聚合「新建…对话…」等大量文字，若用整体文本比对会误命中（点模式时 setSmartSearch 的
          // 合成点击冒泡上去即触发误报），因此超过 50 字的一律不当作新建对话。
          if (txt.length > 50) return false;
          var aria = (el.getAttribute('aria-label') || '').toLowerCase();
          var traeref = (el.getAttribute('data-trae-ref') || '').toLowerCase();
          // 精确优先：兼容「新建对话」前后带图标/空格/其它文案的变体
          if (txt.indexOf('新建对话') >= 0 || txt === '新对话' || txt.indexOf('newchat') >= 0) return true;
          // 官方侧栏「新建对话」按钮是 icon 按钮（无文字/无 aria），data-trae-ref="e0"；文字入口为「开启新对话」
          if (traeref === 'e0') return true;
          if (txt.indexOf('开启新对话') >= 0 || txt.indexOf('新对话') >= 0) return true;
          if (aria.indexOf('新建对话') >= 0 || aria.indexOf('newchat') >= 0) return true;
          // 放宽：覆盖「新建 / New chat / New conversation」等变体（参考实现以显式点击新建对话按钮为准）
          if (txt.indexOf('新建') >= 0 && txt.indexOf('对话') >= 0) return true;
          if (txt.indexOf('new') >= 0 && txt.indexOf('chat') >= 0) return true;
          if (aria.indexOf('new') >= 0 && aria.indexOf('chat') >= 0) return true;
          if (aria.indexOf('new conversation') >= 0) return true;
          return false;
        }
        // 仅捕获阶段监听「新建对话」按钮点击；不监听 URL 变化事件，避免普通会话切换误触发。
        document.addEventListener('click', function (e) {
          try {
            var node = e.target;
            // 守卫：点击落在我们注入的「模式切换」UI（按钮/下拉/各二级框）内时，绝不当作「新建对话」——
            // 否则点任务/增强检索会误触发 NEW_CONV 把刚选的模式复位成普通。
            var ui = node && node.closest ? node.closest('#ds-chat-mode-btn, #ds-chat-mode-menu, [id^="ds-cm-"]') : null;
            if (ui) {
              console.log('[PAGE-NEWCONV-GUARD] 命中模式UI，跳过 id=' + (ui.id || ui.tagName));
              return;
            }
            while (node && node !== document.body) {
              if (node.getAttribute && isNewChatButton(node)) {
                console.log('[PAGE-NEWCONV] 命中新建对话按钮 id=' + (node.id || '') + ' class=' + (typeof node.className === 'string' ? node.className : '') + ' txt=' + JSON.stringify((node.textContent || '').slice(0, 40)) + '，350ms 后上报 IPC');
                setTimeout(report, 350); return;
              }
              // 诊断：遇到会话相关按钮但未命中规则，记录真实文本/aria，便于主理人精修匹配
              if (node.tagName === 'BUTTON' || node.getAttribute('role') === 'button') {
                var t = (node.textContent || '').replace(/\\s+/g, ' ').trim();
                var a = node.getAttribute('aria-label') || '';
                var low = (t + ' ' + a).toLowerCase();
                if (low.indexOf('对话') >= 0 || low.indexOf('chat') >= 0) {
                  console.log('[PAGE-NEWCONV-DIAG] 会话相关按钮未命中: text=' + JSON.stringify(t) + ' aria=' + JSON.stringify(a) + ' class=' + JSON.stringify(typeof node.className === 'string' ? node.className : ''));
                }
              }
              node = node.parentElement;
            }
          } catch (err) {}
        }, true);
        // 快捷键 Ctrl/Cmd+J 新建对话 → 同样复位为设置的默认模式（官方内置新建对话快捷键）。
        document.addEventListener('keydown', function (e) {
          try {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'J')) {
              console.log('[PAGE-NEWCONV] 命中 Ctrl+J 新建对话');
              setTimeout(report, 300);
            }
          } catch (err3) {}
        });
        // URL 兜底：从「有会话 id 的历史会话」导航到「根页(无 id) 的新对话」→ 也复位（覆盖任意触发方式，
        // 如快捷键、按钮、侧栏入口等）。仅在 有id→无id 迁移时触发，避免同一对话内误复位。
        (function () {
          var lastU = location.href.split('#')[0];
          function navCheck() {
            var u = location.href.split('#')[0];
            var prevHad = /\\/a\\/chat\\/[^/?#]+/.test(lastU);
            var had = /\\/a\\/chat\\/[^/?#]+/.test(u);
            lastU = u;
            if (prevHad && !had) { setTimeout(report, 200); }
          }
          var pr = history.replaceState, pu = history.pushState;
          history.replaceState = function () { var r = pr.apply(this, arguments); setTimeout(navCheck, 0); return r; };
          history.pushState = function () { var r = pu.apply(this, arguments); setTimeout(navCheck, 0); return r; };
          window.addEventListener('popstate', navCheck);
        })();
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

  /**
   * 注入「回答生成状态」监听（回答完成提醒功能）。
   * 判定信号（实测 DeepSeek 网页：无停止生成按钮，必须靠 AI 消息文本增长）：
   *   1) 最后一条 AI 消息正文（.ds-markdown）文本单调增长 = 生成中（思考/回答阶段均流式增长）；
   *   2) 文本连续稳定约 3s = 回答完成；
   *   3) 停止按钮存在（兼容其它模式）作辅助信号。
   * 虚拟列表会卸载旧消息，故始终取「最后一条」，不依赖元素数量。
   * 切换会话（URL 变化）时重置基线避免误报；状态经 window.__ds.reportAnswerStatus() 上报主进程。
   * 幂等：已绑定则直接返回（did-navigate 重建页面后需重新注入）。
   */
  public async injectAnswerWatcher(wc: WebContents): Promise<boolean> {
    const code = `(() => {
      try {
        if (window.__dsAnswerWatcherBound) return true;
        window.__dsAnswerWatcherBound = true;
        var lastLen = 0, stableTicks = 0, generating = false;
        var first = true;
        // 「用户已发送提问」标志：只有回车 / 点击发送按钮后才开始监测本会话。
        // 根治「切换会话的初始渲染被误判为生成中 → 误报回答完成」的问题——
        // 不发送提问时不做任何状态判定，切换会话的渲染变化不再触发误报。
        var armed = false;
        // 生成中切走时记录的会话 id：切回时恢复监测补报（主进程追踪不取消）。
        var pendingSessionId = null;
        function currentSessionId() {
          // ⚠️ 模板字符串中 \/ 会被 TS 解码成 /，正则字面量会被 / 截断（Invalid regexp flags），
          // 故用 RegExp 字符串构造（正则里的 / 无需转义）
          var re = new RegExp('(?:/a/chat/s/|/a/chat/|/c/)([^/?#]+)');
          var m = location.href.match(re);
          return m ? m[1] : null;
        }
        var lastSessionId = currentSessionId();
        function findStop() {
          var els = document.querySelectorAll('button, [role="button"], [class*="stop" i], [class*="abort" i]');
          for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var a = ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || '')) || '').toLowerCase();
            var t = ((el.textContent || '').trim()).toLowerCase();
            var cls = (el.className && el.className.toString ? el.className.toString().toLowerCase() : '');
            if (a.indexOf('\u505c\u6b62') >= 0 || a.indexOf('stop') >= 0 ||
                t.indexOf('\u505c\u6b62') >= 0 || t.indexOf('stop') >= 0 ||
                cls.indexOf('stop') >= 0 || cls.indexOf('abort') >= 0) return el;
          }
          return null;
        }
        // 读取最后一条 AI 消息文本：优先正文容器，兜底最后一个 .ds-markdown（思考/回答阶段通用）
        function readLastAI() {
          var main = document.querySelectorAll('.ds-markdown.ds-assistant-message-main-content');
          if (main && main.length) {
            return { text: (main[main.length - 1].textContent || '') };
          }
          var all = document.querySelectorAll('.ds-markdown');
          if (all && all.length) {
            return { text: (all[all.length - 1].textContent || '') };
          }
          return null;
        }
        function setState(g) {
          if (g === generating) return;
          generating = g;
          console.log('[AnswerWatch] 生成状态变化 -> ' + (g ? '生成中' : '结束/停止'));
          try {
            if (window.__ds && typeof window.__ds.reportAnswerStatus === 'function') {
              window.__ds.reportAnswerStatus(g);
            }
          } catch (e2) {}
        }
        function reportSwitched() {
          console.log('[AnswerWatch] 会话已切换，取消跟踪');
          try {
            if (window.__ds && typeof window.__ds.reportAnswerStatus === 'function') {
              window.__ds.reportAnswerStatus(false, true);
            }
          } catch (e2) {}
        }
        // 重置文本基线；不改变 generating、不上报（避免把切换会话误判为「回答完成」）
        function resetBaseline() {
          var m = readLastAI();
          lastLen = m ? m.text.length : 0;
          stableTicks = 0;
        }
        // 用户发送提问 → 开始监测本会话
        function arm() {
          if (armed) return;
          armed = true;
          generating = false;
          stableTicks = 0;
          console.log('[AnswerWatch] 用户发送提问，开始监测');
        }
        // 回车发送（输入框内按 Enter）
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey && e.isComposing !== true) {
            var ta = document.querySelector('textarea[aria-label*="\u53d1\u9001\u6d88\u606f"], textarea[placeholder*="\u53d1\u9001\u6d88\u606f"], textarea');
            if (ta && document.activeElement === ta) arm();
          }
        }, true);
        // 点击发送按钮
        document.addEventListener('click', function (e) {
          var node = e.target;
          while (node && node !== document.body) {
            if (node.getAttribute) {
              var a = (node.getAttribute('aria-label') || '');
              if (a.indexOf('\u53d1\u9001') >= 0 || a.indexOf('send') >= 0) { arm(); return; }
            }
            node = node.parentElement;
          }
        }, true);
        function sync() {
          try {
            // 会话切换（URL 变化）
            if (location.href !== window.__dsAnswerUrl) {
              var oldId = lastSessionId;
              var wasGenerating = generating;
              lastSessionId = currentSessionId();
              window.__dsAnswerUrl = location.href;
              resetBaseline();
              if (pendingSessionId && lastSessionId === pendingSessionId) {
                // 切回「生成中切走」的原会话：恢复监测补报，不取消主进程追踪
                pendingSessionId = null;
                armed = true;
                console.log('[AnswerWatch] 切回生成中的会话，恢复监测');
              } else if (wasGenerating) {
                // 正在生成时切走：保留主进程追踪，等切回补报（切走期间无法检测原会话）
                pendingSessionId = oldId;
                console.log('[AnswerWatch] 生成中切走，保留追踪 session=' + oldId);
              } else if (!pendingSessionId) {
                // 未在生成也非生成中切走：取消追踪（无记录时无副作用）
                reportSwitched();
              }
              armed = false;
              generating = false;
              stableTicks = 0;
              return;
            }
            // 未发送提问：不监测（只追文本基线），切换会话的渲染变化不会误判
            if (!armed) {
              resetBaseline();
              return;
            }
            var stop = findStop();
            var m = readLastAI();
            if (first) { first = false; resetBaseline(); return; }
            if (!m) { setState(!!stop); return; }
            var changed = m.text.length !== lastLen;
            lastLen = m.text.length;
            if (stop || changed) {
              stableTicks = 0;
              setState(true);
            } else if (generating) {
              // 文本稳定：连续 6 次（约 3s）视为回答完成（思考→回答切换间隙也在此阈值内）
              stableTicks++;
              if (stableTicks >= 6) { stableTicks = 0; setState(false); }
            } else {
              setState(false);
            }
          } catch (e2) {}
        }
        window.__dsAnswerUrl = location.href;
        sync();
        var mo = new MutationObserver(sync);
        mo.observe(document.body, { childList: true, subtree: true, characterData: true });
        window.__dsAnswerWatcherMO = mo;
        window.__dsAnswerWatcherTimer = setInterval(sync, 500);
        return true;
      } catch (e) { return false; }
    })()`;
    try {
      return Boolean(await wc.executeJavaScript(code));
    } catch (e) {
      console.error('[Injector] injectAnswerWatcher 失败:', e);
      return false;
    }
  }

  /**
   * 注入「回答滚动方式」控制（设置 → 板块 → 对话 → 回答滚动方式）：
   *   - stay（停留开头，默认）：AI 生成回答时不干预滚动，用户保持当前位置；
   *   - follow（跟随回答）：AI 生成时持续滚动到底部，始终显示最新输出（复刻简单模式体验）。
   * 生成状态检测复用 AnswerWatcher 思路（停止按钮 / 最后一条 AI 文本长度变化）。
   * 用户主动滚动（wheel/触控/键盘）会暂停跟随，直到下一次生成开始重新跟随。
   * 幂等：同 document 只绑定一次；完整导航重建 document 后需重新注入。
   * 运行时可通过 updateAnswerScrollMode 更新模式（window.__dsSetAnswerScrollMode）。
   */
  public async injectAnswerScroll(wc: WebContents, mode: 'stay' | 'follow'): Promise<boolean> {
    const code = `(() => {
      try {
        if (window.__dsAnswerScrollBound) return true;
        window.__dsAnswerScrollBound = true;
        var mode = ${JSON.stringify(mode)};
        // 暴露给 injectPinToBottom 读取：stay 模式 + 生成中 → 停止初始钉底，避免 URL 变化钉底覆盖「停留开头」
        window.__dsAnswerScrollMode = mode;
        var generating = false;
        var userScrolled = false;
        var rafId = 0;
        var lastLen = 0, stableTicks = 0;
        var first = true;
        // stay 模式抑制网页原生自动滚动：生成开始时记录锚点，网页把滚动条自动滚走时拉回锚点
        var anchorTop = 0;
        var lastUserAction = 0;

        // 运行时切换模式（设置变更）：立即生效
        function setMode(m) {
          mode = m;
          window.__dsAnswerScrollMode = m;
          if (!generating && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          if (generating && mode === 'follow') {
            userScrolled = false;
            rafId = requestAnimationFrame(tick);
          }
        }
        window.__dsSetAnswerScrollMode = setMode;

        // 用户主动滚动 → 记录操作时间与接管位置（仅影响当前生成；下次生成开始时重置）
        function markUser() {
          if (!generating) return;
          lastUserAction = Date.now();
          userScrolled = true;
          var c = findContainer();
          if (c) anchorTop = c.scrollTop;
        }
        window.addEventListener('wheel', markUser, { passive: true, capture: true });
        window.addEventListener('touchstart', markUser, { passive: true, capture: true });
        window.addEventListener('keydown', function (e) {
          var k = e.key || '';
          if (k.indexOf('Arrow') === 0 || k === 'PageDown' || k === 'PageUp' || k === 'Home' || k === 'End' || k === ' ') markUser();
        }, true);
        // stay 模式：抑制网页自动滚动——滚动条被自动改走（非用户操作）时拉回锚点
        window.addEventListener('scroll', function () {
          if (mode !== 'stay' || !generating) return;
          if (Date.now() - lastUserAction < 400) return; // 用户刚操作，放行
          var c = findContainer();
          if (!c || !(c.scrollHeight > c.clientHeight)) return;
          if (c.scrollTop !== anchorTop) c.scrollTop = anchorTop;
        }, true);

        // 消息滚动容器：从最后一条 AI 消息向上找「最近的可滚动祖先」
        function findContainer() {
          var marks = document.querySelectorAll('.ds-markdown');
          if (!marks || !marks.length) return null;
          var el = marks[marks.length - 1].parentElement;
          for (var d = 0; d < 20 && el; d++, el = el.parentElement) {
            try {
              var cs = window.getComputedStyle(el);
              if (!/(auto|scroll|overlay)/.test(cs.overflowY)) continue;
            } catch (e2) { continue; }
            if (el.scrollHeight > el.clientHeight + 10 && el.clientHeight > 50) return el;
          }
          return null;
        }

        function tick() {
          rafId = 0;
          if (mode !== 'follow' || !generating || userScrolled) return;
          var c = findContainer();
          if (c && c.scrollHeight > c.clientHeight) {
            c.scrollTop = c.scrollHeight;
          } else {
            try {
              var last = document.querySelectorAll('.ds-markdown');
              if (last && last.length) last[last.length - 1].scrollIntoView({ block: 'end' });
            } catch (e3) {}
          }
          rafId = requestAnimationFrame(tick);
        }

        // ---- 生成状态检测（复用 AnswerWatcher 思路） ----
        function findStop() {
          var els = document.querySelectorAll('button, [role="button"], [class*="stop" i], [class*="abort" i]');
          for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var a = ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || '')) || '').toLowerCase();
            var t = ((el.textContent || '').trim()).toLowerCase();
            var cls = (el.className && el.className.toString ? el.className.toString().toLowerCase() : '');
            if (a.indexOf('\u505c\u6b62') >= 0 || a.indexOf('stop') >= 0 ||
                t.indexOf('\u505c\u6b62') >= 0 || t.indexOf('stop') >= 0 ||
                cls.indexOf('stop') >= 0 || cls.indexOf('abort') >= 0) return el;
          }
          return null;
        }
        function readLastAI() {
          var main = document.querySelectorAll('.ds-markdown.ds-assistant-message-main-content');
          if (main && main.length) return { text: (main[main.length - 1].textContent || '') };
          var all = document.querySelectorAll('.ds-markdown');
          if (all && all.length) return { text: (all[all.length - 1].textContent || '') };
          return null;
        }
        function setState(g) {
          if (g === generating) return;
          generating = g;
          if (g) {
            // 开始生成：重置用户滚动标记；记录锚点（生成开始时位置），stay 模式据此拉回自动滚动
            userScrolled = false;
            lastUserAction = 0;
            var c0 = findContainer();
            anchorTop = c0 ? c0.scrollTop : 0;
            if (mode === 'follow' && !rafId) rafId = requestAnimationFrame(tick);
          } else {
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          }
        }
        function resetBaseline() {
          var m = readLastAI();
          lastLen = m ? m.text.length : 0;
          stableTicks = 0;
        }
        function sync() {
          try {
            if (location.href !== window.__dsAnswerScrollUrl) {
              window.__dsAnswerScrollUrl = location.href;
              resetBaseline();
              setState(false);
              return;
            }
            var stop = findStop();
            var m = readLastAI();
            if (first) { first = false; resetBaseline(); return; }
            if (!m) { setState(!!stop); return; }
            var changed = m.text.length !== lastLen;
            lastLen = m.text.length;
            if (stop || changed) {
              stableTicks = 0;
              setState(true);
            } else if (generating) {
              stableTicks++;
              if (stableTicks >= 6) { stableTicks = 0; setState(false); }
            } else {
              setState(false);
            }
          } catch (e2) {}
        }
        window.__dsAnswerScrollUrl = location.href;
        sync();
        var mo = new MutationObserver(sync);
        mo.observe(document.body, { childList: true, subtree: true, characterData: true });
        window.__dsAnswerScrollMO = mo;
        window.__dsAnswerScrollTimer = setInterval(sync, 500);
        console.log('[AnswerScroll] 已安装 mode=' + mode);
        return true;
      } catch (e) { return false; }
    })()`;
    try {
      return Boolean(await wc.executeJavaScript(code));
    } catch (e) {
      console.error('[Injector] injectAnswerScroll 失败:', e);
      return false;
    }
  }

  /** 运行时更新「回答滚动方式」（设置变更时调用）：切换到新模式并立即生效。 */
  public async updateAnswerScrollMode(wc: WebContents, mode: 'stay' | 'follow'): Promise<void> {
    try {
      const ok = await wc.executeJavaScript(
        `(function () { try { if (typeof window.__dsSetAnswerScrollMode === 'function') { window.__dsSetAnswerScrollMode(${JSON.stringify(mode)}); return true; } return false; } catch (e) { return false; } })()`
      );
      logf('SETTING', `updateAnswerScrollMode → ${mode} wcId=${wc.id} ok=${ok}`);
    } catch {
      logf('SETTING', `updateAnswerScrollMode → ${mode} wcId=${wc.id} 页面不可用`);
    }
  }

  /**
   * 注入「切换会话后自动钉到底部」监听（修复：切换历史会话时被拽回顶部/随机位置）。
   * DeepSeek 是 SPA：点侧边栏会话 → pushState/replaceState/popstate（偶有 hashchange）。
   * 检测到 URL 变化后轮询消息滚动容器并持续滚到底部，直到「真正贴底且高度稳定」才停止，
   * 覆盖虚拟列表边滚边懒加载的间隙；用户主动滚动/翻页则停止，切换下一个会话时重新允许。
   * 幂等：同 document 只绑定一次；完整导航重建 document 后需重新注入。
   */
  public async injectPinToBottom(wc: WebContents): Promise<boolean> {
    const code = `(() => {
      try {
        if (window.__dsPinBottomBound) return true;
        window.__dsPinBottomBound = true;
        var lastUrl = location.href;
        // generation 计数器：每次 onUrlChange 自增，旧代 tick 检测到代差即退出，
        // 避免快速连续切换会话时多条 rAF 链并存竞态。
        var generation = 0;
        var userScrolled = false;
        function stopPin() { generation++; }
        // 用户主动滚动/翻页 → 停止钉底，尊重用户操作（仅影响当前会话）
        function markUser() { userScrolled = true; stopPin(); }
        window.addEventListener('wheel', markUser, { passive: true, capture: true });
        window.addEventListener('touchstart', markUser, { passive: true, capture: true });
        window.addEventListener('keydown', function (e) {
          var k = e.key || '';
          if (k.indexOf('Arrow') === 0 || k === 'PageDown' || k === 'PageUp' || k === 'Home' || k === 'End' || k === ' ') markUser();
        }, true);
        // 消息滚动容器：从最后一条 AI 消息向上找「最近的可滚动祖先」。
        // 从 .ds-markdown 向上走不会经过代码块等局部滚动区（它们在 markdown 内部），
        // 加最小尺寸守卫防退化。
        function findContainer() {
          var marks = document.querySelectorAll('.ds-markdown');
          if (!marks || !marks.length) return null;
          var el = marks[marks.length - 1].parentElement;
          for (var d = 0; d < 20 && el; d++, el = el.parentElement) {
            try {
              var cs = window.getComputedStyle(el);
              if (!/(auto|scroll|overlay)/.test(cs.overflowY)) continue;
            } catch (e2) { continue; }
            if (el.scrollHeight > el.clientHeight + 10 && el.clientHeight > 50) return el;
          }
          return null;
        }
        function scrollBottom(c) {
          if (userScrolled) return false;
          if (c && c.scrollHeight > c.clientHeight) {
            c.scrollTop = c.scrollHeight;
            // 是否真正贴底（scrollTop 会被浏览器钳制到最大值）
            return (c.scrollTop + c.clientHeight) >= c.scrollHeight - 8;
          }
          var marks = document.querySelectorAll('.ds-markdown');
          if (marks && marks.length) {
            try { marks[marks.length - 1].scrollIntoView({ block: 'end' }); return true; } catch (e3) {}
          }
          var d = document.scrollingElement || document.documentElement;
          if (d && d.scrollHeight > d.clientHeight) { d.scrollTop = d.scrollHeight; return true; }
          return false;
        }
        // 检测回答生成中（停止按钮存在）：供 stay 模式停止钉底
        function findStop() {
          var els = document.querySelectorAll('button, [role="button"], [class*="stop" i], [class*="abort" i]');
          for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var a = ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || '')) || '').toLowerCase();
            var t = ((el.textContent || '').trim()).toLowerCase();
            var cls = (el.className && el.className.toString ? el.className.toString().toLowerCase() : '');
            if (a.indexOf('\u505c\u6b62') >= 0 || a.indexOf('stop') >= 0 ||
                t.indexOf('\u505c\u6b62') >= 0 || t.indexOf('stop') >= 0 ||
                cls.indexOf('stop') >= 0 || cls.indexOf('abort') >= 0) return el;
          }
          return null;
        }
        function onUrlChange() {
          // 新会话 = 新的上下文：重置用户滚动标记，保证每次都尝试钉底
          userScrolled = false;
          var url = location.href;
          if (url === lastUrl) return;
          lastUrl = url;
          stopPin();
          var gen = generation;
          var count = 0, lastH = -1, hStable = 0;
          function tick() {
            if (gen !== generation) return; // 已被新一代取代
            // 停留开头（stay）+ 回答生成中：停止钉底——发送消息会触发 URL 变化
            // （新建对话 → /a/chat/<id>），若继续钉底会把「停留开头」变成跟随；
            // 切换会话（无生成）时仍正常钉底，符合「打开对话自动到最低端」。
            if (window.__dsAnswerScrollMode === 'stay' && findStop()) return;
            count++;
            var c = findContainer();
            var atBottom = scrollBottom(c);
            var h = c ? c.scrollHeight : 0;
            if (h === lastH) hStable++; else { hStable = 0; lastH = h; }
            // 真正贴底且高度连续稳定约 8 帧才认为渲染完成
            if (atBottom && hStable >= 8) return;
            // 最多约 10s 兜底（600 帧 × ~16ms）
            if (count > 600) return;
            // 用 rAF 在每帧绘制前滚动，比 setTimeout(150ms) 快约 10 倍，
            // 最大限度减少新会话从顶部渲染到被钉底之间的顶部闪现
            requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        }
        var origPush = history.pushState;
        var origReplace = history.replaceState;
        history.pushState = function () { var r = origPush.apply(this, arguments); setTimeout(onUrlChange, 0); return r; };
        history.replaceState = function () { var r = origReplace.apply(this, arguments); setTimeout(onUrlChange, 0); return r; };
        window.addEventListener('popstate', onUrlChange);
        window.addEventListener('hashchange', onUrlChange);
        // 兜底轮询 URL（覆盖非 pushState/replaceState 的导航方式）
        setInterval(function () {
          if (location.href !== lastUrl) onUrlChange();
        }, 500);
        console.log('[PinBottom] 已安装');
        return true;
      } catch (e) { return false; }
    })()`;
    try {
      return Boolean(await wc.executeJavaScript(code));
    } catch (e) {
      console.error('[Injector] injectPinToBottom 失败:', e);
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
        const txtOf = (b) => ((b.textContent || b.getAttribute('aria-label') || '')).trim().toLowerCase();
        const isLogout = (t) => t.includes('退出登录') || t.includes('注销') || t.includes('log out') || t.includes('sign out');
        // 登录/注册按钮精确匹配：文本等于登录词，或以「登录词 + 空格/账号」开头，
        // 避免「注册表/注册码」等正文内容被「注册」误命中（实测 chat.deepseek.com 对话正文含「注册表项」即触发误判）
        const isLoginBtn = (t) => texts.some((k) => t === k || t.startsWith(k + ' ') || t.startsWith(k + '账号'));
        // 已登录页面常驻「退出登录」菜单项：命中即视为已登录（修复「退出登录」被误判为登录按钮的 Bug）
        if (btns.some((b) => isLogout(txtOf(b)))) return true;
        const hasLogin = btns.some((b) => {
          const t = txtOf(b);
          if (!t || isLogout(t)) return false;
          return isLoginBtn(t);
        });
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

  /**
   * 读取对话框输入框当前文本（兼容 React 受控组件）。
   * 用于主副切换时把输入框文字迁移到目标窗口。返回空字符串表示无输入或无输入框。
   */
  public async readInputText(wc: WebContents): Promise<string> {
    try {
      const res = await wc.executeJavaScript(`(() => {
        try {
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
            var sp = document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], [contenteditable][aria-label*="发送消息"]');
            if (sp) return sp;
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
          if (!el) return '';
          var v = (el.value !== undefined ? el.value : el.textContent) || '';
          return String(v);
        } catch (e) { return ''; }
      })()`);
      return typeof res === 'string' ? res : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 向对话框输入框填入文本（不点击发送），并将光标置于文本末尾。
   * 用于「问问DeepSeek」引用功能：将选中文本括起来放入输入框，等待用户输入问题。
   */
  public async setInputText(wc: WebContents, text: string): Promise<boolean> {
    const ok = await this.fillText(wc, text);
    if (!ok) return false;
    // 将光标定位到文本末尾
    try {
      await wc.executeJavaScript(`(() => {
        try {
          var el = document.activeElement;
          if (!el) return false;
          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            var len = el.value.length;
            el.setSelectionRange(len, len);
          } else if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
            var range = document.createRange();
            var sel = window.getSelection();
            if (el.lastChild) {
              range.setStartAfter(el.lastChild);
              range.collapse(true);
            } else {
              range.setStart(el, 0);
            }
            sel.removeAllRanges();
            sel.addRange(range);
          }
          return true;
        } catch(e) { return false; }
      })()`);
    } catch (e) {
      console.error('[Injector] setInputText 光标定位失败:', e);
    }
    return true;
  }

  /**
   * 「引用」模式（参考 better-deepseek 的 quoteReply）：点击后在聊天输入框上方渲染一个**引用条**
   * （带引用样式/预览/可关闭），回车（无修饰键）时把选中文本按 markdown 引用块拼入输入框，
   * 发送后 DeepSeek 渲染成引用块。不是把 `> ` 文本平铺塞进输入框。
   */
  public async injectQuoteBar(wc: WebContents, selectedText: string): Promise<boolean> {
    const header = '针对你刚才这段内容：';
    const sel = JSON.stringify(selectedText);
    const hdr = JSON.stringify(header);
    const code = `(() => {
      try {
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
          var sp = document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], [contenteditable][aria-label*="发送消息"]');
          if (sp) return sp;
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
        var input = findChatInput();
        if (!input) return JSON.stringify({ok:false,reason:'no-input'});
        var sel = ${sel};
        var hdr = ${hdr};
        var old = document.getElementById('ds-cm-quote-bar');
        if (old) old.remove();
        var bar = document.createElement('div');
        bar.id = 'ds-cm-quote-bar';
        // 采用 better-deepseek 的 .bd-quote-bar 深色主题外观
        bar.style.cssText = 'display:flex;align-items:center;gap:8px;box-sizing:border-box;width:auto;min-height:34px;padding:7px 12px;margin:8px 10px;border:1px solid rgba(148,163,184,0.2);border-radius:10px;background:rgba(148,163,184,0.12);font:12px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#a6b0bf;';
        var icon = document.createElement('span');
        icon.style.cssText = 'display:flex;flex-shrink:0;align-items:center;color:#98a4b5;';
        icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>';
        var preview = document.createElement('span');
        preview.style.cssText = 'flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:#a6b0bf;font-size:12px;line-height:1.4;';
        preview.textContent = sel.split('\\n').slice(0,2).join(' ').slice(0,80);
        var x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.title = '删除引用';
        x.setAttribute('aria-label', '删除引用');
        x.style.cssText = 'flex-shrink:0;display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:1px solid rgba(148,163,184,0.4);border-radius:6px;background:rgba(148,163,184,0.16);color:#dfe6f0;font:600 15px/1 system-ui,sans-serif;cursor:pointer;transition:background 0.15s,color 0.15s,border-color 0.15s;';
        x.onmouseenter = function(){ x.style.background = 'rgba(229,90,90,0.28)'; x.style.color = '#ffffff'; x.style.borderColor = 'rgba(229,90,90,0.6)'; };
        x.onmouseleave = function(){ x.style.background = 'rgba(148,163,184,0.16)'; x.style.color = '#dfe6f0'; x.style.borderColor = 'rgba(148,163,184,0.4)'; };
        x.onclick = function(){ bar.remove(); };
        bar.appendChild(icon);
        bar.appendChild(preview);
        bar.appendChild(x);
        var host = input.parentElement;
        if (host) host.insertBefore(bar, input);
        // 引用条抬高输入框 → 让吸附输入框的悬浮元素（token 小窗/占位文字/模式按钮等）重新贴位，避免与其重合
        function reflowFloaters(){
          try { if (window.dsMark) window.dsMark(); } catch(e){}
          try { if (window.__dsTokenWidget && window.__dsTokenWidget.place) window.__dsTokenWidget.place(); } catch(e){}
        }
        x.onclick = function(){ bar.remove(); reflowFloaters(); };
        reflowFloaters();
        // 回车（无修饰键）时把引用块拼入输入框，走正常发送
        var handler = function(ev){
          if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
          if (!bar || !bar.isConnected) return;
          var quoted = sel.split('\\n').filter(function(l){ return l && l.trim() !== ''; }).map(function(l){ return '> ' + l; }).join('\\n');
          if (!quoted) return;
          var cur = (input.getAttribute && input.getAttribute('contenteditable')==='true') ? (input.textContent||'') : (input.value||'');
          var final = cur ? hdr + '\\n---\\n' + quoted + '\\n---\\n' + cur : hdr + '\\n---\\n' + quoted;
          input.focus();
          if (input.getAttribute && input.getAttribute('contenteditable')==='true'){ input.textContent = final; }
          else {
            try { var desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value'); if(desc && desc.set){ desc.set.call(input, final); } else { input.value = final; } } catch(e){ try{ input.value = final; } catch(e2){} }
          }
          input.dispatchEvent(new Event('input', { bubbles:true }));
          try { input.dispatchEvent(new InputEvent('input', { bubbles:true, data:final, inputType:'insertText' })); } catch(e){}
          input.dispatchEvent(new Event('change', { bubbles:true }));
          bar.remove();
          reflowFloaters();
        };
        // 输入框为空时按退格/删除 → 关闭引用条（也把删除按钮的 × 一并用于此判定）
        var delHandler = function(ev){
          if (ev.key !== 'Backspace' && ev.key !== 'Delete') return;
          if (!bar || !bar.isConnected) return;
          var cur = (input.getAttribute && input.getAttribute('contenteditable')==='true') ? (input.textContent||'') : (input.value||'');
          if (cur && cur.replace(/\\s/g,'') !== '') return; // 输入框里有实际内容时不删引用
          bar.remove();
          reflowFloaters();
        };
        input.addEventListener('keydown', handler);
        input.addEventListener('keydown', delHandler);
        return JSON.stringify({ok:true});
      } catch(e){ return JSON.stringify({ok:false,reason:'err:'+e}); }
    })()`;
    const res = await wc.executeJavaScript(code).catch(() => '');
    let obj: any;
    try { obj = JSON.parse(res); } catch { obj = res; }
    if (typeof obj === 'boolean') return obj;
    return !!(obj && obj.ok);
  }

  // -------------------- 内部辅助 --------------------

  /** 在输入框填入文本（兼容 React 受控组件）。轮询等待输入框出现并重试（覆盖 B 窗口加载时机）。 */
  private async fillText(wc: WebContents, text: string): Promise<boolean> {
    const t = JSON.stringify(text);
    for (let attempt = 0; attempt < 5; attempt++) {
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
      await sleep(200);
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
          // 精准：发送/停止是唯一「圆形主按钮」，用稳定 ds- 语义类组合锁定（比任意 --primary 更精准）
          var primary=document.querySelector('[role="button"].ds-button--circle.ds-button--primary, .ds-button--circle.ds-button--primary, .ds-button--primary, [class*="--primary"]');
          if(primary && !disabledOf(primary)) return {b:primary, via:'primary'};
          var all=Array.from(document.querySelectorAll('button, [role="button"], .ds-button'));
          for(var i=0;i<all.length;i++){ var a=(all[i].getAttribute('aria-label')||'').toLowerCase(); if((a.indexOf('发送')>=0||a.indexOf('send')>=0)&&!disabledOf(all[i])) return {b:all[i],via:'label'}; }
          return null;
        }
        function fireClick(el){
          var types=['pointerdown','mousedown','mouseup'];
          for(var i=0;i<types.length;i++){ try{ el.dispatchEvent(new MouseEvent(types[i],{bubbles:true,cancelable:true,view:window})); }catch(e){} }
          try{ el.click(); }catch(e){}
        }
        // 轮询等待发送按钮可用（最多 3 秒），找到后只点击一次。
        // 关键修复：发送按钮在消息发出后会变为「停止」按钮（同为 primary 样式、可用态），
        // 若点击后验证失败就再次点击，会误点「停止」导致回答刚生成就被终止；
        // 且文件发送场景下输入框文字为空、附件清空时机不定，验证信号不可靠。
        // 故命中可用的发送按钮即视为点击成功，不再重复点击。
        for (var wait = 0; wait < 30; wait++) {
          await new Promise(function(r){ setTimeout(r, 100); });
          var s = findSend();
          if (!s) continue;
          fireClick(s.b);
          console.log('[Injector] clickSend -> ' + s.via + ' sent=true (click once)');
          return JSON.stringify({found:true, sent:true});
        }
        console.log('[Injector] clickSend: timeout');
        return JSON.stringify({found:false, sent:false});
      } catch(e){ return JSON.stringify({found:false, sent:false, err:String(e)}); }
    })()`);
    let obj: any;
    try {
      obj = JSON.parse(res);
    } catch {
      obj = res;
    }
    if (typeof obj === 'boolean') return obj;
    if (obj && obj.sent) return true;
    console.log('[Injector] clickSend 失败:', res);
    return false;
  }

  /**
   * 同步页面「无痕模式」标志、加号菜单高亮，并在开启时于输入框上方靠右显示「无痕模式」悬浮徽章
   * （眼睛+斜杠图标 + 文字，样式仿共享文档悬浮框）。由主进程在开启/关闭/离开无痕会话时调用。
   * 页面侧注入脚本已定义 window.__dsIncognitoActive 与 window.__dsSyncIncognitoMenu。
   */
  public setIncognitoState(wc: WebContents, on: boolean): Promise<void> {
    if (!wc || wc.isDestroyed()) return Promise.resolve();
    // 页面侧「无痕模式」徽章：开启时创建并定位到输入框上方靠右，关闭时移除。
    // 幂等：重复开启先移除旧徽章再重建；跟随滚动/缩放/输入框尺寸变化实时定位。
    const badgeCode = `(() => {
      try {
        var active = ${on ? 'true' : 'false'};
        window.__dsIncognitoActive = active;
        // 无痕状态变化 → 同步模式下拉的可选项置灰/记忆开关（受限即置灰不可点）
        try { if (typeof window.__dsSyncChatMode === 'function') window.__dsSyncChatMode(); } catch (e5) {}
        // CSS zoom 坐标换算：与共享文档悬浮框一致，避免 fixed 定位被 zoom 放大导致偏移
        function layoutRect(el) {
          var r = el.getBoundingClientRect();
          try {
            var z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            if (z !== 1 && z > 0) return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z };
          } catch (e) {}
          return r;
        }
        function cleanBadge() {
          var b = document.getElementById('ds-incognito-badge');
          if (b) b.remove();
          if (window.__dsIncognitoPosTimer) { clearInterval(window.__dsIncognitoPosTimer); window.__dsIncognitoPosTimer = null; }
          if (window.__dsIncognitoRo) { try { window.__dsIncognitoRo.disconnect(); } catch (e) {} window.__dsIncognitoRo = null; }
          if (window.__dsIncognitoScroll) { window.removeEventListener('scroll', window.__dsIncognitoScroll, true); window.__dsIncognitoScroll = null; }
          if (window.__dsIncognitoResize) { window.removeEventListener('resize', window.__dsIncognitoResize); window.__dsIncognitoResize = null; }
        }
        if (!active) { cleanBadge(); if (typeof window.__dsSyncIncognitoMenu === 'function') window.__dsSyncIncognitoMenu(); return; }
        cleanBadge();
        var badge = document.createElement('div');
        badge.id = 'ds-incognito-badge';
        badge.style.cssText = 'position:fixed;display:flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;background:rgba(28,30,38,0.55);backdrop-filter:blur(20px) saturate(1.6);-webkit-backdrop-filter:blur(20px) saturate(1.6);border:1px solid rgba(255,255,255,0.18);border-radius:12px;z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;cursor:pointer;transition:background 0.2s,border-color 0.2s;';
        // 悬浮样式（仅注入一次）：悬浮时正文显示「取消无痕」+ 背景微变；点击徽章即退出无痕模式
        if (!document.getElementById('ds-incognito-badge-css')) {
          var badgeStyle = document.createElement('style');
          badgeStyle.id = 'ds-incognito-badge-css';
          badgeStyle.textContent = '#ds-incognito-badge .ds-badge-hover{display:none;} #ds-incognito-badge:hover{background:rgba(226,160,74,0.26);border-color:rgba(255,255,255,0.32);} #ds-incognito-badge:hover .ds-badge-normal{display:none;} #ds-incognito-badge:hover .ds-badge-hover{display:inline;}'
          + '#ds-incognito-badge.compact{width:24px!important;height:24px!important;min-width:24px;padding:0!important;gap:0;border-radius:7px!important;justify-content:center;}' // 窄屏：与 token 同高的圆角方形图标框
          + '#ds-incognito-badge.compact .ds-badge-normal,#ds-incognito-badge.compact .ds-badge-hover,#ds-incognito-badge.compact .ds-badge-dot{display:none!important;}' // 只留眼睛，去掉文字与绿点
          + '#ds-incognito-badge.compact:hover svg{color:#ffd28f!important;}'; // 悬浮时图标变黄（同取消无痕文字色）
          document.head.appendChild(badgeStyle);
        }
        // 眼睛 + 斜杠图标（用户指定：无痕即"看不到"，去掉原眼镜图标）
        badge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#9db5ff;flex:none;display:block;"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1.91 1.91 0 0 1 0 1.8 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1.91 1.91 0 0 1 0-1.8 10.75 10.75 0 0 1 4.446-5.147"/><path d="m2 2 20 20"/></svg>' +
          '<span class="ds-badge-normal" style="color:#e8eaed;font-size:12px;font-weight:500;white-space:nowrap;">无痕模式</span>' +
          '<span class="ds-badge-hover" style="color:#ffd28f;font-size:12px;font-weight:500;white-space:nowrap;">取消无痕</span>' +
          '<span class="ds-badge-dot" style="width:6px;height:6px;border-radius:50%;background:#34c759;flex:none;display:block;"></span>';
        badge.onclick = function (e) { e.preventDefault(); e.stopPropagation(); try { if (window.__ds && window.__ds.toggleIncognito) window.__ds.toggleIncognito(); } catch (er) {} };
        document.body.appendChild(badge);
        function findInput() {
          return document.querySelector('textarea[aria-label*="发送消息"], textarea[placeholder*="发送消息"], textarea, [contenteditable="true"], [role="textbox"]');
        }
        function position() {
          var inp = findInput();
          if (!inp) return;
          var composer = inp.parentElement;
          for (var i = 0; i < 8 && composer; i++) {
            if (composer.querySelector && composer.querySelector('input[type="file"]') && composer.querySelector('textarea, [contenteditable="true"]')) break;
            composer = composer.parentElement;
          }
          if (!composer) composer = inp.parentElement;
          var cRect = layoutRect(composer);
          // 空间不足（副窗口等窄视口）→ 折叠为与 token 同高的圆角方形图标（样式 .compact 隐藏文字与绿点），悬浮图标变黄
          var compact = window.innerWidth < 760;
          badge.classList.toggle('compact', compact);
          var bw = badge.offsetWidth || (compact ? 24 : 120);
          var bh = badge.offsetHeight || 24;
          // 右锚：默认对齐 composer 右缘（留 8px）；若右上 token 悬浮块可见，让位到其左侧（紧凑态贴更近 4px），避免重叠
          var gap = compact ? 4 : 8;
          var rightAnchor = cRect.right - gap;
          try {
            var twEl = document.getElementById('ds-token-widget');
            if (twEl && twEl.isConnected && twEl.style && twEl.style.display !== 'none') {
              var tRect = layoutRect(twEl);
              if (tRect.width > 1 && tRect.height > 1 && tRect.left > cRect.left) {
                rightAnchor = tRect.left - gap;
              }
            }
          } catch (eT) { /* 忽略 */ }
          var left = Math.max(8, rightAnchor - bw);
          var top = cRect.top - bh - 8;            // 与 token 一致：距输入框上方 8px
          if (top < 8) top = cRect.bottom + 8;     // 空间不足则翻到下方（同样 8px）
          badge.style.left = left + 'px';
          badge.style.top = top + 'px';
        }
        position();
        window.__dsIncognitoScroll = function () { position(); };
        window.addEventListener('scroll', window.__dsIncognitoScroll, true);
        window.__dsIncognitoResize = function () { position(); };
        window.addEventListener('resize', window.__dsIncognitoResize);
        try {
          var iTarget = findInput();
          if (iTarget && typeof ResizeObserver === 'function') {
            window.__dsIncognitoRo = new ResizeObserver(function () { position(); });
            window.__dsIncognitoRo.observe(iTarget);
          }
        } catch (e2) {}
        window.__dsIncognitoPosTimer = setInterval(function () { position(); }, 500);
        if (typeof window.__dsSyncIncognitoMenu === 'function') window.__dsSyncIncognitoMenu();
      } catch (e3) {}
    })()`;
    // 串行链：按调用顺序依次执行，避免快速开关时 executeJavaScript 乱序导致标志/徽章停在历史值。
    const prev = this.incognitoStateChain.get(wc.id) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => {
      if (wc.isDestroyed()) return;
      // 页面未就绪则忽略（did-finish-load 后重新注入时页面标志会再次同步）
      return wc.executeJavaScript(badgeCode).catch(() => {});
    });
    this.incognitoStateChain.set(wc.id, next);
    return next;
  }

  /**
   * 删除对话（B 窗口关闭 / 无痕模式退出时自动清理）。
   * 先尝试调用 DeepSeek API 删除；失败则回退到导航到新对话页。
   * @param chatId 指定要删除的对话 id（如无痕模式切换/退出会话时传入离开前的会话 id）；
   *               缺省时读取 webContents 当前 URL 中的对话 id。
   */
  public async deleteConversation(wc: WebContents, chatId?: string): Promise<boolean> {
    // 参考 DeepSeek 官方前端使用的内部 API:
    //   POST /api/v0/chat_session/delete
    //   Auth: Bearer token (从 localStorage.userToken 读取)
    //   Body: { chat_session_id: <id> }
    //   Response: { code: 0, data: {...} }
    const safeId = chatId ? JSON.stringify(String(chatId)) : null;
    const code = `(async () => {
      try {
        // 1) 取对话 ID：优先用调用方传入的 id（无痕模式离开会话时 URL 已切换，
        //    不能读当前 URL）；缺省则从 URL 匹配（/a/chat/s/<id>、/a/chat/<id>、/c/<id>）
        var id = ${safeId !== null ? safeId : 'null'};
        if (!id) {
          var re = new RegExp('(?:/a/chat/s/|/a/chat/|/c/)([^/?#]+)');
          var m = location.href.match(re);
          id = m ? m[1] : null;
        }
        if (!id) return 'no_id';
        // 2) 从 localStorage 取 Bearer token
        var token = (function() {
          try {
            var raw = localStorage.getItem('userToken');
            if (!raw) return null;
            var p = JSON.parse(raw);
            return typeof p === 'object' ? p.value || p.token || p : p;
          } catch(e) {
            return localStorage.getItem('userToken');
          }
        })();
        if (!token) return 'no_token';
        // 3) 调用 DeepSeek 内部 API 删除对话
        var res = await fetch('/api/v0/chat_session/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
            'X-App-Version': '2025.04.25'
          },
          body: JSON.stringify({ chat_session_id: id })
        });
        if (!res.ok) return 'http:' + res.status;
        var json = await res.json();
        if (json && json.code === 0) return 'api_deleted';
        return 'api_error:' + (json ? json.code : 'no_json');
      } catch(e) {
        try { location.href = '/'; } catch {}
        return 'error:' + String(e);
      }
    })()`;
    try {
      const result = String(await wc.executeJavaScript(code) || '');
      console.log('[Injector] deleteConversation:', result);
      return result === 'api_deleted';
    } catch (e) {
      console.log('[Injector] deleteConversation 异常:', e);
      return false;
    }
  }
}
