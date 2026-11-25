export interface ListenOptions {
  /** Called with the transcript so far while the user is speaking. */
  onPartial?(text: string): void;
  lang?: string;
  /** True when the app is offline or in private mode: recognition must not use the network. */
  offline: boolean;
}

export interface Listening {
  /** Resolves with the final transcript ('' when nothing was said). */
  done: Promise<string>;
  /** Stops listening early; `done` then resolves with what was heard so far. */
  stop(): void;
}

export interface SttSupport {
  /** Speech recognition exists on this device / browser. */
  available: boolean;
  /** It can run without the network. */
  onDevice: boolean;
}
