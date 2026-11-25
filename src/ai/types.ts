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
  /** Cloud model for this request; defaults to Remote Config's `cloud_model`. */
  model?: string;
}

export interface GenerateResult {
  text: string;
  source: InferenceSource;
}

/** One step of a streamed response. `text` is everything produced so far. */
export interface GenerateChunk {
  text: string;
  source: InferenceSource;
}

export interface AIEngine {
  /** Which on-device runtime this engine uses. */
  readonly runtime: 'chrome' | 'android-aicore' | 'none';
  /** True when `stream()` yields real incremental output rather than one final chunk. */
  readonly streaming: boolean;
  status(): Promise<DeviceStatus>;
  /** Starts (or waits for) the on-device model download. */
  download(onProgress?: (downloaded: number, total: number) => void): Promise<DeviceStatus>;
  /**
   * Loads the on-device model ahead of the first real request. Best-effort: false when the
   * platform cannot warm up. Used to take model load time off the user's first interaction.
   */
  warmUp?(): Promise<boolean>;
  /** The concrete on-device model in use, for example "nano-v4-full". Empty when unknown. */
  modelName?(): Promise<string>;
  generate(prompt: string, options: GenerateOptions): Promise<GenerateResult>;
  /**
   * Yields the answer as it is produced. Engines without native streaming yield a single chunk,
   * so callers can always use this and get progressive output when the platform supports it.
   */
  stream(prompt: string, options: GenerateOptions): AsyncIterable<GenerateChunk>;
}
