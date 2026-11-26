/** The dice & chance block's rules, kept free of UI so they can be tested on their own. */
import { firstNumber } from '../spec/stats';
import type { SpecComponent } from '../spec/types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/**
 * The block with any settings it takes from other fields filled in from what's on screen now:
 * a "Number of dice" choice set to "4 Dice" makes it roll 4 dice. A field that's empty or has no
 * number keeps the block's own setting.
 */
export function resolveRandom(c: SpecComponent, values: Record<string, string | undefined>): SpecComponent {
  const num = (id?: string) => (id ? firstNumber(values[id]) : null);
  const out = { ...c };
  const count = num(c.countFrom);
  if (count !== null) out.count = clamp(count, 1, 6);
  const sides = num(c.sidesFrom);
  if (sides !== null) out.sides = clamp(sides, 2, 1000);
  const min = num(c.minFrom);
  if (min !== null) out.min = Math.round(min);
  const max = num(c.maxFrom);
  if (max !== null) out.max = Math.round(max);
  if ((out.min ?? 1) > (out.max ?? 100)) [out.min, out.max] = [out.max, out.min];
  const list = c.optionsFrom ? (values[c.optionsFrom] ?? '').split(/\s*(?:,|\n|;)\s*/).map((o) => o.trim()).filter(Boolean) : [];
  if (list.length >= 2) out.options = [...new Set(list)].slice(0, 50);
  return out;
}

const rand = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

export type Result = { dice?: number[]; text: string };

/** One random result for this block. */
export function rollOnce(c: SpecComponent): Result {
  switch (c.roll) {
    case 'coin':
      return { text: Math.random() < 0.5 ? 'Heads' : 'Tails' };
    case 'pick': {
      const o = c.options ?? [];
      return { text: o[rand(0, o.length - 1)] ?? '' };
    }
    case 'number':
      return { text: String(rand(c.min ?? 1, c.max ?? 100)) };
    default: {
      const dice = Array.from({ length: c.count ?? 1 }, () => rand(1, c.sides ?? 6));
      const sum = dice.reduce((a, b) => a + b, 0);
      return { dice, text: dice.length > 1 ? `${sum} (${dice.join(' + ')})` : String(sum) };
    }
  }
}
