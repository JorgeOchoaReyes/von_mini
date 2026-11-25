/**
 * Parsing a chat turn: the model's single answer to a message about an app, either a reply or a
 * reply plus the updated app. Kept free of engine imports so it can be tested on its own.
 */
import type { AppSpec } from '../spec/types';
import { extractJson, sanitizeSpec } from '../spec/validate';

/** Reads a chat turn's JSON. Accepts a bare app (some models skip the wrapper) as an edit. */
export function parseChatTurn(text: string): { reply: string; app: AppSpec | null } {
  const raw = extractJson(text) as Record<string, unknown>;
  if (raw && typeof raw === 'object' && Array.isArray(raw.components)) return { reply: '', app: sanitizeSpec(raw) };
  const reply = typeof raw?.reply === 'string' ? raw.reply.trim() : '';
  const app = raw?.app && typeof raw.app === 'object' ? sanitizeSpec(raw.app) : null;
  if (!reply && !app) throw new Error('The model returned an empty reply.');
  return { reply, app };
}

