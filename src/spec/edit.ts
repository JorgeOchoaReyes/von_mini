/**
 * Direct manipulation of an AppSpec.
 *
 * Because an app is a small JSON document rather than generated code, most edits do not need a
 * model at all: renaming a field, adding a rating, reordering the screen or changing an AI
 * instruction is a pure function over the spec. These run instantly, work with no network and no
 * Gemini Nano, and are always exactly what the user asked for — unlike a model round-trip, which
 * can silently change something else.
 *
 * The AI is still used for changes expressed in words ("make this kinder"); these functions back
 * the tap-to-edit UI and the quick-edit chips.
 */
import { DATA_TOKENS, type StatOp, type StatRange } from './stats';
import { ACCENTS, COMPONENT_TYPES, type Accent, type AppSpec, type ComponentType, type InputKind, type SpecComponent } from './types';
import { normalizeLayout, normalizeTimes } from './validate';

export const componentTitle = (c: SpecComponent, index: number) =>
  c.label ?? c.text ?? c.id ?? `${c.type} ${index + 1}`;

const clone = (spec: AppSpec): AppSpec => ({ ...spec, components: spec.components.map((c) => ({ ...c })) });

/** Re-applies the canonical layout order after a structural change. */
const settle = (spec: AppSpec): AppSpec => ({ ...spec, components: normalizeLayout(spec.components) });

const uniqueId = (spec: AppSpec, base: string) => {
  const used = new Set<string>([...DATA_TOKENS, ...(spec.components.map((c) => c.id).filter(Boolean) as string[])]);
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'field';
  let id = slug;
  for (let i = 2; used.has(id); i++) id = `${slug}_${i}`;
  return id;
};

/** Finds a component by its stable position in the spec (ids are unique for field-ish types). */
export function findIndex(spec: AppSpec, key: string): number {
  const byId = spec.components.findIndex((c) => c.id === key);
  if (byId >= 0) return byId;
  return spec.components.findIndex((c, i) => `${c.type}#${i}` === key);
}

export function componentKey(c: SpecComponent, i: number): string {
  return c.id ?? `${c.type}#${i}`;
}

export function setLabel(spec: AppSpec, index: number, label: string): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c) return spec;
  const trimmed = label.trim().slice(0, 80);
  if (c.type === 'heading' || c.type === 'text') c.text = trimmed || c.text;
  else c.label = trimmed || c.label;
  return next;
}

export function setText(spec: AppSpec, index: number, text: string): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || (c.type !== 'heading' && c.type !== 'text' && c.type !== 'voice' && c.type !== 'reminder')) return spec;
  // A voice chat's opening line may be cleared (the user then speaks first).
  if (c.type === 'voice') c.text = text.trim().slice(0, 240) || undefined;
  else if (c.type === 'reminder') c.text = text.trim().slice(0, 120) || c.text;
  else c.text = text.trim().slice(0, 400) || c.text;
  return next;
}

/** Sets a reminder block's daily times from free text like "8:00, 1pm, 19:30". */
export function setTimes(spec: AppSpec, index: number, raw: string): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || c.type !== 'reminder') return spec;
  c.times = normalizeTimes(raw);
  return next;
}

export function setPrompt(spec: AppSpec, index: number, prompt: string): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || (c.type !== 'ai' && c.type !== 'voice')) return spec;
  c.prompt = prompt.trim().slice(0, 600) || c.prompt;
  return next;
}

export function setPlaceholder(spec: AppSpec, index: number, placeholder: string): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || c.type !== 'input') return spec;
  c.placeholder = placeholder.trim().slice(0, 120) || undefined;
  return next;
}

export function setOptions(spec: AppSpec, index: number, options: string[]): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || (c.type !== 'choice' && c.type !== 'checklist' && c.type !== 'random')) return spec;
  // Checklist items are saved joined by ", ", so an item can't contain a comma.
  const clean = [...new Set(options.map((o) => (c.type === 'checklist' ? o.replace(/,/g, ' ') : o).trim().slice(0, 40)).filter(Boolean))];
  if (clean.length < (c.type === 'choice' ? 2 : 1)) return spec;
  if (c.type === 'random' && clean.length < 2) return spec;
  c.options = clean.slice(0, c.type === 'choice' ? 8 : c.type === 'random' ? 20 : 12);
  return next;
}

/** Changes what kind of value a field holds (text, number, yes/no, rating, date). */
export function setKind(spec: AppSpec, index: number, kind: InputKind): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || c.type !== 'input') return spec;
  c.kind = kind === 'text' ? undefined : kind;
  if (kind !== 'text') c.multiline = undefined;
  if (kind !== 'number') c.unit = undefined;
  return next;
}

export function setUnit(spec: AppSpec, index: number, unit: string): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || !(c.type === 'input' || c.type === 'stat' || c.type === 'chart')) return spec;
  c.unit = unit.trim().slice(0, 12) || undefined;
  return next;
}

/** Points a stat or chart at a field and says how to count it. */
export function setStat(spec: AppSpec, index: number, patch: { field?: string; op?: StatOp; range?: StatRange }): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || (c.type !== 'stat' && c.type !== 'chart')) return spec;
  if (patch.field !== undefined) c.field = patch.field || undefined;
  if (patch.op) c.op = c.type === 'chart' && (patch.op === 'latest' || patch.op === 'streak') ? 'sum' : patch.op;
  if (patch.range && c.type === 'stat') c.range = patch.range;
  return next;
}

/** Sets which field an AI button writes its answer into, and whether it runs on save. */
export function setAiFill(spec: AppSpec, index: number, patch: { fills?: string; auto?: boolean }): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || c.type !== 'ai') return spec;
  if (patch.fills !== undefined) c.fills = patch.fills || undefined;
  if (patch.auto !== undefined) c.auto = patch.auto || undefined;
  return next;
}

/** Changes a game block's game, speed or emoji. */
export function setGame(
  spec: AppSpec,
  index: number,
  patch: { game?: SpecComponent['game']; speed?: SpecComponent['speed']; player?: string; item?: string },
): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || c.type !== 'game') return spec;
  if (patch.game) {
    c.game = patch.game;
    // Each game has its own default characters; keep custom ones only for the same game.
    c.player = undefined;
    c.item = undefined;
  }
  if (patch.speed) c.speed = patch.speed;
  if (patch.player !== undefined) c.player = [...patch.player.trim()].slice(0, 4).join('') || undefined;
  if (patch.item !== undefined) c.item = [...patch.item.trim()].slice(0, 4).join('') || undefined;
  return next;
}

/** Changes how a dice & chance block picks: what it rolls, how many dice, their sides, a range. */
export function setRandom(
  spec: AppSpec,
  index: number,
  patch: { roll?: SpecComponent['roll']; count?: number; sides?: number; min?: number; max?: number },
): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || c.type !== 'random') return spec;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
  if (patch.roll) {
    c.roll = patch.roll;
    if (patch.roll === 'dice') {
      c.count ??= 1;
      c.sides ??= 6;
    }
    if (patch.roll === 'number') {
      c.min ??= 1;
      c.max ??= 100;
    }
    if (patch.roll === 'pick' && (c.options?.length ?? 0) < 2) c.options = ['Yes', 'No', 'Maybe'];
  }
  if (patch.count !== undefined && Number.isFinite(patch.count)) c.count = clamp(patch.count, 1, 6);
  if (patch.sides !== undefined && Number.isFinite(patch.sides)) c.sides = clamp(patch.sides, 2, 100);
  if (patch.min !== undefined && Number.isFinite(patch.min)) c.min = Math.round(patch.min);
  if (patch.max !== undefined && Number.isFinite(patch.max)) c.max = Math.round(patch.max);
  if (c.min !== undefined && c.max !== undefined && c.min >= c.max) c.max = c.min + 1;
  return next;
}

/** Groups history by day, optionally totalling a field on each day. */
export function setHistoryDays(spec: AppSpec, index: number, patch: { byDay?: boolean; total?: string }): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || c.type !== 'history') return spec;
  if (patch.byDay !== undefined) c.groupBy = patch.byDay ? 'day' : undefined;
  if (patch.total !== undefined) c.total = patch.total || undefined;
  if (c.total) c.groupBy = 'day';
  return next;
}

export function toggleMultiline(spec: AppSpec, index: number): AppSpec {
  const next = clone(spec);
  const c = next.components[index];
  if (!c || c.type !== 'input') return spec;
  c.multiline = !c.multiline;
  return next;
}

export function removeComponent(spec: AppSpec, index: number): AppSpec {
  const next = clone(spec);
  if (!next.components[index]) return spec;
  const [gone] = next.components.splice(index, 1);
  const id = gone.id;
  if (!id) return next;
  // Nothing may keep pointing at the removed block: an AI that filled it, a stat or chart that
  // counted it (it falls back to counting entries), or a history total.
  for (const c of next.components) {
    if (c.fills === id) delete c.fills;
    if (c.total === id) delete c.total;
    if (c.field === id) {
      delete c.field;
      if (c.type === 'stat' || c.type === 'chart') c.op = 'count';
    }
  }
  return pruneTemplates(next);
}

/** Moves a component one slot up or down among its layout group. */
export function moveComponent(spec: AppSpec, index: number, direction: -1 | 1): AppSpec {
  const next = clone(spec);
  const target = index + direction;
  if (!next.components[index] || !next.components[target]) return spec;
  [next.components[index], next.components[target]] = [next.components[target], next.components[index]];
  return next;
}

/** Adds a component, letting `normalizeLayout` decide where it lands in the reading order. */
export function addComponent(spec: AppSpec, type: ComponentType): AppSpec {
  if (!COMPONENT_TYPES.includes(type)) return spec;
  const next = clone(spec);
  if (next.components.length >= 12) return spec;
  if ((type === 'save' || type === 'history' || type === 'reminder') && next.components.some((c) => c.type === type)) {
    return spec;
  }

  switch (type) {
    case 'input':
      next.components.push({ type, id: uniqueId(next, 'new_field'), label: 'New field', placeholder: '…' });
      break;
    case 'choice':
      next.components.push({ type, id: uniqueId(next, 'new_choice'), label: 'Choose one', options: ['Yes', 'No'] });
      break;
    case 'ai':
      next.components.push({
        type,
        id: uniqueId(next, 'new_action'),
        label: 'Ask AI',
        prompt: 'Help me with this: {new_field}',
      });
      break;
    case 'voice':
      next.components.push({
        type,
        id: uniqueId(next, 'conversation'),
        label: 'Talk it through',
        prompt: 'You are a warm, curious coach. Help the user think out loud about what they typed.',
        text: 'Hi! What would you like to talk through?',
      });
      break;
    case 'reminder':
      next.components.push({
        type,
        id: uniqueId(next, 'reminder'),
        label: 'Daily reminders',
        text: `Time to open ${next.name}.`,
        times: ['09:00', '20:00'],
      });
      break;
    case 'checklist':
      next.components.push({ type, id: uniqueId(next, 'checklist'), label: 'Today', options: ['First thing', 'Second thing', 'Third thing'] });
      break;
    case 'stat':
    case 'chart': {
      const num = next.components.find((c) => c.type === 'input' && c.kind === 'number');
      next.components.push(
        num
          ? { type, id: uniqueId(next, type), label: type === 'stat' ? `${num.label} today` : `${num.label} per day`, field: num.id, op: 'sum', range: type === 'stat' ? 'today' : undefined, days: type === 'chart' ? 7 : undefined, unit: num.unit }
          : { type, id: uniqueId(next, type), label: type === 'stat' ? 'Entries today' : 'Entries per day', op: 'count', range: type === 'stat' ? 'today' : undefined, days: type === 'chart' ? 7 : undefined },
      );
      break;
    }
    case 'game':
      next.components.push({ type, id: uniqueId(next, 'game'), label: 'Lane Dash', game: 'runner', speed: 'normal' });
      break;
    case 'random':
      next.components.push({ type, id: uniqueId(next, 'roll'), label: 'Roll', roll: 'dice', count: 1, sides: 6 });
      break;
    case 'heading':
      next.components.push({ type, text: 'New heading' });
      break;
    case 'text':
      next.components.push({ type, text: 'Some helpful context.' });
      break;
    default:
      next.components.push({ type, label: type === 'save' ? 'Save' : 'History' });
  }
  return settle(next);
}

export function setAccent(spec: AppSpec, accent: Accent): AppSpec {
  if (!ACCENTS.includes(accent)) return spec;
  return { ...spec, accent };
}

export function setName(spec: AppSpec, name: string): AppSpec {
  const trimmed = name.trim().slice(0, 40);
  return trimmed ? { ...spec, name: trimmed } : spec;
}

export function setEmoji(spec: AppSpec, emoji: string): AppSpec {
  const trimmed = [...emoji.trim()].slice(0, 2).join('');
  return trimmed ? { ...spec, emoji: trimmed } : spec;
}

export function setDescription(spec: AppSpec, description: string): AppSpec {
  return { ...spec, description: description.trim().slice(0, 160) };
}

/** Keeps a template's `{field}` placeholders pointing at fields that still exist. */
export function pruneTemplates(spec: AppSpec): AppSpec {
  const ids = new Set<string>([...DATA_TOKENS, ...(spec.components.map((c) => c.id).filter(Boolean) as string[])]);
  return {
    ...spec,
    components: spec.components.map((c) =>
      (c.type === 'ai' || c.type === 'voice') && c.prompt
        ? { ...c, prompt: c.prompt.replace(/\{([a-z0-9_]+)\}/gi, (m, id: string) => (ids.has(id) ? m : '')) }
        : c,
    ),
  };
}

export interface QuickEdit {
  label: string;
  apply(spec: AppSpec): AppSpec;
}

/**
 * Contextual suggestions, derived from what the spec currently contains, so the chips a user
 * sees are always relevant to *their* app rather than a fixed list.
 */
export function quickEdits(spec: AppSpec): QuickEdit[] {
  const out: QuickEdit[] = [];
  const has = (t: SpecComponent['type']) => spec.components.some((c) => c.type === t);
  const inputs = spec.components.filter((c) => c.type === 'input');
  const addField = (label: string, fieldLabel: string, placeholder: string, multiline = false): QuickEdit => ({
    label,
    apply: (s) => {
      const next = clone(s);
      next.components.push({ type: 'input', id: uniqueId(next, fieldLabel), label: fieldLabel, placeholder, multiline });
      return settle(next);
    },
  });

  if (!spec.components.some((c) => c.type === 'choice')) {
    out.push({
      label: 'Add a rating',
      apply: (s) => {
        const next = clone(s);
        next.components.push({ type: 'choice', id: uniqueId(next, 'rating'), label: 'How was it?', options: ['Great', 'Okay', 'Not great'] });
        return settle(next);
      },
    });
  }
  if (!inputs.some((c) => /date|when|day/i.test(c.label ?? ''))) out.push(addField('Add a date field', 'Date', 'Today'));
  if (!has('heading')) {
    out.push({
      label: 'Add a heading',
      apply: (s) => settle({ ...s, components: [...s.components, { type: 'heading', text: s.name }] }),
    });
  }
  if (inputs.length === 1 && !inputs[0].multiline) {
    out.push({
      label: 'Make the note longer',
      apply: (s) => {
        const i = s.components.findIndex((c) => c.type === 'input');
        return i < 0 ? s : toggleMultiline(s, i);
      },
    });
  }
  const ai = spec.components.find((c) => c.type === 'ai');
  if (ai) {
    out.push({
      label: 'Make AI answers shorter',
      apply: (s) => ({
        ...s,
        components: s.components.map((c) =>
          c.type === 'ai' && c.prompt && !/two sentences|short/i.test(c.prompt)
            ? { ...c, prompt: `${c.prompt} Keep the answer to two short sentences.` }
            : c,
        ),
      }),
    });
  }
  if (!has('reminder') && spec.components.length < 12) {
    out.push({ label: 'Add daily reminders', apply: (s) => addComponent(s, 'reminder') });
  }
  if (!has('voice') && spec.components.length < 12) {
    out.push({ label: 'Add a voice chat', apply: (s) => addComponent(s, 'voice') });
  }
  const partner = ACCENTS.find((a) => a !== spec.accent);
  if (partner) out.push({ label: 'Change the colour', apply: (s) => setAccent(s, partner) });

  // Adding chips are hidden once an app has the most blocks it can hold, and never overfill it.
  const full = spec.components.length >= 12;
  return out
    .filter((e) => !(full && e.label.startsWith('Add ')))
    .map((e) => (e.label.startsWith('Add ') ? { ...e, apply: (s: AppSpec) => (s.components.length >= 12 ? s : e.apply(s)) } : e))
    .slice(0, 5);
}
