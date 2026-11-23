/** Mirrors Firebase AI Logic's InferenceMode values (identical on web and Android). */
export type InferenceMode = 'prefer_on_device' | 'only_on_device' | 'prefer_in_cloud' | 'only_in_cloud';

/** Where a response was actually produced. */
export type InferenceSource = 'on_device' | 'in_cloud';

/** Gemini Nano availability on this device. */
export type DeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

export interface GenerateOptions {
  mode: InferenceMode;
  /** System instruction for the model. */
  system?: string;
  /** Ask for JSON output. */
  json?: boolean;
  /** JSON Schema used to constrain on-device output where supported (web). */
  schema?: object;
}

export interface GenerateResult {
  text: string;
  source: InferenceSource;
}

export interface AIEngine {
  /** Which on-device runtime this engine uses. */
  readonly runtime: 'chrome' | 'android-aicore' | 'none';
  status(): Promise<DeviceStatus>;
  /** Starts (or waits for) the on-device model download. */
  download(onProgress?: (downloaded: number, total: number) => void): Promise<DeviceStatus>;
  generate(prompt: string, options: GenerateOptions): Promise<GenerateResult>;
}
