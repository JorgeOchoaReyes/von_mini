/**
 * Keeping chat edits honest: what a user's message asked for, checked against what the model
 * changed. Free of engine imports, so it can be tested on its own.
 */
import type { AppSpec } from '../spec/types';

/** The user asked for code / a custom version in so many words. */
export const ASKS_CODE = /\b(code|coded|html|javascript|custom (version|app|game))\b/i;

/** Words that mean the user wants the AI to do something (so a new AI button is welcome). */
const AI_INTENT =
  /\b(ai|smart|suggest|estimat|explain|summar|feedback|advice|advise|tips?|ideas?|generat|write|rewrit|translat|analy[sz]|insight|reflect|coach|recommend|tag|classif|predict|guess|caption|story|quiz me|ask me|chat|talk)/i;

/**
 * Checks a chat edit against what was asked, so the edit chat never "fixes" things by inventing
 * blocks: an AI button nobody asked for, or a custom code version when the message is about a
 * block the app already has (that's a setting or a connection, e.g. countFrom). Returns the edit
 * with those parts removed, and what was removed.
 */
export function vetEdit(before: AppSpec, after: AppSpec, message: string): { spec: AppSpec; rejected: string[] } {
  const rejected: string[] = [];
  const old = new Set(before.components.map((c) => c.id).filter(Boolean));
  let components = after.components;
  const addedAi = components.filter((c) => c.type === 'ai' && c.id && !old.has(c.id));
  if (addedAi.length && !AI_INTENT.test(message)) {
    components = components.filter((c) => !addedAi.includes(c));
    rejected.push(`added an AI button (${addedAi.map((c) => `“${c.label}”`).join(', ')}) the user didn't ask for`);
  }
  let code = after.code;
  const words = message.toLowerCase();
  const namesBlock = before.components.some((c) => {
    const label = (c.label ?? '').toLowerCase().trim();
    return label.length > 2 && words.includes(label);
  });
  if (code && code !== before.code && !ASKS_CODE.test(message) && namesBlock) {
    code = before.code;
    rejected.push('wrote a custom code version for something about a block the app already has (change that block\'s settings or connect blocks instead)');
  }
  const spec = { ...after, components, ...(code ? { code } : {}) };
  if (!code) delete spec.code;
  return { spec, rejected };
}


/** "fix it", "it's broken", "doesn't work": something's wrong, but not what. */
export const VAGUE_FIX = /^\s*(please\s+)?(fix( it| this| the app| that)?|it'?s broken|broken|(it )?(does ?n[o']?t|is ?n[o']?t) work(ing)?|not working|help)\s*[.!?]*\s*$/i;

/**
 * When a message is about blocks that are already connected (a dice block taking its count from a
 * choice), says how the connection works, instead of "couldn't work out a change".
 */
export function explainConnections(spec: AppSpec, message: string): string | null {
  const text = message.toLowerCase();
  const byId = new Map(spec.components.filter((c) => c.id).map((c) => [c.id!, c]));
  const what = { countFrom: 'how many dice', sidesFrom: 'how many sides', minFrom: 'the lowest number', maxFrom: 'the highest number', optionsFrom: 'what it picks from' } as const;
  for (const c of spec.components) {
    if (c.type !== 'random') continue;
    for (const k of Object.keys(what) as (keyof typeof what)[]) {
      const control = c[k] ? byId.get(c[k]!) : undefined;
      if (!control) continue;
      const names = [c.label, control.label, 'dice', 'roll', 'spin'].filter(Boolean).map((n) => n!.toLowerCase());
      if (!names.some((n) => n.length > 2 && text.includes(n))) continue;
      return `“${c.label}” already takes ${what[k]} from “${control.label}”: set that first, then tap “${c.label}”. Each roll uses whatever it's set to at that moment.`;
    }
  }
  return null;
}
