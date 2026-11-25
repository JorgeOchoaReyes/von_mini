/**
 * The `reminder` block: daily local notifications for one generated app ("Log your meals" at
 * 08:00, 13:00 and 19:00). Turning it on asks for notification permission once, then schedules
 * one daily notification per time; tapping a notification opens this app. Everything happens on
 * the phone, so reminders work offline and nothing is sent anywhere.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import type { SpecComponent } from '../spec/types';
import { kvGet, kvSet } from '../storage/store';
import { Icon } from '../ui/components';
import { haptics } from '../ui/haptics';
import { PopIn } from '../ui/motion';
import { stroke, radius, space, type, type Theme } from '../ui/theme';
import { useAlertPrefs } from './alertPrefs';
import { alertsSupported, cancelReminders, scheduleDailyReminders } from './notifications';

/** "19:30" -> "7:30 PM" in the user's locale. */
function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function ReminderBlock({
  appId,
  appName,
  appEmoji,
  c,
  theme,
}: {
  appId: string;
  appName: string;
  appEmoji: string;
  c: SpecComponent;
  theme: Theme;
}) {
  const key = `${appId}:${c.id}`;
  const times = c.times ?? [];
  const timesKey = times.join(',');
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const prefs = useAlertPrefs();

  useEffect(() => {
    let alive = true;
    void kvGet(appId, `reminder:${c.id}`).then((v) => alive && setOn(v === true));
    return () => {
      alive = false;
    };
  }, [appId, c.id]);

  const content = { title: `${appEmoji} ${appName}`, body: c.text ?? 'Time to check in.', url: `/app/${appId}` };

  // If the times or message change while reminders are on, reschedule them to match.
  useEffect(() => {
    if (!on || !alertsSupported) return;
    void scheduleDailyReminders(key, times, content);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reschedule only when what's scheduled changes
  }, [on, key, timesKey, c.text, appName, appEmoji]);

  const toggle = async (next: boolean) => {
    haptics.tap();
    setBusy(true);
    setDenied(false);
    try {
      if (next) {
        const ok = await scheduleDailyReminders(key, times, content);
        if (!ok) {
          setDenied(true);
          return;
        }
      } else {
        await cancelReminders(key);
      }
      setOn(next);
      await kvSet(appId, `reminder:${c.id}`, next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
          <Icon name={on ? 'notifications' : 'notifications-outline'} size={17} color={theme.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: theme.text }]}>{c.label}</Text>
          <Text style={[type.caption, { color: theme.muted }]} numberOfLines={2}>
            “{c.text}”
          </Text>
        </View>
        {alertsSupported && (
          <Switch
            value={on}
            disabled={busy}
            onValueChange={toggle}
            accessibilityLabel={on ? 'Turn reminders off' : 'Turn reminders on'}
            trackColor={{ true: theme.accent, false: theme.surfaceAlt }}
            thumbColor={theme.surface}
          />
        )}
      </View>

      <View style={styles.times}>
        {times.map((t) => (
          <PopIn key={t} trigger={on}>
            <View style={[styles.time, { backgroundColor: on ? theme.accentSoft : theme.surfaceAlt }]}>
              <Icon name="time-outline" size={13} color={on ? theme.accent : theme.subtle} />
              <Text style={[type.caption, { color: on ? theme.accent : theme.muted, fontWeight: '600' }]}>{formatTime(t)}</Text>
            </View>
          </PopIn>
        ))}
      </View>

      <Text style={[type.caption, { color: denied ? theme.danger : theme.subtle }]}>
        {!alertsSupported
          ? 'Reminders work in the Android app.'
          : denied
            ? 'Notifications are turned off for von mini. Allow them in your phone’s settings to get reminders.'
            : on && !prefs.reminders
              ? 'Paused: daily reminders are off in Settings.'
              : on
                ? 'Every day, on this phone. Works offline.'
              : 'Off. Turn on to get a notification every day at these times.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: stroke, borderRadius: radius.lg, padding: space(4), gap: space(3) },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  badge: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  time: { flexDirection: 'row', alignItems: 'center', gap: space(1), borderRadius: radius.pill, paddingHorizontal: space(3), paddingVertical: space(1) },
});
