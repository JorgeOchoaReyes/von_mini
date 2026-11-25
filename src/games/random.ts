/** The dice & chance block's rules, kept free of UI so they can be tested on their own. */
import type { SpecComponent } from '../spec/types';

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
