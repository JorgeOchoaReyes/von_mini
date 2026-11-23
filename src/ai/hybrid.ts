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
import type { GenerateResult, InferenceMode, InferenceSource } from './types';

export interface RouteContext {
  online: boolean;
  /** User toggle: never send anything to the cloud. */
  privateMode: boolean;
}

const local = (ctx: RouteContext) => onDeviceOnly || !ctx.online || ctx.privateMode;

export function modeFor(task: 'build' | 'edit' | 'action', ctx: RouteContext): InferenceMode {
  if (local(ctx)) return 'only_on_device';
  return task === 'build' ? 'prefer_in_cloud' : 'prefer_on_device';
}

async function generateSpec(prompt: string, mode: InferenceMode) {
  const opts = { mode, system: SPEC_SYSTEM, json: true, schema: appSpecJsonSchema };
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

async function generateSpecProgressive(
  prompt: string,
  mode: InferenceMode,
  task: 'build' | 'edit',
  onEvent: (e: BuildEvent) => void,
): Promise<{ spec: AppSpec; source: InferenceSource }> {
  const labels = STEP_LABELS[task];
  const opts = { mode, system: SPEC_SYSTEM, json: true, schema: appSpecJsonSchema };
  let attempt = 0;

  for (;;) {
    onEvent({ type: 'step', step: { id: 'read', label: labels[0], state: 'active' } });
    let text = '';
    let source: InferenceSource = 'on_device';
    let sawFirstToken = false;
    for await (const chunk of engine.stream(attempt === 0 ? prompt : `${prompt}\n\nReturn valid JSON only, no other text.`, opts)) {
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
): Promise<ChatReply> {
  if ((await classify(message, ctx)) === 'change') {
    const { spec: next, source } = await editApp(spec, message, ctx);
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
