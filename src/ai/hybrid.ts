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
import { withLatestChange } from './brief';
import { onDeviceOnly } from '../config';
import { describeChanges } from '../spec/diff';
import { sanitizeSpec, extractJson } from '../spec/validate';
import { ASKS_CODE, explainConnections, VAGUE_FIX, vetEdit } from './vet';
import { parseChatTurn } from './chatTurn';
import { appSpecJsonSchema, type AppSpec } from '../spec/types';
import { rcString } from '../remote/remoteConfig';
import { engine, isQuotaError, retryAfterMs } from './engineSelect';
import { cleanCustomHtml } from './htmlSafety';
import { chartDaysAsked, isVagueRequest } from './requestRules';
import {
  ACTION_SYSTEM,
  CHAT_TURN_RULES,
  chatTurnJsonSchema,
  chatTurnPrompt,
  HTML_SYSTEM,
  SPEC_SYSTEM,
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
  /** For AI inside a generated app: that app's own choice (see appMode.tsx). */
  appMode?: 'auto' | 'device' | 'cloud';
}

/** True when every request must stay on the device (offline, private mode, or an offline build). */
export const local = (ctx: RouteContext) => onDeviceOnly || !ctx.online || ctx.privateMode;

/**
 * Why an app's AI can't run with its current setting, in plain words, or null if it can. Shown
 * under the app's AI selector, and thrown by the app's AI calls so they fail clearly.
 */
export function appModeProblem(ctx: RouteContext): string | null {
  const nano = ctx.deviceStatus === 'available';
  if (local(ctx)) return localProblem(ctx);
  if (ctx.appMode === 'device' && !nano) {
    return 'This app is set to On-device, but this device can’t run Gemini Nano. Choose Auto or Cloud.';
  }
  return null;
}

export function modeFor(task: 'build' | 'edit' | 'action', ctx: RouteContext): InferenceMode {
  if (local(ctx)) return 'only_on_device';
  // An app's own choice applies to its AI features ('action'), not to building or editing it.
  if (task === 'action' && ctx.appMode === 'device') return 'only_on_device';
  if (task === 'action' && ctx.appMode === 'cloud') return 'only_in_cloud';
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
    return { spec: sanitizeSpec(extractJson(result.text), { rescue: true }), source: result.source };
  }
}

/**
 * Why AI can't run at all right now, in plain words, or null: offline or in private mode, every
 * request must stay on the phone, and this phone has no on-device model. Checked before a build,
 * an edit or a chat turn, so the answer is a clear sentence rather than an engine error.
 */
export function localProblem(ctx: RouteContext): string | null {
  if (!local(ctx) || ctx.deviceStatus === 'available') return null;
  if (!ctx.online) return 'You’re offline, and this phone can’t run AI on its own. Connect to build or change apps. Your apps, saved data and games still work offline.';
  return 'Private mode keeps AI on this phone, but this phone can’t run Gemini Nano. Turn off Private mode in Settings to use AI.';
}

/** A chat message asking for the app to be written in code: "write it as code", "make this a custom version". */
export const ASKS_FOR_CODE_VERSION =
  /\b(write|make|turn|rewrite|redo|build|do|remake|recreate)\s+(it|this|that|the app|this app|my app)?\s*(as|in|into|with|using)\s+(code|html|javascript)\b|\b(make|give|want|build|write)\b[^.?!]{0,20}\bcustom version\b|^\s*(in |as )?code\s*[.!]?\s*$/i;

const dropCode = ({ code: _drop, ...rest }: AppSpec): AppSpec => rest;
/** Things custom code can't do either: it runs alone on the phone (no internet, camera, people). */
const NO_CODE_TOPIC = /\b(weather|forecast|stocks?|crypto|bitcoin|live prices?|prices? live|news|photos?|pictures?|camera|selfies?|filters?|social|followers|feed)\b/i;
/** Requests a built-in game already covers. */
const BUILT_IN_GAME = /\b(tetris|falling blocks?|block (drop|stack)|subway|runner|dodge|snake|flappy|bird|brick|breakout|arkanoid|space ?shooter|shooter|invaders?|aliens?|galaga|catch(ing|er)?|whack|mole)\b/i;

/**
 * Keeps a design's code brief only where code helps. The model adds one too eagerly (a built-in
 * game, or live weather that code can't fetch either), which would write a needless custom app.
 */
/**
 * Requests the blocks can only approximate (money owed between people, timers, calculators, board
 * and puzzle games): always write the custom version, even if the model forgot to ask for it.
 */
const NEEDS_CODE =
  /\b(split(ting)? (the |a |our )?(bill|check|tab|rent|costs?|expenses?)|split(ting)? (expenses|costs|bills|rent) with|who owes|settle up|pomodoro|stopwatch|countdown timer|calculator|unit converter|play(ing)? (chess|checkers)|(chess|checkers) (against|vs|board)|an? (chess|checkers) game|tic.?tac.?toe|sudoku|minesweeper|memory (card|matching) game|drawing pad|sketch ?pad)\b/i;

/** A chat change that asks for something only code can do: "add a 5 minute timer". */
export const ADDS_CODE_ONLY_FEATURE = /\b(add|put|include|give( me)?|need|want|with)\b.{0,60}\b(timer|countdown|stopwatch|pomodoro)s?\b/i;

export function settleCode(request: string, spec: AppSpec): AppSpec {
  if (!spec.code && NEEDS_CODE.test(request) && !NO_CODE_TOPIC.test(request)) return { ...spec, code: `Build it exactly as asked: "${request.slice(0, 400)}"` };
  if (!spec.code || ASKS_CODE.test(request)) return spec;
  if (isVagueRequest(request)) return dropCode(spec);
  const builtInGame = spec.components.some((c) => c.type === 'game') && BUILT_IN_GAME.test(request) && !/power.?ups?|boss|level editor|multiplayer|own rules/i.test(request);
  if (!NO_CODE_TOPIC.test(request) && !builtInGame) return spec;
  const { code: _drop, ...rest } = spec;
  return rest;
}

function checkLocal(ctx: RouteContext) {
  const problem = localProblem(ctx);
  if (problem) throw new Error(problem);
}

export async function buildApp(request: string, ctx: RouteContext): Promise<{ spec: AppSpec; source: InferenceSource }> {
  checkLocal(ctx);
  const r = await generateSpec(specPrompt(request), modeFor('build', ctx));
  return { ...r, spec: settleCode(request, r.spec) };
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

/** How long a single non-streamed request may take before we stop waiting for it. */
export const REQUEST_MS = 60_000;

/** Rejects with StalledError if `p` hasn't settled within `ms`, so nothing can spin forever. */
export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StalledError()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Cloud failures worth retrying on the device: the model is busy, over quota, or unreachable. */
/** The cloud couldn't be reached or didn't answer (as opposed to refusing the request). */
export class UnreachableError extends Error {}

export function isCloudUnavailable(e: unknown): boolean {
  if (e instanceof StalledError || e instanceof UnreachableError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return (
    isAppCheckRejection(e) ||
    /high demand|overloaded|unavailable|503|429|resource.?exhausted|quota|deadline|timed? ?out|network|fetch failed|failed to connect|unable to resolve host/i.test(
      msg,
    )
  );
}

/**
 * The cloud refused to serve this copy of the app: App Check couldn't attest it (an old APK, an
 * emulator, a rooted phone, a browser that failed reCAPTCHA). Treated like "cloud unavailable",
 * so Gemini Nano takes over where the device has it.
 */
export function isAppCheckRejection(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /app.?check|firebaseappcheck|UNAUTHENTICATED|\b401\b/i.test(msg);
}

/**
 * Turns the usual Firebase setup failures into something a person can act on. The original error
 * is kept at the end, so nothing is hidden.
 */
export function explainCloudError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  // These two are limits we set on purpose (quotas, App Check), so the message is for the person
  // using the app, not for a developer. The technical details go to the console.
  if (isQuotaError(e)) {
    console.warn('Cloud quota reached:', msg.slice(0, 400));
    const wait = retryAfterMs(e);
    const when =
      wait === null
        ? 'in a minute'
        : wait < 90_000
          ? 'in a minute'
          : wait < 2 * 3600_000
            ? `in about ${Math.ceil(wait / 60_000)} minutes`
            : `in about ${Math.round(wait / 3600_000)} hours`;
    return new Error(
      `So many people are using von mini’s cloud AI right now that it’s at its limit. Try again ${when}. Your apps, your saved entries and anything that runs on this device keep working.`,
    );
  }
  if (isAppCheckRejection(e)) {
    console.warn('App Check rejected the request:', msg.slice(0, 400));
    return new Error(
      'Cloud AI only works in the official von mini app and website, and this copy couldn’t confirm it is one. Update to the latest version (or use a phone with Gemini Nano). Everything on this device keeps working.',
    );
  }
  const hint = /android client application|API_KEY_ANDROID_APP_BLOCKED|blocked/i.test(msg)
    ? 'Firebase blocked this app’s requests. Add this build’s SHA-1 fingerprint to the Android app in Firebase project settings (for EAS builds, `eas credentials` shows it), or loosen the API key’s Android restriction.'
    : /API key not valid|API_KEY_INVALID/i.test(msg)
      ? 'Firebase rejected the API key. Check google-services.json / the EXPO_PUBLIC_FIREBASE_* values for this build.'
      : /SERVICE_DISABLED|has not been used|not been enabled|is disabled/i.test(msg)
        ? 'Firebase AI Logic isn’t enabled for this project yet. Open AI Logic in the Firebase console and click Get started.'
        : null;
  return new Error(hint ? `${hint} (${msg.slice(0, 200)})` : msg);
}

async function generateSpecProgressive(
  prompt: string,
  mode: InferenceMode,
  task: 'build' | 'edit',
  onEvent: (e: BuildEvent) => void,
): Promise<{ spec: AppSpec; source: InferenceSource }> {
  return withDeviceFallback(mode, onEvent, (m) => generateSpecOnce(prompt, m, task, onEvent));
}

/**
 * Hybrid, for real: when the cloud is busy or unreachable, run the same request on Gemini Nano if
 * this device has it (the SDK's own PREFER_IN_CLOUD only falls back when offline, not on server
 * errors). Otherwise turns the failure into a message a person can act on.
 */
async function withDeviceFallback<T>(
  mode: InferenceMode,
  onEvent: (e: BuildEvent) => void,
  run: (mode: InferenceMode) => Promise<T>,
): Promise<T> {
  try {
    return await run(mode);
  } catch (e) {
    const cloudFirst = mode === 'prefer_in_cloud' || mode === 'prefer_on_device';
    if (cloudFirst && isCloudUnavailable(e) && (await engine.status()) === 'available') {
      onEvent({ type: 'fallback' });
      return run('only_on_device');
    }
    if (isQuotaError(e)) throw explainCloudError(e);
    if (isCloudUnavailable(e)) {
      throw new UnreachableError(
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
    const p = attempt === 0 ? prompt : `${prompt}\n\nReturn valid JSON only, no other text.`;
    try {
      for await (const chunk of withTimeouts(engine.stream(p, opts), FIRST_CHUNK_MS, IDLE_MS)) {
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
    } catch (e) {
      // A stream that never starts may be a streaming problem rather than a model problem (seen on
      // an Android phone: no chunk and no error). Ask once more without streaming before failing.
      if (!(e instanceof StalledError) || sawFirstToken) throw e;
      onEvent({ type: 'retry' });
      const r = await withDeadline(engine.generate(p, opts), REQUEST_MS);
      text = r.text;
      source = r.source;
    }
    try {
      // The last attempt keeps a usable app even if it came back with nothing to fill in.
      const spec = sanitizeSpec(extractJson(text), { rescue: attempt > 0 });
      onEvent({ type: 'step', step: { id: 'design', label: labels[1], state: 'done' } });
      onEvent({ type: 'step', step: { id: 'check', label: labels[2], state: 'done' } });
      return { spec, source };
    } catch (e) {
      // Small models occasionally break JSON; one retry with a stricter nudge usually fixes it.
      if (attempt++ > 0) {
        // Both streamed answers were broken (seen on very long requests): one last plain request,
        // kept as usable as possible, before giving up.
        try {
          const r = await withDeadline(engine.generate(`${prompt}\n\nReturn valid JSON only, no comments, at most 12 components.`, opts), REQUEST_MS);
          return { spec: sanitizeSpec(extractJson(r.text), { rescue: true }), source: r.source };
        } catch {
          throw e;
        }
      }
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
  checkLocal(ctx);
  const r = await generateSpecProgressive(specPrompt(request), modeFor('build', ctx), 'build', onEvent);
  return { ...r, spec: settleCode(request, r.spec) };
}

/** Applies a requested change, reporting progress as the new spec streams in. */
export async function editAppProgressive(
  spec: AppSpec,
  change: string,
  ctx: RouteContext,
  onEvent: (e: BuildEvent) => void,
): Promise<{ spec: AppSpec; source: InferenceSource }> {
  checkLocal(ctx);
  return generateSpecProgressive(editSpecPrompt(JSON.stringify(spec), change), modeFor('edit', ctx), 'edit', onEvent);
}

export async function editApp(
  spec: AppSpec,
  change: string,
  ctx: RouteContext,
): Promise<{ spec: AppSpec; source: InferenceSource }> {
  checkLocal(ctx);
  return generateSpec(editSpecPrompt(JSON.stringify(spec), change), modeFor('edit', ctx));
}

export type ChatReply =
  | { kind: 'answer'; text: string; source: InferenceSource }
  /** `reply` is the model's own one-line summary; `changes` is computed locally from the diff. */
  | { kind: 'edit'; spec: AppSpec; changes: string[]; reply: string; source: InferenceSource };

const CHAT_STEPS = ['Reading your message', 'Updating your app', 'Checking the result'];

async function chatTurnOnce(
  prompt: string,
  mode: InferenceMode,
  onEvent: (e: BuildEvent) => void,
): Promise<{ reply: string; app: AppSpec | null; source: InferenceSource }> {
  const opts = { mode, system: `${specSystem()}\n\n${CHAT_TURN_RULES}`, json: true, schema: chatTurnJsonSchema(appSpecJsonSchema) };
  const step = (n: number, state: ProgressStep['state']) => onEvent({ type: 'step', step: { id: `chat${n}`, label: CHAT_STEPS[n], state } });
  let attempt = 0;
  for (;;) {
    step(0, 'active');
    let text = '';
    let source: InferenceSource = 'on_device';
    let editing = false;
    const p = attempt === 0 ? prompt : `${prompt}\n\nReturn valid JSON only, no other text.`;
    try {
      for await (const chunk of withTimeouts(engine.stream(p, opts), FIRST_CHUNK_MS, IDLE_MS)) {
        text = chunk.text;
        source = chunk.source;
        // Only show "Updating your app" once the model has started writing a new app.
        if (!editing && /"app"\s*:\s*\{/.test(text)) {
          editing = true;
          step(0, 'done');
          step(1, 'active');
        }
        if (editing) onEvent({ type: 'peek', peek: peekSpec(text.slice(text.search(/"app"\s*:/))) });
      }
    } catch (e) {
      if (!(e instanceof StalledError) || text) throw e;
      onEvent({ type: 'retry' });
      const r = await withDeadline(engine.generate(p, opts), REQUEST_MS);
      text = r.text;
      source = r.source;
    }
    try {
      const turn = parseChatTurn(text);
      step(editing ? 1 : 0, 'done');
      if (turn.app) step(2, 'done');
      return { ...turn, source };
    } catch (e) {
      // Small models occasionally break JSON; one retry with a stricter nudge usually fixes it.
      if (attempt++ > 0) throw e;
      onEvent({ type: 'retry' });
    }
  }
}

/**
 * One chat turn about an app, in a single request: the model answers, or returns the updated app.
 * An "edit" that changes nothing is turned into an answer, using the model's own reply.
 */
export async function chatAboutApp(
  spec: AppSpec,
  history: { role: string; text: string }[],
  message: string,
  ctx: RouteContext,
  onEvent: (e: BuildEvent) => void = () => undefined,
): Promise<ChatReply> {
  checkLocal(ctx);
  // "Fix it" with nothing to go on: ask what's wrong rather than change something at random.
  if (VAGUE_FIX.test(message) && !history.length) {
    return {
      kind: 'answer',
      source: 'on_device',
      text: 'What isn’t working? Tell me which part and what it does wrong, like “the Roll button always rolls 3 dice” or “the total doesn’t add up”.',
    };
  }
  // "Write it as code": no model needed to say yes. The brief carries anything else they asked.
  if (ASKS_FOR_CODE_VERSION.test(message) && message.length < 200) {
    if (spec.code) {
      return {
        kind: 'answer',
        source: 'on_device',
        text: 'It’s already the full version. Tell me what to change (like “make the breaks 10 minutes”) and I’ll update it.',
      };
    }
    const next = { ...spec, code: `A custom version of “${spec.name}”${spec.description ? ` (${spec.description})` : ''}, with all of its features and a more interactive design. The user asked: "${message.trim()}"` };
    return { kind: 'edit', spec: next, changes: describeChanges(spec, next), reply: 'Building the full version of the app.', source: 'on_device' };
  }
  // Things only a custom version can do (a running timer, a stopwatch, a countdown): no block can,
  // so write or extend the custom version directly instead of hoping the model works that out.
  if (ADDS_CODE_ONLY_FEATURE.test(message) && message.length < 300) {
    const asked = message.trim();
    const brief = spec.code
      ? `${spec.code}\nAlso: ${asked}`
      : `A custom version of “${spec.name}”${spec.description ? ` (${spec.description})` : ''}, with all of its features. The user asked: "${asked}"`;
    const next = { ...spec, code: brief };
    return { kind: 'edit', spec: next, changes: describeChanges(spec, next), reply: 'That needs the full version of the app, so I’m writing it with that added.', source: 'on_device' };
  }
  // "Show 30 days on the chart": a plain number change the model sometimes fumbles. Charts show 7-31.
  const asked = chartDaysAsked(message);
  const charts = spec.components.filter((c) => c.type === 'chart');
  const wantsNewChart = /\b(add|new|another|second|extra|create)\b/i.test(message);
  if (asked !== null && charts.length === 1 && !spec.code && !wantsNewChart && message.length < 120) {
    const days = Math.min(31, Math.max(7, asked));
    const next = { ...spec, components: spec.components.map((c) => (c === charts[0] ? { ...c, days } : c)) };
    const note = days !== asked ? ` (charts show 7 to 31 days)` : '';
    return { kind: 'edit', spec: next, changes: describeChanges(spec, next), reply: `The chart now shows the last ${days} days${note}.`, source: 'on_device' };
  }
  // Back from code to the blocks: drop the brief (the code stays in History to go back to).
  if (spec.code && BACK_TO_BLOCKS.test(message)) {
    const { code: _gone, ...blocks } = spec;
    return { kind: 'edit', spec: blocks, changes: describeChanges(spec, blocks), reply: 'Back to the simpler version.', source: 'on_device' };
  }
  const prompt = chatTurnPrompt(JSON.stringify(spec), history.slice(-6), message);
  const mode = modeFor('edit', ctx);
  let turn: Awaited<ReturnType<typeof chatTurnOnce>>;
  try {
    turn = await withDeviceFallback(mode, onEvent, (m) => chatTurnOnce(prompt, m, onEvent));
  } catch (e) {
    // The model's answer couldn't be read twice over (it echoed the format, or broke off): say so
    // in words, never as a raw JSON error. Real outages (no connection, quota) still surface.
    if (e instanceof SyntaxError || /JSON|empty reply/i.test(e instanceof Error ? e.message : '')) {
      return {
        kind: 'answer',
        source: 'in_cloud',
        text: 'I didn’t catch that one. Could you say it another way? For example: “add a note field” or “make the button bigger”.',
      };
    }
    throw e;
  }
  // Keep only what was asked for; if the model invented something, ask it once more, saying what.
  const vet = (t: typeof turn) => {
    if (!t.app) return [];
    const v = vetEdit(spec, t.app, message);
    t.app = v.spec;
    return v.rejected;
  };
  const rejected = vet(turn);
  if (rejected.length) {
    const again = `${prompt}\n\nYour last answer ${rejected.join(' and ')}. Do only what the user asked, using the blocks and their settings (a random block can take its count, sides, range or list from another field with countFrom / sidesFrom / minFrom / maxFrom / optionsFrom). If you're not sure what they mean, set "app" to null and ask one short question in "reply".`;
    try {
      const second = await withDeviceFallback(mode, onEvent, (m) => chatTurnOnce(again, m, onEvent));
      vet(second);
      turn = second;
    } catch {
      // Keep the first answer, minus what was removed.
    }
  }
  const edit = (t: typeof turn) => (t.app ? describeChanges(spec, t.app) : []);
  let changes = edit(turn);
  // The model sent the app back unchanged while saying it changed something (or said nothing):
  // the edit was lost on the way. Ask once more, pointing that out, before giving up.
  // Also when it says it changed the app but sent no app at all ("I've extended the chart").
  const lost = turn.app ? !changes.length && (!turn.reply || CLAIMS_CHANGE.test(turn.reply)) : SAYS_DONE.test(turn.reply);
  if (lost && !rejected.length) {
    const again = `${prompt}\n\nYour last answer returned the app unchanged. If the user asked for any change, return the full app with that change applied (use "code" for what the blocks can't do). If they didn't ask for a change, set "app" to null and just reply.`;
    try {
      turn = await withDeviceFallback(mode, onEvent, (m) => chatTurnOnce(again, m, onEvent));
      changes = edit(turn);
    } catch {
      // Keep the first answer.
    }
  }
  // An app built in code shows its code, not its blocks: a change that only touched the blocks
  // would never show. Carry the ask into the brief so the code is rebuilt with it.
  // Also when the model replied but sent no app: a code app can still take any change in its code.
  if (spec.code && (turn.app ? turn.app.code === spec.code : !rejected.length && SAYS_DONE.test(turn.reply))) {
    turn.app = { ...(turn.app ?? spec), code: withLatestChange(spec.code, message) };
    changes = describeChanges(spec, turn.app);
  }
  if (turn.app && changes.length) return { kind: 'edit', spec: turn.app, changes, reply: turn.reply, source: turn.source };
  const noChange =
    'I couldn’t work out a change from that, so the app is as it was. Try naming what to change, e.g. “add a daily total of calories” or “make the AI answers shorter”.';
  // No change: show the model's own words, unless they claim a change that didn't happen. If what
  // it tried was something nobody asked for, say so and ask, rather than guess again.
  const unsure = 'I wasn’t sure how to do that without adding things you didn’t ask for. Which block should change, and how? For example: “make the Number of Dice choice set how many dice roll”.';
  const reply =
    turn.reply && !(turn.app && CLAIMS_CHANGE.test(turn.reply))
      ? turn.reply
      : (explainConnections(spec, message) ?? (rejected.length ? unsure : noChange));
  return { kind: 'answer', source: turn.source, text: reply };
}

/** "Go back to the blocks", "use the widgets again", "stop using code". */
const BACK_TO_BLOCKS = /\b(back to|go back to|use|switch to|return to)\s+(the\s+)?(blocks?|built.?in|widgets?|original|normal|simple)( version| app)?\b|\b(stop using|remove|undo|drop)\s+(the\s+)?(code|custom)( version)?\b/i;

/** A reply in which the model says it has already made a change. */
const SAYS_DONE = /\b(i('ve| have)|i)\s+(just\s+)?(added|changed|updated|removed|renamed|made|turned|replaced|switched|extended|set|increased|decreased|moved|generated|created|built|wrote|written)\b|\b(is|are) now\b|\bnow (has|shows|uses|rolls|includes)\b/i;

/** A reply that says the app was changed. */
const CLAIMS_CHANGE = /\b(added|add(ing)?|changed|updated|removed|renamed|made|turned|replaced|switched|set|now (has|shows|uses|rolls|is))\b/i;

export async function runAction(prompt: string, ctx: RouteContext): Promise<GenerateResult> {
  const problem = appModeProblem(ctx);
  if (problem) throw new Error(problem);
  return withDeadline(engine.generate(prompt, { mode: modeFor('action', ctx), system: ACTION_SYSTEM }), REQUEST_MS).catch(
    (e: unknown) => {
      throw e instanceof StalledError ? new Error('The AI didn’t answer within a minute. Try again.') : explainCloudError(e);
    },
  );
}

export async function buildCustomHtml(request: string, ctx: RouteContext, spec?: AppSpec, currentHtml?: string, errors?: string[]): Promise<string> {
  // The design may carry a brief for exactly what to write (see AppSpec.code).
  if (onDeviceOnly) throw new Error('Custom apps need the cloud, and this build runs in offline (on-device only) mode.');
  if (local(ctx)) throw new Error('Custom apps are written by Gemini in the cloud. Connect to the internet and turn off private mode.');
  const { text } = await engine.generate(htmlPrompt(request, spec && JSON.stringify({ ...spec, code: undefined }), spec?.code, currentHtml, errors), {
    mode: 'only_in_cloud',
    system: HTML_SYSTEM,
  });
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const html = (fenced ? fenced[1] : text).trim();
  if (!/<html|<!doctype/i.test(html)) throw new Error('Gemini did not return an HTML document. Try again.');
  return cleanCustomHtml(html);
}
