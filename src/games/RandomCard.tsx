/**
 * A dice & chance block: roll dice, flip a coin, spin to pick one of a list, or pick a number.
 * Works offline. Every result is saved as an entry (a roll of two dice saves "9 (4 + 5)", whose
 * first number is the total), so stats like "Highest roll" and the history work on results.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { SpecComponent } from '../spec/types';
import { rollOnce, type Result } from './random';
import type { Entry } from '../storage/store';
import { Button, Card } from '../ui/components';
import { haptics } from '../ui/haptics';
import { radius, space, stroke, type, type Theme } from '../ui/theme';

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
/** The saved value back as a result, so the last roll shows when the app opens. */
function fromSaved(c: SpecComponent, v: string | undefined): Result | null {
  if (!v) return null;
  if (c.roll && c.roll !== 'dice') return { text: v };
  const parts = v.match(/\(([^)]+)\)/)?.[1].split('+').map((x) => parseInt(x, 10)) ?? [parseInt(v, 10)];
  return parts.every(Number.isFinite) ? { dice: parts, text: v } : { text: v };
}

export function RandomCard({
  c,
  theme,
  entries,
  onResult,
}: {
  c: SpecComponent;
  theme: Theme;
  entries: Entry[];
  onResult(value: string): Promise<void> | void;
}) {
  const last = entries.find((e) => e.values[c.id!])?.values[c.id!];
  const [shown, setShown] = useState<Result | null>(null);
  const [rolling, setRolling] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const result = shown ?? fromSaved(c, last);
  const rolls = entries.filter((e) => e.values[c.id!]).length;

  const roll = () => {
    if (rolling) return;
    haptics.tap();
    setRolling(true);
    // A short shuffle before the real result lands, like dice tumbling.
    let n = 0;
    timer.current = setInterval(() => {
      n++;
      setShown(rollOnce(c));
      if (n % 2) haptics.light();
      if (n < 9) return;
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      const final = rollOnce(c);
      setShown(final);
      setRolling(false);
      haptics.success();
      void Promise.resolve(onResult(final.text)).catch(() => undefined);
    }, 70);
  };

  const big = (text: string) => (
    <Text style={[styles.big, { color: theme.text }]} numberOfLines={2} adjustsFontSizeToFit>
      {text}
    </Text>
  );

  let face: React.ReactNode = <Text style={[type.body, { color: theme.subtle }]}>{rollHint(c)}</Text>;
  if (result) {
    if (result.dice && (c.sides ?? 6) === 6) {
      face = (
        <View style={styles.dice}>
          {result.dice.map((d, i) => (
            <Text key={i} style={[styles.die, { color: theme.text }]}>
              {FACES[d - 1] ?? d}
            </Text>
          ))}
        </View>
      );
    } else if (result.dice) {
      face = (
        <View style={styles.dice}>
          {result.dice.map((d, i) => (
            <View key={i} style={[styles.tile, { borderColor: theme.border, backgroundColor: theme.surface }]}>
              <Text style={[type.title, { color: theme.text }]}>{d}</Text>
            </View>
          ))}
        </View>
      );
    } else if (c.roll === 'coin') {
      face = (
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 56 }}>🪙</Text>
          {big(result.text)}
        </View>
      );
    } else face = big(result.text);
  }
  const total = result?.dice && result.dice.length > 1 ? result.dice.reduce((a, b) => a + b, 0) : null;

  return (
    <Card theme={theme} style={{ gap: space(3) }}>
      <View style={{ gap: 2 }}>
        <Text style={[type.headline, { color: theme.text }]}>{c.label}</Text>
        {c.text ? <Text style={[type.caption, { color: theme.muted }]}>{c.text}</Text> : null}
      </View>
      <View
        accessibilityLiveRegion="polite"
        accessibilityLabel={result ? `Result: ${result.text}` : 'No result yet'}
        style={[styles.stage, { backgroundColor: theme.surfaceAlt, borderColor: theme.border, opacity: rolling ? 0.75 : 1 }]}
      >
        {face}
        {total !== null && !rolling ? <Text style={[type.label, { color: theme.muted }]}>Total {total}</Text> : null}
      </View>
      <View style={styles.row}>
        <Text style={[type.caption, { color: theme.subtle }]}>
          {rolls} {c.roll === 'coin' ? (rolls === 1 ? 'flip' : 'flips') : rolls === 1 ? 'roll' : 'rolls'}
        </Text>
      </View>
      <Button label={c.label ?? 'Roll'} icon={c.roll === 'coin' ? 'sync' : c.roll === 'pick' ? 'shuffle' : 'dice'} theme={theme} onPress={roll} disabled={rolling} />
    </Card>
  );
}

function rollHint(c: SpecComponent) {
  if (c.roll === 'coin') return 'Heads or tails?';
  if (c.roll === 'pick') return `One of ${c.options?.length ?? 0}: ${(c.options ?? []).slice(0, 3).join(', ')}${(c.options?.length ?? 0) > 3 ? '…' : ''}`;
  if (c.roll === 'number') return `A number from ${c.min ?? 1} to ${c.max ?? 100}`;
  const n = c.count ?? 1;
  return `${n} ${n === 1 ? 'die' : 'dice'}${(c.sides ?? 6) !== 6 ? ` with ${c.sides} sides` : ''}`;
}

const styles = StyleSheet.create({
  stage: { minHeight: 130, borderWidth: stroke, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', padding: space(4), gap: space(1) },
  dice: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space(2) },
  die: { fontSize: 72, lineHeight: 84 },
  tile: { minWidth: 64, height: 64, borderWidth: stroke, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space(2) },
  big: { fontSize: 40, fontWeight: '800', textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
});
