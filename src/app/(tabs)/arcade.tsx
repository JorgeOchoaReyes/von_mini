/** The Arcade tab: the built-in games, ready to play. All of them work offline. */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ARCADE } from '../../spec/starters';
import { listApps, type SavedApp } from '../../storage/store';
import { AppTile } from '../../ui/AppTile';
import { MIC_OVERHANG } from '../../ui/BottomBar';
import { Icon } from '../../ui/components';
import { confirmDeleteApp } from '../../ui/deleteApp';
import { FadeUp } from '../../ui/motion';
import { MAX_WIDTH, space, type, useTheme } from '../../ui/theme';

export default function ArcadeTab() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [games, setGames] = useState<SavedApp[]>(ARCADE);

  // A game you've changed is saved under the same id; show that version.
  useFocusEffect(
    useCallback(() => {
      void listApps().then((all) => setGames(ARCADE.map((g) => all.find((a) => a.id === g.id) ?? g)));
    }, []),
  );

  const open = useCallback((id: string) => router.push({ pathname: '/app/[id]', params: { id } }), []);
  const reset = useCallback((app: SavedApp) => confirmDeleteApp(app, () => void listApps().then((all) => setGames(ARCADE.map((g) => all.find((a) => a.id === g.id) ?? g)))), []);

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[styles.page, { paddingTop: (Platform.OS === 'web' ? 0 : insets.top) + space(4) }]}
    >
      <Text style={[type.display, { color: theme.text }]}>Arcade</Text>
      <View style={styles.row}>
        <Icon name="airplane-outline" size={16} color={theme.success} />
        <Text style={[type.caption, { color: theme.muted, flex: 1 }]}>Every game works offline: no AI, no internet. High scores stay on this phone.</Text>
      </View>
      <View style={styles.grid}>
        {games.map((g, i) => (
          <FadeUp key={g.id} delay={Math.min(i * 40, 240)} style={styles.tileWrap}>
            <AppTile app={g} onOpen={open} onLongPress={reset} />
          </FadeUp>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space(4), paddingBottom: MIC_OVERHANG + space(8), gap: space(4), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3) },
  tileWrap: { flexBasis: '47%', flexGrow: 1, minWidth: 240 },
});
