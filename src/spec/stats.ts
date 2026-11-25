/**
 * Saved data, made usable inside an app:
 *
 * - `stat` blocks: a live number computed from saved entries ("Calories today: 1,450"). The value
 *   of a field is the first number in its saved text, so an AI estimate like "≈ 520 kcal, mostly
 *   from the eggs" counts as 520.
 * - prompt placeholders for AI buttons and voice: {today}, {today_entries} and {entries} insert the
 *   date and the saved entries as plain lines, so an AI button can total or review past data.
 */
import type { Entry } from '../storage/store';
import type { SpecComponent } from './types';

export const STAT_OPS = ['sum', 'avg', 'count', 'min', 'max', 'latest', 'streak'] as const;
export type StatOp = (typeof STAT_OPS)[number];
export const STAT_RANGES = ['today', 'week', 'all'] as const;
export type StatRange = (typeof STAT_RANGES)[number];

/** Placeholders that read saved data rather than a field. */
export const DATA_TOKENS = ['today', 'today_entries', 'entries'] as const;

export const OP_LABEL: Record<StatOp, string> = {
  sum: 'Total',
  avg: 'Average',
  count: 'Count',
  min: 'Lowest',
  max: 'Highest',
  latest: 'Latest',
  streak: 'Streak',
};
export const RANGE_LABEL: Record<StatRange, string> = { today: 'today', week: 'last 7 days', all: 'all time' };

/**
 * First number in a text: "1,450 kcal" -> 1450, "≈ 3.5 h" -> 3.5, "$12.40" -> 12.4, and a decimal
 * comma as typed on many keyboards: "12,5" -> 12.5.
 */
export function firstNumber(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const raw = m[0];
  // "1,450" (groups of three) is thousands; "12,5" or "3,75" is a decimal comma.
  const n = Number(/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw) ? raw.replace(/,/g, '') : raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Checklist values are saved as "item, item"; each ticked item counts as one. */
export const CHECK_SEP = ', ';
export const checklistCount = (v: string | undefined) => (v?.trim() ? v.split(CHECK_SEP).filter(Boolean).length : 0);

/**
 * The number an entry holds for a field: ticked items for a checklist, otherwise the first number
 * in the saved text ("Yes" counts as 1 and "No" as 0, so yes/no fields can be summed).
 */
export function entryNumber(e: Entry, field: string | undefined, checklist = false): number | null {
  if (!field) return null;
  const v = e.values[field];
  if (checklist) return v === undefined ? null : checklistCount(v);
  if (/^\s*yes\s*$/i.test(v ?? '')) return 1;
  if (/^\s*no\s*$/i.test(v ?? '')) return 0;
  return firstNumber(v);
}

/** Days in a row, ending today (or yesterday, until today is logged), with a qualifying entry. */
export function streak(entries: Entry[], field: string | undefined, now = Date.now()): number {
  const days = new Set(entries.filter((e) => !field || e.values[field]?.trim()).map((e) => startOfDay(e.at)));
  let day = startOfDay(now);
  if (!days.has(day)) day -= DAY;
  let n = 0;
  while (days.has(day)) {
    n++;
    day -= DAY;
  }
  return n;
}

/** "week" is the last 7 calendar days including today, the same days a 7-day chart shows. */
export function inRange(at: number, range: StatRange, now = Date.now()): boolean {
  if (range === 'today') return sameDay(at, now);
  if (range === 'week') return at >= startOfDay(now) - 6 * DAY && at <= now + DAY;
  return true;
}

/** Computes a stat over saved entries (newest first). `value` is null when there's nothing yet. */
export function computeStat(
  c: SpecComponent,
  entries: Entry[],
  now = Date.now(),
  checklist = false,
): { value: number | null; n: number } {
  const op = (c.op ?? 'sum') as StatOp;
  const range = (c.range ?? 'today') as StatRange;
  if (op === 'streak') {
    const n = streak(entries, c.field, now);
    return { value: n, n };
  }
  const scoped = entries.filter((e) => inRange(e.at, range, now));
  if (op === 'count') {
    const n = c.field ? scoped.filter((e) => e.values[c.field!]?.trim()).length : scoped.length;
    return { value: n, n };
  }
  // Newest first, whatever order the caller passed, so "latest" is the most recent value.
  const nums = [...scoped]
    .sort((a, b) => b.at - a.at)
    .map((e) => entryNumber(e, c.field, checklist))
    .filter((x): x is number => x !== null);
  if (!nums.length) return { value: null, n: 0 };
  const value =
    op === 'sum'
      ? nums.reduce((a, b) => a + b, 0)
      : op === 'avg'
        ? nums.reduce((a, b) => a + b, 0) / nums.length
        : op === 'min'
          ? Math.min(...nums)
          : op === 'max'
            ? Math.max(...nums)
            : nums[0];
  return { value, n: nums.length };
}

/** One value per day for the last `days` days, oldest first, for charts. */
export function daySeries(
  c: SpecComponent,
  entries: Entry[],
  days: number,
  now = Date.now(),
  checklist = false,
): { day: number; value: number | null }[] {
  const op = (c.op ?? 'sum') as StatOp;
  const today = startOfDay(now);
  return Array.from({ length: days }, (_, i) => {
    const day = today - (days - 1 - i) * DAY;
    const inDay = entries.filter((e) => startOfDay(e.at) === day);
    if (op === 'count' || !c.field) return { day, value: inDay.length || null };
    const nums = inDay.map((e) => entryNumber(e, c.field, checklist)).filter((x): x is number => x !== null);
    if (!nums.length) return { day, value: null };
    const sum = nums.reduce((a, b) => a + b, 0);
    const value = op === 'avg' ? sum / nums.length : op === 'max' ? Math.max(...nums) : op === 'min' ? Math.min(...nums) : sum;
    return { day, value };
  });
}

/** Total of a field for one day, for history day headers. */
export function dayTotal(entries: Entry[], field: string, checklist = false): number | null {
  const nums = entries.map((e) => entryNumber(e, field, checklist)).filter((x): x is number => x !== null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

export function formatStat(value: number | null, unit?: string): string {
  if (value === null) return '—';
  // Currency symbols go first, with cents: "$16.50". Everything else: "1,450 kcal", "3.5 h".
  if (unit && /^[$€£¥₹₩]$/.test(unit)) {
    const cents = Math.round(value * 100) % 100 !== 0;
    const s = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
    return `${value < 0 ? '-' : ''}${unit}${s}`;
  }
  const s = value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 100 ? 1 : 0 });
  return unit ? `${s} ${unit}` : s;
}

/** Saved entries as short lines for an AI prompt, newest first, capped so prompts stay small. */
export function entriesAsText(entries: Entry[], labels: Record<string, string>, limit = 25): string {
  if (!entries.length) return '(nothing saved yet)';
  const lines = entries.slice(0, limit).map((e) => {
    const when = new Date(e.at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const parts = Object.entries(e.values)
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => `${labels[k] ?? k}: ${v.replace(/\s+/g, ' ').trim().slice(0, 160)}`);
    return `- ${when}: ${parts.join('; ')}`;
  });
  return lines.join('\n').slice(0, 4000);
}

/** Field ids a prompt reads, ignoring the saved-data placeholders. */
export function promptFields(prompt: string | undefined): string[] {
  const ids = [...(prompt ?? '').matchAll(/\{([a-z0-9_]+)\}/gi)].map((m) => m[1]);
  return ids.filter((id) => !(DATA_TOKENS as readonly string[]).includes(id));
}

/**
 * Fills a prompt: {field_id} with what the user typed, and the saved-data placeholders with the
 * date and saved entries.
 */
export function fillPrompt(
  template: string,
  values: Record<string, string>,
  data?: { entries: Entry[]; labels: Record<string, string>; now?: number },
): string {
  const now = data?.now ?? Date.now();
  return template.replace(/\{([a-z0-9_]+)\}/gi, (_, id: string) => {
    if (id === 'today') return new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    if (id === 'today_entries') return data ? entriesAsText(data.entries.filter((e) => sameDay(e.at, now)), data.labels) : '(none)';
    if (id === 'entries') return data ? entriesAsText(data.entries, data.labels) : '(none)';
    return values[id]?.trim() || '(empty)';
  });
}
