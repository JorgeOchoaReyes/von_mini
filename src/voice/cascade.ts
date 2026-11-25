/**
 * The voice "cascade": speech-to-text → Gemini Nano → text-to-speech, each step on the device.
 *
 * A turn streams the model's reply and speaks it sentence by sentence while the rest is still
 * being written, so the first words come out long before the whole answer exists. Routing goes
 * through the same hybrid rules as every other request: on-device first, and on-device only when
 * the app is offline or in private mode.
 */
import { engine } from '../ai/engineSelect';
import { appModeProblem, modeFor, type RouteContext } from '../ai/hybrid';
import type { InferenceSource } from '../ai/types';
import { SentenceSpeaker } from './tts';

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

/** How many past turns go into the prompt. Small models do better with a short window. */
const WINDOW = 8;

export const VOICE_RULES =
  'You are talking out loud with the user. Reply in 1-3 short spoken sentences. Plain words only: no lists, no markdown, no emoji. Ask at most one question at a time.';

export function voiceSystem(persona: string) {
  return `${persona.trim()}\n\n${VOICE_RULES}`;
}

export function conversationPrompt(history: Turn[]) {
  const lines = history.slice(-WINDOW).map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`);
  return `${lines.join('\n')}\nAssistant:`;
}

export interface ReplyOptions {
  /** Who the AI plays, e.g. "You are a tough but fair interviewer for a product manager role." */
  persona: string;
  ctx: RouteContext;
  /** Speak the reply as it streams. */
  speak: boolean;
  /** Called with the reply text so far. */
  onText?(text: string): void;
  /** Lets the caller cut the reply short (e.g. the user taps the mic to interrupt). */
  signal?: { aborted: boolean };
}

/**
 * Runs one assistant turn for a conversation whose last entry is the user's message.
 * Resolves with the full reply once it has been spoken.
 */
export async function voiceReply(history: Turn[], o: ReplyOptions): Promise<{ text: string; source: InferenceSource }> {
  const problem = appModeProblem(o.ctx);
  if (problem) throw new Error(problem);
  const speaker = o.speak ? new SentenceSpeaker() : null;
  let text = '';
  let source: InferenceSource = 'on_device';
  try {
    for await (const chunk of engine.stream(conversationPrompt(history), {
      mode: modeFor('action', o.ctx),
      system: voiceSystem(o.persona),
    })) {
      if (o.signal?.aborted) break;
      text = chunk.text;
      source = chunk.source;
      o.onText?.(stripSpeaker(text));
      speaker?.update(stripSpeaker(text));
    }
    text = stripSpeaker(text).trim();
    if (o.signal?.aborted) speaker?.stop();
    else await speaker?.finish(text);
    return { text, source };
  } catch (e) {
    speaker?.stop();
    throw e;
  }
}

/** Small models sometimes echo the "Assistant:" prefix or start writing the user's next line. */
function stripSpeaker(text: string) {
  return text.replace(/^\s*Assistant:\s*/i, '').split(/\n\s*User:/i)[0];
}
