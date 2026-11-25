import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAI } from '../../ai/AIContext';
import { buildAppProgressive, modeFor, type BuildEvent, type ProgressStep, type SpecPeek } from '../../ai/hybrid';
import { ensureAlertPermission, notify, notifyIfInBackground } from '../../alerts/notifications';
import { STARTERS } from '../../spec/starters';
import { MicButton } from '../../voice/MicButton';
import { listApps, newId, pushVersion, saveApp, type SavedApp } from '../../storage/store';
import {
  Button,
  Caption,
  Card,
  Chip,
  Composer,
  EmptyState,
  Icon,
  IconButton,
  ModePill,
  Segmented,
  SourceBadge,
  SpecSkeleton,
  StepList,
  type IconName,
} from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { Halftone } from '../../ui/Halftone';
import { Drift, FadeUp, Pulse, usePressScale } from '../../ui/motion';
import { stroke, ACCENT_COLORS, alpha, MAX_WIDTH, radius, setSchemePref, space, type, useSchemePref, useTheme } from '../../ui/theme';
import { MIC_OVERHANG } from '../../ui/BottomBar';

/** Which shelf of the app gallery is showing. */
type Shelf = 'mine' | 'ready';

const IDEAS: { label: string; icon: IconName; prompt: string }[] = [
  { label: 'Interview practice', icon: 'mic-outline', prompt: 'Help me practice answering tough interview questions out loud' },
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
  const spring = usePressScale(0.965);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${app.spec.name}`}
      onPress={() => {
        haptics.tap();
        onOpen(app.id);
      }}
      {...spring.handlers}
    >
      <Animated.View
        style={[
          styles.tile,
          spring.style,
          { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: theme.shadow },
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
      </Animated.View>
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
    else if (e.type === 'fallback') {
      // Start the visible pipeline over, headed by why it switched.
      setSteps([{ id: 'fallback', label: 'Cloud is busy, so Gemini Nano is designing it on this device', state: 'done' }]);
      setPeek(null);
      setPartial('');
    }
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
    // Ask once (Android 13+) so we can say "your app is ready" if the user switches away mid-build.
    void ensureAlertPermission().catch(() => false);
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
      void notifyIfInBackground({
        title: `${spec.emoji} ${spec.name} is ready`,
        body: 'Your app is built. Tap to open it.',
        url: `/app/${app.id}`,
      });
      router.push({ pathname: '/app/[id]', params: { id: app.id } });
    } catch (e) {
      haptics.error();
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      // Always notify on failure, even with the app open: the build may have been left running.
      void notify({ title: 'Couldn’t build your app', body: message.slice(0, 180), url: '/' });
    } finally {
      setBuilding(null);
      setSteps([]);
      setPeek(null);
      setPartial('');
    }
  };

  const openApp = useCallback((id: string) => router.push({ pathname: '/app/[id]', params: { id } }), []);
  const schemePref = useSchemePref();
  const isStarter = (a: SavedApp) => STARTERS.some((s) => s.id === a.id);
  const mine = apps.filter((a) => !isStarter(a));
  const ready = apps.filter(isStarter);
  // Show your own apps once you have some; until then, the ready-made shelf.
  const [shelfChoice, setShelfChoice] = useState<Shelf | null>(null);
  const shelf: Shelf = shelfChoice ?? (mine.length ? 'mine' : 'ready');
  const shown = shelf === 'mine' ? mine : ready;

  // The bottom bar's voice button sends what was said here to build it (params.at keeps a repeat
  // of the same request from being ignored).
  const params = useLocalSearchParams<{ build?: string; at?: string }>();
  const buildRef = useRef(build);
  useEffect(() => {
    buildRef.current = build;
  });
  useEffect(() => {
    if (!params.build || !params.at) return;
    void buildRef.current(params.build);
  }, [params.at, params.build]);

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={[
          styles.page,
          { paddingTop: (Platform.OS === 'web' ? 0 : insets.top) + space(4), paddingBottom: MIC_OVERHANG + space(8) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <FadeUp style={styles.brandRow} distance={6}>
          <View style={styles.brand}>
            <Image source={require('../../../assets/logo.png')} style={styles.logo} accessibilityIgnoresInvertColors />
            <Text style={[type.title, { color: theme.text }]}>von mini</Text>
          </View>
          <View style={{ flex: 1 }} />
          {/* One tap cycles the look: follow the system, light (paper), dark (night comic). */}
          <IconButton
            icon={schemePref === 'system' ? 'contrast-outline' : schemePref === 'light' ? 'sunny-outline' : 'moon-outline'}
            label={`Appearance: ${schemePref}. Tap to change`}
            theme={theme}
            color={theme.text}
            onPress={() => setSchemePref(schemePref === 'system' ? 'light' : schemePref === 'light' ? 'dark' : 'system')}
          />
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
            {/* Ben-Day dots in the panel corner, drifting slightly: comic shading, kept off the text. */}
            <Drift style={styles.heroDots} range={6} duration={12000}>
              <Halftone color={theme.accentAlt} cols={11} rows={8} spacing={15} maxDot={10} from="top-right" />
            </Drift>
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
              accessory={
                // Say the idea instead of typing it; the app is built as soon as you stop talking.
                <MicButton theme={theme} size={40} label="Describe your app out loud" onPartial={setRequest} onFinal={(t) => build(t)} />
              }
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
            {/* A comic caption box: the narrator's note on how this gets built. */}
            <Caption theme={theme} icon={onDevice ? 'phone-portrait-outline' : 'git-compare-outline'}>
              {onDevice
                ? 'Built on-device with Gemini Nano. Works in airplane mode.'
                : 'Gemini designs it, with Gemini Nano as the offline fallback.'}
            </Caption>
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

        {/* Two shelves: the apps you made, and the ones that ship with von mini. All stored on
            this device. */}
        <View style={{ gap: space(4) }}>
          <Segmented<Shelf>
            theme={theme}
            value={shelf}
            onChange={setShelfChoice}
            options={[
              { value: 'mine', label: `My apps${mine.length ? ` · ${mine.length}` : ''}`, icon: 'person-outline' },
              { value: 'ready', label: `Ready-made · ${ready.length}`, icon: 'cube-outline' },
            ]}
          />
          {shown.length === 0 ? (
            <EmptyState
              icon="sparkles-outline"
              title="No apps yet"
              body="Describe one above, or tap the mic below and say what you want. Your apps stay on this device."
              theme={theme}
            />
          ) : (
            <View style={styles.grid}>
              {shown.map((app, i) => (
                <FadeUp key={`${shelf}:${app.id}`} delay={Math.min(i * 40, 240)} style={styles.tileWrap}>
                  <AppTile app={app} onOpen={openApp} />
                </FadeUp>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space(4), gap: space(6), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  logo: { width: 40, height: 40, borderRadius: radius.sm },
  hero: {
    borderWidth: stroke,
    borderRadius: radius.xl,
    padding: space(5),
    gap: space(4),
    overflow: 'hidden',
  },
  // Sized to the dot grid (11 x 8 at 15 px) so the panel's clipping doesn't hide it.
  heroDots: { position: 'absolute', top: space(2), right: space(1), width: 11 * 15 + 8, height: 8 * 15 },
  ideas: { gap: space(2), paddingRight: space(4) },
  // A vertical ScrollView's content container is a column by default, so wrapping needs the row
  // direction spelled out — otherwise every chip lands on its own line.
  ideasWrap: { flexDirection: 'row', flexWrap: 'wrap', paddingRight: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  buildBody: { flexDirection: 'row', gap: space(4), flexWrap: 'wrap' },
  peek: { minWidth: 168, flexGrow: 1, flexBasis: 168, borderWidth: stroke, borderRadius: radius.lg, padding: space(4), gap: space(1) },
  peekEmoji: { fontSize: 28 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3) },
  tileWrap: { flexBasis: '47%', flexGrow: 1, minWidth: 240 },
  tile: {
    flex: 1,
    minHeight: 168,
    borderWidth: stroke,
    borderRadius: radius.lg,
    padding: space(4),
    gap: space(3),
  },
  tileIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tileEmoji: { fontSize: 26 },
});
