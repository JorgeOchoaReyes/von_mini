/**
 * The `vonmini` API that custom HTML apps can call. The app runs sandboxed (WebView / iframe)
 * and talks to the host only through postMessage; the host decides how each call is served.
 */
import { local, runAction, type RouteContext } from '../ai/hybrid';
import { reportRuntimeError } from '../chat/customJobs';
import { kvGet, kvSet } from '../storage/store';
import { voiceReply, type Turn } from '../voice/cascade';
import { listen } from '../voice/stt';
import { speak, stopSpeaking } from '../voice/tts';
import type { Theme } from '../ui/theme';
import { COMIC_FONT_TTF_BASE64 } from './comicFont';

export interface BridgeRequest {
  __vm: true;
  id: number;
  method: 'ai' | 'store.get' | 'store.set' | 'listen' | 'speak' | 'stopSpeaking' | 'converse' | 'error';
  args: unknown[];
}

export function isBridgeRequest(v: unknown): v is BridgeRequest {
  return !!v && typeof v === 'object' && (v as BridgeRequest).__vm === true && typeof (v as BridgeRequest).id === 'number';
}

export async function handleBridge(
  appId: string,
  req: BridgeRequest,
  ctx: RouteContext,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    switch (req.method) {
      case 'ai': {
        const prompt = String(req.args[0] ?? '').slice(0, 4000);
        return { ok: true, value: (await runAction(prompt, ctx)).text };
      }
      // Voice: the sandboxed app can't reach the microphone or speech engine itself, so the host
      // runs speech-to-text and text-to-speech on its behalf (on-device where possible).
      case 'listen':
        return { ok: true, value: await listen({ offline: local(ctx) }).done };
      case 'speak':
        await speak(String(req.args[0] ?? '').slice(0, 2000));
        return { ok: true, value: null };
      case 'stopSpeaking':
        stopSpeaking();
        return { ok: true, value: null };
      case 'converse': {
        // One spoken turn: Gemini Nano replies in character and the reply is spoken while it streams.
        const persona = String(req.args[0] ?? '').slice(0, 1000);
        const history = (Array.isArray(req.args[1]) ? req.args[1] : [])
          .filter((t): t is Turn => !!t && typeof t === 'object' && typeof (t as Turn).text === 'string')
          .map((t) => ({ role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const), text: t.text.slice(0, 2000) }))
          .slice(-12);
        if (!history.length || history[history.length - 1].role !== 'user') {
          return { ok: false, error: 'converse() needs a history that ends with the user turn.' };
        }
        const speakIt = req.args[2] !== false;
        return { ok: true, value: (await voiceReply(history, { persona, ctx, speak: speakIt })).text };
      }
      case 'store.get':
        return { ok: true, value: await kvGet(appId, String(req.args[0])) };
      case 'store.set':
        await kvSet(appId, String(req.args[0]), req.args[1] ?? null);
        return { ok: true, value: null };
      // The app hit an error: noted, and repaired in the background (see customJobs).
      case 'error':
        reportRuntimeError(appId, String(req.args[0] ?? 'Error').slice(0, 500), ctx);
        return { ok: true, value: null };
      default:
        return { ok: false, error: 'Unknown method' };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Injected before the app's own scripts. `post` is the transport (differs per platform),
 * and the host replies by calling window.__vmReply(id, ok, valueOrError).
 */
export const bridgeScript = (post: string) => `
(function(){
  var seq = 0, pending = {};
  function call(method, args){
    return new Promise(function(resolve, reject){
      var id = ++seq; pending[id] = [resolve, reject];
      ${post}(JSON.stringify({__vm:true, id:id, method:method, args:args}));
    });
  }
  window.__vmReply = function(id, ok, v){
    var p = pending[id]; if(!p) return; delete pending[id];
    ok ? p[0](v) : p[1](new Error(v));
  };
  // Errors reach the host, so an app that breaks is repaired instead of silently doing nothing.
  function report(msg){ try { ${post}(JSON.stringify({__vm:true, id:0, method:'error', args:[String(msg).slice(0, 500)]})); } catch (e) {} }
  window.addEventListener('error', function(e){ report((e.message || 'Error') + (e.lineno ? ' (line ' + e.lineno + ')' : '')); });
  window.addEventListener('unhandledrejection', function(e){ var r = e.reason; report('Unhandled promise: ' + ((r && r.message) || r)); });
  // Storage the sandbox blocks, made to work: localStorage is kept through vonmini.store (seeded by
  // the host before the app starts), sessionStorage lives for the visit.
  function makeStorage(data, persist){
    return {
      getItem: function(k){ k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function(k, v){ data[String(k)] = String(v); persist(); },
      removeItem: function(k){ delete data[String(k)]; persist(); },
      clear: function(){ for (var k in data) delete data[k]; persist(); },
      key: function(i){ return Object.keys(data)[i] || null; },
      get length(){ return Object.keys(data).length; }
    };
  }
  var lsData = {}, seed = window.__vmSeed || {}, saveTimer;
  for (var sk in seed) lsData[sk] = String(seed[sk]);
  var ls = makeStorage(lsData, function(){ clearTimeout(saveTimer); saveTimer = setTimeout(function(){ call('store.set', ['__ls', lsData]).catch(function(){}); }, 150); });
  try { Object.defineProperty(window, 'localStorage', { value: ls, configurable: true }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: makeStorage({}, function(){}), configurable: true }); } catch (e) {}
  // Dialogs the sandbox blocks: alert shows a themed toast, confirm says yes, prompt gives its default.
  function toast(t){
    var d = document.createElement('div'); d.textContent = t;
    d.style.cssText = 'position:fixed;left:16px;right:16px;bottom:24px;z-index:2147483647;padding:12px 16px;border:3px solid var(--vm-border);border-radius:12px;background:var(--vm-surface);color:var(--vm-text);box-shadow:var(--vm-shadow);font-weight:700';
    (document.body || document.documentElement).appendChild(d); setTimeout(function(){ d.remove(); }, 2600);
  }
  window.alert = function(m){ toast(String(m)); };
  window.confirm = function(){ return true; };
  window.prompt = function(m, d){ return d == null ? '' : String(d); };
  window.vonmini = {
    ai: function(prompt){ return call('ai', [prompt]); },
    listen: function(){ return call('listen', []); },
    speak: function(text){ return call('speak', [String(text)]); },
    stopSpeaking: function(){ return call('stopSpeaking', []); },
    converse: function(persona, history, speakIt){ return call('converse', [persona, history, speakIt !== false]); },
    store: {
      get: function(k){ return call('store.get', [k]); },
      set: function(k, v){ return call('store.set', [k, v]); }
    }
  };
})();`;

/** Blocks network access from generated HTML (defense in depth on top of the prompt rules). */
export const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'";

/** The theme an HTML app is drawn with: the app's own colours, in its current light/dark mode. */
export type HtmlTheme = Pick<Theme, 'scheme' | 'bg' | 'surface' | 'surfaceAlt' | 'text' | 'muted' | 'subtle' | 'border' | 'danger' | 'success' | 'accent' | 'accentSoft' | 'onAccent'>;

/**
 * von mini's design system as plain CSS, injected into every app written in HTML so it looks
 * like the rest of the product: newsprint page, ink outlines, hard comic shadows, caption-yellow
 * inputs, the comic display font for headings and buttons, and the app's own accent. The model
 * is told to use these classes and variables and never its own colours or fonts.
 */
export function baseCss(t: HtmlTheme) {
  return `
@font-face{font-family:"VM Comic";src:url(data:font/ttf;base64,${COMIC_FONT_TTF_BASE64}) format("truetype");font-display:block}
:root{--vm-bg:${t.bg};--vm-surface:${t.surface};--vm-surface-alt:${t.surfaceAlt};--vm-text:${t.text};--vm-muted:${t.muted};--vm-subtle:${t.subtle};--vm-border:${t.border};--vm-danger:${t.danger};--vm-success:${t.success};--vm-accent:${t.accent};--vm-accent-soft:${t.accentSoft};--vm-on-accent:${t.onAccent};--vm-stroke:3px;--vm-shadow:4px 4px 0 ${t.border};--vm-shadow-sm:3px 3px 0 ${t.border};--vm-radius:14px;--vm-display:"VM Comic",Impact,"Arial Black",sans-serif;--vm-font:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color-scheme:${t.scheme}}
*{box-sizing:border-box}
html{overflow-x:hidden;-webkit-text-size-adjust:100%;text-size-adjust:100%}
html,body{margin:0;min-height:100%;background:var(--vm-bg);color:var(--vm-text);font:16px/1.5 var(--vm-font);-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
body{padding:16px 16px 32px;max-width:720px;margin:0 auto;overflow-wrap:anywhere}
h1,.vm-title{font-family:var(--vm-display);font-weight:400;font-size:30px;line-height:1.1;letter-spacing:.03em;margin:0 0 4px}
h2,.vm-headline{font-family:var(--vm-display);font-weight:400;font-size:22px;line-height:1.15;letter-spacing:.03em;margin:0}
h3{font-size:17px;font-weight:700;margin:0}
p{margin:0}
.vm-muted{color:var(--vm-muted);font-size:14px}
.vm-overline{font-family:var(--vm-display);font-size:16px;letter-spacing:.06em;text-transform:uppercase;color:var(--vm-accent)}
.vm-stack{display:flex;flex-direction:column;gap:16px}
.vm-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.vm-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
.vm-card{background:var(--vm-surface);border:var(--vm-stroke) solid var(--vm-border);border-radius:var(--vm-radius);padding:16px;box-shadow:var(--vm-shadow)}
.vm-hero{background:var(--vm-accent-soft);border:var(--vm-stroke) solid var(--vm-border);border-radius:18px;padding:16px;box-shadow:var(--vm-shadow)}
.vm-stat{font-family:var(--vm-display);font-size:44px;line-height:1;letter-spacing:.02em}
.vm-label{display:block;font-size:15px;font-weight:700;margin-bottom:8px}
.vm-input,input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select{width:100%;font:inherit;color:var(--vm-text);background:var(--vm-surface-alt);border:var(--vm-stroke) solid var(--vm-border);border-radius:10px;padding:12px;outline:none}
.vm-input:focus,input:focus,textarea:focus,select:focus{box-shadow:var(--vm-shadow-sm)}
input[type=checkbox],input[type=radio]{width:22px;height:22px;accent-color:var(--vm-accent)}
input[type=range]{width:100%;accent-color:var(--vm-accent)}
textarea{min-height:110px;resize:vertical}
.vm-btn,button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:50px;padding:0 20px;border:var(--vm-stroke) solid var(--vm-border);border-radius:12px;font:400 20px/1 var(--vm-display);letter-spacing:.05em;background:var(--vm-accent);color:var(--vm-on-accent);box-shadow:var(--vm-shadow);cursor:pointer;transition:transform .08s,box-shadow .08s,opacity .15s;touch-action:manipulation}
.vm-btn:active,button:active{transform:translate(3px,3px);box-shadow:1px 1px 0 var(--vm-border)}
.vm-btn:disabled,button:disabled{opacity:.45;cursor:default}
.vm-btn-secondary{background:var(--vm-surface);color:var(--vm-text)}
.vm-btn-block{width:100%}
.vm-chip{display:inline-flex;align-items:center;gap:4px;min-height:40px;padding:6px 14px;border-radius:999px;border:var(--vm-stroke) solid var(--vm-border);background:var(--vm-surface);color:var(--vm-text);font:700 14px/1 var(--vm-font);box-shadow:var(--vm-shadow-sm);cursor:pointer}
.vm-chip[aria-pressed=true],.vm-chip.is-active{background:var(--vm-accent);color:var(--vm-on-accent)}
.vm-result{background:var(--vm-surface-alt);border:var(--vm-stroke) solid var(--vm-border);border-radius:12px;padding:14px;white-space:pre-wrap}
.vm-badge{display:inline-flex;gap:4px;align-items:center;font-size:12px;font-weight:700;color:var(--vm-text);border:2px solid var(--vm-border);border-radius:999px;padding:2px 10px;background:var(--vm-surface)}
.vm-empty{text-align:center;color:var(--vm-muted);border:var(--vm-stroke) dashed var(--vm-border);border-radius:var(--vm-radius);padding:20px}
.vm-list{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.vm-list>li{background:var(--vm-surface);border:var(--vm-stroke) solid var(--vm-border);border-radius:12px;padding:12px;box-shadow:var(--vm-shadow-sm)}
.vm-spinner{width:20px;height:20px;border-radius:50%;border:3px solid var(--vm-accent-soft);border-top-color:var(--vm-accent);animation:vm-spin .8s linear infinite}
body{width:100%;padding-bottom:calc(32px + env(safe-area-inset-bottom))}
img,video,canvas,svg,iframe{max-width:100%}
img,video{height:auto}
canvas{display:block;touch-action:none}
table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse}
pre,code{white-space:pre-wrap;overflow-wrap:anywhere}
@keyframes vm-spin{to{transform:rotate(360deg)}}`;
}

export function wrapHtml(html: string, script: string, theme: HtmlTheme, seed: Record<string, unknown> = {}): string {
  // What the app saved in localStorage last time, in place before its own scripts run.
  const seedJs = `window.__vmSeed=${JSON.stringify(seed).replace(/</g, '\\u003c')};`;
  const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"><style>${baseCss(theme)}</style><script>${seedJs}${script}</script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;
}
