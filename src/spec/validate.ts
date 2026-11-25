import { ACCENTS, COMPONENT_TYPES, type AppSpec, type SpecComponent } from './types';

const MAX_COMPONENTS = 12;
const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max).trim() : undefined);
const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'field';

/**
 * Pulls the first JSON object out of model output (handles ```json fences and stray prose), and
 * forgives the slips small models make: trailing commas and curly quotes around keys and strings.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The model did not return JSON.');
  const json = body.slice(start, end + 1);
  try {
    return JSON.parse(json);
  } catch (e) {
    const repaired = json.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(repaired);
    } catch {
      throw e;
    }
  }
}

/** Lowercased letters only, so "Yes/No", "yes_no" and "YesNo" all read "yesno". */
const word = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]/g, '') : '');

// What models write, mapped to what the renderer understands.
const KIND_ALIASES: Record<string, SpecComponent['kind']> = {
  number: 'number', numeric: 'number', integer: 'number', int: 'number', float: 'number', decimal: 'number', amount: 'number', quantity: 'number', currency: 'number', money: 'number',
  yesno: 'yesno', boolean: 'yesno', bool: 'yesno', toggle: 'yesno', checkbox: 'yesno', switch: 'yesno',
  rating: 'rating', stars: 'rating', star: 'rating', scale: 'rating', score: 'rating',
  date: 'date', day: 'date', datetime: 'date',
};
const OP_ALIASES: Record<string, SpecComponent['op']> = {
  sum: 'sum', total: 'sum', add: 'sum', avg: 'avg', average: 'avg', mean: 'avg', count: 'count', entries: 'count', number: 'count',
  min: 'min', minimum: 'min', lowest: 'min', max: 'max', maximum: 'max', highest: 'max', best: 'max',
  latest: 'latest', last: 'latest', recent: 'latest', current: 'latest', streak: 'streak', daysinarow: 'streak',
};
const RANGE_ALIASES: Record<string, SpecComponent['range']> = {
  today: 'today', day: 'today', daily: 'today', week: 'week', thisweek: 'week', weekly: 'week', last7days: 'week', '7days': 'week', '7d': 'week',
  all: 'all', alltime: 'all', ever: 'all', total: 'all', overall: 'all',
};

/** A list from an array, or from one string written as "a, b, c" or one per line. */
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*[,\n;]\s*/) : []);

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

  /** A reference to another block's id, written as "calories", "{calories}" or "Calories". */
  const ref = (v: unknown) => (str(v, 40) ? slug(str(v, 40)!) : undefined);

  const components: SpecComponent[] = [];
  for (const c of Array.isArray(r.components) ? r.components : []) {
    if (!c || typeof c !== 'object') continue;
    const comp = c as Record<string, unknown>;
    const type = (typeof comp.type === 'string' ? comp.type.toLowerCase().trim() : comp.type) as SpecComponent['type'];
    // Save and history always fit, so an app at the cap keeps its grouped history.
    if (components.length >= MAX_COMPONENTS && type !== 'save' && type !== 'history') continue;
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
        const kind = KIND_ALIASES[word(comp.kind ?? comp.inputType ?? comp.format)];
        if (kind) out.kind = kind;
        out.multiline = !out.kind && comp.multiline === true;
        if (out.kind === 'number') out.unit = str(comp.unit, 16) || undefined;
        break;
      }
      case 'checklist': {
        // Ticked items are saved as "a, b", so an item can't contain the separator.
        const items = list(comp.options ?? comp.items)
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
        const options = [...new Set(list(comp.options)
          .map((o) => str(o, 40))
          .filter((o): o is string => !!o))]
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
        out.fills = ref(comp.fills);
        out.auto = comp.auto === true || comp.auto === 'true' ? true : undefined;
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
        out.id = uniqueId(str(comp.id) ?? label ?? 'stat');
        out.label = label ?? 'Today';
        out.field = ref(comp.field);
        out.op = OP_ALIASES[word(comp.op)] ?? (out.field ? 'sum' : 'count');
        out.range = RANGE_ALIASES[word(comp.range)] ?? 'today';
        out.unit = str(comp.unit, 16) || undefined;
        break;
      }
      case 'chart': {
        // Bars per day for the last N days.
        const op = OP_ALIASES[word(comp.op)];
        out.id = uniqueId(str(comp.id) ?? label ?? 'chart');
        out.label = label ?? 'Last 7 days';
        out.field = ref(comp.field);
        out.op = op && op !== 'latest' && op !== 'streak' ? op : out.field ? 'sum' : 'count';
        out.days = Math.min(31, Math.max(7, Math.round(Number(comp.days) || 7)));
        out.unit = str(comp.unit, 16) || undefined;
        break;
      }
      case 'save':
      case 'history':
        if (components.some((x) => x.type === type)) continue;
        out.label = label ?? (type === 'save' ? 'Save' : 'History');
        if (type === 'history') {
          if (['day', 'days', 'date', 'daily'].includes(word(comp.groupBy))) out.groupBy = 'day';
          out.total = ref(comp.total);
          if (out.total) out.groupBy = 'day';
        }
        break;
    }
    components.push(out);
  }

  // At most 12 blocks in all (sharing enforces the same limit), counting the save and history
  // blocks added below. Drop static text first, then the last of the other blocks. This runs before
  // references are checked, so nothing can point at a block that was dropped.
  const reserve = (components.some((c) => c.type === 'save') ? 0 : 1) + (components.some((c) => c.type === 'history') ? 0 : 1);
  while (components.length + reserve > MAX_COMPONENTS) {
    let drop = components.map((c) => c.type).lastIndexOf('text');
    if (drop === -1) drop = components.map((c) => c.type).lastIndexOf('heading');
    if (drop === -1) drop = components.findLastIndex((c) => c.type !== 'save' && c.type !== 'history');
    components.splice(drop, 1);
  }

  // Repair references the model got slightly wrong: "{Meal}" or "{meal_description}" for the
  // field "meal", a stat pointing at "kcal" when the field is "calories_kcal", a label for an id.
  let ids = components.filter((c) => c.id).map((c) => ({ id: c.id!, label: c.label ? slug(c.label) : '' }));
  const resolve = (raw: string | undefined): string | undefined => {
    if (!raw) return raw;
    const r = slug(raw);
    if (ids.some((x) => x.id === r)) return r;
    const byLabel = ids.find((x) => x.label === r);
    if (byLabel) return byLabel.id;
    const near = ids.filter((x) => x.id.length > 2 && r.length > 2 && (r.includes(x.id) || x.id.includes(r)));
    return near.length === 1 ? near[0].id : raw;
  };
  const DATA = ['today', 'today_entries', 'entries'];
  const repairPrompts = () => {
    for (const c of components) {
      if ((c.type !== 'ai' && c.type !== 'voice') || !c.prompt) continue;
      c.prompt = c.prompt.replace(/\{\s*([A-Za-z0-9_ -]+?)\s*\}/g, (m, name: string) => {
        const s = slug(name);
        if (DATA.includes(s)) return `{${s}}`;
        const id = resolve(name);
        return id && ids.some((x) => x.id === id) ? `{${id}}` : m;
      });
    }
  };
  for (const c of components) {
    if (c.type === 'stat' || c.type === 'chart') c.field = resolve(c.field);
    if (c.type === 'history') c.total = resolve(c.total);
    if (c.type === 'ai') c.fills = resolve(c.fills);
  }
  repairPrompts();

  // A stat must read a field that exists and gets saved (input, choice or AI result); a count may
  // count entries without one. Anything else would show a number that can never change.
  const savedIds = new Set(
    components
      .filter((c) => c.type === 'input' || c.type === 'choice' || c.type === 'checklist' || c.type === 'ai' || c.type === 'voice')
      .map((c) => c.id),
  );
  // An AI can only fill a field the user could also type into.
  const fillable = new Set(components.filter((c) => c.type === 'input').map((c) => c.id));
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

  // Blocks may have been dropped above; resolve placeholders against what's left.
  ids = components.filter((c) => c.id).map((c) => ({ id: c.id!, label: c.label ? slug(c.label) : '' }));
  repairPrompts();

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
