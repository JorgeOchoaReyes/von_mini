/**
 * Speech-to-text in the browser through the Web Speech API.
 *
 * Chrome can run recognition on the device (`processLocally`, with a per-language model the
 * browser downloads once). That API has changed shape between releases, so everything here is
 * feature-detected: when on-device recognition is available it is always used (private, and it
 * works offline); otherwise Chrome's default recognizer is used, which needs a connection.
 */
import type { Listening, ListenOptions, SttSupport } from './types';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface RecognitionResultList {
  length: number;
  [i: number]: { 0: { transcript: string }; isFinal: boolean };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  processLocally?: boolean;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface RecognitionCtor {
  new (): Recognition;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<Availability>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
  // Earlier Chrome builds shipped these names instead.
  availableOnDevice?: (lang: string) => Promise<Availability>;
  installOnDevice?: (lang: string) => Promise<boolean>;
}

function ctor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Last known on-device availability, filled in the first time the user talks. */
let knownLocal: Availability | null = null;

async function onDeviceAvailability(C: RecognitionCtor, lang: string): Promise<Availability> {
  try {
    if (C.available) knownLocal = await C.available({ langs: [lang], processLocally: true });
    else if (C.availableOnDevice) knownLocal = await C.availableOnDevice(lang);
    else knownLocal = 'unavailable';
  } catch {
    knownLocal = 'unavailable';
  }
  return knownLocal;
}

/** Asks Chrome to fetch the on-device speech model. Must run from a user gesture. */
async function installOnDevice(C: RecognitionCtor, lang: string) {
  try {
    if (C.install) await C.install({ langs: [lang], processLocally: true });
    else if (C.installOnDevice) await C.installOnDevice(lang);
  } catch {
    // Best effort: recognition falls back to the default recognizer when online.
  }
}

/**
 * Cheap capability check, safe to run on page load: it only looks for the API. The on-device
 * check (`SpeechRecognition.available`) is deferred until the user taps a mic, because it talks to
 * the browser's speech service, and in some environments (e.g. headless Chromium) that call
 * crashes the tab. `onDevice` is therefore reported as false until the first use confirms it.
 */
export async function sttSupport(): Promise<SttSupport> {
  return { available: !!ctor(), onDevice: knownLocal === 'available' };
}

export function listen({ onPartial, lang = 'en-US', offline }: ListenOptions): Listening {
  const C = ctor();
  let rec: Recognition | null = null;
  let stopped = false;

  const done = new Promise<string>((resolve, reject) => {
    if (!C) {
      reject(new Error('This browser has no speech recognition. Use Chrome, or type instead.'));
      return;
    }
    void (async () => {
      let local = await onDeviceAvailability(C, lang);
      if (local === 'downloadable') {
        // Start fetching the local model for next time; use it now only if it is ready.
        await installOnDevice(C, lang);
        local = await onDeviceAvailability(C, lang);
      }
      if (offline && local !== 'available') {
        throw new Error('Offline speech recognition is not available in this browser yet. Type instead, or go online.');
      }
      if (stopped) {
        resolve('');
        return;
      }
      let text = '';
      rec = new C();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false;
      if (local === 'available' && 'processLocally' in rec) rec.processLocally = true;
      rec.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        text = t;
        onPartial?.(text);
      };
      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') resolve(text.trim());
        else reject(new Error(friendly(e.error)));
      };
      rec.onend = () => resolve(text.trim());
      rec.start();
    })().catch((e: unknown) => reject(e instanceof Error ? e : new Error(String(e))));
  });

  return {
    done,
    stop: () => {
      stopped = true;
      rec?.stop();
    },
  };
}

function friendly(code: string) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone access was blocked. Allow it in the browser, or type instead.';
  if (code === 'network') return 'Speech recognition needs a connection in this browser. Type instead, or go online.';
  if (code === 'language-not-supported') return 'This language is not supported for speech recognition here.';
  return 'Could not hear that. Try again, or type instead.';
}
