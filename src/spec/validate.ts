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
      case 'input': {
        out.id = uniqueId(str(comp.id) ?? label ?? 'input');
        out.label = label ?? 'Text';
        out.placeholder = str(comp.placeholder, 120);
        const kind = comp.kind as SpecComponent['kind'];
        if (kind && ['number', 'yesno', 'rating', 'date'].includes(kind)) out.kind = kind;
        out.multiline = !out.kind && comp.multiline === true;
        if (out.kind === 'number') out.unit = str(comp.unit, 16) || undefined;
        break;
      }
      case 'checklist': {
        // Ticked items are saved as "a, b", so an item can't contain the separator.
        const items = (Array.isArray(comp.options) ? comp.options : [])
          .map((o) => str(o, 40)?.replace(/,/g, ' '))
          .filter((o): o is string => !!o)
          .slice(0, 12);
        if (items.length < 1) continue;
        out.id = uniqueId(str(comp.id) ?? label ?? 'checklist');
        out.label = label ?? 'Today';
        out.options = [...new Set(items)];
        break;
      }
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
        // Where the answer goes, and whether it runs by itself on save (checked once ids are known).
        out.fills = str(comp.fills, 40) ? slug(str(comp.fills, 40)!) : undefined;
        out.auto = comp.auto === true ? true : undefined;
        break;
      }
      case 'voice': {
        // A spoken conversation: speech-to-text -> Gemini Nano -> text-to-speech.
        const prompt = str(comp.prompt, 600);
        if (!prompt) continue;
        out.id = uniqueId(str(comp.id) ?? label ?? 'conversation');
        out.label = label ?? 'Talk it through';
        out.prompt = prompt;
        out.text = str(comp.text, 240);
        break;
      }
      case 'reminder': {
        // Daily local notifications. At most one reminder block per app.
        if (components.some((x) => x.type === 'reminder')) continue;
        out.id = uniqueId(str(comp.id) ?? 'reminder');
        out.label = label ?? 'Daily reminders';
        out.text = str(comp.text, 120) || 'Time to check in.';
        out.times = normalizeTimes(comp.times);
        break;
      }
      case 'stat': {
        // A number computed from saved entries; its field is checked once all ids are known.
        const op = comp.op as SpecComponent['op'];
        const range = comp.range as SpecComponent['range'];
        out.id = uniqueId(str(comp.id) ?? label ?? 'stat');
        out.label = label ?? 'Today';
        out.field = str(comp.field, 40) ? slug(str(comp.field, 40)!) : undefined;
        out.op = op && ['sum', 'avg', 'count', 'min', 'max', 'latest', 'streak'].includes(op) ? op : 'sum';
        out.range = range && ['today', 'week', 'all'].includes(range) ? range : 'today';
        out.unit = str(comp.unit, 16) || undefined;
        break;
      }
      case 'chart': {
        // Bars per day for the last N days.
        const op = comp.op as SpecComponent['op'];
        out.id = uniqueId(str(comp.id) ?? label ?? 'chart');
        out.label = label ?? 'Last 7 days';
        out.field = str(comp.field, 40) ? slug(str(comp.field, 40)!) : undefined;
        out.op = op && ['sum', 'avg', 'count', 'max', 'min'].includes(op) ? op : 'sum';
        out.days = Math.min(31, Math.max(7, Math.round(Number(comp.days) || 7)));
        out.unit = str(comp.unit, 16) || undefined;
        break;
      }
      case 'save':
      case 'history':
        if (components.some((x) => x.type === type)) continue;
        out.label = label ?? (type === 'save' ? 'Save' : 'History');
        if (type === 'history') {
          if (comp.groupBy === 'day') out.groupBy = 'day';
          out.total = str(comp.total, 40) ? slug(str(comp.total, 40)!) : undefined;
        }
        break;
    }
    components.push(out);
  }

  // A stat must read a field that exists and gets saved (input, choice or AI result); a count may
  // count entries without one. Anything else would show a number that can never change.
  const savedIds = new Set(
    components
      .filter((c) => c.type === 'input' || c.type === 'choice' || c.type === 'checklist' || c.type === 'ai' || c.type === 'voice')
      .map((c) => c.id),
  );
  // An AI can only fill a field the user could also type into.
  const fillable = new Set(components.filter((c) => c.type === 'input' || c.type === 'choice').map((c) => c.id));
  for (let i = components.length - 1; i >= 0; i--) {
    const c = components[i];
    if (c.type === 'ai') {
      if (c.fills && !fillable.has(c.fills)) c.fills = undefined;
      continue;
    }
    if (c.type === 'history') {
      if (c.total && !savedIds.has(c.total)) c.total = undefined;
      continue;
    }
    if (c.type !== 'stat' && c.type !== 'chart') continue;
    if (c.field && !savedIds.has(c.field)) c.field = undefined;
    // A count or streak can work on entries alone; everything else needs a field to read.
    if (!c.field && c.op !== 'count' && c.op !== 'streak') components.splice(i, 1);
  }

  // A voice conversation or a checklist collects input too, so an app can be built from those alone.
  if (!components.some((c) => c.type === 'input' || c.type === 'choice' || c.type === 'voice' || c.type === 'checklist')) {
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

/**
 * Reminder times as sorted, unique 24-hour "HH:MM" strings (at most 6). Accepts "8:00", "08:00"
 * or "8am"-style input; anything unreadable is dropped, and an empty result becomes 09:00.
 */
export function normalizeTimes(raw: unknown): string[] {
  const list = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : []).map((t) => String(t));
  const out = new Set<string>();
  for (const t of list) {
    const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t.trim());
    if (!m) continue;
    let hour = Number(m[1]);
    const minute = Number(m[2] ?? '0');
    const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && hour < 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) continue;
    out.add(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
  const sorted = [...out].sort().slice(0, 6);
  return sorted.length ? sorted : ['09:00'];
}

const RANK: Record<SpecComponent['type'], number> = {
  heading: 0,
  text: 0,
  // Totals sit at the top, like a dashboard, above the form that feeds them.
  stat: 0.5,
  chart: 0.5,
  input: 1,
  choice: 1,
  checklist: 1,
  ai: 2,
  voice: 2,
  reminder: 3,
  save: 4,
  history: 5,
};

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
