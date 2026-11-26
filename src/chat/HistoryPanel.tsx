/**
 * Version history for one app.
 *
 * Every change — a build, a chat edit, a manual tweak, a restore — records a snapshot of the spec
 * with a plain-words summary of what it changed. Because an app is a small JSON document rather
 * than generated code, restoring is exact and instant: no re-generation, no drift.
 */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { AppSpec } from '../spec/types';
import { listVersions, restoreVersion, type Version } from '../storage/store';
import { Button, Card, Icon, SourceBadge, relativeTime, type IconName } from '../ui/components';
import { FadeUp } from '../ui/motion';
import { MAX_WIDTH, alpha, radius, space, type, useTheme } from '../ui/theme';

const ORIGIN: Record<Version['origin'], { icon: IconName; label: string }> = {
  build: { icon: 'sparkles-outline', label: 'Created' },
  chat: { icon: 'chatbubble-ellipses-outline', label: 'Chat edit' },
  manual: { icon: 'create-outline', label: 'Manual edit' },
  restore: { icon: 'arrow-undo-outline', label: 'Restored' },
};

export function HistoryPanel({
  appId,
  current,
  version,
  onRestored,
}: {
  appId: string;
  /** The spec on screen now, so the newest version can be marked as current. */
  current: AppSpec;
  /** Bump to reload (the builder passes its chat/version counter). */
  version: number;
  onRestored(spec: AppSpec): void;
}) {
  const theme = useTheme(current.accent);
  const [versions, setVersions] = useState<Version[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listVersions(appId).then((v) => alive && setVersions(v));
    return () => {
      alive = false;
    };
  }, [appId, version]);

  const restore = useCallback(
    async (v: Version) => {
      setBusy(v.id);
      try {
        const spec = await restoreVersion(appId, v.id);
        if (spec) {
          setVersions(await listVersions(appId));
          onRestored(spec);
        }
      } finally {
        setBusy(null);
      }
    },
    [appId, onRestored],
  );

  // The newest version matching the app is the current one (a design and the code built from it
  // share the same design, so only the latest of them is "current").
  const currentId = versions.find((v) => JSON.stringify(v.spec) === JSON.stringify(current))?.id;
  const isCurrent = (v: Version) => v.id === currentId;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space(1) }}>
        <Text style={[type.title, { color: theme.text }]}>Version history</Text>
        <Text style={[type.caption, { color: theme.muted }]}>
          Every change is saved as a version you can put back, exactly as it was.
        </Text>
      </View>

      {versions.length === 0 && (
        <Card theme={theme}>
          <Text style={[type.caption, { color: theme.muted }]}>
            No versions yet. Build or edit this app and its history will appear here.
          </Text>
        </Card>
      )}

      {versions.map((v, i) => {
        const meta = ORIGIN[v.origin];
        const now = isCurrent(v);
        return (
          <FadeUp key={v.id} delay={Math.min(i * 30, 180)} distance={6}>
            <Card theme={theme} style={{ gap: space(3) }}>
              <View style={styles.head}>
                <View style={[styles.origin, { backgroundColor: now ? alpha(theme.accent, 0.14) : theme.surfaceAlt }]}>
                  <Icon name={meta.icon} size={15} color={now ? theme.accent : theme.muted} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.row}>
                    <Text style={[type.label, { color: theme.text }]}>{meta.label}</Text>
                    {now && (
                      <View style={[styles.nowTag, { backgroundColor: theme.accentSoft }]}>
                        <Text style={[type.caption, { color: theme.accent, fontWeight: '700', fontSize: 11 }]}>Current</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[type.caption, { color: theme.subtle }]}>
                    {relativeTime(v.at)} · {new Date(v.at).toLocaleString()}
                  </Text>
                </View>
                <SourceBadge source={v.source} />
              </View>

              <View style={{ gap: space(1) }}>
                {v.changes.slice(0, 6).map((c, j) => (
                  <View key={j} style={styles.row}>
                    <View style={[styles.dot, { backgroundColor: theme.subtle }]} />
                    <Text style={[type.caption, { color: theme.muted, flex: 1 }]}>{c}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.row}>
                <Text style={[type.caption, { color: theme.subtle, flex: 1 }]}>
                  {v.spec.emoji} {v.spec.name} · {v.html ? 'built in code' : `${v.spec.components.length} blocks`}
                </Text>
                <Button
                  label={now ? 'Already current' : 'Restore'}
                  icon="arrow-undo-outline"
                  size="sm"
                  variant="secondary"
                  theme={theme}
                  disabled={now}
                  loading={busy === v.id}
                  onPress={() => restore(v)}
                />
              </View>
            </Card>
          </FadeUp>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space(4), paddingBottom: space(12), gap: space(3), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  origin: { width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  nowTag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 7, alignSelf: 'flex-start' },
});
