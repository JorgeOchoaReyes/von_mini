/**
 * Settings: the honest, one-screen answer to "where does my AI actually run?".
 *
 * Everything here is about the hybrid story — which device runtime is present, which model is
 * loaded, whether the cloud is allowed, and how to get on-device AI when the device does not have
 * it yet.
 */
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAI } from '../../ai/AIContext';
import { DEVICE_MODELS, type DeviceModel } from '../../ai/deviceModel';
import type { DeviceStatus } from '../../ai/types';
import { Button, Card, Icon, Segmented, StatusBanner, type IconName } from '../../ui/components';
import { ProgressBar } from '../../ui/motion';
import { stroke, MAX_WIDTH, radius, setSchemePref, space, type, useSchemePref, useTheme, type SchemePref } from '../../ui/theme';
import { useRemoteConfig } from '../../remote/remoteConfig';
import { CloudCheck } from '../../ui/CloudCheck';
import { UpdatesCard } from '../../ui/UpdatesCard';
import { VoiceSettingsCard } from '../../ui/VoiceSettingsCard';
import { NotificationsCard } from '../../ui/NotificationsCard';
import { useSttSupport } from '../../voice/useVoice';
import { MIC_OVERHANG } from '../../ui/BottomBar';

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

/**
 * What the on-device model's state means for the user, and what (if anything) they need to do.
 * Gemini Nano comes from Android's AICore service: the app can ask it to download the model, but
 * can't install Nano on a phone AICore doesn't support.
 */
function nanoStatusText(status: DeviceStatus, modelName: string): string {
  switch (status) {
    case 'available':
      return modelName ? `Ready on this device: ${modelName}.` : 'Gemini Nano is ready on this device.';
    case 'downloading':
      return 'Downloading Gemini Nano. It continues in the background; on-device AI turns on when it finishes.';
    case 'downloadable':
      return 'This phone supports Gemini Nano, but the model isn’t downloaded yet. It downloads automatically on Wi-Fi, or tap below. Until then, AI runs in the cloud.';
    case 'unsupported':
      return 'On-device AI isn’t available in this build or browser. AI runs in the cloud.';
    default:
      return 'This device can’t run Gemini Nano (it needs a phone with Android AICore, such as recent Pixel or Galaxy flagships). Nothing to install: AI runs in the cloud, and everything else works the same.';
  }
}

export default function Settings() {
  const ai = useAI();
  const theme = useTheme();
  const onDevice = ai.deviceStatus === 'available';
  const stt = useSttSupport();
  const rc = useRemoteConfig();
  const insets = useSafeAreaInsets();
  const schemePref = useSchemePref();

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={[styles.page, { paddingTop: (Platform.OS === 'web' ? 0 : insets.top) + space(4) }]}
      >
        <Text style={[type.display, { color: theme.text }]}>Settings</Text>

        <Card theme={theme} style={{ gap: space(3) }}>
          <Text style={[type.overline, { color: theme.text }]}>APPEARANCE</Text>
          <Segmented<SchemePref>
            theme={theme}
            value={schemePref}
            onChange={setSchemePref}
            options={[
              { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
              { value: 'light', label: 'Light', icon: 'sunny-outline' },
              { value: 'dark', label: 'Dark', icon: 'moon-outline' },
            ]}
          />
        </Card>
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
          {/* Describe what actually happens on this device, not the best case. */}
          {(onDevice
            ? [
                ['phone-portrait-outline', 'Your apps’ AI runs on this device', 'Tagging a mood, rewriting a message, summarizing notes — all on Gemini Nano, offline and free.'],
                ['git-compare-outline', 'Building a new app prefers the cloud', 'A bigger model designs the screen, then the app itself runs on-device.'],
                ['cloud-offline-outline', 'Everything still works offline', 'If the cloud is unreachable, or private mode is on, building falls back to Gemini Nano.'],
              ]
            : [
                ['cloud-outline', 'AI runs in the cloud on this device', 'This device has no Gemini Nano, so building apps and your apps’ AI features use Gemini through Firebase AI Logic.'],
                ['phone-portrait-outline', 'On a phone with Gemini Nano', 'The same apps run their AI on-device, offline and free, and the cloud is only used to design new apps.'],
              ]
          ).map(([icon, title, body]) => (
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
            <Text style={[type.caption, { color: theme.muted, flex: 1 }]}>{nanoStatusText(ai.deviceStatus, ai.modelName)}</Text>
          </View>
          {ai.deviceStatus === 'downloadable' && ai.downloadProgress == null && (
            <Button label="Download Gemini Nano" icon="cloud-download-outline" theme={theme} onPress={ai.downloadModel} />
          )}
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

        <NotificationsCard theme={theme} />

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
            body="Speech is generated locally, a sentence at a time while the AI is still writing its reply."
            theme={theme}
          />
          <VoiceSettingsCard theme={theme} />
        </Card>

        <Card theme={theme} style={{ gap: space(3) }}>
          <Text style={[type.headline, { color: theme.text }]}>Your data</Text>
          <Row
            icon="save-outline"
            title="Apps and entries are saved on this device"
            body={
              onDevice
                ? 'Stored locally, with no account. AI runs on Gemini Nano, so what you type stays here.'
                : 'Stored locally, with no account. AI requests (what you type into an AI feature) go to Gemini through Firebase.'
            }
            theme={theme}
          />
          <Row
            icon="eye-off-outline"
            title="Private mode blocks the cloud entirely"
            body={
              onDevice
                ? 'Turn it on to make every request on-device only.'
                : 'Every request then runs on-device only, so AI features need a device with Gemini Nano.'
            }
            theme={theme}
          />
          {onDevice && (
            <Row icon="pricetag-outline" title="No paid services" body="On-device inference costs nothing, so the app has no usage limits." theme={theme} />
          )}
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

        <CloudCheck theme={theme} />

        <UpdatesCard theme={theme} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: space(4), paddingBottom: MIC_OVERHANG + space(8), gap: space(4), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space(3) },
  rowIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  status: { flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(3), borderWidth: stroke, borderRadius: radius.md },
});
