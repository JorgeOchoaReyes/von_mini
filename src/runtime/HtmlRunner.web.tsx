// Web: runs a custom HTML app in a sandboxed iframe (scripts only, opaque origin).
import { useEffect, useMemo, useRef } from 'react';

import { useAI } from '../ai/AIContext';
import { bridgeScript, handleBridge, isBridgeRequest, wrapHtml } from './bridge';

export function HtmlRunner({ appId, html }: { appId: string; html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ai = useAI();
  const aiRef = useRef(ai);
  aiRef.current = ai;

  // The iframe posts JSON strings to the host; the host posts back a reply object that a tiny
  // listener inside the frame forwards to window.__vmReply. No code is evaluated across the boundary.
  const srcDoc = useMemo(
    () =>
      wrapHtml(
        html,
        // Sandboxed frames have an opaque origin, so the target must be '*'.
        bridgeScript("(function(m){ parent.postMessage(m, '*'); })") +
          `window.addEventListener('message', function(e){ var m=e.data; if(m && m.__vmReply) window.__vmReply(m.id, m.ok, m.v); });`,
      ),
    [html],
  );

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win || typeof e.data !== 'string') return;
      let req: unknown;
      try {
        req = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!isBridgeRequest(req)) return;
      const res = await handleBridge(appId, req, aiRef.current);
      win.postMessage({ __vmReply: true, id: req.id, ok: res.ok, v: res.ok ? res.value : res.error }, '*');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [appId]);

  return (
    <iframe
      ref={frame}
      title="Custom app"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ flex: 1, width: '100%', height: '100%', minHeight: 600, border: 'none', background: 'transparent' }}
    />
  );
}
