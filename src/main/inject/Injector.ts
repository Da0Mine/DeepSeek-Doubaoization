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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** WPS 启动程序路径（用于提取程序图标）。 */
const WPS_LAUNCH_EXE = 'D:\\wps\\wps64位\\WPS Office\\ksolaunch.exe';

let wpsIconDataUrlCache: string | null = null;

/**
 * 提取 WPS 程序图标（ksolaunch.exe）为 16×16 PNG data URL，供「+」菜单共享项使用。
 * 提取失败（如文件不存在）返回 null，调用方回退到原 SVG 图标；结果模块级缓存。
 */
async function getWpsIconDataUrl(): Promise<string | null> {
  if (wpsIconDataUrlCache) return wpsIconDataUrlCache;
  try {
    const img = await app.getFileIcon(WPS_LAUNCH_EXE, { size: 'normal' });
    if (img.isEmpty()) return null;
    const resized = img.resize({ width: 16, height: 16 });
    wpsIconDataUrlCache = resized.toDataURL();
    return wpsIconDataUrlCache;
  } catch (e) {
    return null;
  }
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
          var primary=document.querySelector('.ds-button--primary, [class*="--primary"]');
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
        picker.style.cssText = 'position:fixed;display:flex;align-items:center;gap:6px;padding:5px 8px 5px 12px;background:rgba(28,30,38,0.55);backdrop-filter:blur(20px) saturate(1.6);-webkit-backdrop-filter:blur(20px) saturate(1.6);border:1px solid rgba(255,255,255,0.18);border-radius:10px;z-index:2147483646;box-shadow:0 8px 28px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;';
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
        // 同步「+」菜单共享选项的蓝色高亮状态（类型与菜单项 type 一致）
        window.__dsShareActiveMode = shareItemType;
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
          window.__dsShareActiveMode = null;
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
        logf('setDeepThink', `未找到深度思考开关（账号可能未灰度到）；enabled=${enabled}`);
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
        logf('setSmartSearch', `未找到智能搜索开关；enabled=${enabled}`);
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

  /** 点击右上角「新建对话」按钮（带加号图标），用于展开折叠的模型选择器。 */
  public async clickNewConversationButton(wc: WebContents): Promise<boolean> {
    try {
      const rect = await wc.executeJavaScript(`(() => {
        const allBtns = Array.from(document.querySelectorAll('.ds-button--iconLabelPrimary, .ds-button--iconLabel, ._4f3769f'));
        for (const btn of allBtns) {
          const r = btn.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const hasPlusIcon = btn.querySelector('svg[class*="plus"], svg[data-icon*="plus"], svg[viewBox="0 0 24 24"] path[d*="M12 5v14M5 12h14"]');
          if (hasPlusIcon) return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
        }
        // 删除「ds-button--xl 取最右」fallback（2026-08-01 用户反馈"副窗口切回自动点分享"根因）：
        // 该 fallback 会命中对话顶栏最右的分享按钮（弯曲箭头，纯 SVG 无 aria-label），
        // 触发分享侧栏/弹窗。只保留：① 带加号图标的 iconLabelPrimary 按钮 ② 文字精确匹配。
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
            var anchor = getUploadButton();
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
            if (document.getElementById('ds-plus-btn')) return;
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
              return t === (window.__dsShareActiveMode || null);
            }
            // 共享状态同步：window.__dsShareActiveMode 标记当前共享模式（'shareDocAll'/'shareScreen'/null），
            // 据此给对应「共享」菜单项加蓝色高亮框；统一由此函数刷新，供共享浮层（picker）注入/共享屏幕启停时调用。
            function syncShareMenuHighlight() {
              var menuEl = document.getElementById('ds-plus-menu');
              if (!menuEl) return;
              var btns = menuEl.querySelectorAll('button');
              for (var si = 0; si < btns.length; si++) {
                var b = btns[si];
                var t = b.getAttribute('data-ds-type');
                if (!t) continue;
                // 共享类菜单项：恢复原始标签文字（悬浮时的「取消共享」在鼠标离开后由本函数还原）
                if (t === 'shareDocAll' || t === 'shareScreen') {
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
                menuItem.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 13px;border:1px solid transparent;background:transparent;color:#e0e0e0;font-size:13px;cursor:pointer;text-align:left;white-space:nowrap;transition:background 0.12s,border-color 0.12s;';
                menuItem.onmouseenter = function () {
                  var t = this.getAttribute('data-ds-type');
                  var isActive = isMenuHighlighted(t);
                  this.style.background = isActive ? 'rgba(90,140,255,0.26)' : 'rgba(255,255,255,0.1)';
                  // 共享中悬浮：显示「取消共享」，提示点击即可关闭共享（无痕模式无此交互）
                  if (isActive && (t === 'shareDocAll' || t === 'shareScreen')) {
                    var lbl = this.querySelector('.ds-menu-label');
                    if (lbl) lbl.textContent = '取消共享';
                  }
                };
                menuItem.onmouseleave = function () {
                  this.style.background = 'transparent';
                  syncShareMenuHighlight(); // 恢复共享中选项的蓝色高亮与原始标签文字
                };
                // WPS 程序图标（<img>）保持原色，不加暗化
                var isWpsIcon = item.icon.indexOf('<img') === 0;
                menuItem.innerHTML = '<span style="display:inline-flex;align-items:center;width:18px;height:14px;' + (isWpsIcon ? '' : 'opacity:0.7;') + '">' + item.icon + '</span><span class="ds-menu-label" data-ds-label="' + item.label + '">' + item.label + '</span>';
                menuItem.addEventListener('click', function (e) {
                  e.preventDefault();
                  e.stopPropagation();
                  // 无痕模式：纯本地开关（开启 / 关闭）。
                  // 关键：一旦当前对话已有记录（URL 已含会话 id，如 /a/chat/s/<uuid> 等），
                  // 无痕模式被锁定——无法手动关闭，只能等「退出该会话/关闭窗口/退出程序」时自动删除。
                  if (item.type === 'incognito') {
                    if (window.__dsIncognitoActive) {
                      // 尝试关闭：已有记录则拒绝（保持菜单开启 + 蓝色高亮作为反馈）
                      var hasRecord = !!location.href.match(new RegExp('(?:/a/chat/s/|/a/chat/|/c/)([^/?#]+)'));
                      if (hasRecord) {
                        syncShareMenuHighlight();
                        return; // 菜单不关闭，保持高亮 = 已锁定
                      }
                      window.__dsIncognitoActive = false;
                      syncShareMenuHighlight();
                      menu.style.display = 'none';
                      try { window.__ds && window.__ds.setIncognito(false); } catch (e2) {}
                    } else {
                      window.__dsIncognitoActive = true;
                      syncShareMenuHighlight();
                      menu.style.display = 'none';
                      try { window.__ds && window.__ds.setIncognito(true); } catch (e2) {}
                    }
                    return;
                  }
                  menu.style.display = 'none';
                  // 共享类菜单项：再次点击同一项=取消共享；切换类型时先取消旧共享
                  if (item.type === 'shareDocAll') {
                    if (window.__dsShareActiveMode === item.type) {
                      if (window.__dsDocShareStop) window.__dsDocShareStop();
                      window.__dsShareActiveMode = null;
                      window.__dsRequestedShare = null;
                      syncShareMenuHighlight();
                      return;
                    }
                    if (window.__dsShareActiveMode && window.__dsDocShareStop) window.__dsDocShareStop();
                    window.__dsShareActiveMode = item.type;
                    window.__dsRequestedShare = item.type;
                    syncShareMenuHighlight();
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
              } else {
                syncShareMenuHighlight(); // 打开菜单时刷新共享选项的蓝色高亮状态
                // 先显示菜单以测量高度，再向上定位（offsetHeight 是布局值，不受 zoom 影响）
                menu.style.display = 'flex';
                menu.style.visibility = 'hidden';
                var menuHeight = menu.offsetHeight;
                menu.style.visibility = 'visible';
                menu.style.left = rect.left + 'px';
                menu.style.top = (rect.top - menuHeight - 4) + 'px';
              }
            });

            // 点击菜单外部关闭
            document.addEventListener('click', function () {
              menu.style.display = 'none';
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
          if (SHOULD_INJECT_PLUS_BUTTON && anchor && anchor.style) {
            anchor.style.display = 'none';
            if (anchor.setAttribute) anchor.setAttribute('aria-hidden', 'true');
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
          var aria = (el.getAttribute('aria-label') || '').toLowerCase();
          // 精确优先：兼容「新建对话」前后带图标/空格/其它文案的变体
          if (txt.indexOf('新建对话') >= 0 || txt === '新对话' || txt.indexOf('newchat') >= 0) return true;
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
            while (node && node !== document.body) {
              if (node.getAttribute && isNewChatButton(node)) {
                console.log('[PAGE-NEWCONV] 命中新建对话按钮，350ms 后上报 IPC');
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
   * 注入「回答滚动方式」控制（设置 → 对话 → 模型行为 → 回答滚动方式）：
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
          var primary=document.querySelector('.ds-button--primary, [class*="--primary"]');
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
   * 同步页面「无痕模式」标志与加号菜单高亮（主进程在开启/关闭/离开无痕会话时调用）。
   * 页面侧注入脚本已定义 window.__dsIncognitoActive 与 window.__dsSyncIncognitoMenu。
   */
  public async setIncognitoState(wc: WebContents, on: boolean): Promise<void> {
    if (!wc || wc.isDestroyed()) return;
    try {
      await wc.executeJavaScript(
        `(() => {
          try {
            window.__dsIncognitoActive = ${on ? 'true' : 'false'};
            if (typeof window.__dsSyncIncognitoMenu === 'function') window.__dsSyncIncognitoMenu();
          } catch (e) {}
        })()`
      );
    } catch {
      /* 页面未就绪则忽略（did-finish-load 后重新注入时页面标志会再次同步） */
    }
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
