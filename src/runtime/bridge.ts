/**
 * The `vonmini` API that custom HTML apps can call. The app runs sandboxed (WebView / iframe)
 * and talks to the host only through postMessage; the host decides how each call is served.
 */
import { runAction, type RouteContext } from '../ai/hybrid';
import { kvGet, kvSet } from '../storage/store';

export interface BridgeRequest {
  __vm: true;
  id: number;
  method: 'ai' | 'store.get' | 'store.set';
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
      case 'store.get':
        return { ok: true, value: await kvGet(appId, String(req.args[0])) };
      case 'store.set':
        await kvSet(appId, String(req.args[0]), req.args[1] ?? null);
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
  window.vonmini = {
    ai: function(prompt){ return call('ai', [prompt]); },
    store: {
      get: function(k){ return call('store.get', [k]); },
      set: function(k, v){ return call('store.set', [k, v]); }
    }
  };
})();`;

/** Blocks network access from generated HTML (defense in depth on top of the prompt rules). */
export const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'";

/**
 * von mini's design system as plain CSS, injected into every custom app so cloud-written
 * apps look consistent with the rest of the product. The model is told to use these classes.
 */
export function baseCss(accent: { light: string; dark: string }) {
  return `
:root{--vm-accent:${accent.light};--vm-accent-soft:${accent.light}1a;--vm-bg:#F6F5FA;--vm-surface:#fff;--vm-surface-alt:#EFEDF5;--vm-text:#15141A;--vm-muted:#64627A;--vm-border:#E3E1EC;--vm-danger:#C62828;--vm-radius:18px;color-scheme:light dark}
@media (prefers-color-scheme: dark){:root{--vm-accent:${accent.dark};--vm-accent-soft:${accent.dark}2e;--vm-bg:#0D0C12;--vm-surface:#17161F;--vm-surface-alt:#211F2B;--vm-text:#F3F2F8;--vm-muted:#A3A1B8;--vm-border:#2A2836;--vm-danger:#FF6B6B}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--vm-bg);color:var(--vm-text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
body{padding:16px;max-width:720px;margin:0 auto}
h1,.vm-title{font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-.01em;margin:0 0 4px}
h2,.vm-headline{font-size:17px;font-weight:600;margin:0}
.vm-muted{color:var(--vm-muted);font-size:13px}
.vm-overline{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--vm-accent)}
.vm-stack{display:flex;flex-direction:column;gap:16px}
.vm-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.vm-card{background:var(--vm-surface);border:1px solid var(--vm-border);border-radius:var(--vm-radius);padding:16px;box-shadow:0 1px 2px rgba(20,16,40,.06),0 4px 16px rgba(20,16,40,.06)}
.vm-hero{background:var(--vm-accent-soft);border-radius:24px;padding:16px}
.vm-label{display:block;font-size:14px;font-weight:600;margin-bottom:8px}
.vm-input,input,textarea,select{width:100%;font:inherit;color:inherit;background:var(--vm-surface-alt);border:1px solid transparent;border-radius:12px;padding:12px;outline:none}
.vm-input:focus,input:focus,textarea:focus,select:focus{border-color:var(--vm-accent)}
textarea{min-height:110px;resize:vertical}
.vm-btn,button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 20px;border:0;border-radius:12px;font:600 16px/1 inherit;background:var(--vm-accent);color:#fff;cursor:pointer;transition:transform .08s,opacity .15s}
.vm-btn:active,button:active{transform:scale(.98)}
.vm-btn:disabled,button:disabled{opacity:.45;cursor:default}
.vm-btn-secondary{background:var(--vm-surface-alt);color:var(--vm-text)}
.vm-btn-block{width:100%}
.vm-chip{display:inline-flex;align-items:center;gap:4px;padding:8px 12px;border-radius:999px;border:1px solid var(--vm-border);background:var(--vm-surface);font-size:13px;cursor:pointer}
.vm-chip[aria-pressed=true],.vm-chip.is-active{background:var(--vm-accent);border-color:var(--vm-accent);color:#fff}
.vm-result{background:var(--vm-accent-soft);border-left:3px solid var(--vm-accent);border-radius:12px;padding:16px;white-space:pre-wrap}
.vm-badge{display:inline-flex;gap:4px;align-items:center;font-size:12px;color:var(--vm-muted);border:1px solid var(--vm-border);border-radius:999px;padding:2px 8px}
.vm-empty{text-align:center;color:var(--vm-muted);border:1px dashed var(--vm-border);border-radius:var(--vm-radius);padding:20px}
.vm-spinner{width:18px;height:18px;border-radius:50%;border:2px solid var(--vm-accent-soft);border-top-color:var(--vm-accent);animation:vm-spin .8s linear infinite}
@keyframes vm-spin{to{transform:rotate(360deg)}}`;
}

export function wrapHtml(html: string, script: string, accent: { light: string; dark: string }): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${baseCss(accent)}</style><script>${script}</script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;
}
