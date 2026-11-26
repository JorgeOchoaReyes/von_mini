// The app engine's safety nets: what it repairs in a design or a custom app before anyone sees it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSpec } from '../src/spec/validate.ts';
import { stripExternal } from '../src/ai/htmlSafety.ts';

test('an AI button that reads nothing is grounded in what was saved', () => {
  const spec = sanitizeSpec({
    name: 'Water Log',
    emoji: '💧',
    accent: 'blue',
    description: 'Drink enough water.',
    components: [
      { type: 'input', id: 'glasses', label: 'Glasses', kind: 'number' },
      { type: 'ai', id: 'tip', label: 'Hydration tip', prompt: 'Give one short hydration tip.' },
      { type: 'save', label: 'Save' },
      { type: 'history', label: 'Log' },
    ],
  });
  const tip = spec.components.find((c) => c.id === 'tip');
  assert.match(tip.prompt, /\{entries\}/);
  assert.match(tip.prompt, /^Give one short hydration tip\./);
});

test('an AI button that already reads a field is left alone', () => {
  const spec = sanitizeSpec({
    name: 'Mood',
    emoji: '😊',
    accent: 'violet',
    description: 'Journal.',
    components: [
      { type: 'input', id: 'entry', label: 'Entry', multiline: true },
      { type: 'ai', id: 'tag', label: 'Tag', prompt: 'One word for the mood: {entry}' },
      { type: 'save', label: 'Save' },
    ],
  });
  assert.equal(spec.components.find((c) => c.id === 'tag').prompt, 'One word for the mood: {entry}');
});

test('custom apps lose any link to the internet, and keep everything else', () => {
  const html = `<!doctype html><html><head>
<link rel="stylesheet" href="https://vonmini.github.io/ui/style.css">
<link rel="preconnect" href="//fonts.example.com">
<style>@import url("https://fonts.example.com/css?family=X"); .a{color:var(--vm-text)}</style>
<script src="https://cdn.example.com/lib.js"></script>
</head><body><svg xmlns="http://www.w3.org/2000/svg"></svg><script>document.body.dataset.ok = 1</script></body></html>`;
  const out = stripExternal(html);
  assert.doesNotMatch(out, /vonmini\.github\.io|fonts\.example|cdn\.example/);
  assert.match(out, /\.a\{color:var\(--vm-text\)\}/);
  assert.match(out, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, 'namespaces are not resources');
  assert.match(out, /<script>document\.body\.dataset\.ok = 1<\/script>/);
});

test('custom apps use the theme fonts, and canvas text keeps its own', async () => {
  const { themeFonts } = await import('../src/ai/htmlSafety.ts');
  const html = `<style>body{font-family: Arial, sans-serif; color: var(--vm-text)} h1{font-family: var(--vm-display); font-size: 2em}</style>
<div style="font-family: 'Comic Sans MS'; padding: 4px">x</div><script>ctx.font = '20px Arial'; el.style.fontFamily = 'Arial';</script>`;
  const out = themeFonts(html);
  assert.doesNotMatch(out, /font-family:\s*Arial|Comic Sans/);
  assert.match(out, /font-family: var\(--vm-display\)/);
  assert.match(out, /color: var\(--vm-text\)/);
  assert.match(out, /padding: 4px/);
  assert.match(out, /ctx\.font = '20px Arial'/, 'script is untouched');
});
