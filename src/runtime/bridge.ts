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

export function wrapHtml(html: string, script: string): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><script>${script}</script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;
}
