import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAI } from '../ai/AIContext';
import { buildApp, modeFor } from '../ai/hybrid';
import { listApps, newId, saveApp, type SavedApp } from '../storage/store';
import { Card, Chip, Composer, Icon, SectionHeader, SourceBadge, StatusBanner, type IconName } from '../ui/components';
import { ACCENT_COLORS, alpha, MAX_WIDTH, radius, space, type, useTheme } from '../ui/theme';

const IDEAS: { label: string; icon: IconName; prompt: string }[] = [
  { label: 'Habit tracker', icon: 'repeat', prompt: 'A habit tracker that reflects on my week' },
  { label: 'Expense log', icon: 'wallet-outline', prompt: 'An expense logger that categorizes what I buy' },
  { label: 'Gratitude', icon: 'heart-outline', prompt: 'A gratitude journal with a kind daily reflection' },
  { label: 'Fridge recipes', icon: 'restaurant-outline', prompt: 'Recipe ideas from what is in my fridge' },
  { label: 'Workout log', icon: 'barbell-outline', prompt: 'A workout log that suggests what to train next' },
];

export default function Home() {
  const theme = useTheme();
  const ai = useAI();
  const insets = useSafeAreaInsets();
  const [request, setRequest] = useState('');
  const [building, setBuilding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<SavedApp[]>([]);

  useFocusEffect(
    useCallback(() => {
      listApps().then(setApps);
    }, []),
  );

  const onDevice = modeFor('build', ai) === 'only_on_device';

  const build = async () => {
    const text = request.trim();
    if (!text || building) return;
    setBuilding(text);
    setError(null);
    try {
      const { spec, source } = await buildApp(text, ai);
      const app: SavedApp = { id: newId(), request: text, spec, builtWith: source, createdAt: Date.now(), updatedAt: Date.now() };
      await saveApp(app);
      setRequest('');
      router.push({ pathname: '/app/[id]', params: { id: app.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={[styles.page, { paddingTop: insets.top + space(4), paddingBottom: insets.bottom + space(10) }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={[styles.logo, { backgroundColor: theme.accent }]}>
            <Text style={styles.logoText}>v</Text>
          </View>
          <Text style={[type.headline, { color: theme.text }]}>von mini</Text>
        </View>

        <View style={{ gap: space(2) }}>
          <Text style={[type.display, { color: theme.text }]}>What do you want to build?</Text>
          <Text style={[type.body, { color: theme.muted }]}>
            Describe a small app. It’s ready in seconds, runs its AI on your device, and keeps your data here.
          </Text>
        </View>

        <View style={{ gap: space(3) }}>
          <Composer
            value={request}
            onChange={setRequest}
            onSubmit={build}
            placeholder="A journal that tags my mood…"
            theme={theme}
            busy={!!building}
            minHeight={72}
            sendLabel="Build app"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ideas}>
            {IDEAS.map((idea) => (
              <Chip key={idea.label} label={idea.label} icon={idea.icon} theme={theme} onPress={() => setRequest(idea.prompt)} />
            ))}
          </ScrollView>
        </View>

        {building && (
          <Card theme={theme} tinted style={styles.buildingCard}>
            <ActivityIndicator color={theme.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: theme.text }]} numberOfLines={1}>
                Designing “{building}”
              </Text>
              <Text style={[type.caption, { color: theme.muted }]}>
                {onDevice ? 'Gemini Nano is designing it on this device.' : 'Gemini is designing it; Nano takes over if you go offline.'}
              </Text>
            </View>
          </Card>
        )}
        {error && (
          <Card theme={theme} style={[styles.row, { borderColor: alpha(theme.danger, 0.4) }]}>
            <Icon name="alert-circle-outline" size={18} color={theme.danger} />
            <Text style={[type.caption, { color: theme.danger, flex: 1 }]}>{error}</Text>
          </Card>
        )}

        <StatusBanner
          status={ai.deviceStatus}
          online={ai.online}
          privateMode={ai.privateMode}
          locked={ai.locked}
          onTogglePrivate={ai.setPrivateMode}
          onDownload={() => ai.downloadModel().catch((e) => setError(String(e?.message ?? e)))}
          downloadProgress={ai.downloadProgress}
        />

        <SectionHeader
          title="Your apps"
          theme={theme}
          right={<Text style={[type.caption, { color: theme.subtle }]}>{apps.length}</Text>}
        />
        <View style={styles.grid}>
          {apps.map((app) => {
            const color = ACCENT_COLORS[app.spec.accent][theme.scheme];
            return (
              <Pressable
                key={app.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${app.spec.name}`}
                onPress={() => router.push({ pathname: '/app/[id]', params: { id: app.id } })}
                style={({ pressed }) => [
                  styles.tile,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                    boxShadow: theme.shadow,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  },
                ]}
              >
                <View style={[styles.tileIcon, { backgroundColor: alpha(color, theme.scheme === 'dark' ? 0.22 : 0.12) }]}>
                  <Text style={styles.tileEmoji}>{app.spec.emoji}</Text>
                </View>
                <View style={{ gap: 2, flex: 1 }}>
                  <Text style={[type.label, { color: theme.text }]} numberOfLines={1}>
                    {app.spec.name}
                  </Text>
                  <Text style={[type.caption, { color: theme.muted }]} numberOfLines={2}>
                    {app.spec.description || app.request}
                  </Text>
                </View>
                <SourceBadge source={app.builtWith} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space(4), gap: space(6), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  logo: { width: 28, height: 28, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontWeight: '800', fontSize: 16, marginTop: -2 },
  ideas: { gap: space(2), paddingRight: space(4) },
  buildingCard: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3) },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 168,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(4),
    gap: space(3),
  },
  tileIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tileEmoji: { fontSize: 26 },
});
