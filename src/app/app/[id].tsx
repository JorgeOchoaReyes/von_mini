import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAI } from '../../ai/AIContext';
import { buildCustomHtml } from '../../ai/hybrid';
import { ChatPanel } from '../../chat/ChatPanel';
import { isBusy, useChatVersion } from '../../chat/chatJobs';
import { HtmlRunner } from '../../runtime/HtmlRunner';
import { SpecRenderer } from '../../runtime/SpecRenderer';
import { deleteApp, getApp, saveApp, type SavedApp } from '../../storage/store';
import { Button, Card, SourceBadge } from '../../ui/components';
import { space, useTheme } from '../../ui/theme';

type Tab = 'app' | 'chat' | 'custom';

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
  const tabs: { key: Tab; label: string }[] = [
    { key: 'app', label: 'App' },
    { key: 'chat', label: isBusy(app.id) ? 'Chat •' : 'Chat' },
    ...(app.html ? [{ key: 'custom' as const, label: 'Custom ✨' }] : []),
  ];

  return (
    <>
      <Stack.Screen options={{ title: `${app.spec.emoji} ${app.spec.name}` }} />
      <View style={[styles.tabs, { borderColor: theme.border }]}>
        {tabs.map((t) => (
          <Button
            key={t.key}
            label={t.label}
            theme={theme}
            variant={tab === t.key ? 'primary' : 'ghost'}
            onPress={() => setTab(t.key)}
            style={styles.tab}
          />
        ))}
      </View>

      {tab === 'chat' ? (
        <ChatPanel appId={app.id} spec={app.spec} onShowApp={() => setTab('app')} />
      ) : tab === 'custom' && app.html ? (
        <HtmlRunner appId={app.id} html={app.html} />
      ) : (
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space(2) }}>
            {app.spec.description ? <Text style={[styles.desc, { color: theme.muted }]}>{app.spec.description}</Text> : null}
            <SourceBadge source={app.builtWith} />
          </View>

          <SpecRenderer key={JSON.stringify(app.spec)} appId={app.id} spec={app.spec} />

          <Card theme={theme} style={{ gap: space(3), marginTop: space(4) }}>
            <Text style={[styles.section, { color: theme.text }]}>Improve this app</Text>
            <Button label="💬 Chat about this app" theme={theme} variant="secondary" onPress={() => setTab('chat')} />
            <Button
              label={app.html ? 'Regenerate custom version ✨' : 'Make it custom ✨'}
              theme={theme}
              loading={busy}
              disabled={busy || !canCustom}
              onPress={makeCustom}
            />
            <Text style={[styles.hint, { color: theme.muted }]}>
              {canCustom
                ? 'Gemini in the cloud writes a fully custom version. Its AI features still run on-device.'
                : ai.locked
                  ? 'Custom versions need the cloud; this build runs in offline (on-device only) mode.'
                  : 'Custom versions need the cloud. Go online and turn off private mode.'}
            </Text>
            {error && <Text style={{ color: theme.danger }}>{error}</Text>}
            {app.builtWith !== 'starter' && <Button label="Delete app" theme={theme} variant="ghost" onPress={remove} />}
          </Card>
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: space(4), gap: space(4), maxWidth: 760, width: '100%', alignSelf: 'center' },
  desc: { fontSize: 15, lineHeight: 21 },
  section: { fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 13, lineHeight: 18 },
  tabs: { flexDirection: 'row', gap: space(2), padding: space(2), borderBottomWidth: 1 },
  tab: { flex: 1, minHeight: 40 },
});
