// Native (Android / iOS) engine. Web uses engine.web.ts instead (Metro picks it by extension).
import NanoBridge from '../../modules/nano-bridge';

import { rcString } from '../remote/remoteConfig';
import { getDeviceModel } from './deviceModel';
import type { AIEngine, DeviceStatus, GenerateChunk } from './types';

const missing =
  'On-device AI bridge is not available. Run a development build on Android (npx expo run:android); Expo Go cannot load it.';

/** Chunks arrive as native events keyed by stream id; this joins them back into an async iterator. */
interface StreamEvent {
  streamId: string;
  text: string;
  /** Set by newer APKs: `text` is only the new part. */
  delta?: boolean;
  done: boolean;
  source?: 'on_device' | 'in_cloud';
  error?: string | null;
}

let streamSeq = 0;

export const engine: AIEngine = {
  runtime: NanoBridge ? 'android-aicore' : 'none',
  streaming: true,

  longStreams() {
    try {
      return NanoBridge?.streamsDeltas?.() === true;
    } catch {
      return false;
    }
  },

  async status() {
    if (!NanoBridge) return 'unsupported';
    try {
      return (await NanoBridge.getStatus(rcString('cloud_model'), getDeviceModel())) as DeviceStatus;
    } catch {
      return 'unavailable';
    }
  },

  /** The concrete on-device model in use, e.g. "nano-v4-full". */
  async modelName() {
    if (!NanoBridge) return '';
    try {
      return await NanoBridge.getModelName(rcString('cloud_model'), getDeviceModel());
    } catch {
      return '';
    }
  },

  async download(onProgress) {
    if (!NanoBridge) return 'unsupported';
    const sub = NanoBridge.addListener('onDownloadProgress', (e) => onProgress?.(e.downloaded, e.total));
    try {
      return (await NanoBridge.download(rcString('cloud_model'), getDeviceModel())) as DeviceStatus;
    } finally {
      sub.remove();
    }
  },

  /** Loads the model so the first user-visible request is not the one paying for it. */
  async warmUp() {
    if (!NanoBridge) return false;
    try {
      return await NanoBridge.warmUp(rcString('cloud_model'), getDeviceModel());
    } catch {
      return false;
    }
  },

  async generate(prompt, { mode, system, json, model }) {
    if (!NanoBridge) throw new Error(missing);
    return NanoBridge.generate(prompt, model ?? rcString('cloud_model'), mode, system ?? null, !!json, getDeviceModel());
  },

  async *stream(prompt, options): AsyncIterable<GenerateChunk> {
    if (!NanoBridge) throw new Error(missing);
    const id = `s${++streamSeq}`;
    const queue: StreamEvent[] = [];
    let notify: (() => void) | null = null;
    let finished = false;
    let failure: string | null = null;

    const sub = NanoBridge.addListener('onStreamChunk', (e) => {
      if (e.streamId !== id) return;
      queue.push(e);
      if (e.done) {
        finished = true;
        if (e.error) failure = e.error;
      }
      notify?.();
    });

    try {
      // Not awaited: the promise resolves when the native stream is drained, which is signalled
      // by the final event we consume below.
      NanoBridge.streamGenerate(prompt, options.model ?? rcString('cloud_model'), options.mode, options.system ?? null, !!options.json, getDeviceModel(), id).catch(
        (e: unknown) => {
          failure = e instanceof Error ? e.message : String(e);
          finished = true;
          notify?.();
        },
      );

      let lastText = '';
      let source: 'on_device' | 'in_cloud' = options.mode === 'only_in_cloud' ? 'in_cloud' : 'on_device';
      for (;;) {
        // Newer APKs send only the new part (joined here); older ones the whole text so far, where
        // only the newest of several waiting events matters.
        if (queue.length) {
          for (const e of queue) {
            if (e.source) source = e.source;
            if (e.delta) lastText += e.text;
            else if (e.text) lastText = e.text;
          }
          queue.length = 0;
          if (lastText) yield { text: lastText, source };
        }
        if (finished) break;
        await new Promise<void>((r) => {
          notify = r;
        });
        notify = null;
      }
      if (failure) throw new Error(failure);
      if (!lastText.trim()) yield await this.generate(prompt, options);
    } finally {
      sub.remove();
    }
  },
};
