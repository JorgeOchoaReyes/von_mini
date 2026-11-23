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
import { sanitizeSpec, extractJson } from '../spec/validate';
import { appSpecJsonSchema, type AppSpec } from '../spec/types';
import { engine } from './engine';
import { ACTION_SYSTEM, HTML_SYSTEM, SPEC_SYSTEM, editSpecPrompt, htmlPrompt, specPrompt } from './prompts';
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

export async function editApp(
  spec: AppSpec,
  change: string,
  ctx: RouteContext,
): Promise<{ spec: AppSpec; source: InferenceSource }> {
  return generateSpec(editSpecPrompt(JSON.stringify(spec), change), modeFor('edit', ctx));
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
