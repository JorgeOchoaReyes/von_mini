// Engine eval: real requests through the app's own pipeline (web build with EXPO_PUBLIC_ENGINE_EVAL),
// in a browser so App Check works as it does for people. Usage: node run.mjs <distDir> [outDir]
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';

// require(), so a globally installed Playwright works as well as a local one.
const { chromium } = createRequire(import.meta.url)('playwright');

const dist = process.argv[2] ?? 'dist';
const outDir = process.argv[3] ?? 'engine-eval-results';
const only = process.env.ONLY ?? '';
const ideas = JSON.parse(readFileSync(new URL('./ideas.json', import.meta.url), 'utf8'));
mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
// A URL instead of a folder runs against a dev server (e.g. the mock engine) to check this script.
const base = dist.startsWith('http') ? dist : 'http://localhost:4173';
const server = dist.startsWith('http') ? null : createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = join(dist, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(4173);

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const logs = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.text().slice(0, 300)));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(`${base}/`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => !!globalThis.__vmEval, null, { timeout: 60000 });

const call = (fn, ...args) => page.evaluate(([fn, args]) => globalThis.__vmEval[fn](...args), [fn, args]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Retries only rate limits, so a real failure still counts. */
async function withRetry(fn, ...args) {
  for (let i = 0; ; i++) {
    const r = await call(fn, ...args);
    if (r.ok || i >= 3 || !/quota|429|rate|exhausted|too many/i.test(r.error)) return r;
    await sleep(15000 * (i + 1));
  }
}

/** Problems with a valid spec that a person would still notice. */
function review(spec, expect = {}) {
  const issues = [];
  const ids = new Set(spec.components.map((c) => c.id).filter(Boolean));
  const types = spec.components.map((c) => c.type);
  for (const t of expect.has ?? []) if (!types.includes(t)) issues.push(`missing ${t}`);
  if (expect.code === true && !spec.code) issues.push('expected a code brief');
  if (expect.wired && !spec.components.some((c) => c.type === 'random' && (c.countFrom || c.sidesFrom || c.minFrom || c.maxFrom || c.optionsFrom))) issues.push('blocks not connected');
  if (expect.code === false && spec.code) issues.push('unexpected code brief');
  if (!spec.name || spec.name === 'My App') issues.push('no name');
  if (spec.components.length < 2) issues.push('too few blocks');
  for (const c of spec.components) {
    for (const m of (c.prompt ?? '').matchAll(/\{([a-z0-9_]+)\}/g)) {
      if (!ids.has(m[1]) && !['today', 'today_entries', 'entries'].includes(m[1])) issues.push(`${c.id}: unknown {${m[1]}}`);
    }
    if (c.type === 'ai' && c.prompt && !/\{[a-z0-9_]+\}/.test(c.prompt)) issues.push(`${c.id}: ai reads nothing`);
    if ((c.type === 'stat' || c.type === 'chart') && c.field && !ids.has(c.field)) issues.push(`${c.id}: reads missing ${c.field}`);
  }
  if (/super mario|tetris|pac-?man|flappy bird|subway surfers|candy crush|minecraft|pok[eé]mon/i.test(spec.name)) issues.push(`trademarked name: ${spec.name}`);
  return issues;
}

async function pool(items, n, work) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i], i);
    }
  }));
  return out;
}

const builds = ideas.builds.filter((b) => !only || b.request.includes(only));
console.log(`Building ${builds.length} apps…`);
const built = await pool(builds, 3, async (b) => {
  const r = await withRetry('build', b.request);
  const issues = r.ok ? review(r.value.spec, b) : [];
  console.log(`${r.ok ? (issues.length ? 'WARN' : 'OK  ') : 'FAIL'} ${String(Math.round(r.ms / 1000)).padStart(3)}s  ${b.request.slice(0, 60)}${r.ok ? `  → ${r.value.spec.emoji} ${r.value.spec.name} [${r.value.spec.components.map((c) => c.type).join(',')}]${r.value.spec.code ? ' +code' : ''}` : `  ✗ ${r.error}`}${issues.length ? `  ⚠ ${issues.join('; ')}` : ''}`);
  return { ...b, ...r, issues };
});

const specOf = Object.fromEntries(built.filter((b) => b.ok).map((b) => [b.request, b.value.spec]));
const chats = ideas.chats.filter((c) => specOf[c.base] && (!only || c.base.includes(only)));
console.log(`\nChat: ${chats.length} turns…`);
const chatted = await pool(chats, 3, async (c) => {
  const r = await withRetry('chat', specOf[c.base], c.history ?? [], c.message);
  const issues = [];
  if (r.ok) {
    const v = r.value;
    if (c.expect !== 'any' && v.kind !== c.expect) issues.push(`expected ${c.expect}, got ${v.kind}`);
    if (v.kind === 'edit') issues.push(...review(v.spec, { has: c.has, code: c.code, wired: c.wired }));
    if (c.noInvent && v.kind === 'edit') {
      const before = new Set(specOf[c.base].components.map((x) => x.id));
      const added = v.spec.components.filter((x) => x.type === 'ai' && !before.has(x.id));
      if (added.length) issues.push(`invented AI button ${added.map((x) => x.label).join(', ')}`);
    }
    if (v.kind === 'answer' && /couldn.t work out a change/i.test(v.text) && c.expect === 'edit') issues.push('no change made');
  }
  const what = r.ok ? (r.value.kind === 'edit' ? `edit: ${r.value.changes.join(' | ').slice(0, 160)}` : `answer: ${r.value.text.slice(0, 160)}`) : `✗ ${r.error}`;
  console.log(`${r.ok ? (issues.length ? 'WARN' : 'OK  ') : 'FAIL'} ${String(Math.round(r.ms / 1000)).padStart(3)}s  [${c.base.slice(0, 24)}] "${c.message.slice(0, 50)}" → ${what}${issues.length ? `  ⚠ ${issues.join('; ')}` : ''}`);
  return { ...c, ...r, issues };
});

const htmlIdeas = ideas.html.filter((h) => specOf[h] && (!only || h.includes(only)));
console.log(`\nCustom code: ${htmlIdeas.length}…`);
const coded = await pool(htmlIdeas, 3, async (h) => {
  const spec = { ...specOf[h], code: specOf[h].code ?? `Build: ${h}` };
  const r = await withRetry('html', h, spec);
  const issues = [];
  if (r.ok) {
    if (/<script[^>]+src=|https?:\/\/(?!www\.w3\.org)/i.test(r.value)) issues.push('external resource');
    if (/localStorage|alert\(/.test(r.value)) issues.push('uses localStorage/alert');
    if (!/<script/i.test(r.value)) issues.push('no script');
    // It should be drawn with von mini's theme, not its own look.
    const vm = (r.value.match(/\bvm-[a-z-]+/g) ?? []).length;
    if (vm < 4) issues.push(`barely uses the design system (${vm} vm- classes)`);
    const ownColours = (r.value.match(/(?<![\w-])(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/gi) ?? []).length;
    if (ownColours > 6) issues.push(`${ownColours} hard-coded colours`);
    if (/font-family\s*:(?![^;]*var\(--vm-)/i.test(r.value)) issues.push('sets its own font');
  }
  console.log(`${r.ok ? (issues.length ? 'WARN' : 'OK  ') : 'FAIL'} ${String(Math.round(r.ms / 1000)).padStart(3)}s  ${h}${r.ok ? `  (${r.value.length} chars)` : `  ✗ ${r.error}`}${issues.length ? `  ⚠ ${issues.join('; ')}` : ''}`);
  if (r.ok) writeFileSync(join(outDir, `${h.replace(/[^a-z0-9]+/gi, '-')}.html`), r.value);
  return { request: h, ok: r.ok, ms: r.ms, error: r.ok ? undefined : r.error, issues, html: r.ok ? r.value : undefined, spec };
});

// First run, like a person: open each HTML app in the real app screen, type into its fields, tap
// every button, and report errors and buttons that change nothing. Then wait for the self-repair.
console.log(`\nFirst run of ${coded.filter((x) => x.html).length} HTML apps…`);
const tryer = await context.newPage();
await tryer.setViewportSize({ width: 412, height: 915 });
const appErrors = [];
tryer.on('console', (m) => { const t = m.text(); if (t.includes('[vm-app-error]')) appErrors.push(t.replace(/^.*\[vm-app-error\]\s*\S+\s*/, '')); });
tryer.on('pageerror', (e) => appErrors.push(`pageerror: ${e.message}`));
const firstRun = [];
for (const [i, x] of coded.entries()) {
  if (!x.html) continue;
  const id = `eval-html-${i}`;
  await call('save', x.spec, id, x.html);
  appErrors.length = 0;
  const notes = [];
  try {
    await tryer.goto(`${base}/app/${id}`, { waitUntil: 'load', timeout: 60000 });
    const frame = tryer.frameLocator('iframe').first();
    await frame.locator('body').waitFor({ timeout: 20000 });
    await tryer.waitForTimeout(1200);
    const bodyText = async () => (await frame.locator('body').innerText().catch(() => '')).trim();
    if ((await bodyText()).length < 10) notes.push('blank first screen');
    for (const input of (await frame.locator('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea').all()).slice(0, 6)) {
      const kind = await input.getAttribute('type');
      await input.fill(kind === 'number' ? '3' : 'test 3').catch(() => {});
    }
    const buttons = (await frame.locator('button, .vm-btn, [role=button]').all()).slice(0, 12);
    let dead = 0;
    for (const btn of buttons) {
      if (!(await btn.isVisible().catch(() => false))) continue;
      const before = await bodyText();
      await btn.click({ timeout: 2000 }).catch(() => {});
      await tryer.waitForTimeout(500);
      if ((await bodyText()) === before) dead++;
    }
    if (buttons.length && dead === buttons.length) notes.push(`no button changed anything (${dead})`);
  } catch (e) {
    notes.push(`couldn't open: ${String(e.message).split('\n')[0]}`);
  }
  const errs = [...new Set(appErrors)];
  let repaired = '';
  if (errs.length) {
    // The app reported errors, so it repairs itself: wait for the fix, then check again.
    await tryer.waitForTimeout(25000);
    appErrors.length = 0;
    await tryer.reload({ waitUntil: 'load' }).catch(() => {});
    await tryer.waitForTimeout(1500);
    for (const btn of (await tryer.frameLocator('iframe').first().locator('button, .vm-btn').all()).slice(0, 12)) await btn.click({ timeout: 2000 }).catch(() => {});
    await tryer.waitForTimeout(800);
    repaired = appErrors.length ? `still failing after repair: ${appErrors[0]}` : 'fixed by self-repair';
  }
  const issues = [...notes, ...errs.slice(0, 3).map((e) => `error: ${e.slice(0, 140)}`), ...(repaired ? [repaired] : [])];
  console.log(`${errs.length || notes.length ? (repaired === 'fixed by self-repair' ? 'FIXD' : 'FAIL') : 'OK  '} first run  ${x.request}${issues.length ? `  ⚠ ${issues.join('; ')}` : ''}`);
  firstRun.push({ request: x.request, ok: !errs.length && !notes.length, issues: [], error: issues.join('; ') || undefined });
}
for (const x of coded) delete x.html;

// Render every design the model made in the real app screen: it must show, with no errors.
const designs = [
  ...built.filter((b) => b.ok).map((b) => ({ label: b.request, spec: b.value.spec })),
  ...chatted.filter((c) => c.ok && c.value.kind === 'edit').map((c) => ({ label: `${c.base} + "${c.message}"`, spec: c.value.spec })),
];
console.log(`\nRendering ${designs.length} designs…`);
const viewer = await context.newPage(); // same storage as the eval page
await viewer.setViewportSize({ width: 412, height: 915 });
const viewErrors = [];
viewer.on('pageerror', (e) => viewErrors.push(e.message));
const rendered = [];
for (const [i, d] of designs.entries()) {
  const id = `eval-${i}`;
  await call('save', d.spec, id);
  const before = viewErrors.length;
  let shown = false;
  try {
    await viewer.goto(`${base}/app/${id}`, { waitUntil: 'load', timeout: 60000 });
    // Shown: the app's name on screen, or its custom version opened (it may write one by itself).
    await viewer.waitForFunction(
      (name) => document.body.innerText.includes(name) || document.body.innerText.includes('Custom version, written by Gemini'),
      d.spec.name,
      { timeout: 20000 },
    );
    shown = true;
    await viewer.waitForTimeout(400);
  } catch {
    // reported below
  }
  const errors = viewErrors.slice(before);
  const issues = [...(shown ? [] : ['app did not show']), ...errors.map((e) => `error: ${e.slice(0, 160)}`)];
  if (issues.length) {
    console.log(`FAIL render  ${d.label.slice(0, 70)}  ⚠ ${issues.join('; ')}`);
    // Enough to reproduce it: what the screen showed, and the design itself.
    const shownText = await viewer.locator('body').innerText().catch(() => '');
    console.log(`  screen: ${shownText.replace(/\s+/g, ' ').slice(0, 400)}`);
    console.log(`  design: ${JSON.stringify(d.spec)}`);
    await viewer.screenshot({ path: join(outDir, `render-fail-${i}.png`) }).catch(() => undefined);
  }
  rendered.push({ label: d.label, ok: !issues.length, issues: [] , error: issues.join('; ') || undefined });
}
console.log(`Rendered ${rendered.filter((r) => r.ok).length}/${rendered.length} cleanly.`);

const count = (xs) => ({ total: xs.length, ok: xs.filter((x) => x.ok && !x.issues.length).length, warn: xs.filter((x) => x.ok && x.issues.length).length, fail: xs.filter((x) => !x.ok).length });
const summary = { builds: count(built), chats: count(chatted), html: count(coded), firstRun: count(firstRun), render: count(rendered) };
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ summary, built, chatted, coded, firstRun, rendered, logs: logs.slice(0, 200) }, null, 2));
writeFileSync(join(outDir, 'specs.json'), JSON.stringify(built.filter((b) => b.ok).map((b) => b.value.spec).concat(chatted.filter((c) => c.ok && c.value.kind === 'edit').map((c) => c.value.spec)), null, 2));
const md = [`## Engine eval`, '', '| | total | ok | warnings | failed |', '|---|---|---|---|---|', ...Object.entries(summary).map(([k, v]) => `| ${k} | ${v.total} | ${v.ok} | ${v.warn} | ${v.fail} |`)].join('\n');
console.log(`\n${md}`);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n', { flag: 'a' });
await browser.close();
server?.close();
