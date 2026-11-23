import { router, Stack, useFocusEffect } from 'expo-router';
import { memo, useCallback, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAI } from '../ai/AIContext';
import { buildAppProgressive, modeFor, type BuildEvent, type ProgressStep, type SpecPeek } from '../ai/hybrid';
import { STARTERS } from '../spec/starters';
import { listApps, newId, pushVersion, saveApp, type SavedApp } from '../storage/store';
import {
  Button,
  Card,
  Chip,
  Composer,
  Gradient,
  Icon,
  ModePill,
  SectionHeader,
  SourceBadge,
  SpecSkeleton,
  StepList,
  type IconName,
} from '../ui/components';
import { haptics } from '../ui/haptics';
import { FadeUp, Pulse } from '../ui/motion';
import { ACCENT_COLORS, alpha, MAX_WIDTH, radius, space, type, useTheme } from '../ui/theme';

const IDEAS: { label: string; icon: IconName; prompt: string }[] = [
  { label: 'Mood journal', icon: 'happy-outline', prompt: 'A journal that tags my mood' },
  { label: 'Habit tracker', icon: 'repeat', prompt: 'A habit tracker that reflects on my week' },
  { label: 'Expense notes', icon: 'wallet-outline', prompt: 'An expense logger that categorizes what I buy' },
  { label: 'Tone fixer', icon: 'mail-outline', prompt: 'Rewrite my messages in a different tone' },
  { label: 'Flashcards', icon: 'school-outline', prompt: 'Make flashcards from my study notes' },
  { label: 'Meeting notes', icon: 'document-text-outline', prompt: 'Turn meeting notes into action items' },
  { label: 'Recipe scaler', icon: 'restaurant-outline', prompt: 'Scale a recipe and get ideas from my fridge' },
  { label: 'Workout log', icon: 'barbell-outline', prompt: 'A workout log that suggests what to train next' },
];

/** One app in the gallery. Memoized so typing in the prompt box never re-renders the grid. */
const AppTile = memo(function AppTile({ app, onOpen }: { app: SavedApp; onOpen(id: string): void }) {
  const theme = useTheme(app.spec.accent);
  const color = ACCENT_COLORS[app.spec.accent][theme.scheme];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${app.spec.name}`}
      onPress={() => {
        haptics.tap();
        onOpen(app.id);
      }}
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
      <View style={{ gap: 3, flex: 1 }}>
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
});

export default function Home() {
  const theme = useTheme();
  const ai = useAI();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const [request, setRequest] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<SavedApp[]>([]);

  // Live build state, so the hero can show what is happening while the spec streams in.
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [peek, setPeek] = useState<SpecPeek | null>(null);
  const [partial, setPartial] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const builtRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      listApps().then(setApps);
    }, []),
  );

  const onDevice = modeFor('build', ai) === 'only_on_device';

  const onEvent = useCallback((e: BuildEvent) => {
    if (e.type === 'step') {
      setSteps((prev) => {
        const next = prev.map((s) => (s.id === e.step.id ? e.step : s.state === 'active' ? { ...s, state: 'done' as const } : s));
        return next.some((s) => s.id === e.step.id) ? next : [...next, e.step];
      });
    } else if (e.type === 'peek') setPeek(e.peek);
    else if (e.type === 'partial') setPartial(e.text);
    else if (e.type === 'retry') setRetrying(true);
  }, []);

  const build = async (text: string) => {
    const value = text.trim();
    if (!value || building) return;
    haptics.medium();
    ai.warmUp();
    setBuilding(value);
    setError(null);
    setSteps([]);
    setPeek(null);
    setPartial('');
    setRetrying(false);
    builtRef.current = false;
    try {
      const { spec, source } = await buildAppProgressive(value, ai, onEvent);
      const app: SavedApp = {
        id: newId(),
        request: value,
        spec,
        builtWith: source,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveApp(app);
      await pushVersion(app.id, spec, [`Built “${spec.name}” from your description.`], 'build', source);
      builtRef.current = true;
      haptics.success();
      setRequest('');
      router.push({ pathname: '/app/[id]', params: { id: app.id } });
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(null);
      setSteps([]);
      setPeek(null);
      setPartial('');
    }
  };

  const openApp = useCallback((id: string) => router.push({ pathname: '/app/[id]', params: { id } }), []);
  const mine = apps.filter((a) => !STARTERS.some((s) => s.id === a.id));

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={[
          styles.page,
          { paddingTop: (Platform.OS === 'web' ? 0 : insets.top) + space(4), paddingBottom: insets.bottom + space(10) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <FadeUp style={styles.brandRow} distance={6}>
          <View style={styles.brand}>
            <Gradient theme={theme} style={styles.logo}>
              <Text style={styles.logoText}>v</Text>
            </Gradient>
            <Text style={[type.headline, { color: theme.text }]}>von mini</Text>
          </View>
          <View style={{ flex: 1 }} />
          <ModePill
            status={ai.deviceStatus}
            online={ai.online}
            privateMode={ai.privateMode}
            locked={ai.locked}
            onPress={() => router.push('/settings')}
          />
        </FadeUp>

        {/* Prompt-first hero: the whole product starts here. */}
        <FadeUp delay={40}>
          <View style={[styles.hero, { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: theme.shadow }]}>
            <View style={[styles.heroWash, { backgroundColor: theme.accentSoft }]} pointerEvents="none" />
            <View style={{ gap: space(2) }}>
              <Text style={[type.display, { color: theme.text }]}>What do you want to build?</Text>
              <Text style={[type.body, { color: theme.muted }]}>
                Describe a small app in a sentence. It’s ready in seconds, its AI runs on your device, and your data stays
                here.
              </Text>
            </View>
            <Composer
              value={request}
              onChange={setRequest}
              onSubmit={() => build(request)}
              placeholder="A journal that tags my mood…"
              theme={theme}
              busy={!!building}
              minHeight={64}
              sendLabel="Build app"
            />
            {/* Scrolling on phones keeps the hero short; wrapping on wide screens uses the space. */}
            <ScrollView
              horizontal={!wide}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.ideas, wide && styles.ideasWrap]}
            >
              {IDEAS.map((idea) => (
                <Chip
                  key={idea.label}
                  label={idea.label}
                  icon={idea.icon}
                  theme={theme}
                  onPress={() => {
                    setRequest(idea.prompt);
                  }}
                />
              ))}
            </ScrollView>
            <View style={styles.row}>
              <Icon name={onDevice ? 'phone-portrait-outline' : 'git-compare-outline'} size={14} color={theme.subtle} />
              <Text style={[type.caption, { color: theme.subtle, flex: 1 }]}>
                {onDevice
                  ? 'Built on-device with Gemini Nano — works in airplane mode.'
                  : 'Gemini designs it, with Gemini Nano as the offline fallback.'}
              </Text>
            </View>
          </View>
        </FadeUp>

        {/* Live build progress: real pipeline phases, plus the app taking shape as it streams. */}
        {building && (
          <FadeUp>
            <Card theme={theme} style={{ gap: space(4) }}>
              <View style={styles.row}>
                <Pulse color={theme.accent} />
                <Text style={[type.label, { color: theme.text, flex: 1 }]} numberOfLines={1}>
                  Building “{building}”
                </Text>
                {retrying && <Text style={[type.caption, { color: theme.warning }]}>retrying…</Text>}
              </View>

              <View style={styles.buildBody}>
                <View style={{ flexGrow: 1, flexBasis: 200, gap: space(3) }}>
                  <StepList steps={steps} theme={theme} />
                </View>
                <View style={[styles.peek, { borderColor: theme.border, backgroundColor: theme.bgAlt }]}>
                  {peek?.name ? (
                    <FadeUp style={{ gap: space(2) }} distance={4}>
                      <Text style={styles.peekEmoji}>{peek.emoji || '✨'}</Text>
                      <Text style={[type.label, { color: theme.text }]} numberOfLines={2}>
                        {peek.name}
                      </Text>
                      {peek.description ? (
                        <Text style={[type.caption, { color: theme.muted }]} numberOfLines={3}>
                          {peek.description}
                        </Text>
                      ) : null}
                      <Text style={[type.caption, { color: theme.subtle }]}>
                        {peek.components} block{peek.components === 1 ? '' : 's'}
                      </Text>
                    </FadeUp>
                  ) : (
                    <SpecSkeleton theme={theme} />
                  )}
                </View>
              </View>

              {partial ? (
                <Text style={[type.mono, { color: theme.subtle }]} numberOfLines={2}>
                  {partial.slice(-160)}
                </Text>
              ) : null}
            </Card>
          </FadeUp>
        )}

        {error && (
          <Card theme={theme} style={[styles.row, { borderColor: alpha(theme.danger, 0.4) }]}>
            <Icon name="alert-circle-outline" size={18} color={theme.danger} />
            <Text style={[type.caption, { color: theme.danger, flex: 1 }]}>{error}</Text>
            <Button label="Settings" size="sm" variant="secondary" theme={theme} onPress={() => router.push('/settings')} />
          </Card>
        )}

        {mine.length === 0 && !building && (
          <FadeUp delay={80}>
            <Card theme={theme} tinted style={{ gap: space(3) }}>
              <Text style={[type.label, { color: theme.text }]}>Private by default</Text>
              {[
                ['lock-closed-outline', 'Everything you type is processed on this device by Gemini Nano.'],
                ['cloud-offline-outline', 'Apps you build keep working in airplane mode.'],
                ['pricetag-outline', 'On-device inference costs nothing, so your apps are free to run.'],
              ].map(([icon, text]) => (
                <View key={text} style={styles.row}>
                  <Icon name={icon as IconName} size={16} color={theme.accent} />
                  <Text style={[type.caption, { color: theme.muted, flex: 1 }]}>{text}</Text>
                </View>
              ))}
            </Card>
          </FadeUp>
        )}

        <SectionHeader
          title={mine.length ? 'Your apps' : 'Start with a ready-made app'}
          theme={theme}
          right={<Text style={[type.caption, { color: theme.subtle }]}>{apps.length}</Text>}
        />
        <View style={styles.grid}>
          {apps.map((app, i) => (
            <FadeUp key={app.id} delay={Math.min(i * 40, 240)} style={styles.tileWrap}>
              <AppTile app={app} onOpen={openApp} />
            </FadeUp>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space(4), gap: space(6), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  logo: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontWeight: '800', fontSize: 17, marginTop: -2 },
  hero: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space(5),
    gap: space(4),
    overflow: 'hidden',
  },
  heroWash: {
    position: 'absolute',
    top: -120,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: 999,
    opacity: 0.9,
  },
  ideas: { gap: space(2), paddingRight: space(4) },
  // A vertical ScrollView's content container is a column by default, so wrapping needs the row
  // direction spelled out — otherwise every chip lands on its own line.
  ideasWrap: { flexDirection: 'row', flexWrap: 'wrap', paddingRight: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  buildBody: { flexDirection: 'row', gap: space(4), flexWrap: 'wrap' },
  peek: { minWidth: 168, flexGrow: 1, flexBasis: 168, borderWidth: 1, borderRadius: radius.lg, padding: space(4), gap: space(1) },
  peekEmoji: { fontSize: 28 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3) },
  tileWrap: { flexBasis: '47%', flexGrow: 1, minWidth: 240 },
  tile: {
    flex: 1,
    minHeight: 168,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(4),
    gap: space(3),
  },
  tileIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tileEmoji: { fontSize: 26 },
});
