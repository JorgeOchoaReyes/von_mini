// The ready-made apps are the first thing everyone opens: each must be a design the engine
// accepts as-is, with every block wired to something real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE, STARTERS } from '../src/spec/starters.ts';
import { sanitizeSpec } from '../src/spec/validate.ts';

const ORDER = ['stat', 'chart', 'heading', 'text', 'input', 'choice', 'checklist', 'random', 'game', 'ai', 'voice', 'reminder', 'save', 'history'];
const DATA_TOKENS = new Set(['today', 'today_entries', 'entries']);

for (const app of STARTERS) {
  const { spec } = app;
  test(`${spec.name}: the validator keeps it exactly as designed`, () => {
    const clean = sanitizeSpec(JSON.parse(JSON.stringify(spec)));
    assert.equal(clean.components.length, spec.components.length, 'no block dropped');
    assert.deepEqual(
      clean.components.map((c) => [c.type, c.id ?? null]),
      spec.components.map((c) => [c.type, c.id ?? null]),
    );
    assert.equal(clean.name, spec.name);
  });

  test(`${spec.name}: every block is wired to something real`, () => {
    const ids = new Set(spec.components.map((c) => c.id).filter(Boolean));
    const fields = new Set(spec.components.filter((c) => ['input', 'choice', 'checklist', 'ai', 'game', 'random', 'voice'].includes(c.type)).map((c) => c.id));
    assert.ok(spec.components.length >= 3 && spec.components.length <= 12, `${spec.components.length} blocks`);
    assert.equal(ids.size, spec.components.filter((c) => c.id).length, 'ids are unique');
    for (const c of spec.components) {
      for (const [, ref] of (c.prompt ?? '').matchAll(/\{([a-z0-9_]+)\}/g)) assert.ok(fields.has(ref) || DATA_TOKENS.has(ref), `${c.id} reads unknown {${ref}}`);
      if (c.type === 'ai') assert.match(c.prompt ?? '', /\{[a-z0-9_]+\}/, `${c.id} reads nothing`);
      if ((c.type === 'stat' || c.type === 'chart') && c.field) assert.ok(fields.has(c.field), `${c.id} reads missing ${c.field}`);
      if (c.type === 'history' && c.total) assert.ok(fields.has(c.total), `history totals missing ${c.total}`);
      if (c.fills) assert.ok(fields.has(c.fills) && !(c.prompt ?? '').includes(`{${c.fills}}`), `${c.id} fills ${c.fills}`);
      if (c.type === 'reminder') for (const t of c.times ?? []) assert.match(t, /^([01]\d|2[0-3]):[0-5]\d$/);
    }
    // A chart or average of a rating only makes sense if the rating is saved.
    const saves = spec.components.some((c) => c.type === 'save' || c.type === 'game' || c.type === 'random');
    assert.ok(saves, 'something saves entries');
  });

  test(`${spec.name}: blocks follow the screen order (stats first, save and history last)`, () => {
    const rank = spec.components.map((c) => ORDER.indexOf(c.type));
    const save = spec.components.findIndex((c) => c.type === 'save');
    const history = spec.components.findIndex((c) => c.type === 'history');
    if (save >= 0) assert.ok(save >= spec.components.length - 2, 'save near the end');
    if (history >= 0) assert.equal(history, spec.components.length - 1, 'history last');
    // Games open with the game itself; everything else opens with its stats and charts.
    const lead = spec.components[0].type === 'game' ? 1 : 0;
    const stats = spec.components.filter((c) => c.type === 'stat' || c.type === 'chart').length;
    assert.ok(rank.slice(lead, lead + stats).every((r) => r <= 1), 'stats and charts first');
  });

  test(`${spec.name}: polished copy`, () => {
    assert.ok(spec.name.split(' ').length <= 3);
    assert.ok(spec.description.split(' ').length <= 12, `"${spec.description}" is long`);
    assert.ok(spec.emoji && spec.accent);
  });
}

test('every arcade game tracks its best score over time', () => {
  for (const app of ARCADE) {
    const game = app.spec.components.find((c) => c.type === 'game');
    assert.ok(game, app.spec.name);
    assert.ok(app.spec.components.some((c) => c.type === 'stat' && c.field === game.id && c.op === 'max'));
    assert.ok(app.spec.components.some((c) => c.type === 'chart' && c.field === game.id));
  }
});

test('ids of ready-made apps are unique', () => {
  const ids = STARTERS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});
