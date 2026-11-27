// Native: runs a custom HTML app inside a sandboxed WebView. Web uses HtmlRunner.web.tsx.
import { useEffect, useMemo, useRef, useState, type ComponentType, type RefAttributes } from 'react';
import WebViewBase, { type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from 'react-native-webview';

import { AppState, Text, View } from 'react-native';

import { useAppAI } from '../ai/appMode';
import type { Accent } from '../spec/types';
import { reportRuntimeError } from '../chat/customJobs';
import { clearRunning, noteRunning } from '../diagnostics/crashNotes';
import { kvGet } from '../storage/store';
import { space, type, useTheme } from '../ui/theme';
import { bridgeScript, handleBridge, isBridgeRequest, wrapHtml } from './bridge';

// Upstream typings default the class generic to `undefined`, which collapses props to `never`
// under TypeScript 6. Re-type the component with the props and the one ref method we use.
type WebViewHandle = { injectJavaScript(script: string): void };
const WebView = WebViewBase as unknown as ComponentType<WebViewProps & RefAttributes<WebViewHandle>>;

export function HtmlRunner({ appId, html, accent }: { appId: string; html: string; accent: Accent }) {
  const ref = useRef<WebViewHandle>(null);
  const ai = useAppAI();
  // Drawn with the app's own theme (and its light/dark mode), so it looks like the rest of von mini.
  // What the app kept in localStorage, loaded before it starts (see the bridge's storage).
  const [seed, setSeed] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let alive = true;
    void kvGet(appId, '__ls')
      .then((v) => alive && setSeed(v && typeof v === 'object' ? (v as Record<string, unknown>) : {}))
      .catch(() => alive && setSeed({}));
    return () => {
      alive = false;
    };
  }, [appId, html]);
  const fresh = useTheme(accent);
  // useTheme returns a new object each render; only a different scheme or accent may reload the
  // app (a reload restarts whatever is running inside it).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const theme = useMemo(() => fresh, [fresh.scheme, fresh.accent]);
  const source = useMemo(
    () => ({ html: wrapHtml(html, bridgeScript('window.ReactNativeWebView.postMessage'), theme, seed ?? {}) }),
    [html, theme, seed],
  );

  // A page that crashes (Android kills its renderer, e.g. when it runs out of memory) or freezes
  // (an endless loop) must never take von mini down or sit there dead: start it afresh, and have
  // the agent fix the cause. After two in a row, stop restarting and say so while it's fixed.
  const [run, setRun] = useState(0);
  // Counted per version of the app: a new version (the fix) gets fresh chances.
  const [failed, setFailed] = useState<{ html: string; n: number }>({ html, n: 0 });
  const failures = failed.html === html ? failed.n : 0;
  const lastAlive = useRef(0);
  const fail = (why: string) => {
    reportRuntimeError(appId, why, ai);
    setFailed((f) => ({ html, n: (f.html === html ? f.n : 0) + 1 }));
    setRun((n) => n + 1);
    lastAlive.current = Date.now();
  };
  useEffect(() => {
    lastAlive.current = Date.now();
    const t = setInterval(() => {
      // Only while von mini is on screen: a backgrounded WebView pauses its timers.
      if (AppState.currentState !== 'active') {
        lastAlive.current = Date.now();
        return;
      }
      if (Date.now() - lastAlive.current > 8000) {
        fail('The app froze and stopped responding (likely an endless or very long loop). Make every loop end and keep each frame short.');
      }
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, source]);

  const onMessage = async (event: WebViewMessageEvent) => {
    lastAlive.current = Date.now();
    let req: unknown;
    try {
      req = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!isBridgeRequest(req) || req.method === 'alive') return;
    const res = await handleBridge(appId, req, ai);
    if (req.id === 0) return; // a report, nothing waits for an answer
    const payload = JSON.stringify(res.ok ? res.value : res.error);
    ref.current?.injectJavaScript(`window.__vmReply(${req.id}, ${res.ok}, ${payload}); true;`);
  };

  // Noted while it runs, so if von mini goes down with it, the next launch says so.
  useEffect(() => {
    noteRunning(appId);
    return () => clearRunning(appId);
  }, [appId]);

  // Start the app only once its saved data is in place.
  if (!seed) return <View style={{ flex: 1 }} />;
  if (failures >= 2) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(6), gap: space(2) }}>
        <Text style={[type.headline, { color: theme.text, textAlign: 'center' }]}>This app keeps crashing</Text>
        <Text style={[type.body, { color: theme.muted, textAlign: 'center' }]}>
          It’s being fixed now and opens again when the fix is ready. You can also restore an earlier version in History.
        </Text>
      </View>
    );
  }
  return (
    <WebView
      key={run}
      ref={ref}
      onRenderProcessGone={() =>
        fail('The app crashed: it ran out of memory. Keep lists and the page from growing forever (remove what is far off screen) and keep drawing light.')
      }
      source={source}
      originWhitelist={['*']}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(r: WebViewNavigation) => r.url === 'about:blank' || r.url.startsWith('data:')}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false}
      // Fit the page: the phone's font-size setting mustn't reflow it, no pinch zoom or overscroll.
      textZoom={100}
      setBuiltInZoomControls={false}
      overScrollMode="never"
      bounces={false}
      style={{ flex: 1, backgroundColor: 'transparent' }}
    />
  );
}
