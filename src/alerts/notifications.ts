/**
 * Local notifications (expo-notifications), scheduled on the phone itself: no server, no push
 * token, and they fire offline.
 *
 * Two uses:
 *   - reminders: an app's `reminder` block schedules daily notifications ("Log your meals" at
 *     08:00, 13:00, 19:00), and tapping one opens that app;
 *   - "your app is ready": when a build or edit finishes while von mini is in the background.
 *
 * Web has its own no-op version (notifications.web.ts).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { AppState, Platform } from 'react-native';

export const alertsSupported = true;

const CHANNELS = {
  reminders: { id: 'reminders', name: 'Reminders from your apps' },
  builds: { id: 'builds', name: 'Builds and edits' },
} as const;

let channelsReady: Promise<void> | null = null;
function ensureChannels() {
  channelsReady ??= (async () => {
    if (Platform.OS !== 'android') return;
    await Notifications.setNotificationChannelAsync(CHANNELS.reminders.id, {
      name: CHANNELS.reminders.name,
      importance: AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.builds.id, {
      name: CHANNELS.builds.name,
      importance: AndroidImportance.DEFAULT,
    });
  })();
  return channelsReady;
}

export type AlertPermission = 'granted' | 'denied' | 'undetermined';

export async function alertPermission(): Promise<AlertPermission> {
  const { status } = await Notifications.getPermissionsAsync();
  return status as AlertPermission;
}

/**
 * Asks for permission if it hasn't been decided yet. Channels are created first: on Android 13+
 * the system prompt only appears once a channel exists.
 */
export async function ensureAlertPermission(): Promise<boolean> {
  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

const storeKey = (key: string) => `vm:alerts:${key}`;

/** Parses "HH:MM" (24h). Returns null for anything else. */
export function parseTime(t: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/**
 * Replaces the daily reminders stored under `key` (e.g. "<appId>:<blockId>") with one per time.
 * Returns false if notifications aren't allowed.
 */
export async function scheduleDailyReminders(
  key: string,
  times: string[],
  content: { title: string; body: string; url: string },
): Promise<boolean> {
  if (!(await ensureAlertPermission())) return false;
  await cancelReminders(key);
  const ids: string[] = [];
  for (const t of times) {
    const at = parseTime(t);
    if (!at) continue;
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: { title: content.title, body: content.body, data: { url: content.url } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: at.hour,
          minute: at.minute,
          channelId: CHANNELS.reminders.id,
        },
      }),
    );
  }
  await AsyncStorage.setItem(storeKey(key), JSON.stringify(ids));
  return true;
}

export async function cancelReminders(key: string): Promise<void> {
  const raw = await AsyncStorage.getItem(storeKey(key));
  const ids: string[] = raw ? JSON.parse(raw) : [];
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  await AsyncStorage.removeItem(storeKey(key));
}

/** Cancels every reminder an app scheduled (used when the app is deleted). */
export async function cancelRemindersForApp(appId: string): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(storeKey(`${appId}:`)));
  for (const k of keys) await cancelReminders(k.slice(storeKey('').length));
}

/**
 * Shows a notification right away, but only when von mini isn't on screen: in the foreground the
 * UI already shows the result.
 */
export async function notifyIfInBackground(content: { title: string; body: string; url: string }) {
  if (AppState.currentState === 'active') return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: { title: content.title, body: content.body, data: { url: content.url } },
      trigger: { channelId: CHANNELS.builds.id },
    });
  } catch {
    // Alerts are a convenience; never let them break a build.
  }
}

/** Foreground presentation, and routing a tapped notification to the screen in its `url`. */
export function initAlerts(openUrl: (url: string) => void): () => void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  const open = (r: Notifications.NotificationResponse | null) => {
    const url = r?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) openUrl(url);
  };
  // Opened from a notification while the app was closed.
  open(Notifications.getLastNotificationResponse());
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}
