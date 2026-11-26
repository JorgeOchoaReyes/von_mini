/**
 * Picks the AI engine at runtime, and wraps it with a cloud-quota fallback.
 *
 * Normally this is the real Firebase AI Logic engine (native on Android, `firebase/ai` on web).
 * A development-only mock can be enabled with `EXPO_PUBLIC_MOCK_ENGINE=true` so the build/edit
 * flows can be exercised — and screenshotted — on machines without Gemini Nano. It is never on
 * by default and never runs in a release build (see `mockEngine.ts`).
 *
 * Quota fallback: Gemini's free tier caps requests per day per model (gemini-3.8-flash allows 20),
 * and each build makes several. When the cloud says the model's quota is used up, the same request
 * is retried once on `cloud_model_fallback` (Remote Config), which has its own quota. A stream is
 * retried only if it failed before producing any text.
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

/** How long the cloud asked us to wait ("Please retry in 12.5s" / "1h2m3s"), in ms. */
export function retryAfterMs(e: unknown): number | null {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/retry in\s*(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/i);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return ((Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (parseFloat(m[3] ?? '') || 0)) * 1000;
}

/**
 * A per-minute limit (ours or Google's): worth waiting a few seconds and trying again, rather than
 * failing. Daily limits ("retry in 12h…") are not.
 */
export function isShortRateLimit(e: unknown): boolean {
  if (!isQuotaError(e)) return false;
  const wait = retryAfterMs(e);
  if (wait !== null) return wait <= SHORT_WAIT_MAX_MS;
  const msg = e instanceof Error ? e.message : String(e);
  return /per ?minute|PerMinute|too many requests|rate.?limit/i.test(msg) && !/per ?day|PerDay/i.test(msg);
}

/**
 * Longest single wait we absorb. Three waits stay around 30 s in total, inside the build's 45 s
 * first-token timeout.
 */
const SHORT_WAIT_MAX_MS = 10_000;
const BACKOFF_MS = [2_000, 5_000, 10_000];

/** Lets the UI say "busy, trying again in 5 s" instead of looking stuck. */
type CloudWaitListener = (waitMs: number) => void;
const waitListeners = new Set<CloudWaitListener>();
export function onCloudWait(cb: CloudWaitListener): () => void {
  waitListeners.add(cb);
  return () => waitListeners.delete(cb);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits before retry number `attempt` (0-based), or returns false when out of retries. */
async function waitForRateLimit(e: unknown, attempt: number): Promise<boolean> {
  if (attempt >= BACKOFF_MS.length || !isShortRateLimit(e)) return false;
  const asked = retryAfterMs(e);
  const ms = Math.min(SHORT_WAIT_MAX_MS, Math.max(asked ?? 0, BACKOFF_MS[attempt])) + Math.random() * 500;
  waitListeners.forEach((cb) => cb(ms));
  await sleep(ms);
  return true;
}

function fallbackModel(o: GenerateOptions, e: unknown): string | null {
  if (o.mode === 'only_on_device' || !isQuotaError(e)) return null;
  const fb = rcString('cloud_model_fallback').trim();
  const used = o.model ?? rcString('cloud_model');
  return fb && fb !== used ? fb : null;
}

/**
 * Keeps our own limits invisible to people using the app:
 * - per-minute limits: wait (as long as the cloud asks, capped) and retry, up to 3 times;
 * - daily limits: retry once on `cloud_model_fallback`, which has its own quota.
 * Anything left over is handled by the caller (Gemini Nano fallback, then a plain message).
 */
function withQuotaFallback(base: AIEngine): AIEngine {
  return {
    ...base,
    async generate(prompt, o) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await base.generate(prompt, o);
        } catch (e) {
          if (await waitForRateLimit(e, attempt)) continue;
          const fb = fallbackModel(o, e);
          if (!fb) throw e;
          return base.generate(prompt, { ...o, model: fb });
        }
      }
    },
    async *stream(prompt, o): AsyncIterable<GenerateChunk> {
      for (let attempt = 0; ; attempt++) {
        let yielded = false;
        try {
          for await (const chunk of base.stream(prompt, o)) {
            yielded = true;
            yield chunk;
          }
          return;
        } catch (e) {
          // Only retry a stream that failed before producing any text.
          if (yielded) throw e;
          if (await waitForRateLimit(e, attempt)) continue;
          const fb = fallbackModel(o, e);
          if (!fb) throw e;
          yield* base.stream(prompt, { ...o, model: fb });
          return;
        }
      }
    },
  };
}

export const engine: AIEngine = withQuotaFallback(mockEnabled ? mockEngine : platformEngine);
