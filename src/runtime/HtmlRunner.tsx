// Native: runs a custom HTML app inside a sandboxed WebView. Web uses HtmlRunner.web.tsx.
import { useEffect, useMemo, useRef, useState, type ComponentType, type RefAttributes } from 'react';
import WebViewBase, { type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from 'react-native-webview';

import { View } from 'react-native';

import { useAppAI } from '../ai/appMode';
import type { Accent } from '../spec/types';
import { kvGet } from '../storage/store';
import { useTheme } from '../ui/theme';
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

  const onMessage = async (event: WebViewMessageEvent) => {
    let req: unknown;
    try {
      req = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!isBridgeRequest(req)) return;
    const res = await handleBridge(appId, req, ai);
    const payload = JSON.stringify(res.ok ? res.value : res.error);
    ref.current?.injectJavaScript(`window.__vmReply(${req.id}, ${res.ok}, ${payload}); true;`);
  };

  // Start the app only once its saved data is in place.
  if (!seed) return <View style={{ flex: 1 }} />;
  return (
    <WebView
      ref={ref}
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
