// Web engine: Firebase AI Logic JS SDK with hybrid inference.
// On-device requests run on Chrome's built-in Gemini Nano; cloud requests go to Gemini.
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource, type GenerativeModel } from 'firebase/ai';

import { firebaseApp } from '../firebase/app';
import { rcString } from '../remote/remoteConfig';
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
  ai ??= getAI(firebaseApp(), { backend: new GoogleAIBackend() });
  return ai;
}

const models = new Map<string, GenerativeModel>();
function model({ mode, system, json, schema, model: modelName }: GenerateOptions) {
  // The cloud model comes from Remote Config, so it can be switched without shipping a build.
  const cloudModel = modelName ?? rcString('cloud_model');
  const key = JSON.stringify([cloudModel, mode, system ?? '', !!json, schema ?? null]);
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
    const m = model(options);
    if (typeof m.generateContentStream !== 'function') {
      yield await this.generate(prompt, options);
      return;
    }
    let emitted = false;
    try {
      const result = await m.generateContentStream(prompt);
      let text = '';
      // Report where each chunk actually ran: with prefer_* modes the SDK can fall back either way.
      let source: Source = options.mode === 'only_in_cloud' || options.mode === 'prefer_in_cloud' ? 'in_cloud' : 'on_device';
      for await (const chunk of result.stream) {
        if (chunk.inferenceSource) source = chunk.inferenceSource === InferenceSource.ON_DEVICE ? 'on_device' : 'in_cloud';
        const piece = chunk.text();
        if (!piece) continue;
        // Some SDK builds emit cumulative text and others emit deltas; handle both.
        text = piece.startsWith(text) ? piece : text + piece;
        emitted = true;
        yield { text, source };
      }
      if (!emitted || !text.trim()) yield await this.generate(prompt, options);
    } catch (e) {
      // Fall back to one whole response only if nothing was produced; otherwise retrying would
      // double the request (and its cost) and hide the real error.
      if (emitted) throw e;
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
