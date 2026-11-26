import { DATA_TOKENS } from './stats';
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
    const repaired = looseRepair(json);
    try {
      return JSON.parse(repaired);
    } catch {
      // Output cut off mid-way (seen in the cloud: "Unterminated string"): close what's open and
      // keep everything before the break. The validator drops the half-written last block.
      try {
        return JSON.parse(closeTruncated(looseRepair(body.slice(start))));
      } catch {
        throw e;
      }
    }
  }
}

/**
 * Fixes slips models make in long JSON, outside strings only: curly quotes, trailing commas,
 * // and /* comments, unquoted or single-quoted keys.
 */
function looseRepair(text: string): string {
  let out = '';
  let inString = false;
  let curly = false; // the open string started with a curly quote
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (curly && ch === '”') {
        out += '"';
        inString = curly = false;
        continue;
      }
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (ch === '“' || ch === '”') {
      out += '"';
      inString = curly = true;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)'([^'"\n]+)'\s*:/g, '$1"$2":')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
}

/** Closes an unfinished JSON text: an open string, then open arrays and objects, in order. */
export function closeTruncated(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafe = 0; // end of the last complete value inside a container
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      lastSafe = i + 1;
      if (!stack.length) return text.slice(0, i + 1);
    } else if (ch === ',') lastSafe = i;
  }
  // Cut back to the last complete element, so no half-written key or value is left dangling.
  let cut = text.slice(0, lastSafe).replace(/,\s*$/, '');
  // Re-count what's still open in the kept part.
  const open: string[] = [];
  inString = false;
  escaped = false;
  for (const ch of cut) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') open.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') open.pop();
  }
  if (inString) cut += '"';
  return cut + open.reverse().join('');
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

// Game names models (and people) use, mapped to the built-in games. Well-known game titles map
// to the original game of the same style.
const GAME_ALIASES: Record<string, SpecComponent['game']> = {
  blocks: 'blocks', block: 'blocks', fallingblocks: 'blocks', tetris: 'blocks', puzzle: 'blocks', stack: 'blocks', stacker: 'blocks', tiles: 'blocks',
  runner: 'runner', lanerunner: 'runner', endlessrunner: 'runner', run: 'runner', dodge: 'runner', dodger: 'runner', subwaysurfers: 'runner', subway: 'runner', racer: 'runner', racing: 'runner', lanes: 'runner',
  snake: 'snake', worm: 'snake',
  flyer: 'flyer', flappy: 'flyer', flappybird: 'flyer', fly: 'flyer', bird: 'flyer', jump: 'flyer', jumper: 'flyer',
  bricks: 'bricks', brickbreaker: 'bricks', breakout: 'bricks', arkanoid: 'bricks', paddle: 'bricks', pong: 'bricks', ball: 'bricks',
  shooter: 'shooter', spaceshooter: 'shooter', spaceinvaders: 'shooter', invaders: 'shooter', galaga: 'shooter', asteroids: 'shooter', shmup: 'shooter', space: 'shooter', aliens: 'shooter',
  catch: 'catch', catcher: 'catch', basket: 'catch', collect: 'catch', fruit: 'catch', falling: 'catch',
  whack: 'whack', whackamole: 'whack', mole: 'whack', tap: 'whack', tapper: 'whack', reflex: 'whack', reaction: 'whack', popup: 'whack',
};
const SPEED_ALIASES: Record<string, SpecComponent['speed']> = {
  slow: 'slow', easy: 'slow', relaxed: 'slow', chill: 'slow', normal: 'normal', medium: 'normal', fast: 'fast', hard: 'fast', quick: 'fast', insane: 'fast',
};
const FROM_KEYS = ['countFrom', 'sidesFrom', 'minFrom', 'maxFrom', 'optionsFrom'] as const;
const ROLL_ALIASES: Record<string, SpecComponent['roll']> = {
  dice: 'dice', die: 'dice', roll: 'dice', d6: 'dice', d20: 'dice', rolldice: 'dice',
  coin: 'coin', flip: 'coin', coinflip: 'coin', headsortails: 'coin', toss: 'coin',
  pick: 'pick', spin: 'pick', spinner: 'pick', wheel: 'pick', choose: 'pick', choice: 'pick', random: 'pick', decide: 'pick', draw: 'pick', card: 'pick',
  number: 'number', range: 'number', integer: 'number', lottery: 'number', randomnumber: 'number',
};
/** A whole number from model output, clamped; `fallback` when it isn't one. */
const int = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

/** A short emoji-ish token for a game sprite: at most 2 user-perceived characters. */
const sprite = (v: unknown) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t || /[a-z0-9]{2,}/i.test(t)) return undefined;
  return [...t].slice(0, 4).join('');
};

/** A list from an array, or from one string written as "a, b, c" or one per line. */
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*[,\n;]\s*/) : []);

/**
 * Turns untrusted model output into a safe, renderable AppSpec.
 * Unknown component types are dropped, ids are normalized and de-duplicated,
 * and missing pieces (save / history) are added so every app is usable.
 */
export function sanitizeSpec(raw: unknown, opts: { rescue?: boolean } = {}): AppSpec {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid app description.');
  const r = raw as Record<string, unknown>;
  // {today}, {entries}… read saved data, so no field may take those names.
  const used = new Set<string>(DATA_TOKENS);
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
      case 'game': {
        // A built-in arcade game; each finished run saves its score as an entry.
        const game = GAME_ALIASES[word(comp.game ?? comp.kind ?? comp.style)];
        if (!game) continue;
        out.id = uniqueId(str(comp.id) ?? label ?? 'game');
        out.label = label ?? 'Play';
        out.game = game;
        out.speed = SPEED_ALIASES[word(comp.speed ?? comp.difficulty)] ?? 'normal';
        out.player = sprite(comp.player);
        out.item = sprite(comp.item);
        out.text = str(comp.text, 120);
        break;
      }
      case 'random': {
        // Dice, a coin, a spinner over options, or a random number. Every result saves as an entry.
        const options = [...new Set(list(comp.options ?? comp.items).map((o) => str(o, 40)).filter((o): o is string => !!o))].slice(0, 20);
        // A setting may come from another field: "countFrom": "dice_count", or "count": "{dice_count}".
        const from = (key: 'count' | 'sides' | 'min' | 'max' | 'options') => {
          const direct = str(comp[`${key}From`], 40);
          const inline = typeof comp[key] === 'string' ? (comp[key] as string).match(/^\s*\{\s*([A-Za-z0-9_ -]+?)\s*\}\s*$/)?.[1] : undefined;
          return direct ?? inline;
        };
        const optionsFrom = from('options');
        const roll = ROLL_ALIASES[word(comp.roll ?? comp.mode ?? comp.style ?? comp.kind)] ?? (options.length >= 2 || optionsFrom ? 'pick' : 'dice');
        if (roll === 'pick' && options.length < 2 && !optionsFrom) continue;
        out.id = uniqueId(str(comp.id) ?? label ?? roll);
        out.label = label ?? { dice: 'Roll', coin: 'Flip a coin', pick: 'Spin', number: 'Pick a number' }[roll!];
        out.roll = roll;
        if (roll === 'dice') {
          out.count = int(comp.count ?? comp.dice, 1, 6, 1);
          out.sides = int(comp.sides ?? comp.faces, 2, 100, 6);
          out.countFrom = from('count');
          out.sidesFrom = from('sides');
        } else if (roll === 'number') {
          const a = int(comp.min, -1_000_000, 1_000_000, 1);
          const b = int(comp.max, -1_000_000, 1_000_000, 100);
          out.min = Math.min(a, b);
          out.max = Math.max(a, b) === Math.min(a, b) ? Math.min(a, b) + 1 : Math.max(a, b);
          out.minFrom = from('min');
          out.maxFrom = from('max');
        } else if (roll === 'pick') {
          // Spinning over a list typed elsewhere: keep a fallback list so it always has something.
          out.options = options.length >= 2 ? options : ['Yes', 'No'];
          out.optionsFrom = optionsFrom;
        }
        out.text = str(comp.text, 120);
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
  const needsSave = components.some((c) => c.type === 'input' || c.type === 'choice' || c.type === 'voice' || c.type === 'checklist');
  const reserve = (!needsSave || components.some((c) => c.type === 'save') ? 0 : 1) + (components.some((c) => c.type === 'history') ? 0 : 1);
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
  const repairPrompts = (final = false) => {
    for (const c of components) {
      if ((c.type !== 'ai' && c.type !== 'voice') || !c.prompt) continue;
      c.prompt = c.prompt.replace(/\{\s*([A-Za-z0-9_ -]+?)\s*\}/g, (m, name: string) => {
        const s = slug(name);
        if (DATA.includes(s)) return `{${s}}`;
        const id = resolve(name);
        if (id && ids.some((x) => x.id === id)) return `{${id}}`;
        // Still pointing at nothing after blocks were settled: say it in words, so the AI never
        // sees a raw "{preset}" and the app doesn't wait on a field that doesn't exist.
        return final ? name.trim().replace(/_/g, ' ') : m;
      });
    }
  };
  for (const c of components) {
    if (c.type === 'stat' || c.type === 'chart') c.field = resolve(c.field);
    if (c.type === 'history') c.total = resolve(c.total);
    if (c.type === 'ai') c.fills = resolve(c.fills);
    if (c.type === 'random') for (const k of FROM_KEYS) if (c[k]) c[k] = resolve(c[k]);
  }
  repairPrompts();

  // A stat must read a field that exists and gets saved (input, choice or AI result); a count may
  // count entries without one. Anything else would show a number that can never change.
  const savedIds = new Set(
    components
      .filter((c) => c.type === 'input' || c.type === 'choice' || c.type === 'checklist' || c.type === 'ai' || c.type === 'voice' || c.type === 'game' || c.type === 'random')
      .map((c) => c.id),
  );
  // A dice & chance block can only take a setting from a field the user sets on this screen.
  const controlIds = new Set(components.filter((c) => c.type === 'input' || c.type === 'choice' || c.type === 'checklist').map((c) => c.id));
  for (const c of components) if (c.type === 'random') for (const k of FROM_KEYS) if (c[k] && !controlIds.has(c[k])) c[k] = undefined;
  // An AI can only fill a field the user could also type into.
  const fillable = new Set(components.filter((c) => c.type === 'input').map((c) => c.id));
  for (let i = components.length - 1; i >= 0; i--) {
    const c = components[i];
    if (c.type === 'ai') {
      if (c.fills && !fillable.has(c.fills)) c.fills = undefined;
      // Never write the answer over the text the AI is reading (a mood tag replacing the journal
      // entry, scaled amounts replacing the recipe): the answer shows under the button instead.
      if (c.fills && new RegExp(`\\{\\s*${c.fills}\\s*\\}`, 'i').test(c.prompt ?? '')) {
        c.fills = undefined;
        c.auto = undefined;
      }
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
  repairPrompts(true);
  // An AI button that reads nothing gives the same generic answer every time ("drink more
  // water"). Ground it in what this person saved, so the answer is about them.
  for (const c of components) {
    if (c.type === 'ai' && c.prompt && !/\{[a-z0-9_]+\}/i.test(c.prompt)) c.prompt = `${c.prompt}\nWhat I saved recently:\n{entries}`;
  }

  // A voice conversation or a checklist collects input too, so an app can be built from those alone.
  if (!components.some((c) => c.type === 'input' || c.type === 'choice' || c.type === 'voice' || c.type === 'checklist' || c.type === 'game' || c.type === 'random')) {
    // A build's last attempt keeps what the model made and adds a place to write, rather than
    // failing: a usable app beats an error. (Chat edits throw, so the turn is retried instead.)
    if (opts.rescue) {
      components.splice(MAX_COMPONENTS - 3, Infinity); // room for the note, save and history
      const id = ids.some((x) => x.id === 'note') ? 'note_2' : 'note';
      components.push({ type: 'input', id, label: 'Note', placeholder: 'Write it down…', multiline: true });
    } else throw new Error('The generated app has no inputs. Try describing it differently.');
  }
  // A game saves its own scores, so a games-only app needs no save button.
  // Fields that only set how a dice & chance block works are controls, not things to save.
  const controls = new Set(components.flatMap((c) => (c.type === 'random' ? FROM_KEYS.map((k) => c[k]).filter(Boolean) : [])));
  const usedElsewhere = (id?: string) =>
    components.some((c) => c.type !== 'random' && (c.field === id || c.total === id || c.fills === id || (c.prompt ?? '').includes(`{${id}}`)));
  const fillable2 = components.some(
    (c) => c.type === 'voice' || ((c.type === 'input' || c.type === 'choice' || c.type === 'checklist') && (!controls.has(c.id) || usedElsewhere(c.id))),
  );
  if (fillable2 && !components.some((c) => c.type === 'save')) components.push({ type: 'save', label: 'Save' });
  // ...and a save button with nothing to fill in could never be pressed.
  if (!fillable2) {
    const at = components.findIndex((c) => c.type === 'save');
    if (at >= 0) components.splice(at, 1);
  }
  if (!components.some((c) => c.type === 'history')) components.push({ type: 'history', label: 'History' });

  const accent = ACCENTS.includes(r.accent as never) ? (r.accent as AppSpec['accent']) : 'violet';
  return {
    name: str(r.name, 40) || 'My App',
    emoji: (str(r.emoji, 8) || '✨').slice(0, 4),
    accent,
    description: str(r.description, 160) ?? '',
    ...(str(r.code, 1000) ? { code: str(r.code, 1000) } : {}),
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
  // A game is the point of its app, so it leads.
  game: 0.4,
  random: 0.4,
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
