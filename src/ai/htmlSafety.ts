/**
 * Custom apps run alone on the phone, offline: anything they load from the internet would never
 * arrive (and would leak that the app was opened). The model is told so, but occasionally still
 * links a stylesheet or a script it imagines exists. Remove those references before saving.
 */
const REMOTE = String.raw`(?:https?:)?\/\/`;

/**
 * The app's theme sets the fonts (body text and the comic display face). A font-family of the
 * model's own in a stylesheet would break that, so drop it; `var(--vm-…)` fonts stay. Only CSS in
 * <style> blocks and style="" attributes is touched, never script (canvas text sets its own).
 */
export function themeFonts(html: string): string {
  const dropOwnFont = (css: string) => css.replace(/font-family\s*:\s*(?![^;}"]*var\(--vm-)[^;}"]*;?/gi, '');
  return html
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_, open: string, css: string, close: string) => open + dropOwnFont(css) + close)
    .replace(/(\sstyle\s*=\s*")([^"]*)(")/gi, (_, open: string, css: string, close: string) => open + dropOwnFont(css) + close);
}

/** Everything a generated custom app goes through before it's saved. */
export function cleanCustomHtml(html: string): string {
  return themeFonts(stripExternal(html));
}

export function stripExternal(html: string): string {
  return (
    html
      // <script src="https://…"></script>
      .replace(new RegExp(String.raw`<script\b[^>]*\bsrc\s*=\s*["']?${REMOTE}[^>]*>\s*<\/script\s*>`, 'gi'), '')
      // <link rel="stylesheet" href="https://…"> and preconnects / font links
      .replace(new RegExp(String.raw`<link\b[^>]*\bhref\s*=\s*["']?${REMOTE}[^>]*>`, 'gi'), '')
      // @import url("https://…"); inside <style>
      .replace(new RegExp(String.raw`@import\s+(?:url\()?\s*["']?${REMOTE}[^;]*;`, 'gi'), '')
  );
}
