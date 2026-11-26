/**
 * Web: scheduled local notifications aren't available in the browser build, so reminders are
 * Android-only. These keep the same API so callers don't need platform checks.
 */
import type { AlertPermission } from './notifications';

export const alertsSupported = false;

export async function alertPermission(): Promise<AlertPermission> {
  return 'denied';
}
export async function ensureAlertPermission(): Promise<boolean> {
  return false;
}
export function parseTime(t: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}
export async function scheduleDailyReminders(): Promise<boolean> {
  return false;
}
export async function cancelReminders(): Promise<void> {}
export async function cancelRemindersForApp(): Promise<void> {}
export async function cancelOrphanReminders(): Promise<void> {}
export async function notifyIfInBackground(): Promise<void> {}
export async function notify(): Promise<void> {}
export function initAlerts(): () => void {
  return () => undefined;
}

/** Reminders only exist in the Android app; on the web the switch just records the choice. */
export async function setRemindersEnabled(on: boolean): Promise<boolean> {
  const { setAlertPrefs } = await import('./alertPrefs');
  setAlertPrefs({ reminders: on });
  return true;
}
