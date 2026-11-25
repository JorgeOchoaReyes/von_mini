/**
 * Engine evaluation hook. Compiled in only for a web build made with EXPO_PUBLIC_ENGINE_EVAL=true
 * (the "Engine eval" GitHub workflow), never in the app people use. It lets a test script send
 * real requests through the same pipeline the app uses: prompts, model, validation, chat turns.
 */
import { engine } from '../ai/engineSelect';
import { buildAppProgressive, buildCustomHtml, chatAboutApp, type RouteContext } from '../ai/hybrid';
import type { AppSpec } from '../spec/types';
import { saveApp } from '../storage/store';

const evalEnabled = process.env.EXPO_PUBLIC_ENGINE_EVAL === 'true';

async function timed<T>(work: () => Promise<T>) {
  try {
    return { ok: true as const, value: await work() };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export function installEvalHook() {
  if (!evalEnabled) return;
  const ctx = async (): Promise<RouteContext> => ({ online: true, privateMode: false, deviceStatus: await engine.status() });
  (globalThis as { __vmEval?: unknown }).__vmEval = {
    async build(request: string) {
      const t0 = Date.now();
      const r = await timed(async () => buildAppProgressive(request, await ctx(), () => undefined));
      return { ...r, ms: Date.now() - t0 };
    },
    async chat(spec: AppSpec, history: { role: string; text: string }[], message: string) {
      const t0 = Date.now();
      const r = await timed(async () => chatAboutApp(spec, history, message, await ctx()));
      return { ...r, ms: Date.now() - t0 };
    },
    /** Saves a design as an app on this device, so the script can open it and check it renders. */
    async save(spec: AppSpec, id: string) {
      await saveApp({ id, request: spec.name, spec, builtWith: 'in_cloud', createdAt: Date.now(), updatedAt: Date.now() });
      return id;
    },
    async html(request: string, spec: AppSpec) {
      const t0 = Date.now();
      const r = await timed(async () => buildCustomHtml(request, await ctx(), spec));
      return { ...r, ms: Date.now() - t0 };
    },
  };
}
