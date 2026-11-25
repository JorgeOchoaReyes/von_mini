/** Settings > Notifications: switch build/change alerts and apps' daily reminders on or off. */
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { useAlertPrefs, setAlertPrefs } from '../alerts/alertPrefs';
import { alertsSupported, setRemindersEnabled } from '../alerts/notifications';
import { Card, Icon, type IconName } from './components';
import { haptics } from './haptics';
import { space, type, type Theme } from './theme';

function Toggle({
  icon,
  title,
  body,
  value,
  onChange,
  theme,
  disabled,
}: {
  icon: IconName;
  title: string;
  body: string;
  value: boolean;
  onChange(v: boolean): void;
  theme: Theme;
  disabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
      <Icon name={icon} size={20} color={value ? theme.accent : theme.subtle} />
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: theme.text }]}>{title}</Text>
        <Text style={[type.caption, { color: theme.muted }]}>{body}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(v) => {
          haptics.tap();
          onChange(v);
        }}
        accessibilityLabel={title}
        trackColor={{ true: theme.accent, false: theme.surfaceAlt }}
        thumbColor={theme.surface}
      />
    </View>
  );
}

export function NotificationsCard({ theme }: { theme: Theme }) {
  const prefs = useAlertPrefs();
  const [note, setNote] = useState<string | null>(null);

  return (
    <Card theme={theme} style={{ gap: space(4) }}>
      <Text style={[type.headline, { color: theme.text }]}>Notifications</Text>
      <Toggle
        icon="construct-outline"
        title="Build and change alerts"
        body="When an app is ready or a change is done while you’re away, and when something fails."
        value={prefs.builds}
        onChange={(v) => setAlertPrefs({ builds: v })}
        theme={theme}
      />
      <Toggle
        icon="alarm-outline"
        title="Daily reminders"
        body="Reminders your apps schedule (like “Log what you ate”). Off pauses them all; on brings them back."
        value={prefs.reminders}
        onChange={async (v) => {
          setNote(null);
          const ok = await setRemindersEnabled(v);
          if (!ok) setNote('Allow notifications for von mini in your phone’s settings first.');
        }}
        theme={theme}
      />
      {!alertsSupported && <Text style={[type.caption, { color: theme.subtle }]}>Notifications work in the Android app.</Text>}
      {note && <Text style={[type.caption, { color: theme.danger }]}>{note}</Text>}
    </Card>
  );
}
