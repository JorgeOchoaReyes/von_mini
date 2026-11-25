import type { AppSpec, SpecComponent } from './types';

const KIND: Record<SpecComponent['type'], string> = {
  heading: 'heading',
  text: 'text',
  input: 'field',
  choice: 'choice',
  ai: 'AI button',
  stat: 'stat',
  chart: 'chart',
  checklist: 'checklist',
  voice: 'voice chat',
  reminder: 'reminder',
  save: 'save button',
  game: 'game',
  random: 'dice & chance block',
  history: 'history list',
};

const keyOf = (c: SpecComponent, i: number) => c.id ?? `${c.type}#${c.type === 'save' || c.type === 'history' ? 0 : i}`;
const nameOf = (c: SpecComponent) => c.label ?? c.text ?? c.id ?? c.type;

/**
 * Describes what changed between two specs in plain words, computed locally so the
 * summary is always accurate, whatever the model claims it did.
 */
export function describeChanges(before: AppSpec, after: AppSpec): string[] {
  const out: string[] = [];
  if (before.name !== after.name) out.push(`Renamed the app to “${after.name}”.`);
  if (before.emoji !== after.emoji || before.accent !== after.accent) out.push('Updated the look.');
  if (after.code && after.code !== before.code) out.push('Writing a custom version: ' + after.code);
  else if (before.code && !after.code) out.push('Went back to the built-in version.');

  const prev = new Map(before.components.map((c, i) => [keyOf(c, i), c]));
  const next = new Map(after.components.map((c, i) => [keyOf(c, i), c]));

  for (const [k, c] of next) {
    const old = prev.get(k);
    if (!old) {
      out.push(`Added the “${nameOf(c)}” ${KIND[c.type]}.`);
      continue;
    }
    if (old.type !== c.type) out.push(`Turned “${nameOf(old)}” into a ${KIND[c.type]}.`);
    else if ((old.label ?? old.text) !== (c.label ?? c.text)) out.push(`Renamed “${nameOf(old)}” to “${nameOf(c)}”.`);
    if (old.prompt !== c.prompt && c.prompt) out.push(`Changed what “${nameOf(c)}” asks the AI.`);
    if (c.type === 'voice' && old.type === 'voice' && old.text !== c.text) out.push(`Changed how “${nameOf(c)}” opens.`);
    if (c.type === 'reminder' && old.type === 'reminder') {
      if (old.text !== c.text) out.push('Changed the reminder message.');
      if (JSON.stringify(old.times) !== JSON.stringify(c.times)) out.push(`Reminders now at ${(c.times ?? []).join(', ')}.`);
    }
    if (JSON.stringify(old.options) !== JSON.stringify(c.options) && c.options) {
      out.push(`Updated the options for “${nameOf(c)}”.`);
    }
    if (old.kind !== c.kind && c.type === 'input') out.push(`Made “${nameOf(c)}” a ${c.kind ?? 'text'} field.`);
    if (old.fills !== c.fills && c.fills) out.push(`“${nameOf(c)}” now fills in a field.`);
    if ((c.type === 'stat' || c.type === 'chart') && (old.field !== c.field || old.op !== c.op || old.range !== c.range || old.unit !== c.unit)) {
      out.push(`Changed what “${nameOf(c)}” counts.`);
    }
    const same = (keys: (keyof SpecComponent)[]) => keys.every((key) => JSON.stringify(old[key]) === JSON.stringify(c[key]));
    if (c.type === 'game' && !same(['game', 'speed', 'player', 'item'])) out.push(`Changed the game “${nameOf(c)}”.`);
    if (c.type === 'random' && !same(['roll', 'count', 'sides', 'min', 'max'])) out.push(`Changed how “${nameOf(c)}” picks.`);
    if (old.type === c.type && (c.type === 'game' || c.type === 'random') && old.text !== c.text && c.text && (old.label ?? old.text) === (c.label ?? c.text)) {
      out.push(`Changed the description of “${nameOf(c)}”.`);
    }
    if (!!old.multiline !== !!c.multiline) out.push(`Made “${nameOf(c)}” ${c.multiline ? 'multi-line' : 'single-line'}.`);
  }
  for (const [k, c] of prev) if (!next.has(k)) out.push(`Removed the “${nameOf(c)}” ${KIND[c.type]}.`);

  const order = (s: AppSpec) => s.components.map(keyOf).filter((k) => prev.has(k) && next.has(k)).join(',');
  if (!out.length && order(before) !== order(after)) out.push('Reordered the screen.');
  return out;
}
