import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAI } from '../../ai/AIContext';
import { buildCustomHtml, editApp } from '../../ai/hybrid';
import { HtmlRunner } from '../../runtime/HtmlRunner';
import { SpecRenderer } from '../../runtime/SpecRenderer';
import { deleteApp, getApp, saveApp, type SavedApp } from '../../storage/store';
import { Button, Card, SourceBadge } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ai = useAI();
  const [app, setApp] = useState<SavedApp | null | undefined>(undefined);
  const [view, setView] = useState<'blocks' | 'custom'>('blocks');
  const [change, setChange] = useState('');
  const [busy, setBusy] = useState<'edit' | 'custom' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = useTheme(app?.spec.accent);

  useEffect(() => {
    getApp(id).then((a) => {
      setApp(a ?? null);
      if (a?.html) setView('custom');
    });
  }, [id]);

  if (app === undefined) return null;
  if (app === null) {
    return (
      <View style={styles.page}>
        <Text style={{ color: theme.text }}>This app no longer exists.</Text>
      </View>
    );
  }

  const update = async (next: SavedApp) => {
    await saveApp(next);
    setApp(next);
  };

  const applyEdit = async () => {
    if (!change.trim()) return;
    setBusy('edit');
    setError(null);
    try {
      const { spec, source } = await editApp(app.spec, change, ai);
      await update({ ...app, spec, builtWith: source });
      setChange('');
      setView('blocks');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const makeCustom = async () => {
    setBusy('custom');
    setError(null);
    try {
      const html = await buildCustomHtml(app.request, ai, app.spec);
      await update({ ...app, html });
      setView('custom');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
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
  const isStarter = app.builtWith === 'starter';

  return (
    <>
      <Stack.Screen options={{ title: `${app.spec.emoji} ${app.spec.name}` }} />
      {app.html && (
        <View style={[styles.tabs, { borderColor: theme.border }]}>
          <Button label="Blocks" theme={theme} variant={view === 'blocks' ? 'primary' : 'ghost'} onPress={() => setView('blocks')} style={styles.tab} />
          <Button label="Custom ✨" theme={theme} variant={view === 'custom' ? 'primary' : 'ghost'} onPress={() => setView('custom')} style={styles.tab} />
        </View>
      )}
      {view === 'custom' && app.html ? (
        <HtmlRunner appId={app.id} html={app.html} />
      ) : (
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space(2) }}>
            {app.spec.description ? <Text style={[styles.desc, { color: theme.muted }]}>{app.spec.description}</Text> : null}
            <SourceBadge source={app.builtWith} />
          </View>

          <SpecRenderer key={JSON.stringify(app.spec)} appId={app.id} spec={app.spec} />

          <Card theme={theme} style={{ gap: space(3), marginTop: space(4) }}>
            <Text style={[styles.section, { color: theme.text }]}>Change this app</Text>
            <TextInput
              value={change}
              onChangeText={setChange}
              placeholder="e.g. add a field for sleep hours"
              placeholderTextColor={theme.muted}
              style={[styles.input, { color: theme.text, backgroundColor: theme.input, borderColor: theme.border }]}
            />
            <Button label="Apply change" theme={theme} variant="secondary" loading={busy === 'edit'} disabled={!!busy || !change.trim()} onPress={applyEdit} />
            <Button
              label={app.html ? 'Regenerate custom version ✨' : 'Make it custom ✨'}
              theme={theme}
              loading={busy === 'custom'}
              disabled={!!busy || !canCustom}
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
            {!isStarter && <Button label="Delete app" theme={theme} variant="ghost" onPress={remove} />}
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
  input: { borderWidth: 1, borderRadius: radius.md, padding: space(3), fontSize: 15 },
  tabs: { flexDirection: 'row', gap: space(2), padding: space(2), borderBottomWidth: 1 },
  tab: { flex: 1, minHeight: 40 },
});
