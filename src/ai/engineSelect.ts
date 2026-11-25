/**
 * Picks the AI engine at runtime, and wraps it with a cloud-quota fallback.
 *
 * Normally this is the real Firebase AI Logic engine (native on Android, `firebase/ai` on web).
 * A development-only mock can be enabled with `EXPO_PUBLIC_MOCK_ENGINE=true` so the build/edit
 * flows can be exercised — and screenshotted — on machines without Gemini Nano. It is never on
 * by default and never runs in a release build (see `mockEngine.ts`).
 *
 * Quota fallback: Gemini's free tier allows only a few requests per day per model (20 for
 * gemini-3.8-flash), and each build makes several. When the cloud says the model's quota is used
 * up, the same request is retried once on `cloud_model_fallback` (Remote Config), which has its
 * own quota. A stream is retried only if it failed before producing any text.
 */
import { rcString } from '../remote/remoteConfig';
import { engine as platformEngine } from './engine';
import { mockEngine, mockEnabled } from './mockEngine';
import type { AIEngine, GenerateChunk, GenerateOptions } from './types';

/** The cloud says this model's request quota (per minute or per day) is used up. */
export function isQuotaError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /quota|resource.?exhausted|QuotaExceeded|rate.?limit|\b429\b|too many requests/i.test(msg);
}

function fallbackModel(o: GenerateOptions, e: unknown): string | null {
  if (o.mode === 'only_on_device' || !isQuotaError(e)) return null;
  const fb = rcString('cloud_model_fallback').trim();
  const used = o.model ?? rcString('cloud_model');
  return fb && fb !== used ? fb : null;
}

function withQuotaFallback(base: AIEngine): AIEngine {
  return {
    ...base,
    async generate(prompt, o) {
      try {
        return await base.generate(prompt, o);
      } catch (e) {
        const fb = fallbackModel(o, e);
        if (!fb) throw e;
        return base.generate(prompt, { ...o, model: fb });
      }
    },
    async *stream(prompt, o): AsyncIterable<GenerateChunk> {
      let yielded = false;
      try {
        for await (const chunk of base.stream(prompt, o)) {
          yielded = true;
          yield chunk;
        }
      } catch (e) {
        const fb = yielded ? null : fallbackModel(o, e);
        if (!fb) throw e;
        yield* base.stream(prompt, { ...o, model: fb });
      }
    },
  };
}

export const engine: AIEngine = withQuotaFallback(mockEnabled ? mockEngine : platformEngine);
