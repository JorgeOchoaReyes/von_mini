/**
 * The full-screen game player behind a game block.
 *
 * Minimal on purpose: a close button, the score and the best score, the board, and a game-over card
 * with the top five scores. Full screen means swipes steer the game instead of scrolling the page.
 * The game pauses when the app goes to the background, and nothing starts until the first tap.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AppState,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, IconButton } from '../ui/components';
import { haptics } from '../ui/haptics';
import { radius, space, stroke, type, type Theme } from '../ui/theme';
import * as G from './logic';

export type GameKind = 'blocks' | 'runner' | 'snake' | 'flyer';

export const GAME_INFO: Record<GameKind, { name: string; how: string; player: string; item: string }> = {
  blocks: { name: 'Falling blocks', how: 'Swipe to move, tap to turn, swipe down to drop. Fill rows to clear them.', player: '', item: '' },
  runner: { name: 'Lane runner', how: 'Swipe or tap left and right to dodge. It gets faster.', player: '🏃', item: '🚧' },
  snake: { name: 'Snake', how: 'Swipe to turn. Eat to grow, don’t bite yourself.', player: '', item: '🍎' },
  flyer: { name: 'Flyer', how: 'Tap to fly up. Slip through the gaps.', player: '🐤', item: '' },
};

const SPEED = { slow: 0.75, normal: 1, fast: 1.35 } as const;
export type GameSpeed = keyof typeof SPEED;

/** Seven block colours that read on both the light and the dark theme. */
const BLOCK_COLORS = ['#3BA7F0', '#F5C518', '#A066E8', '#F08A24', '#2E6FE0', '#2FBF5B', '#E8483F'];

/** Calls `step(dt)` every animation frame while `running`, with dt in seconds. */
function useFrames(step: (dt: number) => void, running: boolean) {
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (last) step(Math.min((t - last) / 1000, 0.1));
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step, running]);
}

type Input = 'left' | 'right' | 'up' | 'down' | 'tap';

/**
 * Turns swipes and taps on the board into game inputs, as touch-responder props to spread on the
 * board. `dragStep` (pixels) makes horizontal drags move in steps while the finger is down, for
 * the block game.
 */
function useControls(onInput: (i: Input, x?: number) => void, dragStep?: number) {
  const touch = useRef({ x: 0, y: 0, applied: 0, dragged: false });
  return {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, applied: 0, dragged: false };
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const t = touch.current;
      const dx = e.nativeEvent.pageX - t.x;
      const dy = e.nativeEvent.pageY - t.y;
      if (!dragStep || Math.abs(dy) > Math.abs(dx)) return;
      const steps = Math.trunc(dx / dragStep);
      while (t.applied !== steps) {
        const dir = steps > t.applied ? 1 : -1;
        t.applied += dir;
        t.dragged = true;
        onInput(dir > 0 ? 'right' : 'left');
      }
    },
    onResponderRelease: (e: GestureResponderEvent) => {
      const t = touch.current;
      const dx = e.nativeEvent.pageX - t.x;
      const dy = e.nativeEvent.pageY - t.y;
      // A tap reports where it landed on the board, for games that steer by side.
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return onInput('tap', e.nativeEvent.locationX);
      if (Math.abs(dy) > Math.abs(dx)) return onInput(dy > 0 ? 'down' : 'up');
      if (!t.dragged) onInput(dx > 0 ? 'right' : 'left');
    },
  };
}

/** Arrow keys and space on the web. */
function useKeys(onInput: (i: Input) => void, active: boolean) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    const map: Record<string, Input> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', ' ': 'tap' };
    const on = (e: KeyboardEvent) => {
      const i = map[e.key];
      if (!i) return;
      e.preventDefault();
      onInput(i);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onInput, active]);
}

interface GameProps {
  theme: Theme;
  speed: number;
  running: boolean;
  player: string;
  item: string;
  /** Room for the board. */
  width: number;
  height: number;
  onScore(score: number): void;
  onOver(score: number): void;
}

/* ----------------------------- Falling blocks ----------------------------- */

function BlocksGame({ theme, speed, running, width, height, onScore, onOver }: GameProps) {
  const [s, setS] = useState(() => G.newBlocks());
  const cell = Math.floor(Math.min(width / G.BLOCKS_W, (height - 8) / G.BLOCKS_H));
  const step = useCallback((dt: number) => setS((x) => G.blocksTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useEffect(() => onScore(s.score), [s.score, onScore]);
  useEffect(() => {
    if (s.cleared) haptics.medium();
  }, [s.cleared, s.lines]);
  useEffect(() => {
    if (s.over) onOver(s.score);
  }, [s.over, s.score, onOver]);
  const input = useCallback(
    (i: Input) => {
      if (!running) return;
      setS((x) => (i === 'left' ? G.blocksMove(x, -1) : i === 'right' ? G.blocksMove(x, 1) : i === 'down' ? G.blocksDrop(x) : G.blocksRotate(x)));
    },
    [running],
  );
  const pan = useControls(input, cell * 0.9);
  useKeys(input, running);

  // What's on screen: the board, the falling piece, and a faint guide where it will land.
  const grid = [...s.board];
  const ghost = G.ghostY(s);
  const paint = (y0: number, v: number) =>
    s.piece.shape.forEach((row, r) =>
      row.forEach((on, c) => {
        const y = y0 + r;
        if (on && y >= 0 && !grid[y * G.BLOCKS_W + s.piece.x + c]) grid[y * G.BLOCKS_W + s.piece.x + c] = v;
      }),
    );
  paint(ghost, -1);
  paint(s.piece.y, s.piece.color);

  return (
    <View style={{ alignItems: 'center', gap: space(2) }}>
      <View style={[styles.row, { gap: space(4) }]}>
        <Text style={[type.caption, { color: theme.muted }]}>Lines {s.lines}</Text>
        <Text style={[type.caption, { color: theme.muted }]}>Level {s.level}</Text>
        <View style={[styles.row, { gap: 2 }]}>
          <Text style={[type.caption, { color: theme.muted }]}>Next </Text>
          {G.SHAPES[s.next].map((row, r) => (
            <View key={r}>
              {row.map((v, c) => (
                <View key={c} style={{ width: 7, height: 7, margin: 0.5, backgroundColor: v ? BLOCK_COLORS[s.next] : 'transparent' }} />
              ))}
            </View>
          ))}
        </View>
      </View>
      <View
        {...pan}
        accessibilityLabel="Falling blocks board"
        style={[styles.board, { width: cell * G.BLOCKS_W + 4, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}
      >
        {Array.from({ length: G.BLOCKS_H }, (_, y) => (
          <View key={y} style={{ flexDirection: 'row' }}>
            {Array.from({ length: G.BLOCKS_W }, (_, x) => {
              const v = grid[y * G.BLOCKS_W + x];
              return (
                <View
                  key={x}
                  style={{
                    width: cell,
                    height: cell,
                    borderWidth: v ? 1 : 0,
                    borderColor: v > 0 ? 'rgba(0,0,0,0.35)' : theme.accent,
                    borderRadius: 2,
                    backgroundColor: v > 0 ? BLOCK_COLORS[v - 1] : 'transparent',
                    opacity: v < 0 ? 0.45 : 1,
                  }}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------- Lane runner ------------------------------ */

function RunnerGame({ theme, speed, running, player, item, width, height, onScore, onOver }: GameProps) {
  const [s, setS] = useState(G.newRunner);
  const w = Math.min(width, 420);
  const h = Math.min(height, w * 1.7);
  const laneW = w / G.LANES;
  const size = Math.min(laneW * 0.6, 48);
  const step = useCallback((dt: number) => setS((x) => G.runnerTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useEffect(() => onScore(s.score), [s.score, onScore]);
  useEffect(() => {
    if (s.over) onOver(s.score);
  }, [s.over, s.score, onOver]);
  const input = useCallback(
    (i: Input, x?: number) => {
      if (!running) return;
      if (i === 'left' || i === 'right') {
        haptics.tap();
        setS((st) => G.runnerMove(st, i === 'left' ? -1 : 1));
      } else if (i === 'tap' && x !== undefined) {
        haptics.tap();
        setS((st) => G.runnerMove(st, x < w / 2 ? -1 : 1));
      }
    },
    [running, w],
  );
  const pan = useControls(input);
  useKeys(input, running);

  return (
    <View
      {...pan}
      accessibilityLabel="Lane runner track"
      style={[styles.track, { width: w, height: h, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}
    >
      {[1, 2].map((k) => (
        <View key={k} style={[styles.laneLine, { left: laneW * k - 1, borderColor: theme.accent }]} />
      ))}
      {s.obstacles.map((o) => (
        <Text key={o.id} style={[styles.sprite, { fontSize: size, left: o.lane * laneW + (laneW - size * 1.2) / 2, top: o.y * h - size / 2 }]}>
          {item}
        </Text>
      ))}
      <Text style={[styles.sprite, { fontSize: size, left: s.lane * laneW + (laneW - size * 1.2) / 2, top: G.RUNNER_Y * h - size / 2 }]}>{player}</Text>
    </View>
  );
}

/* ---------------------------------- Snake --------------------------------- */

function SnakeGame({ theme, speed, running, item, width, height, onScore, onOver }: GameProps) {
  const [s, setS] = useState(() => G.newSnake());
  const cell = Math.floor(Math.min(width, height, 460) / G.SNAKE_N);
  const step = useCallback((dt: number) => setS((x) => G.snakeTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useEffect(() => onScore(s.score), [s.score, onScore]);
  useEffect(() => {
    if (s.score) haptics.light();
  }, [s.score]);
  useEffect(() => {
    if (s.over) onOver(s.score);
  }, [s.over, s.score, onOver]);
  const input = useCallback(
    (i: Input) => {
      if (!running || i === 'tap') return;
      setS((x) => G.snakeTurn(x, i));
    },
    [running],
  );
  const pan = useControls(input);
  useKeys(input, running);
  const size = cell * G.SNAKE_N;

  return (
    <View
      {...pan}
      accessibilityLabel="Snake board"
      style={[styles.board, { width: size + 4, height: size + 4, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}
    >
      <Text style={[styles.sprite, { fontSize: cell * 0.85, left: s.food[0] * cell, top: s.food[1] * cell - cell * 0.1, width: cell, textAlign: 'center' }]}>
        {item}
      </Text>
      {s.body.map(([x, y], k) => (
        <View
          key={k}
          style={{
            position: 'absolute',
            left: x * cell + 1,
            top: y * cell + 1,
            width: cell - 2,
            height: cell - 2,
            borderRadius: k === 0 ? cell / 3 : 3,
            backgroundColor: theme.accent,
            borderWidth: 1,
            borderColor: theme.border,
            opacity: k === 0 ? 1 : 0.85,
          }}
        />
      ))}
    </View>
  );
}

/* ---------------------------------- Flyer --------------------------------- */

function FlyerGame({ theme, speed, running, player, width, height, onScore, onOver }: GameProps) {
  const [s, setS] = useState(G.newFlyer);
  const w = Math.min(width, 440);
  const h = Math.min(height, w * 1.5);
  const step = useCallback((dt: number) => setS((x) => G.flyerTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useEffect(() => onScore(s.score), [s.score, onScore]);
  useEffect(() => {
    if (s.over) onOver(s.score);
  }, [s.over, s.score, onOver]);
  const input = useCallback(
    (i: Input) => {
      if (!running) return;
      if (i === 'tap' || i === 'up') {
        haptics.tap();
        setS(G.flyerFlap);
      }
    },
    [running],
  );
  const pan = useControls(input);
  useKeys(input, running);
  const size = Math.max(24, G.FLYER_R * 2.6 * h);

  return (
    <View
      {...pan}
      accessibilityLabel="Flyer sky"
      style={[styles.track, { width: w, height: h, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}
    >
      {s.walls.map((wall) => {
        const top = (wall.gapY - wall.gapH / 2) * h;
        const bottom = (wall.gapY + wall.gapH / 2) * h;
        const common = { position: 'absolute' as const, left: wall.x * w, width: G.WALL_W * w, backgroundColor: theme.accent, borderColor: theme.border, borderWidth: stroke };
        return (
          <View key={wall.id}>
            <View style={[common, { top: -stroke, height: top + stroke, borderBottomLeftRadius: 6, borderBottomRightRadius: 6 }]} />
            <View style={[common, { top: bottom, height: h - bottom + stroke, borderTopLeftRadius: 6, borderTopRightRadius: 6 }]} />
          </View>
        );
      })}
      <Text style={[styles.sprite, { fontSize: size * 0.8, left: G.FLYER_X * w - size / 2, top: s.y * h - size / 2, transform: [{ scaleX: -1 }, { rotate: `${-Math.max(-25, Math.min(60, s.vy * 60))}deg` }] }]}>
        {player}
      </Text>
      {!s.started && running && (
        <Text style={[type.label, styles.hint, { color: theme.muted, top: h * 0.6 }]}>Tap to fly</Text>
      )}
    </View>
  );
}

const GAMES: Record<GameKind, (p: GameProps) => ReactNode> = { blocks: BlocksGame, runner: RunnerGame, snake: SnakeGame, flyer: FlyerGame };

/* --------------------------------- Player --------------------------------- */

export function GamePlayer({
  visible,
  onClose,
  kind,
  title,
  speed = 'normal',
  player,
  item,
  theme,
  topScores,
  best,
  onFinish,
}: {
  visible: boolean;
  onClose(): void;
  kind: GameKind;
  title: string;
  speed?: GameSpeed;
  player?: string;
  item?: string;
  theme: Theme;
  /** Best scores so far, highest first (shown on the game-over card). */
  topScores: number[];
  best: number | null;
  /** Called once per finished run, with its score. */
  onFinish(score: number): Promise<void> | void;
}) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'paused' | 'over'>('ready');
  const [score, setScore] = useState(0);
  const [final, setFinal] = useState<{ score: number; newBest: boolean } | null>(null);
  const [area, setArea] = useState({ width: Math.min(winW - space(8), 460), height: 520 });
  const info = GAME_INFO[kind];

  // Pause when the app goes to the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') setPhase((p) => (p === 'playing' ? 'paused' : p));
    });
    return () => sub.remove();
  }, []);

  // Saving a score changes `best`, which re-runs the game's "over" effect; finish each run once.
  const finished = useRef(false);
  const onOver = useCallback(
    (s: number) => {
      if (finished.current) return;
      finished.current = true;
      haptics.error();
      setPhase('over');
      setFinal({ score: s, newBest: s > 0 && (best === null || s > best) });
      void onFinish(s);
    },
    [best, onFinish],
  );

  const again = () => {
    finished.current = false;
    setRound((r) => r + 1);
    setScore(0);
    setFinal(null);
    setPhase('ready');
  };
  const close = () => {
    onClose();
    again();
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ width, height });
  };

  const Game = GAMES[kind];
  const shownBest = Math.max(best ?? 0, score);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="fullScreen">
      <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top + space(2), paddingBottom: insets.bottom + space(3) }]}>
        <View style={[styles.row, styles.header]}>
          <IconButton icon="close" label="Close game" theme={theme} onPress={close} />
          <Text style={[type.label, { color: theme.text, flex: 1 }]} numberOfLines={1}>
            {title}
          </Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[type.title, { color: theme.text }]} accessibilityLabel={`Score ${score}`}>
              {score}
            </Text>
            <Text style={[type.caption, { color: theme.muted }]}>Best {shownBest}</Text>
          </View>
        </View>

        <View style={styles.stage} onLayout={onLayout}>
          <Game
            key={round}
            theme={theme}
            speed={SPEED[speed] ?? 1}
            running={phase === 'playing'}
            player={player || info.player}
            item={item || info.item}
            width={area.width}
            height={area.height}
            onScore={setScore}
            onOver={onOver}
          />

          {(phase === 'ready' || phase === 'paused') && (
            <Pressable
              style={styles.overlay}
              onPress={() => {
                haptics.light();
                setPhase('playing');
              }}
              accessibilityRole="button"
              accessibilityLabel={phase === 'paused' ? 'Resume' : 'Start'}
            >
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: theme.shadowSm }]}>
                <Icon name={phase === 'paused' ? 'pause' : 'play'} size={28} color={theme.accent} />
                <Text style={[type.headline, { color: theme.text }]}>{phase === 'paused' ? 'Paused' : 'Tap to start'}</Text>
                <Text style={[type.caption, { color: theme.muted, textAlign: 'center' }]}>{info.how}</Text>
              </View>
            </Pressable>
          )}

          {phase === 'over' && final && (
            <View style={styles.overlay}>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: theme.shadowSm }]}>
                <Text style={[type.overline, { color: theme.accent }]}>{final.newBest ? 'NEW BEST!' : 'GAME OVER'}</Text>
                <Text style={[type.display, { color: theme.text }]}>{final.score}</Text>
                {topScores.length > 0 && (
                  <View style={{ alignSelf: 'stretch', gap: 2 }}>
                    <Text style={[type.caption, { color: theme.muted }]}>High scores</Text>
                    {topScores.slice(0, 5).map((v, k) => (
                      <View key={k} style={styles.row}>
                        <Text style={[type.body, { color: theme.muted, width: 24 }]}>{k + 1}.</Text>
                        <Text style={[type.body, { color: theme.text, fontWeight: v === final.score ? '700' : '400' }]}>{v}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <View style={{ gap: space(2), alignSelf: 'stretch' }}>
                  <Button label="Play again" icon="refresh" theme={theme} onPress={again} />
                  <Button label="Done" variant="secondary" theme={theme} onPress={close} />
                </View>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: space(4), gap: space(3) },
  header: { gap: space(3) },
  row: { flexDirection: 'row', alignItems: 'center' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  board: { borderWidth: stroke, borderRadius: radius.md, padding: 1, overflow: 'hidden' },
  track: { borderWidth: stroke, borderRadius: radius.lg, overflow: 'hidden' },
  laneLine: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 2, borderStyle: 'dashed', opacity: 0.5 },
  sprite: { position: 'absolute' },
  hint: { position: 'absolute', alignSelf: 'center' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: space(4) },
  card: { borderWidth: stroke, borderRadius: radius.lg, padding: space(5), gap: space(3), alignItems: 'center', width: '100%', maxWidth: 340 },
});
