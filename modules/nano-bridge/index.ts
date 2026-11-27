import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Which on-device model to ask for. Gemini Nano 4 is published as the PREVIEW options. */
export type DeviceModel = 'nano4' | 'nano4_fast' | 'stable';

export type NanoBridgeEvents = {
  onDownloadProgress: (event: { downloaded: number; total: number }) => void;
  /**
   * One chunk of a streamed response. Older APKs send everything produced so far for that
   * streamId in `text`; newer ones set `delta` and send only the new part.
   */
  onStreamChunk: (event: {
    streamId: string;
    text: string;
    delta?: boolean;
    done: boolean;
    source?: 'on_device' | 'in_cloud';
    error?: string | null;
  }) => void;
};

declare class NanoBridgeModule extends NativeModule<NanoBridgeEvents> {
  getStatus(cloudModel: string, deviceModel: DeviceModel): Promise<string>;
  /** The concrete on-device model name, e.g. "nano-v4-full". Empty when unknown. */
  getModelName(cloudModel: string, deviceModel: DeviceModel): Promise<string>;
  download(cloudModel: string, deviceModel: DeviceModel): Promise<string>;
  warmUp(cloudModel: string, deviceModel: DeviceModel): Promise<boolean>;
  /** Firebase Remote Config: sets defaults, fetches (throttled) and activates, returns all values. */
  remoteConfig(defaults: Record<string, string>): Promise<{ values: Record<string, string>; fetched: boolean }>;
  generate(
    prompt: string,
    cloudModel: string,
    mode: string,
    system: string | null,
    json: boolean,
    deviceModel: DeviceModel,
  ): Promise<{ text: string; source: 'on_device' | 'in_cloud' }>;
  /** The last native crash's stack trace (then forgotten), or null. Newer APKs only. */
  takeNativeCrash?(): string | null;
  /** True when streams send only the new text (`delta`). Newer APKs only. */
  streamsDeltas?(): boolean;
  /** Keeps the app alive in the background while work runs (a foreground service). Newer APKs only. */
  startKeepAlive?(title: string): boolean;
  stopKeepAlive?(): void;
  streamGenerate(
    prompt: string,
    cloudModel: string,
    mode: string,
    system: string | null,
    json: boolean,
    deviceModel: DeviceModel,
    streamId: string,
  ): Promise<void>;
}

/** Null when the native module isn't compiled in (web, iOS, or Expo Go). */
export default requireOptionalNativeModule<NanoBridgeModule>('NanoBridge');
