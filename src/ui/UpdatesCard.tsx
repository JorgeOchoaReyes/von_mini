/**
 * Over-the-air updates (EAS Update). A release build checks for a new JS bundle on launch and
 * applies it on the next launch; this card shows what is running and lets a tester pull and apply
 * an update right away without reinstalling the APK.
 */
import * as Updates from 'expo-updates';
import { Text, View } from 'react-native';

import { Button, Card, Icon } from './components';
import { haptics } from './haptics';
import { space, type, type Theme } from './theme';

export function UpdatesCard({ theme }: { theme: Theme }) {
  return (
    <Card theme={theme} style={{ gap: space(3) }}>
      <Text style={[type.headline, { color: theme.text }]}>App updates</Text>
      {Updates.isEnabled ? (
        <LiveUpdates theme={theme} />
      ) : (
        <Text style={[type.caption, { color: theme.muted }]}>
          Over-the-air updates are on in installed builds (APK or Play Store). They are off in development and on the web,
          where you always get the latest code.
        </Text>
      )}
    </Card>
  );
}

function LiveUpdates({ theme }: { theme: Theme }) {
  const { currentlyRunning, isUpdateAvailable, isUpdatePending, isChecking, isDownloading, checkError, downloadError } =
    Updates.useUpdates();

  const busy = isChecking || isDownloading;
  const label = isUpdatePending ? 'Restart to update' : isUpdateAvailable ? 'Download update' : 'Check for updates';
  const onPress = async () => {
    haptics.tap();
    try {
      if (isUpdatePending) await Updates.reloadAsync();
      else if (isUpdateAvailable) await Updates.fetchUpdateAsync();
      else await Updates.checkForUpdateAsync();
    } catch {
      // Surfaced through checkError / downloadError below.
    }
  };

  const running = currentlyRunning.isEmbeddedLaunch
    ? 'The version built into this install'
    : `Update from ${currentlyRunning.createdAt?.toLocaleString() ?? 'an earlier download'}`;
  const error = checkError ?? downloadError;

  return (
    <View style={{ gap: space(3) }}>
      <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
        <Icon
          name={isUpdatePending ? 'arrow-down-circle' : 'checkmark-circle-outline'}
          size={18}
          color={isUpdatePending ? theme.accent : theme.success}
        />
        <Text style={[type.caption, { color: theme.text, flex: 1 }]}>
          {isUpdatePending ? 'An update is downloaded and ready.' : running}
        </Text>
      </View>
      <Text style={[type.caption, { color: theme.subtle }]}>
        Channel {currentlyRunning.channel ?? '—'} · runtime {currentlyRunning.runtimeVersion ?? '—'}
      </Text>
      <Button
        label={busy ? (isDownloading ? 'Downloading…' : 'Checking…') : label}
        icon={isUpdatePending ? 'refresh' : 'cloud-download-outline'}
        variant={isUpdatePending ? 'primary' : 'secondary'}
        theme={theme}
        disabled={busy}
        onPress={onPress}
      />
      {error && <Text style={[type.caption, { color: theme.danger }]}>{error.message}</Text>}
    </View>
  );
}
