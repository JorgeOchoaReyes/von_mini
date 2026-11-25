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
import { ACCENTS, COMPONENT_TYPES, type Accent, type AppSpec, type ComponentType, type SpecComponent } from './types';
import { normalizeLayout, normalizeTimes } from './validate';

export const componentTitle = (c: SpecComponent, index: number) =>
  c.label ?? c.text ?? c.id ?? `${c.type} ${index + 1}`;

const clone = (spec: AppSpec): AppSpec => ({ ...spec, components: spec.components.map((c) => ({ ...c })) });

/** Re-applies the canonical layout order after a structural change. */
const settle = (spec: AppSpec): AppSpec => ({ ...spec, components: normalizeLayout(spec.components) });

const uniqueId = (spec: AppSpec, base: string) => {
  const used = new Set(spec.components.map((c) => c.id).filter(Boolean) as string[]);
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
  if (!c || c.type !== 'choice') return spec;
  const clean = options.map((o) => o.trim().slice(0, 40)).filter(Boolean);
  if (clean.length < 2) return spec;
  c.options = clean.slice(0, 8);
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
  next.components.splice(index, 1);
  return next;
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
  const ids = new Set(spec.components.map((c) => c.id).filter(Boolean) as string[]);
  return {
    ...spec,
    components: spec.components.map((c) =>
      c.type === 'ai' && c.prompt
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

  return out.slice(0, 5);
}
