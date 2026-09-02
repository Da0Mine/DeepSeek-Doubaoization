var floatingChat=(function(){function e(e){return e}var t=`deepseek_pp_floating_chat_enabled`;async function n(){return(await chrome.storage.local.get(t))[t]!==!1}Object.freeze([`http://*/*`,`https://*/*`]);async function r(e){try{return await e.readEnabled()?await e.hasHostPermission()?{kind:`ready`}:{kind:`missing-permission`}:{kind:`disabled`}}catch(t){if(e.isContextInvalidated(t))return{kind:`invalidated`};throw t}}function i(e){let t=e instanceof Error?e.message:String(e);return t.includes(`Extension context invalidated`)||t.includes(`context invalidated`)||t.includes(`Extension context is unavailable`)}var a=`dpp-chat-launcher-css`,o=`dpp-chat-launcher-button`,s=`dpp-floating-chat-window`,c=`sidepanel.html?surface=floating-chat`,l=`deepseek_pp_floating_chat_enabled`,u=`pet/deepseek-whale-pet-states.png`,d=`data-dpp-chat-launcher-owner`,f=6,p=null,m=null;function h(){if(m?.(),v(),T(),w(),!document.body)return{stop(){}};let e=A(),t,a;try{t=chrome.runtime.getURL(u),a=chrome.runtime.getURL(c)}catch(e){if(i(e))return{stop(){}};throw e}j();let o=_(t,e),s=!1,d=!1,p=0,h=0,b=0,x=0,S=e=>{if(e.button!==0)return;s=!0,d=!1,p=e.clientX,h=e.clientY;let t=o.getBoundingClientRect();b=window.innerWidth-t.right,x=window.innerHeight-t.bottom;try{o.setPointerCapture(e.pointerId)}catch{}},C=e=>{if(!s)return;let t=e.clientX-p,n=e.clientY-h;if(!d&&Math.hypot(t,n)>f&&(d=!0,o.style.cursor=`grabbing`),!d)return;let r=Math.max(0,b-t),i=Math.max(0,x-n),a=window.innerWidth-o.offsetWidth,c=window.innerHeight-o.offsetHeight;o.style.right=`${Math.min(r,a)}px`,o.style.bottom=`${Math.min(i,c)}px`,o.style.top=`auto`,o.style.left=`auto`},D=t=>{if(s){s=!1;try{o.releasePointerCapture(t.pointerId)}catch{}o.style.cursor=`pointer`,d||(t.preventDefault(),y(a,e))}};o.addEventListener(`pointerdown`,S),o.addEventListener(`pointermove`,C),o.addEventListener(`pointerup`,D),o.addEventListener(`pointercancel`,D);let O=!1,k=new MutationObserver(()=>E(e)),M=(e,t)=>{t===`local`&&l in e&&N()},N=async()=>{let t=await r({readEnabled:n,hasHostPermission:async()=>!0,isContextInvalidated:i});if(!O){if(t.kind===`invalidated`){P();return}g(t.kind===`ready`,e)}},P=()=>{if(!O){O=!0,o.removeEventListener(`pointerdown`,S),o.removeEventListener(`pointermove`,C),o.removeEventListener(`pointerup`,D),o.removeEventListener(`pointercancel`,D);try{chrome.storage?.onChanged?.removeListener(M)}catch(e){if(!i(e))throw e}k.disconnect(),w(e),v(e),T(e),m===P&&(m=null)}};try{chrome.storage?.onChanged?.addListener(M)}catch(e){if(!i(e))throw e;return P(),{stop:P}}return k.observe(document.documentElement,{attributes:!0,attributeFilter:[`class`,`data-dpp-theme`]}),N(),m=P,{stop:P}}function g(e,t){let n=document.getElementById(o);!n||n.getAttribute(d)!==t||(n.style.display=e?``:`none`,n.title=`Open DS++ Chat`,n.setAttribute(`aria-label`,`Open DS++ Chat`))}function _(e,t){let n=document.createElement(`button`);return n.id=o,n.setAttribute(d,t),n.type=`button`,n.style.display=`none`,n.innerHTML=k(e),document.body.appendChild(n),n}function v(e){let t=document.getElementById(o);!t||e&&t.getAttribute(d)!==e||t.remove()}function y(e,t){let n=document.getElementById(s);if(n){n.remove();return}if(!document.body)return;let r=document.createElement(`section`);r.id=s,r.setAttribute(d,t),r.setAttribute(`role`,`dialog`),r.setAttribute(`aria-label`,`DeepSeek++ Chat`),D(r),r.innerHTML=`<div class="dpp-floating-chat__header" data-dpp-drag-handle><span class="dpp-floating-chat__title">DS++ Chat</span><button class="dpp-floating-chat__close" type="button" data-dpp-floating-chat-close aria-label="Close">\u00d7</button></div><iframe class="dpp-floating-chat__frame" title="DS++ Chat" src="${`${e}&hostTheme=${O()}`}"></iframe>`,r.querySelector(`[data-dpp-floating-chat-close]`)?.addEventListener(`click`,()=>r.remove()),r.querySelector(`[data-dpp-drag-handle]`)?.addEventListener(`pointerdown`,e=>b(e,r,t)),document.body.appendChild(r)}function b(e,t,n){if(e.button!==0||x(e.target))return;e.preventDefault();try{e.currentTarget.setPointerCapture(e.pointerId)}catch{}let r=t.getBoundingClientRect();p={ownerId:n,isDragging:!0,startX:e.clientX,startY:e.clientY,startRight:window.innerWidth-r.right,startBottom:window.innerHeight-r.bottom},t.classList.add(`dpp-floating-chat--dragging`),document.body.classList.add(`dpp-floating-chat-dragging`),document.addEventListener(`pointermove`,S),document.addEventListener(`pointerup`,C),document.addEventListener(`pointercancel`,C)}function x(e){return e instanceof Element&&e.closest(`button, a, input, textarea, select, [role="button"]`)!==null}function S(e){if(!p?.isDragging)return;let t=document.getElementById(s);if(!t||t.getAttribute(d)!==p.ownerId){w(p.ownerId);return}let n=e.clientX-p.startX,r=e.clientY-p.startY,i=Math.max(0,p.startRight-n),a=Math.max(0,p.startBottom-r);t.style.right=`${Math.min(i,window.innerWidth-t.offsetWidth)}px`,t.style.bottom=`${Math.min(a,window.innerHeight-t.offsetHeight)}px`}function C(){w()}function w(e){if(e&&p?.ownerId!==e)return;let t=document.getElementById(s);(!e||t?.getAttribute(d)===e)&&t?.classList.remove(`dpp-floating-chat--dragging`),document.body.classList.remove(`dpp-floating-chat-dragging`),p=null,document.removeEventListener(`pointermove`,S),document.removeEventListener(`pointerup`,C),document.removeEventListener(`pointercancel`,C)}function T(e){let t=document.getElementById(s);!t||e&&t.getAttribute(d)!==e||t.remove()}function E(e){let t=document.getElementById(s);!t||t.getAttribute(d)!==e||D(t)}function D(e){let t=O();e.dataset.hostTheme=t,e.classList.toggle(`dpp-floating-chat--dark`,t===`dark`)}function O(){let e=document.documentElement;return e.classList.contains(`dpp-theme-dark`)||e.dataset.dppTheme===`dark`?`dark`:`light`}function k(e){return`<span class="dpp-chat-launcher__whale" style="background-image:url('${e}')"></span>`}function A(){return`launcher-${Date.now()}-${Math.random().toString(36).slice(2)}`}function j(){if(document.getElementById(a)||!document.head)return;let e=document.createElement(`style`);e.id=a,e.textContent=`
#${o} {
  position: fixed;
  right: 22px;
  bottom: max(22px, env(safe-area-inset-bottom));
  z-index: 2147483646;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  outline: none;
  background: rgba(255,255,255,0.82);
  box-shadow: 0 14px 34px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.75);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  cursor: pointer;
  transition: transform 0.12s ease;
  touch-action: none;
}
#${o}:hover { transform: scale(1.06); }
#${o}:active { transform: scale(0.98); }
html.dpp-theme-dark #${o}, [data-dpp-theme="dark"] #${o} {
  background: rgba(17,21,29,0.48);
  box-shadow: 0 18px 46px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08);
}
#${o} .dpp-chat-launcher__whale {
  display: block;
  width: 32px;
  height: 32px;
  background-repeat: no-repeat;
  background-size: 400% 200%;
  /* "thinking" frame of the 4x2 sprite sheet */
  background-position: 33.3333% 0%;
  pointer-events: none;
}

#${s} {
  position: fixed;
  right: 22px;
  bottom: 80px;
  z-index: 2147483645;
  width: min(430px, calc(100vw - 28px));
  height: min(720px, calc(100vh - 100px));
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 18px;
  overflow: hidden;
  background: rgba(250,250,250,0.86);
  box-shadow: 0 24px 60px rgba(15,23,42,0.18);
  animation: dpp-floating-chat-in 170ms ease;
  display: flex;
  flex-direction: column;
}
#${s}.dpp-floating-chat--dark {
  border-color: rgba(148,163,184,0.22);
  background: rgba(7,9,13,0.42);
  box-shadow: 0 28px 82px rgba(0,0,0,0.52), inset 0 1px 0 rgba(255,255,255,0.06);
  backdrop-filter: blur(30px) saturate(1.18);
  -webkit-backdrop-filter: blur(30px) saturate(1.18);
}
#${s} .dpp-floating-chat__frame {
  width: 100%;
  flex: 1;
  min-height: 0;
  border: 0;
  background: transparent;
}
#${s} .dpp-floating-chat__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255,255,255,0.95);
  border-bottom: 1px solid rgba(0,0,0,0.06);
  cursor: move;
  user-select: none;
  touch-action: none;
  flex-shrink: 0;
}
#${s}.dpp-floating-chat--dark .dpp-floating-chat__header {
  background: rgba(17,21,29,0.95);
  border-bottom-color: rgba(148,163,184,0.18);
}
#${s} .dpp-floating-chat__title {
  font: 700 13px/1.4 'Inter', 'PingFang SC', -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #4d6bfe;
}
#${s}.dpp-floating-chat--dark .dpp-floating-chat__title { color: #7b93ff; }
#${s} .dpp-floating-chat__close {
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
}
#${s} .dpp-floating-chat__close:hover { background: rgba(0,0,0,0.06); color: #374151; }
#${s}.dpp-floating-chat--dark .dpp-floating-chat__close { color: #9ca3af; }
#${s}.dpp-floating-chat--dark .dpp-floating-chat__close:hover { background: rgba(255,255,255,0.08); color: #e5e7eb; }
#${s}.dpp-floating-chat--dragging { transition: none !important; user-select: none; }
#${s}.dpp-floating-chat--dragging .dpp-floating-chat__frame { pointer-events: none; }
body.dpp-floating-chat-dragging { cursor: move !important; }
body.dpp-floating-chat-dragging * { cursor: move !important; }

@keyframes dpp-floating-chat-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@media (max-width: 640px) {
  #${s} {
    right: 14px;
    bottom: 74px;
    width: calc(100vw - 28px);
    height: min(680px, calc(100vh - 100px));
  }
}
`,document.head.appendChild(e)}var M=null;function N(e=P){M?.();let t=e.startLauncher(),n=!1,r=()=>{t?.stop(),t=null},i=r=>{!n&&r.persisted&&!t&&(t=e.startLauncher())},a=()=>{n||(n=!0,t?.stop(),t=null,e.removePageListener(`pagehide`,r),e.removePageListener(`pageshow`,i),M===a&&(M=null))};return e.addPageListener(`pagehide`,r),e.addPageListener(`pageshow`,i),M=a,{stop:a}}var P={startLauncher:h,addPageListener(e,t){window.addEventListener(e,t)},removePageListener(e,t){window.removeEventListener(e,t)}},F=e({matches:[`<all_urls>`],runAt:`document_idle`,async main(){location.hostname===`chat.deepseek.com`||location.hostname.endsWith(`.deepseek.com`)||N()}}),I={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)},L=new WeakMap;function R(){let e=globalThis;return z(()=>e.browser)||z(()=>e.chrome)}function z(e){try{return e()}catch(e){if(B(e))return;throw e}}function B(e){let t=e instanceof Error?e.message:String(e);return t.includes(`Extension context invalidated`)||t.includes(`context invalidated`)}function V(e){let t=L.get(e);if(t)return t;let n=new Proxy(e,{get(e,t,n){let r;try{r=Reflect.get(e,t,n)}catch(e){if(B(e))return;throw e}return typeof r==`function`?(...t)=>{try{return r.apply(e,t)}catch(e){if(B(e))return;throw e}}:r&&typeof r==`object`?V(r):r}});return L.set(e,n),n}var H=R(),U=H&&typeof H==`object`?V(H):H,W=class e extends Event{static EVENT_NAME=G(`wxt:locationchange`);constructor(t,n){super(e.EVENT_NAME,{}),this.newUrl=t,this.oldUrl=n}};function G(e){return`${U?.runtime?.id}:floating-chat:${e}`}var K=typeof globalThis.navigation?.addEventListener==`function`;function q(e){let t,n=!1;return{run(){n||(n=!0,t=new URL(location.href),K?globalThis.navigation.addEventListener(`navigate`,e=>{let n=new URL(e.destination.url);n.href!==t.href&&(window.dispatchEvent(new W(n,t)),t=n)},{signal:e.signal}):e.setInterval(()=>{let e=new URL(location.href);e.href!==t.href&&(window.dispatchEvent(new W(e,t)),t=e)},1e3))}}}var J=class e{static SCRIPT_STARTED_MESSAGE_TYPE=G(`wxt:content-script-started`);id;abortController;locationWatcher=q(this);constructor(e,t){this.contentScriptName=e,this.options=t,this.id=Math.random().toString(36).slice(2),this.abortController=new AbortController,this.stopOldScripts(),this.listenForNewerScripts()}get signal(){return this.abortController.signal}abort(e){return this.abortController.abort(e)}get isInvalid(){return U.runtime?.id??this.notifyInvalidated(),this.signal.aborted}get isValid(){return!this.isInvalid}onInvalidated(e){return this.signal.addEventListener(`abort`,e),()=>this.signal.removeEventListener(`abort`,e)}block(){return new Promise(()=>{})}setInterval(e,t){let n=setInterval(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearInterval(n)),n}setTimeout(e,t){let n=setTimeout(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearTimeout(n)),n}requestAnimationFrame(e){let t=requestAnimationFrame((...t)=>{this.isValid&&e(...t)});return this.onInvalidated(()=>cancelAnimationFrame(t)),t}requestIdleCallback(e,t){let n=requestIdleCallback((...t)=>{this.signal.aborted||e(...t)},t);return this.onInvalidated(()=>cancelIdleCallback(n)),n}addEventListener(e,t,n,r){t===`wxt:locationchange`&&this.isValid&&this.locationWatcher.run(),e.addEventListener?.(t.startsWith(`wxt:`)?G(t):t,n,{...r,signal:this.signal})}notifyInvalidated(){this.abort(`Content script context invalidated`),I.debug(`Content script "${this.contentScriptName}" context invalidated`)}stopOldScripts(){document.dispatchEvent(new CustomEvent(e.SCRIPT_STARTED_MESSAGE_TYPE,{detail:{contentScriptName:this.contentScriptName,messageId:this.id}})),this.options?.noScriptStartedPostMessage||window.postMessage({type:e.SCRIPT_STARTED_MESSAGE_TYPE,contentScriptName:this.contentScriptName,messageId:this.id},`*`)}verifyScriptStartedEvent(e){let t=e.detail?.contentScriptName===this.contentScriptName,n=e.detail?.messageId===this.id;return t&&!n}listenForNewerScripts(){let t=e=>{!(e instanceof CustomEvent)||!this.verifyScriptStartedEvent(e)||this.notifyInvalidated()};document.addEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t),this.onInvalidated(()=>document.removeEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t))}},Y={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)};return(async()=>{try{let{main:e,...t}=F;return await e(new J(`floating-chat`,t))}catch(e){throw Y.error(`The content script "floating-chat" crashed on startup!`,e),e}})()})();
floatingChat;