/**
 * Opens a shared app link (/s/<id> on the web, vonmini://s/<id> on a phone): shows the shared
 * design, and "Add to my apps" saves a local copy whose AI then runs on this device.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { firebaseConfigured } from '../../firebase/app';
import { loadShared } from '../../share/share';
import type { AppSpec } from '../../spec/types';
import { newId, pushVersion, saveApp } from '../../storage/store';
import { Button, Card, EmptyState, Icon, type IconName } from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { FadeUp, PopIn } from '../../ui/motion';
import { MAX_WIDTH, radius, space, type, useTheme } from '../../ui/theme';

const BLOCK: Record<AppSpec['components'][number]['type'], { icon: IconName; kind: string }> = {
  heading: { icon: 'text-outline', kind: 'Heading' },
  text: { icon: 'reorder-four-outline', kind: 'Text' },
  stat: { icon: 'stats-chart-outline', kind: 'Stat' },
  chart: { icon: 'bar-chart-outline', kind: 'Chart' },
  checklist: { icon: 'checkbox-outline', kind: 'Checklist' },
  input: { icon: 'create-outline', kind: 'Field' },
  choice: { icon: 'radio-button-on-outline', kind: 'Choice' },
  ai: { icon: 'sparkles-outline', kind: 'AI action' },
  voice: { icon: 'mic-outline', kind: 'Voice chat' },
  reminder: { icon: 'alarm-outline', kind: 'Reminders' },
  save: { icon: 'checkmark-outline', kind: 'Save' },
  game: { icon: 'game-controller-outline', kind: 'Game' },
  history: { icon: 'time-outline', kind: 'History' },
};

export default function SharedApp() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shared, setShared] = useState<{ spec: AppSpec; request: string } | null>(null);
  const [error, setError] = useState<string | null>(
    firebaseConfigured ? null : 'Shared apps need a Firebase project (see README).',
  );
  const [adding, setAdding] = useState(false);
  const theme = useTheme(shared?.spec.accent);

  useEffect(() => {
    let alive = true;
    if (!firebaseConfigured) return;
    loadShared(String(id))
      .then((s) => alive && setShared(s))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  const add = async () => {
    if (!shared) return;
    setAdding(true);
    const app = {
      id: newId(),
      request: shared.request || `Shared app: ${shared.spec.name}`,
      spec: shared.spec,
      builtWith: 'starter' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveApp(app);
    await pushVersion(app.id, app.spec, ['Added from a shared link.'], 'build', 'starter');
    haptics.success();
    router.replace({ pathname: '/app/[id]', params: { id: app.id } });
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Shared app' }} />
      <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.page}>
        {error ? (
          <EmptyState icon="link-outline" title="Couldn't open this link" body={error} theme={theme} />
        ) : !shared ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.accent} />
            <Text style={[type.caption, { color: theme.muted }]}>Opening the shared app…</Text>
          </View>
        ) : (
          <>
            <FadeUp>
              <View style={[styles.hero, { backgroundColor: theme.accentSoft }]}>
                <PopIn>
                  <View style={[styles.icon, { backgroundColor: theme.surface }]}>
                    <Text style={styles.emoji}>{shared.spec.emoji}</Text>
                  </View>
                </PopIn>
                <Text style={[type.title, { color: theme.text, textAlign: 'center' }]}>{shared.spec.name}</Text>
                {shared.spec.description ? (
                  <Text style={[type.body, { color: theme.muted, textAlign: 'center' }]}>{shared.spec.description}</Text>
                ) : null}
              </View>
            </FadeUp>

            <FadeUp delay={80}>
              <Card theme={theme} style={{ gap: space(3) }}>
                <Text style={[type.headline, { color: theme.text }]}>What’s inside</Text>
                {shared.spec.components.map((c, i) => (
                  <View key={i} style={styles.row}>
                    <Icon name={BLOCK[c.type].icon} size={16} color={theme.accent} />
                    <Text style={[type.caption, { color: theme.subtle, width: 76 }]}>{BLOCK[c.type].kind}</Text>
                    <Text style={[type.body, { color: theme.text, flex: 1 }]} numberOfLines={1}>
                      {c.label ?? c.text ?? ''}
                    </Text>
                  </View>
                ))}
              </Card>
            </FadeUp>

            <FadeUp delay={140}>
              <Card theme={theme} style={{ gap: space(2) }}>
                {[
                  ['phone-portrait-outline', 'Its AI runs on your device with Gemini Nano, and works offline.'],
                  ['lock-closed-outline', 'Only the design was shared. Nothing you type is ever sent to whoever shared it.'],
                ].map(([icon, text]) => (
                  <View key={icon} style={styles.row}>
                    <Icon name={icon as IconName} size={16} color={theme.success} />
                    <Text style={[type.caption, { color: theme.text, flex: 1 }]}>{text}</Text>
                  </View>
                ))}
              </Card>
            </FadeUp>

            <Button label="Add to my apps" icon="add" theme={theme} loading={adding} onPress={add} />
          </>
        )}
        <Button label="Go to von mini" variant="ghost" theme={theme} onPress={() => router.replace('/')} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: space(4), paddingBottom: space(12), gap: space(4), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  loading: { alignItems: 'center', gap: space(3), paddingVertical: space(12) },
  hero: { borderRadius: radius.xl, padding: space(6), alignItems: 'center', gap: space(2) },
  icon: { width: 72, height: 72, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 38 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
});
