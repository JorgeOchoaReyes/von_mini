/**
 * Settings: the honest, one-screen answer to "where does my AI actually run?".
 *
 * Everything here is about the hybrid story — which device runtime is present, which model is
 * loaded, whether the cloud is allowed, and how to get on-device AI when the device does not have
 * it yet.
 */
import { router, Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAI } from '../ai/AIContext';
import { DEVICE_MODELS, type DeviceModel } from '../ai/deviceModel';
import { Button, Card, Icon, Segmented, StatusBanner, type IconName } from '../ui/components';
import { ProgressBar } from '../ui/motion';
import { MAX_WIDTH, radius, space, type, useTheme } from '../ui/theme';
import { useRemoteConfig } from '../remote/remoteConfig';
import { UpdatesCard } from '../ui/UpdatesCard';
import { useSttSupport } from '../voice/useVoice';

function Row({ icon, title, body, theme }: { icon: IconName; title: string; body: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: theme.accentSoft }]}>
        <Icon name={icon} size={17} color={theme.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: theme.text }]}>{title}</Text>
        <Text style={[type.caption, { color: theme.muted }]}>{body}</Text>
      </View>
    </View>
  );
}

export default function Settings() {
  const ai = useAI();
  const theme = useTheme();
  const onDevice = ai.deviceStatus === 'available';
  const stt = useSttSupport();
  const rc = useRemoteConfig();

  return (
    <>
      <Stack.Screen options={{ title: 'AI settings' }} />
      <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.page}>
        <StatusBanner
          status={ai.deviceStatus}
          online={ai.online}
          privateMode={ai.privateMode}
          locked={ai.locked}
          onTogglePrivate={ai.setPrivateMode}
          onDownload={ai.downloadModel}
          downloadProgress={ai.downloadProgress}
        />

        {ai.downloadProgress != null && ai.downloadProgress > 0 && (
          <Card theme={theme} style={{ gap: space(3) }}>
            <Text style={[type.label, { color: theme.text }]}>
              Downloading Gemini Nano — {Math.round(ai.downloadProgress * 100)}%
            </Text>
            <ProgressBar progress={ai.downloadProgress} color={theme.accent} track={theme.surfaceAlt} />
            <Text style={[type.caption, { color: theme.muted }]}>
              This happens once. Keep the app open until it finishes.
            </Text>
          </Card>
        )}

        <Card theme={theme} style={{ gap: space(4) }}>
          <Text style={[type.headline, { color: theme.text }]}>How inference is routed</Text>
          {[
            ['phone-portrait-outline', 'Your apps’ AI runs on this device', 'Tagging a mood, rewriting a message, summarizing notes — all on Gemini Nano, offline and free.'],
            ['git-compare-outline', 'Building a new app prefers the cloud', 'A bigger model designs the screen, then the app itself runs on-device.'],
            ['cloud-offline-outline', 'Everything still works offline', 'If the cloud is unreachable, or private mode is on, building falls back to Gemini Nano.'],
          ].map(([icon, title, body]) => (
            <Row key={title} icon={icon as IconName} title={title} body={body} theme={theme} />
          ))}
        </Card>

        <Card theme={theme} style={{ gap: space(3) }}>
          <Text style={[type.headline, { color: theme.text }]}>On-device model</Text>
          <View style={[styles.status, { borderColor: theme.border, backgroundColor: theme.bgAlt }]}>
            <Icon
              name={onDevice ? 'checkmark-circle' : 'information-circle-outline'}
              size={16}
              color={onDevice ? theme.success : theme.subtle}
            />
            <Text style={[type.caption, { color: theme.muted, flex: 1 }]}>
              {ai.modelName
                ? `Loaded: ${ai.modelName}`
                : onDevice
                  ? 'On-device runtime is ready; the model name is not reported on this platform.'
                  : 'No model is loaded yet.'}
            </Text>
          </View>
          <Segmented<DeviceModel>
            theme={theme}
            value={ai.deviceModel}
            onChange={ai.setDeviceModel}
            options={DEVICE_MODELS.map((m) => ({ value: m.value, label: m.label }))}
          />
          <Text style={[type.caption, { color: theme.subtle }]}>
            {DEVICE_MODELS.find((m) => m.value === ai.deviceModel)?.detail} Applies to Android builds that use the AI Core
            runtime; on the web the browser decides which Nano build to load.
          </Text>
        </Card>

        <Card theme={theme} style={{ gap: space(3) }}>
          <Text style={[type.headline, { color: theme.text }]}>Voice</Text>
          <Row
            icon="mic-outline"
            title={
              !stt ? 'Checking speech recognition…' : !stt.available ? 'Speech recognition is not available here' : stt.onDevice ? 'Speech recognition runs on this device' : 'Speech recognition needs a connection here'
            }
            body={
              stt?.onDevice
                ? 'What you say is turned into text locally, so voice chats work offline.'
                : 'Voice chats still work: type your side when offline, and replies are spoken by the device.'
            }
            theme={theme}
          />
          <Row
            icon="volume-high-outline"
            title="Replies are spoken by the device's own voice"
            body="Speech is generated locally, a sentence at a time while Gemini Nano is still writing."
            theme={theme}
          />
        </Card>

        <Card theme={theme} style={{ gap: space(3) }}>
          <Text style={[type.headline, { color: theme.text }]}>Your data</Text>
          <Row icon="save-outline" title="Apps and entries stay on this device" body="Stored locally. Nothing is uploaded, and there is no account." theme={theme} />
          <Row icon="eye-off-outline" title="Private mode blocks the cloud entirely" body="Turn it on to make every request on-device only." theme={theme} />
          <Row icon="pricetag-outline" title="No paid services" body="On-device inference costs nothing, so the app has no usage limits." theme={theme} />
        </Card>

        <Card theme={theme} style={{ gap: space(3) }}>
          <Text style={[type.headline, { color: theme.text }]}>Remote Config</Text>
          <Row
            icon="options-outline"
            title={
              rc.status === 'remote'
                ? 'Live settings from Firebase'
                : rc.status === 'cached'
                  ? 'Last settings fetched from Firebase'
                  : 'Built-in defaults'
            }
            body={`Cloud model ${rc.string('cloud_model')} · new apps designed ${
              rc.string('build_mode') === 'prefer_on_device' ? 'on-device first' : 'in the cloud first'
            } · voice input ${rc.bool('voice_input') ? 'on' : 'off'} · sharing ${rc.bool('sharing') ? 'on' : 'off'}.`}
            theme={theme}
          />
        </Card>

        <UpdatesCard theme={theme} />

        <Button label="Done" theme={theme} variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: space(4), paddingBottom: space(12), gap: space(4), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space(3) },
  rowIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  status: { flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(3), borderWidth: 1, borderRadius: radius.md },
});
