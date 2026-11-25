/** One app in a gallery (Home shelves, Arcade): icon, name, description, and its badges. */
import { memo } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import type { SavedApp } from '../storage/store';
import { SourceBadge } from './components';
import { haptics } from './haptics';
import { usePressScale } from './motion';
import { OfflineBadge } from './OfflineBadge';
import { ACCENT_COLORS, alpha, radius, space, stroke, type, useTheme } from './theme';

/** One app in the gallery. Memoized so typing in the prompt box never re-renders the grid. */
export const AppTile = memo(function AppTile({
  app,
  onOpen,
  onLongPress,
}: {
  app: SavedApp;
  onOpen(id: string): void;
  /** Long-press: delete (or reset a changed ready-made app). */
  onLongPress(app: SavedApp): void;
}) {
  const theme = useTheme(app.spec.accent);
  const color = (ACCENT_COLORS[app.spec.accent] ?? ACCENT_COLORS.violet)[theme.scheme];
  const spring = usePressScale(0.965);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${app.spec.name}`}
      onPress={() => {
        haptics.tap();
        onOpen(app.id);
      }}
      onLongPress={() => {
        haptics.medium();
        onLongPress(app);
      }}
      accessibilityHint="Long-press to delete"
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
        <View style={styles.badges}>
          <SourceBadge source={app.builtWith} />
          <OfflineBadge spec={app.spec} html={!!app.html} />
        </View>
      </Animated.View>
    </Pressable>
  );
});


const styles = StyleSheet.create({
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
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), alignItems: 'center' },
});
