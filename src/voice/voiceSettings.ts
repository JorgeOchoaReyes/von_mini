/**
 * How replies sound: which installed voice, how fast, how high. Stored on the device and read by
 * every spoken reply (voice chats, the Chat tab, voice blocks), so changing it in Settings changes
 * it everywhere at once.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export interface VoiceSettings {
  /** A voice identifier from the device (Speech.getAvailableVoicesAsync); undefined = default. */
  voice?: string;
  /** 1 is normal; 0.8 slower, 1.25 faster. */
  rate: number;
  /** 1 is normal; below is lower, above is higher. */
  pitch: number;
}

const KEY = 'vm:voice-settings';
export const DEFAULT_VOICE: VoiceSettings = { rate: 1.02, pitch: 1 };

let current: VoiceSettings = DEFAULT_VOICE;
const listeners = new Set<() => void>();

AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<VoiceSettings>;
    current = {
      voice: typeof v.voice === 'string' ? v.voice : undefined,
      rate: typeof v.rate === 'number' ? Math.min(1.6, Math.max(0.6, v.rate)) : DEFAULT_VOICE.rate,
      pitch: typeof v.pitch === 'number' ? Math.min(1.5, Math.max(0.6, v.pitch)) : DEFAULT_VOICE.pitch,
    };
    listeners.forEach((l) => l());
  })
  .catch(() => undefined);

export const getVoiceSettings = () => current;

export function setVoiceSettings(patch: Partial<VoiceSettings>) {
  current = { ...current, ...patch };
  void AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => undefined);
  listeners.forEach((l) => l());
}

export function useVoiceSettings(): VoiceSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
