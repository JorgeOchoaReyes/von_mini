// Web engine: Firebase AI Logic JS SDK with hybrid inference.
// On-device requests run on Chrome's built-in Gemini Nano; cloud requests go to Gemini.
import { getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceSource, type GenerativeModel } from 'firebase/ai';

import { appCheckDebugToken, cloudModel, firebaseWebConfig, onDeviceOnly, recaptchaSiteKey } from '../config';
import type { AIEngine, DeviceStatus, GenerateOptions } from './types';

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

const normalize = (s: string): DeviceStatus =>
  s === 'available' || s === 'downloadable' || s === 'downloading' ? s : 'unavailable';

export const engine: AIEngine = {
  runtime: 'chrome',

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

  async generate(prompt, options) {
    if (options.mode === 'only_on_device') {
      const status = await this.status();
      if (status !== 'available') {
        throw new Error(
          status === 'downloadable' || status === 'downloading'
            ? 'Gemini Nano is not downloaded yet. Tap "Download Gemini Nano" on the home screen and try again.'
            : 'Gemini Nano is not available in this browser. Use desktop Chrome with built-in AI (check chrome://on-device-internals).',
        );
      }
    }
    const result = await model(options).generateContent(prompt);
    return {
      text: result.response.text(),
      source: result.response.inferenceSource === InferenceSource.ON_DEVICE ? 'on_device' : 'in_cloud',
    };
  },
};
