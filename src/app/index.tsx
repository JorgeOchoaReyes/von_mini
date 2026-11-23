import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useAI } from '../ai/AIContext';
import { buildApp } from '../ai/hybrid';
import { listApps, newId, saveApp, type SavedApp } from '../storage/store';
import { Button, Card, SourceBadge, StatusPill } from '../ui/components';
import { ACCENT_COLORS, radius, space, useTheme } from '../ui/theme';

const IDEAS = ['A habit tracker that reflects on my week', 'Expense logger that categorizes purchases', 'Gratitude journal', 'Recipe idea helper from what is in my fridge'];

export default function Home() {
  const theme = useTheme();
  const ai = useAI();
  const [request, setRequest] = useState('');
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<SavedApp[]>([]);

  useFocusEffect(
    useCallback(() => {
      listApps().then(setApps);
    }, []),
  );

  const build = async () => {
    if (!request.trim()) return;
    setBuilding(true);
    setError(null);
    try {
      const { spec, source } = await buildApp(request, ai);
      const app: SavedApp = { id: newId(), request: request.trim(), spec, builtWith: source, createdAt: Date.now(), updatedAt: Date.now() };
      await saveApp(app);
      setRequest('');
      router.push({ pathname: '/app/[id]', params: { id: app.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space(2) }}>
        <Text style={[styles.title, { color: theme.text }]}>Build a private AI app in one sentence.</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>
          Apps run on your device with Gemini Nano. Your data stays here, even offline.
        </Text>
      </View>

      <StatusPill status={ai.deviceStatus} online={ai.online} privateMode={ai.privateMode} />
      {ai.deviceStatus === 'downloadable' && (
        <Button
          label={ai.downloadProgress != null ? `Downloading… ${Math.round(ai.downloadProgress * 100)}%` : 'Download Gemini Nano'}
          theme={theme}
          variant="secondary"
          loading={ai.downloadProgress != null && ai.downloadProgress === 0}
          onPress={() => ai.downloadModel().catch((e) => setError(String(e?.message ?? e)))}
        />
      )}

      <Card theme={theme} style={{ gap: space(3) }}>
        <TextInput
          value={request}
          onChangeText={setRequest}
          placeholder="Describe an app… e.g. a journal that tags my mood"
          placeholderTextColor={theme.muted}
          multiline
          style={[styles.prompt, { color: theme.text, backgroundColor: theme.input, borderColor: theme.border }]}
        />
        <View style={styles.chips}>
          {IDEAS.map((idea) => (
            <Pressable key={idea} onPress={() => setRequest(idea)} style={[styles.chip, { borderColor: theme.border }]}>
              <Text style={{ color: theme.muted, fontSize: 13 }}>{idea}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          <View style={styles.toggle}>
            <Switch
              value={ai.privateMode}
              onValueChange={ai.setPrivateMode}
              disabled={ai.locked}
              trackColor={{ true: theme.accent }}
            />
            <Text style={{ color: theme.text, fontSize: 14 }}>
              🔒 Private (on-device only){ai.locked ? ' · offline mode' : ''}
            </Text>
          </View>
        </View>
        <Button label={building ? 'Building…' : 'Build ✨'} theme={theme} loading={building} disabled={!request.trim()} onPress={build} />
        <Text style={[styles.hint, { color: theme.muted }]}>
          {ai.privateMode || !ai.online
            ? 'Building on this device with Gemini Nano.'
            : 'Online: Gemini in the cloud designs the app; it falls back to Gemini Nano if needed.'}
        </Text>
        {error && <Text style={{ color: theme.danger }}>{error}</Text>}
      </Card>

      <Text style={[styles.section, { color: theme.text }]}>Your apps</Text>
      <View style={styles.grid}>
        {apps.map((app) => (
          <Pressable
            key={app.id}
            onPress={() => router.push({ pathname: '/app/[id]', params: { id: app.id } })}
            style={({ pressed }) => [styles.appCard, { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={[styles.icon, { backgroundColor: ACCENT_COLORS[app.spec.accent][theme.scheme] + '22' }]}>
              <Text style={{ fontSize: 24 }}>{app.spec.emoji}</Text>
            </View>
            <Text style={[styles.appName, { color: theme.text }]} numberOfLines={1}>
              {app.spec.name}
            </Text>
            <Text style={[styles.hint, { color: theme.muted }]} numberOfLines={2}>
              {app.spec.description || app.request}
            </Text>
            <SourceBadge source={app.builtWith} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space(4), gap: space(4), maxWidth: 760, width: '100%', alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 16, lineHeight: 22 },
  prompt: { minHeight: 90, borderWidth: 1, borderRadius: radius.md, padding: space(3), fontSize: 16, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: space(3), paddingVertical: space(1) + 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  hint: { fontSize: 13, lineHeight: 18 },
  section: { fontSize: 20, fontWeight: '700', marginTop: space(2) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3) },
  appCard: { flexBasis: 160, flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, padding: space(4), gap: space(2) },
  icon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  appName: { fontSize: 16, fontWeight: '700' },
});
