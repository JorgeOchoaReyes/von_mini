import { ACCENTS, COMPONENT_TYPES, type AppSpec, type SpecComponent } from './types';

const MAX_COMPONENTS = 12;
const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'field';

/** Pulls the first JSON object out of model output (handles ```json fences and stray prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The model did not return JSON.');
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Turns untrusted model output into a safe, renderable AppSpec.
 * Unknown component types are dropped, ids are normalized and de-duplicated,
 * and missing pieces (save / history) are added so every app is usable.
 */
export function sanitizeSpec(raw: unknown): AppSpec {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid app description.');
  const r = raw as Record<string, unknown>;
  const used = new Set<string>();
  const uniqueId = (base: string) => {
    let id = slug(base);
    for (let i = 2; used.has(id); i++) id = `${slug(base)}_${i}`;
    used.add(id);
    return id;
  };

  const components: SpecComponent[] = [];
  for (const c of Array.isArray(r.components) ? r.components : []) {
    if (!c || typeof c !== 'object' || components.length >= MAX_COMPONENTS) continue;
    const comp = c as Record<string, unknown>;
    const type = comp.type as SpecComponent['type'];
    if (!COMPONENT_TYPES.includes(type)) continue;
    const label = str(comp.label, 80);
    const out: SpecComponent = { type };
    switch (type) {
      case 'heading':
      case 'text': {
        const text = str(comp.text) ?? label;
        if (!text) continue;
        out.text = text;
        break;
      }
      case 'input':
        out.id = uniqueId(str(comp.id) ?? label ?? 'input');
        out.label = label ?? 'Text';
        out.placeholder = str(comp.placeholder, 120);
        out.multiline = comp.multiline === true;
        break;
      case 'choice': {
        const options = (Array.isArray(comp.options) ? comp.options : [])
          .map((o) => str(o, 40))
          .filter((o): o is string => !!o)
          .slice(0, 8);
        if (options.length < 2) continue;
        out.id = uniqueId(str(comp.id) ?? label ?? 'choice');
        out.label = label ?? 'Choose one';
        out.options = options;
        break;
      }
      case 'ai': {
        const prompt = str(comp.prompt, 600);
        if (!prompt) continue;
        out.id = uniqueId(str(comp.id) ?? label ?? 'result');
        out.label = label ?? 'Ask AI';
        out.prompt = prompt;
        break;
      }
      case 'save':
      case 'history':
        if (components.some((x) => x.type === type)) continue;
        out.label = label ?? (type === 'save' ? 'Save' : 'History');
        break;
    }
    components.push(out);
  }

  if (!components.some((c) => c.type === 'input' || c.type === 'choice')) {
    throw new Error('The generated app has no inputs. Try describing it differently.');
  }
  if (!components.some((c) => c.type === 'save')) components.push({ type: 'save', label: 'Save' });
  if (!components.some((c) => c.type === 'history')) components.push({ type: 'history', label: 'History' });

  const accent = ACCENTS.includes(r.accent as never) ? (r.accent as AppSpec['accent']) : 'violet';
  return {
    name: str(r.name, 40) || 'My App',
    emoji: (str(r.emoji, 8) || '✨').slice(0, 4),
    accent,
    description: str(r.description, 160) ?? '',
    components: normalizeLayout(components),
  };
}

const RANK: Record<SpecComponent['type'], number> = { heading: 0, text: 0, input: 1, choice: 1, ai: 2, save: 3, history: 4 };

/**
 * Enforces a predictable, good-looking layout whatever order the model used:
 * intro text, then the form, then AI actions, then save, then history.
 * The sort is stable, so the model's order is kept within each group.
 */
export function normalizeLayout(components: SpecComponent[]): SpecComponent[] {
  return components
    .map((c, i) => ({ c, i }))
    .sort((a, b) => RANK[a.c.type] - RANK[b.c.type] || a.i - b.i)
    .map(({ c }) => c);
}

/** Replaces {field_id} placeholders with current values. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (_, id: string) => values[id]?.trim() || '(empty)');
}
