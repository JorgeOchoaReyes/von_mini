import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAI } from '../../ai/AIContext';
import { buildCustomHtml } from '../../ai/hybrid';
import { ChatPanel } from '../../chat/ChatPanel';
import { isBusy, useChatVersion } from '../../chat/chatJobs';
import { HtmlRunner } from '../../runtime/HtmlRunner';
import { SpecRenderer } from '../../runtime/SpecRenderer';
import { deleteApp, getApp, saveApp, type SavedApp } from '../../storage/store';
import { Card, Icon, Segmented, SourceBadge, type IconName } from '../../ui/components';
import { MAX_WIDTH, radius, space, type, useTheme, type Theme } from '../../ui/theme';

type Tab = 'app' | 'chat' | 'custom';

function ActionRow({
  icon,
  title,
  body,
  onPress,
  theme,
  disabled,
  loading,
  danger,
}: {
  icon: IconName;
  title: string;
  body?: string;
  onPress(): void;
  theme: Theme;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
}) {
  const color = danger ? theme.danger : theme.accent;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.action, { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.actionIcon, { backgroundColor: danger ? `${theme.danger}18` : theme.accentSoft }]}>
        <Icon name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: danger ? theme.danger : theme.text }]}>{loading ? 'Working…' : title}</Text>
        {body ? <Text style={[type.caption, { color: theme.muted }]}>{body}</Text> : null}
      </View>
      {!danger && <Icon name="chevron-forward" size={18} color={theme.subtle} />}
    </Pressable>
  );
}

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ai = useAI();
  const version = useChatVersion();
  const [app, setApp] = useState<SavedApp | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('app');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const theme = useTheme(app?.spec.accent);

  // Reload whenever a chat job (possibly started earlier) updates this app.
  useEffect(() => {
    let alive = true;
    getApp(id).then((a) => alive && setApp(a ?? null));
    return () => {
      alive = false;
    };
  }, [id, version]);

  if (app === undefined) return null;
  if (app === null) {
    return (
      <View style={styles.page}>
        <Text style={{ color: theme.text }}>This app no longer exists.</Text>
      </View>
    );
  }

  const makeCustom = async () => {
    setBusy(true);
    setError(null);
    try {
      const html = await buildCustomHtml(app.request, ai, app.spec);
      const next = { ...app, html };
      await saveApp(next);
      setApp(next);
      setTab('custom');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    const go = async () => {
      await deleteApp(app.id);
      router.back();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${app.spec.name} and its saved data?`)) go();
    } else {
      Alert.alert('Delete app?', `${app.spec.name} and its saved data will be removed from this device.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: go },
      ]);
    }
  };

  const canCustom = ai.online && !ai.privateMode;

  return (
    <>
      <Stack.Screen options={{ title: app.spec.name }} />
      <View style={[styles.tabs, { backgroundColor: theme.bg }]}>
        <Segmented<Tab>
          theme={theme}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'app', label: 'App', icon: 'apps-outline' },
            { value: 'chat', label: 'Chat', icon: 'chatbubble-ellipses-outline', dot: isBusy(app.id) },
            ...(app.html ? [{ value: 'custom' as const, label: 'Custom', icon: 'color-wand-outline' as const }] : []),
          ]}
        />
      </View>

      {tab === 'chat' ? (
        <ChatPanel appId={app.id} spec={app.spec} onShowApp={() => setTab('app')} />
      ) : tab === 'custom' && app.html ? (
        <HtmlRunner appId={app.id} html={app.html} accent={app.spec.accent} />
      ) : (
        <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={[styles.hero, { backgroundColor: theme.accentSoft }]}>
            <View style={[styles.heroIcon, { backgroundColor: theme.surface }]}>
              <Text style={styles.heroEmoji}>{app.spec.emoji}</Text>
            </View>
            <View style={{ flex: 1, gap: space(1) }}>
              <Text style={[type.title, { color: theme.text }]}>{app.spec.name}</Text>
              {app.spec.description ? <Text style={[type.caption, { color: theme.muted }]}>{app.spec.description}</Text> : null}
              <SourceBadge source={app.builtWith} />
            </View>
          </View>

          <SpecRenderer key={JSON.stringify(app.spec)} appId={app.id} spec={app.spec} />

          <View style={{ gap: space(2), marginTop: space(4) }}>
            <Text style={[type.overline, { color: theme.subtle }]}>Improve this app</Text>
            <Card theme={theme} style={{ paddingVertical: space(1) }}>
              <ActionRow
                icon="chatbubble-ellipses-outline"
                title="Chat about this app"
                body="Ask questions or describe changes."
                onPress={() => setTab('chat')}
                theme={theme}
              />
              <View style={[styles.sep, { backgroundColor: theme.border }]} />
              <ActionRow
                icon="color-wand-outline"
                title={app.html ? 'Regenerate custom version' : 'Make it custom'}
                body={
                  canCustom
                    ? 'Gemini designs a fully custom version. Its AI still runs on-device.'
                    : ai.locked
                      ? 'Needs the cloud; this build is on-device only.'
                      : 'Needs the cloud. Go online and turn off private mode.'
                }
                onPress={makeCustom}
                theme={theme}
                disabled={!canCustom}
                loading={busy}
              />
              {app.builtWith !== 'starter' && (
                <>
                  <View style={[styles.sep, { backgroundColor: theme.border }]} />
                  <ActionRow icon="trash-outline" title="Delete app" onPress={remove} theme={theme} danger />
                </>
              )}
            </Card>
            {error && <Text style={[type.caption, { color: theme.danger }]}>{error}</Text>}
          </View>
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: space(4), paddingBottom: space(12), gap: space(5), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  tabs: { paddingHorizontal: space(4), paddingBottom: space(3), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  hero: { flexDirection: 'row', gap: space(4), padding: space(4), borderRadius: radius.xl, alignItems: 'center' },
  heroIcon: { width: 64, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 34 },
  action: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(3) },
  actionIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 48 },
});
