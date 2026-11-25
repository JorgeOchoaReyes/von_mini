/** Hooks shared by every voice surface: support detection and a listen/stop controller. */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAI } from '../ai/AIContext';
import { listen, sttSupport } from './stt';
import type { Listening, SttSupport } from './types';

let cached: Promise<SttSupport> | null = null;

/** Whether speech recognition exists here and whether it can run on the device. */
export function useSttSupport(): SttSupport | null {
  const [s, setS] = useState<SttSupport | null>(null);
  useEffect(() => {
    let alive = true;
    cached ??= sttSupport();
    void cached.then((v) => alive && setS(v));
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

export type MicState = 'idle' | 'listening' | 'error';

/**
 * Tap-to-talk controller. `start()` listens until the user stops talking (or taps again) and
 * resolves with the transcript; partial text streams through `onPartial`.
 */
export function useListener(onPartial?: (text: string) => void) {
  const ai = useAI();
  const [state, setState] = useState<MicState>('idle');
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Listening | null>(null);
  const partialRef = useRef(onPartial);
  useEffect(() => {
    partialRef.current = onPartial;
  }, [onPartial]);

  useEffect(() => () => current.current?.stop(), []);

  const start = useCallback(async (): Promise<string> => {
    if (current.current) {
      current.current.stop();
      return '';
    }
    setError(null);
    setState('listening');
    const l = listen({ offline: !ai.online || ai.privateMode || ai.locked, onPartial: (t) => partialRef.current?.(t) });
    current.current = l;
    try {
      const text = await l.done;
      setState('idle');
      // The first real use can reveal more (e.g. that recognition runs on-device): re-check later.
      cached = null;
      return text;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
      return '';
    } finally {
      current.current = null;
    }
  }, [ai.online, ai.privateMode, ai.locked]);

  const stop = useCallback(() => current.current?.stop(), []);

  return { state, error, start, stop, clearError: () => setError(null) };
}
