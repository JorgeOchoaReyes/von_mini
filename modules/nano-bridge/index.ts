import { NativeModule, requireOptionalNativeModule } from 'expo';

export type NanoBridgeEvents = {
  onDownloadProgress: (event: { downloaded: number; total: number }) => void;
};

declare class NanoBridgeModule extends NativeModule<NanoBridgeEvents> {
  getStatus(cloudModel: string): Promise<string>;
  download(cloudModel: string): Promise<string>;
  generate(
    prompt: string,
    cloudModel: string,
    mode: string,
    system: string | null,
    json: boolean,
  ): Promise<{ text: string; source: 'on_device' | 'in_cloud' }>;
}

/** Null when the native module isn't compiled in (web, iOS, or Expo Go). */
export default requireOptionalNativeModule<NanoBridgeModule>('NanoBridge');
