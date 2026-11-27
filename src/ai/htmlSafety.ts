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

/** Lightness 0..1 of a neutral (grey, white or black) CSS colour, or null if it has a hue. */
function neutralLightness(colour: string): number | null {
  const c = colour.trim().toLowerCase();
  const named: Record<string, number> = { white: 1, black: 0, gray: 0.5, grey: 0.5, silver: 0.75, gainsboro: 0.86, whitesmoke: 0.96, lightgray: 0.83, lightgrey: 0.83, darkgray: 0.66, darkgrey: 0.66, dimgray: 0.41, dimgrey: 0.41 };
  if (c in named) return named[c];
  let r: number, g: number, b: number;
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  const rgb = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(1|1\.0+)\s*)?\)$/);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((x) => x + x).join('') : hex[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if (rgb) {
    [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
  } else return null;
  if (Math.max(r, g, b) - Math.min(r, g, b) > 16) return null; // has a hue: a real colour, keep it
  return (r + g + b) / 3 / 255;
}

/**
 * Neutral colours of the model's own (white panels, black text, grey borders) are what break dark
 * mode: map them to the theme, so contrast always follows it. Real colours (game pieces, a red
 * warning) are left alone. Only CSS is touched, never script.
 */
export function themeNeutrals(html: string): string {
  const prop = /(^|[;{\s"])((?:background-color|background|color|border-color|border(?:-top|-right|-bottom|-left)?|outline|fill|stroke)\s*:\s*)([^;}"]*)/gi;
  const swap = (css: string) =>
    css.replace(prop, (whole, lead: string, name: string, value: string) => {
      const key = name.split(':')[0].trim().toLowerCase();
      const fixed = value.replace(/#[0-9a-f]{3,6}\b|rgba?\([^)]*\)|\b(?:white|black|gr[ae]y|silver|gainsboro|whitesmoke|light-?gr[ae]y|darkgr[ae]y|dimgr[ae]y)\b/gi, (col: string) => {
        const l = neutralLightness(col);
        if (l === null) return col;
        if (key === 'color' || key === 'fill') return l > 0.3 && l < 0.7 ? 'var(--vm-muted)' : 'var(--vm-text)';
        if (key.startsWith('border') || key === 'outline' || key === 'stroke') return 'var(--vm-border)';
        // Backgrounds: near-white or near-black panels become the theme's surfaces.
        return l >= 0.85 || l <= 0.15 ? 'var(--vm-surface)' : 'var(--vm-surface-alt)';
      });
      return lead + name + fixed;
    });
  return html
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_, open: string, css: string, close: string) => open + swap(css) + close)
    .replace(/(\sstyle\s*=\s*")([^"]*)(")/gi, (_, open: string, css: string, close: string) => open + swap(css) + close);
}

/** Everything a generated custom app goes through before it's saved. */
export function cleanCustomHtml(html: string): string {
  return themeNeutrals(themeFonts(stripExternal(html)));
}

export function stripExternal(html: string): string {
  return (
    html
      // <script src="…"></script>: remote, or a file it imagines next to it ("/vonmini.js"). The app
      // is one file, so neither can ever load.
      .replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script\s*>/gi, '')
      // <link rel="stylesheet" href="…"> (any), and preconnects / font links to the internet
      .replace(/<link\b(?=[^>]*\brel\s*=\s*["']?stylesheet)[^>]*>/gi, '')
      .replace(new RegExp(String.raw`<link\b[^>]*\bhref\s*=\s*["']?${REMOTE}[^>]*>`, 'gi'), '')
      // @import url("https://…"); inside <style>
      .replace(new RegExp(String.raw`@import\s+(?:url\()?\s*["']?${REMOTE}[^;]*;`, 'gi'), '')
  );
}

/** Whether a written HTML app is whole: every <script> closed and the document ended. */
export function isCompleteHtml(html: string): boolean {
  const opens = (html.match(/<script\b/gi) ?? []).length;
  const closes = (html.match(/<\/script>/gi) ?? []).length;
  return /<\/html>\s*$/i.test(html) && opens === closes;
}

/**
 * Applies edit blocks to an app's HTML, so a change only needs the lines that change:
 *
 *   <<<<<<< SEARCH
 *   exact existing lines
 *   =======
 *   replacement lines
 *   >>>>>>> REPLACE
 *
 * Each SEARCH must match exactly once (an exact match first, then one that ignores indentation and
 * trailing spaces). Returns null when there are no blocks or any block doesn't fit, so the caller
 * can fall back to writing the whole file.
 */
export function applyPatches(html: string, reply: string): string | null {
  const blocks = [...reply.matchAll(/<{5,}\s*SEARCH\s*\n([\s\S]*?)\n?={5,}\s*\n([\s\S]*?)\n?>{5,}\s*REPLACE/g)];
  if (!blocks.length) return null;
  let out = html;
  for (const [, search, replace] of blocks) {
    if (!search.trim()) return null;
    const at = out.indexOf(search);
    if (at >= 0 && out.indexOf(search, at + 1) < 0) {
      out = out.slice(0, at) + replace + out.slice(at + search.length);
      continue;
    }
    // Same lines, different indentation or trailing spaces.
    const norm = (l: string) => l.trim();
    const want = search.split('\n').map(norm);
    const lines = out.split('\n');
    const hits: number[] = [];
    for (let i = 0; i + want.length <= lines.length; i++) {
      if (want.every((w, j) => norm(lines[i + j]) === w)) hits.push(i);
    }
    if (hits.length !== 1) return null;
    lines.splice(hits[0], want.length, ...replace.split('\n'));
    out = lines.join('\n');
  }
  return out;
}

/** Joins a continuation onto text that was cut off, dropping any part the model repeated. */
export function joinContinuation(head: string, tail: string): string {
  const max = Math.min(400, head.length, tail.length);
  for (let n = max; n >= 12; n--) {
    if (head.endsWith(tail.slice(0, n))) return head + tail.slice(n);
  }
  return head + tail;
}
