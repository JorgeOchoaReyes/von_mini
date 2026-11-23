// Web engine: Firebase AI Logic JS SDK with hybrid inference.
// On-device requests run on Chrome's built-in Gemini Nano; cloud requests go to Gemini.
import { getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource, type GenerativeModel } from 'firebase/ai';

import { appCheckDebugToken, cloudModel, firebaseWebConfig, onDeviceOnly, recaptchaSiteKey } from '../config';
import type { AIEngine, DeviceStatus, GenerateOptions, InferenceSource as Source } from './types';

/** Chrome's built-in Prompt API global (only present in supported desktop Chrome). */
type LanguageModelGlobal = {
  availability(options?: object): Promise<string>;
  create(options?: {
    monitor?: (m: EventTarget) => void;
  }): Promise<{ destroy(): void }>;
};
const languageModel = (): LanguageModelGlobal | undefined =>
  (globalThis as { LanguageModel?: LanguageModelGlobal }).LanguageModel;

let ai: ReturnType<typeof getAI> | undefined;
function firebaseAI() {
  if (ai) return ai;
  if (!firebaseWebConfig.apiKey) {
    throw new Error('Firebase is not configured. Copy .env.example to .env.local and fill it in (see README).');
  }
  const app = getApps()[0] ?? initializeApp(firebaseWebConfig);
  if (appCheckDebugToken) {
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken;
  }
  if (recaptchaSiteKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } else if (!onDeviceOnly) {
    // On-device-only (offline) mode never calls the cloud, so App Check is not needed there.
    console.warn('App Check is not initialized: set EXPO_PUBLIC_RECAPTCHA_SITE_KEY.');
  }
  ai = getAI(app, { backend: new GoogleAIBackend() });
  return ai;
}

const models = new Map<string, GenerativeModel>();
function model({ mode, system, json, schema }: GenerateOptions) {
  const key = JSON.stringify([mode, system ?? '', !!json, schema ?? null]);
  let m = models.get(key);
  if (!m) {
    m = getGenerativeModel(firebaseAI(), {
      mode,
      inCloudParams: {
        model: cloudModel,
        systemInstruction: system,
        generationConfig: json ? { responseMimeType: 'application/json' } : undefined,
      },
      onDeviceParams: {
        createOptions: system ? { initialPrompts: [{ role: 'system', content: [{ type: 'text', value: system }] }] } : undefined,
        promptOptions: schema ? { responseConstraint: schema } : undefined,
      },
    });
    models.set(key, m);
  }
  return m;
}

/** A model instance that can only run on-device; used for warm-up and for reporting the model name. */
let deviceModelInstance: GenerativeModel | undefined;
function onDeviceOnlyModel() {
  deviceModelInstance ??= getGenerativeModel(firebaseAI(), { mode: InferenceMode.ONLY_ON_DEVICE });
  return deviceModelInstance;
}

/**
 * Chrome's Prompt API reports the concrete model name (for example "Gemini Nano").
 *
 * Only reported once the model is actually usable: the API can be present while the model is
 * still downloading, and claiming a model is "loaded" then would contradict the status banner.
 */
async function chromeModelName(): Promise<string> {
  const lm = languageModel() as (LanguageModelGlobal & { params?: () => Promise<Record<string, unknown>> }) | undefined;
  if (!lm) return '';
  try {
    if ((await lm.availability()) !== 'available') return '';
    const p = await lm.params?.();
    const name = p && typeof p === 'object' ? (p as { modelName?: string }).modelName : undefined;
    return typeof name === 'string' && name ? name : 'Gemini Nano (Chrome)';
  } catch {
    return '';
  }
}

const normalize = (s: string): DeviceStatus =>
  s === 'available' || s === 'downloadable' || s === 'downloading' ? s : 'unavailable';

export const engine: AIEngine = {
  runtime: 'chrome',
  streaming: true,

  async status() {
    const lm = languageModel();
    if (!lm) return 'unsupported';
    try {
      return normalize(await lm.availability());
    } catch {
      return 'unavailable';
    }
  },

  async download(onProgress) {
    const lm = languageModel();
    if (!lm) return 'unsupported';
    // Creating a session triggers the download; must be called from a user gesture.
    const session = await lm.create({
      monitor: (m) =>
        m.addEventListener('downloadprogress', (e) => {
          const loaded = (e as ProgressEvent).loaded;
          onProgress?.(loaded, 1);
        }),
    });
    session.destroy();
    return this.status();
  },

  async modelName() {
    return chromeModelName();
  },

  /**
   * Firebase AI Logic requires `initializeDeviceModel()` to be called on or after a user gesture
   * and before the first on-device request; it loads the model so the first real prompt is fast.
   * Best-effort: if the SDK build or browser does not support it, the request path still works.
   */
  async warmUp() {
    const m = onDeviceOnlyModel() as GenerativeModel & { initializeDeviceModel?: (cb?: (p: number) => void) => Promise<void> };
    if (typeof m.initializeDeviceModel !== 'function') return false;
    try {
      await m.initializeDeviceModel();
      return true;
    } catch {
      return false;
    }
  },

  async generate(prompt, options) {
    await assertOnDeviceReady(options, this);
    const result = await model(options).generateContent(prompt);
    return {
      text: result.response.text(),
      source: result.response.inferenceSource === InferenceSource.ON_DEVICE ? 'on_device' : 'in_cloud',
    };
  },

  /**
   * Streams the response so the UI can show output as it arrives. `generateContentStream` is a
   * long-standing part of the JS SDK; if a build of it is missing or the stream fails, this falls
   * back to a single whole-response chunk rather than failing the request.
   */
  async *stream(prompt, options) {
    await assertOnDeviceReady(options, this);
    const m = model(options) as GenerativeModel & {
      generateContentStream?: (input: string) => Promise<{ stream: AsyncIterable<{ text(): string }> }>;
    };
    if (typeof m.generateContentStream !== 'function') {
      yield await this.generate(prompt, options);
      return;
    }
    try {
      const result = await m.generateContentStream(prompt);
      let text = '';
      const source: Source = options.mode === 'only_in_cloud' ? 'in_cloud' : 'on_device';
      let emitted = false;
      for await (const chunk of result.stream) {
        const piece = chunk.text();
        if (!piece) continue;
        // Some SDK builds emit cumulative text and others emit deltas; handle both.
        text = piece.startsWith(text) ? piece : text + piece;
        emitted = true;
        yield { text, source };
      }
      if (!emitted || !text.trim()) yield await this.generate(prompt, options);
    } catch {
      yield await this.generate(prompt, options);
    }
  },
};

/** On-device-only requests need the model present; give a useful message instead of a raw failure. */
async function assertOnDeviceReady(options: GenerateOptions, e: AIEngine) {
  if (options.mode !== 'only_on_device') return;
  const status = await e.status();
  if (status === 'available') return;
  throw new Error(
    status === 'downloadable' || status === 'downloading'
      ? 'Gemini Nano is not downloaded yet. Tap "Download Gemini Nano" on the home screen and try again.'
      : 'Gemini Nano is not available in this browser. Use desktop Chrome with built-in AI (check chrome://on-device-internals).',
  );
}
