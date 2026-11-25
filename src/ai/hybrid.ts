/**
 * The hybrid router: decides which inference mode each task uses.
 *
 *  task                     online                 offline / private mode
 *  build app (spec)         prefer_in_cloud        only_on_device
 *  edit app (spec)          prefer_on_device       only_on_device
 *  in-app AI actions        prefer_on_device       only_on_device
 *  custom HTML app          only_in_cloud          (not available)
 *
 * Builds prefer the cloud for quality but still succeed on Nano offline; everything users do
 * inside their apps prefers the device, so their data stays local and costs nothing.
 */
import { onDeviceOnly } from '../config';
import { describeChanges } from '../spec/diff';
import { sanitizeSpec, extractJson } from '../spec/validate';
import { appSpecJsonSchema, type AppSpec } from '../spec/types';
import { rcString } from '../remote/remoteConfig';
import { engine } from './engineSelect';
import {
  ACTION_SYSTEM,
  CHAT_SYSTEM,
  HTML_SYSTEM,
  INTENT_SYSTEM,
  SPEC_SYSTEM,
  chatPrompt,
  editSpecPrompt,
  htmlPrompt,
  specPrompt,
} from './prompts';
import type { DeviceStatus, GenerateResult, InferenceMode, InferenceSource } from './types';

export interface RouteContext {
  online: boolean;
  /** User toggle: never send anything to the cloud. */
  privateMode: boolean;
  /** Whether Gemini Nano can run here right now. Unknown (undefined) keeps the default routing. */
  deviceStatus?: DeviceStatus;
}

/** True when every request must stay on the device (offline, private mode, or an offline build). */
export const local = (ctx: RouteContext) => onDeviceOnly || !ctx.online || ctx.privateMode;

export function modeFor(task: 'build' | 'edit' | 'action', ctx: RouteContext): InferenceMode {
  if (local(ctx)) return 'only_on_device';
  // No usable on-device model: go straight to the cloud. A PREFER_* mode would let the SDK fall
  // back to an on-device path that can't run here, which stalls instead of reporting the real
  // cloud error (seen on a phone without AICore: no request ever reached Firebase).
  if (ctx.deviceStatus && ctx.deviceStatus !== 'available') return 'only_in_cloud';
  if (task !== 'build') return 'prefer_on_device';
  // Remote Config can move app design on-device (e.g. to cut cloud cost) without a release.
  return rcString('build_mode') === 'prefer_on_device' ? 'prefer_on_device' : 'prefer_in_cloud';
}

/** The app-designer prompt, plus any extra rules set in Remote Config. */
function specSystem() {
  const extra = rcString('spec_rules_extra').trim();
  return extra ? `${SPEC_SYSTEM}\nAdditional rules:\n${extra}` : SPEC_SYSTEM;
}

async function generateSpec(prompt: string, mode: InferenceMode) {
  const opts = { mode, system: specSystem(), json: true, schema: appSpecJsonSchema };
  let result = await engine.generate(prompt, opts);
  try {
    return { spec: sanitizeSpec(extractJson(result.text)), source: result.source };
  } catch {
    // Small models occasionally break JSON; one retry with a stricter nudge usually fixes it.
    result = await engine.generate(`${prompt}\n\nReturn valid JSON only, no other text.`, opts);
    return { spec: sanitizeSpec(extractJson(result.text)), source: result.source };
  }
}

export async function buildApp(request: string, ctx: RouteContext): Promise<{ spec: AppSpec; source: InferenceSource }> {
  return generateSpec(specPrompt(request), modeFor('build', ctx));
}

/* ------------------------------------------------------------------ *
 * Progressive generation
 *
 * The model output is streamed so the UI can show what is happening instead of a bare spinner.
 * Two things are surfaced while the JSON is still arriving:
 *   - `partial`: the raw text so far, for a "writing" ticker;
 *   - `peek`:    name / emoji / description scraped out of the unfinished JSON, so the app card
 *                can appear before the spec is valid.
 * ------------------------------------------------------------------ */

export type ProgressStep = { id: string; label: string; state: 'active' | 'done' };
export type BuildEvent =
  | { type: 'step'; step: ProgressStep }
  | { type: 'partial'; text: string }
  | { type: 'peek'; peek: SpecPeek }
  | { type: 'retry' }
  /** The cloud was busy or unreachable; continuing on Gemini Nano. */
  | { type: 'fallback' }
  | { type: 'done'; spec: AppSpec; source: InferenceSource };

export interface SpecPeek {
  name?: string;
  emoji?: string;
  description?: string;
  accent?: string;
  components: number;
}

const unescape = (s: string) => s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

/** Best-effort read of the fields that make a nice preview, from incomplete JSON. */
export function peekSpec(text: string): SpecPeek {
  const field = (key: string) => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    return m ? unescape(m[1]) : undefined;
  };
  return {
    name: field('name'),
    emoji: field('emoji'),
    description: field('description'),
    accent: field('accent'),
    components: (text.match(/"type"\s*:\s*"/g) ?? []).length,
  };
}

const STEP_LABELS: Record<'build' | 'edit', string[]> = {
  build: ['Reading your idea', 'Designing the screen', 'Checking the layout'],
  edit: ['Reading your app', 'Applying the change', 'Checking the result'],
};

/** How long to wait for the model to start answering, and then between chunks. */
const FIRST_CHUNK_MS = 45_000;
const IDLE_MS = 30_000;

export class StalledError extends Error {
  constructor() {
    super('The model stopped responding.');
  }
}

/**
 * Yields from a stream, but gives up if it doesn't start within `firstMs` or goes quiet for
 * `idleMs`. Without this, a stalled cloud request (an overloaded model the SDK keeps retrying)
 * leaves the build spinning for minutes.
 */
async function* withTimeouts<T>(source: AsyncIterable<T>, firstMs: number, idleMs: number): AsyncIterable<T> {
  const it = source[Symbol.asyncIterator]();
  let first = true;
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StalledError()), first ? firstMs : idleMs);
    });
    let r: IteratorResult<T>;
    try {
      r = await Promise.race([it.next(), timeout]);
    } catch (e) {
      // Let the abandoned stream close (and drop its listeners) whenever it finishes.
      void it.return?.(undefined)?.catch?.(() => undefined);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (r.done) return;
    first = false;
    yield r.value;
  }
}

/** Cloud failures worth retrying on the device: the model is busy, over quota, or unreachable. */
export function isCloudUnavailable(e: unknown): boolean {
  if (e instanceof StalledError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /high demand|overloaded|unavailable|503|429|resource.?exhausted|quota|deadline|timed? ?out|network|fetch failed|failed to connect|unable to resolve host/i.test(
    msg,
  );
}

/**
 * Turns the usual Firebase setup failures into something a person can act on. The original error
 * is kept at the end, so nothing is hidden.
 */
export function explainCloudError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  const hint = /android client application|API_KEY_ANDROID_APP_BLOCKED|blocked/i.test(msg)
    ? 'Firebase blocked this app’s requests. Add this build’s SHA-1 fingerprint to the Android app in Firebase project settings (for EAS builds, `eas credentials` shows it), or loosen the API key’s Android restriction.'
    : /API key not valid|API_KEY_INVALID/i.test(msg)
      ? 'Firebase rejected the API key. Check google-services.json / the EXPO_PUBLIC_FIREBASE_* values for this build.'
      : /SERVICE_DISABLED|has not been used|not been enabled|is disabled/i.test(msg)
        ? 'Firebase AI Logic isn’t enabled for this project yet. Open AI Logic in the Firebase console and click Get started.'
        : /app ?check/i.test(msg)
          ? 'App Check rejected this app. Register its debug token in Firebase > App Check, or turn off enforcement.'
          : null;
  return new Error(hint ? `${hint} (${msg.slice(0, 200)})` : msg);
}

async function generateSpecProgressive(
  prompt: string,
  mode: InferenceMode,
  task: 'build' | 'edit',
  onEvent: (e: BuildEvent) => void,
): Promise<{ spec: AppSpec; source: InferenceSource }> {
  try {
    return await generateSpecOnce(prompt, mode, task, onEvent);
  } catch (e) {
    // Hybrid, for real: when the cloud is busy or unreachable, use Gemini Nano if this device has
    // it. (The SDK's own PREFER_IN_CLOUD only falls back when offline, not on server errors.)
    const cloudFirst = mode === 'prefer_in_cloud' || mode === 'prefer_on_device';
    if (cloudFirst && isCloudUnavailable(e) && (await engine.status()) === 'available') {
      onEvent({ type: 'fallback' });
      return generateSpecOnce(prompt, 'only_on_device', task, onEvent);
    }
    if (isCloudUnavailable(e)) {
      throw new Error(
        e instanceof StalledError
          ? 'Gemini in the cloud didn’t answer in time, and this device has no on-device model to fall back to. Try again in a minute.'
          : 'Gemini in the cloud is busy right now, and this device has no on-device model to fall back to. Try again in a minute.',
      );
    }
    throw explainCloudError(e);
  }
}

async function generateSpecOnce(
  prompt: string,
  mode: InferenceMode,
  task: 'build' | 'edit',
  onEvent: (e: BuildEvent) => void,
): Promise<{ spec: AppSpec; source: InferenceSource }> {
  const labels = STEP_LABELS[task];
  const opts = { mode, system: specSystem(), json: true, schema: appSpecJsonSchema };
  let attempt = 0;

  for (;;) {
    onEvent({ type: 'step', step: { id: 'read', label: labels[0], state: 'active' } });
    let text = '';
    let source: InferenceSource = 'on_device';
    let sawFirstToken = false;
    const stream = engine.stream(attempt === 0 ? prompt : `${prompt}\n\nReturn valid JSON only, no other text.`, opts);
    for await (const chunk of withTimeouts(stream, FIRST_CHUNK_MS, IDLE_MS)) {
      text = chunk.text;
      source = chunk.source;
      if (!sawFirstToken) {
        sawFirstToken = true;
        onEvent({ type: 'step', step: { id: 'read', label: labels[0], state: 'done' } });
        onEvent({ type: 'step', step: { id: 'design', label: labels[1], state: 'active' } });
      }
      onEvent({ type: 'partial', text });
      onEvent({ type: 'peek', peek: peekSpec(text) });
    }
    try {
      const spec = sanitizeSpec(extractJson(text));
      onEvent({ type: 'step', step: { id: 'design', label: labels[1], state: 'done' } });
      onEvent({ type: 'step', step: { id: 'check', label: labels[2], state: 'done' } });
      return { spec, source };
    } catch (e) {
      // Small models occasionally break JSON; one retry with a stricter nudge usually fixes it.
      if (attempt++ > 0) throw e;
      onEvent({ type: 'retry' });
    }
  }
}

/** Builds an app, reporting progress as the spec streams in. */
export async function buildAppProgressive(
  request: string,
  ctx: RouteContext,
  onEvent: (e: BuildEvent) => void,
): Promise<{ spec: AppSpec; source: InferenceSource }> {
  return generateSpecProgressive(specPrompt(request), modeFor('build', ctx), 'build', onEvent);
}

/** Applies a requested change, reporting progress as the new spec streams in. */
export async function editAppProgressive(
  spec: AppSpec,
  change: string,
  ctx: RouteContext,
  onEvent: (e: BuildEvent) => void,
): Promise<{ spec: AppSpec; source: InferenceSource }> {
  return generateSpecProgressive(editSpecPrompt(JSON.stringify(spec), change), modeFor('edit', ctx), 'edit', onEvent);
}

export async function editApp(
  spec: AppSpec,
  change: string,
  ctx: RouteContext,
): Promise<{ spec: AppSpec; source: InferenceSource }> {
  return generateSpec(editSpecPrompt(JSON.stringify(spec), change), modeFor('edit', ctx));
}

export type ChatReply =
  | { kind: 'answer'; text: string; source: InferenceSource }
  | { kind: 'edit'; spec: AppSpec; changes: string[]; source: InferenceSource };

const CHANGE_WORDS =
  /^(please\s+)?(can you\s+|could you\s+)?(add|remove|delete|drop|rename|change|make|replace|put|move|include|turn|use|set|show|hide|reword|shorten|swap|let|give|improve|split|merge)\b/i;

async function classify(message: string, ctx: RouteContext): Promise<'change' | 'question'> {
  const m = message.trim();
  if (CHANGE_WORDS.test(m)) return 'change';
  if (m.endsWith('?')) return 'question';
  try {
    const r = await engine.generate(m, { mode: modeFor('action', ctx), system: INTENT_SYSTEM, json: true });
    return (extractJson(r.text) as { intent?: string }).intent === 'change' ? 'change' : 'question';
  } catch {
    return 'question';
  }
}

/** One chat turn about an app: answers questions, or applies the requested change. */
export async function chatAboutApp(
  spec: AppSpec,
  history: { role: string; text: string }[],
  message: string,
  ctx: RouteContext,
  /** Optional: streams the edit so the chat can show progress instead of a bare spinner. */
  onEvent?: (e: BuildEvent) => void,
): Promise<ChatReply> {
  if ((await classify(message, ctx)) === 'change') {
    const { spec: next, source } = onEvent
      ? await editAppProgressive(spec, message, ctx, onEvent)
      : await editApp(spec, message, ctx);
    return { kind: 'edit', spec: next, changes: describeChanges(spec, next), source };
  }
  const r = await engine.generate(chatPrompt(JSON.stringify(spec), history.slice(-6), message), {
    mode: modeFor('action', ctx),
    system: CHAT_SYSTEM,
  });
  return { kind: 'answer', text: r.text.trim(), source: r.source };
}

export async function runAction(prompt: string, ctx: RouteContext): Promise<GenerateResult> {
  return engine.generate(prompt, { mode: modeFor('action', ctx), system: ACTION_SYSTEM });
}

export async function buildCustomHtml(request: string, ctx: RouteContext, spec?: AppSpec): Promise<string> {
  if (onDeviceOnly) throw new Error('Custom apps need the cloud, and this build runs in offline (on-device only) mode.');
  if (local(ctx)) throw new Error('Custom apps are written by Gemini in the cloud. Connect to the internet and turn off private mode.');
  const { text } = await engine.generate(htmlPrompt(request, spec && JSON.stringify(spec)), {
    mode: 'only_in_cloud',
    system: HTML_SYSTEM,
  });
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const html = (fenced ? fenced[1] : text).trim();
  if (!/<html|<!doctype/i.test(html)) throw new Error('Gemini did not return an HTML document. Try again.');
  return html;
}
