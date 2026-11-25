/**
 * A game block on an app's screen: the game's name, best score and a Play button. Playing opens
 * the full-screen player; each finished run is saved as an entry holding its score, so stats,
 * charts and history work on scores like on any other field.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { SpecComponent } from '../spec/types';
import { entryNumber } from '../spec/stats';
import type { Entry } from '../storage/store';
import { Button, Card, Icon } from '../ui/components';
import { radius, space, type, type Theme } from '../ui/theme';
import { GAME_INFO, GamePlayer, type GameKind, type HighScore } from './GamePlayer';

export function GameCard({
  c,
  theme,
  entries,
  onFinish,
}: {
  c: SpecComponent;
  theme: Theme;
  entries: Entry[];
  onFinish(score: number, by?: string): Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const kind = (c.game ?? 'runner') as GameKind;
  const info = GAME_INFO[kind];
  // Every finished run, best first; initials are saved next to the score as "<id>_by".
  const scores = useMemo(
    () =>
      entries
        .flatMap((e): HighScore[] => {
          const score = entryNumber(e, c.id);
          return score === null ? [] : [{ score, by: e.values[`${c.id}_by`] || undefined }];
        })
        .sort((a, b) => b.score - a.score),
    [entries, c.id],
  );
  const best = scores.length ? scores[0].score : null;
  const emoji = c.player || info.icon;

  return (
    <Card theme={theme} style={{ gap: space(3) }}>
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: theme.accentSoft, borderColor: theme.border }]}>
          <Text style={{ fontSize: 28 }}>{emoji}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.headline, { color: theme.text }]} numberOfLines={1}>
            {c.label}
          </Text>
          <Text style={[type.caption, { color: theme.muted }]} numberOfLines={2}>
            {c.text || info.how}
          </Text>
        </View>
      </View>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <View style={styles.row}>
          <Icon name="trophy-outline" size={16} color={theme.accent} />
          <Text style={[type.label, { color: theme.text }]} accessibilityLabel={`Best score ${best ?? 'none yet'}`}>
            {best === null ? 'No score yet' : `Best ${best}${scores[0].by ? ` · ${scores[0].by}` : ''}`}
          </Text>
        </View>
        <Text style={[type.caption, { color: theme.subtle }]}>
          {scores.length} {scores.length === 1 ? 'game' : 'games'} played
        </Text>
      </View>
      <Button label="Play" icon="play" theme={theme} onPress={() => setOpen(true)} />
      <GamePlayer
        visible={open}
        onClose={() => setOpen(false)}
        kind={kind}
        title={c.label ?? info.name}
        speed={c.speed}
        player={c.player}
        item={c.item}
        theme={theme}
        topScores={scores}
        best={best}
        onFinish={onFinish}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  badge: { width: 52, height: 52, borderRadius: radius.md, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
