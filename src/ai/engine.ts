// Native (Android / iOS) engine. Web uses engine.web.ts instead (Metro picks it by extension).
import NanoBridge from '../../modules/nano-bridge';

import { cloudModel } from '../config';
import type { AIEngine, DeviceStatus } from './types';

const missing =
  'On-device AI bridge is not available. Run a development build on Android (npx expo run:android); Expo Go cannot load it.';

export const engine: AIEngine = {
  runtime: NanoBridge ? 'android-aicore' : 'none',
  streaming: false,

  async status() {
    if (!NanoBridge) return 'unsupported';
    try {
      return (await NanoBridge.getStatus(cloudModel)) as DeviceStatus;
    } catch {
      return 'unavailable';
    }
  },

  async download(onProgress) {
    if (!NanoBridge) return 'unsupported';
    const sub = NanoBridge.addListener('onDownloadProgress', (e) => onProgress?.(e.downloaded, e.total));
    try {
      return (await NanoBridge.download(cloudModel)) as DeviceStatus;
    } finally {
      sub.remove();
    }
  },

  async generate(prompt, { mode, system, json }) {
    if (!NanoBridge) throw new Error(missing);
    return NanoBridge.generate(prompt, cloudModel, mode, system ?? null, !!json);
  },

  // The native module returns a whole response; yield it as one chunk so callers have one code path.
  async *stream(prompt, options) {
    yield await this.generate(prompt, options);
  },
};
