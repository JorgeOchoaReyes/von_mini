/**
 * Whether von mini may notify you: build/change alerts and apps' daily reminders, each switchable
 * in Settings. Stored on the device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export interface AlertPrefs {
  /** "Your app is ready" / "Couldn't build your app" / "… updated". */
  builds: boolean;
  /** Daily reminders scheduled by apps' reminder blocks. */
  reminders: boolean;
}

const KEY = 'vm:alert-prefs';
let current: AlertPrefs = { builds: true, reminders: true };
const listeners = new Set<() => void>();

/** Resolves once the stored preferences are loaded, so a check never uses the defaults by mistake. */
export const alertPrefsReady: Promise<void> = AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<AlertPrefs>;
    current = { builds: v.builds !== false, reminders: v.reminders !== false };
    listeners.forEach((l) => l());
  })
  .catch(() => undefined);

export const getAlertPrefs = () => current;

export function setAlertPrefs(patch: Partial<AlertPrefs>) {
  current = { ...current, ...patch };
  void AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => undefined);
  listeners.forEach((l) => l());
}

export function useAlertPrefs(): AlertPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
