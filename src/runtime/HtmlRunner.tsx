// Native: runs a custom HTML app inside a sandboxed WebView. Web uses HtmlRunner.web.tsx.
import { useMemo, useRef, type ComponentType, type RefAttributes } from 'react';
import WebViewBase, { type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from 'react-native-webview';

import { useAI } from '../ai/AIContext';
import { bridgeScript, handleBridge, isBridgeRequest, wrapHtml } from './bridge';

// Upstream typings default the class generic to `undefined`, which collapses props to `never`
// under TypeScript 6. Re-type the component with the props and the one ref method we use.
type WebViewHandle = { injectJavaScript(script: string): void };
const WebView = WebViewBase as unknown as ComponentType<WebViewProps & RefAttributes<WebViewHandle>>;

export function HtmlRunner({ appId, html }: { appId: string; html: string }) {
  const ref = useRef<WebViewHandle>(null);
  const ai = useAI();
  const source = useMemo(
    () => ({ html: wrapHtml(html, bridgeScript('window.ReactNativeWebView.postMessage')) }),
    [html],
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
      style={{ flex: 1, backgroundColor: 'transparent' }}
    />
  );
}
