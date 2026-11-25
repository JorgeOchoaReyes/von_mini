/**
 * The full-screen arcade player behind a game block.
 *
 * Arcade conventions, kept minimal: SCORE / HI / LEVEL and lives at the top, a blinking
 * "TAP TO START", a 3-2-1 countdown, a level-up banner, a screen shake when you lose a life, and a
 * high-score table where a top-five run gets your three initials. Full screen means swipes and
 * drags steer the game instead of scrolling the page. The game pauses when the app goes to the
 * background.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  AppState,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../ui/components';
import { haptics } from '../ui/haptics';
import { radius, space, stroke, type, type Theme } from '../ui/theme';
import * as G from './logic';

export type GameKind = 'blocks' | 'runner' | 'snake' | 'flyer' | 'bricks' | 'shooter' | 'catch' | 'whack';

export const GAME_KINDS: GameKind[] = ['blocks', 'runner', 'snake', 'flyer', 'bricks', 'shooter', 'catch', 'whack'];

export const GAME_INFO: Record<GameKind, { name: string; how: string; player: string; item: string; icon: string }> = {
  blocks: { name: 'Falling blocks', how: 'Swipe to move, tap to turn, swipe down to drop. Fill rows to clear them.', player: '', item: '', icon: '🧱' },
  runner: { name: 'Lane runner', how: 'Swipe or tap left and right to dodge. It gets faster.', player: '🏃', item: '🚧', icon: '🏃' },
  snake: { name: 'Snake', how: 'Swipe to turn. Eat to grow, don’t bite yourself.', player: '', item: '🍎', icon: '🐍' },
  flyer: { name: 'Flyer', how: 'Tap to fly up. Slip through the gaps.', player: '🐤', item: '', icon: '🐤' },
  bricks: { name: 'Brick breaker', how: 'Drag the paddle to bounce the ball and break every brick.', player: '', item: '', icon: '🏓' },
  shooter: { name: 'Space shooter', how: 'Drag to move. Your ship fires by itself. Don’t let them past.', player: '🚀', item: '👾', icon: '🚀' },
  catch: { name: 'Catcher', how: 'Drag to catch the good ones. Dodge the bombs, don’t drop any.', player: '🧺', item: '🍎', icon: '🧺' },
  whack: { name: 'Whack', how: 'Tap them as they pop up. Leave the bombs alone.', player: '', item: '🐹', icon: '🔨' },
};

const SPEED = { slow: 0.75, normal: 1, fast: 1.35 } as const;
export type GameSpeed = keyof typeof SPEED;

export interface HighScore {
  score: number;
  by?: string;
}

/** Seven block colours that read on both the light and the dark theme. */
const BLOCK_COLORS = ['#3BA7F0', '#F5C518', '#A066E8', '#F08A24', '#2E6FE0', '#2FBF5B', '#E8483F'];
const INITIALS_KEY = 'vm:arcade:initials';

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

type Input = 'left' | 'right' | 'up' | 'down' | 'tap' | 'drag';

/** What a bordered board adds around its cells: the border on both sides plus 1px padding. */
const BOARD_EDGE = 2 * stroke + 2;

/**
 * Swipes, drags and taps on the board, as touch-responder props to spread on it.
 *   - `drag`: reported continuously with the finger's movement in pixels (paddle games);
 *   - `dragStep`: instead turns horizontal drags into left/right steps (falling blocks);
 *   - otherwise a release is a swipe (left/right/up/down) or a tap (with its x on the board).
 */
function useControls(onInput: (i: Input, n?: number) => void, opts: { dragStep?: number; drag?: boolean } = {}) {
  const touch = useRef({ x: 0, y: 0, lastX: 0, applied: 0, dragged: false });
  const { dragStep, drag } = opts;
  return {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      const { pageX, pageY } = e.nativeEvent;
      touch.current = { x: pageX, y: pageY, lastX: pageX, applied: 0, dragged: false };
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const t = touch.current;
      const { pageX, pageY } = e.nativeEvent;
      if (drag) {
        onInput('drag', pageX - t.lastX);
        t.lastX = pageX;
        t.dragged = true;
        return;
      }
      const dx = pageX - t.x;
      const dy = pageY - t.y;
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
      if (t.dragged) return;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return onInput('tap', e.nativeEvent.locationX);
      if (Math.abs(dy) > Math.abs(dx)) return onInput(dy > 0 ? 'down' : 'up');
      onInput(dx > 0 ? 'right' : 'left');
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

export interface Status {
  score: number;
  lives?: number;
  level?: number;
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
  onStatus(s: Status): void;
  onOver(score: number): void;
}

/** Reports score/lives/level upward and the end of the game, once each changes. */
function useReport(s: { score: number; over: boolean; lives?: number; level?: number }, p: GameProps) {
  const { onStatus, onOver } = p;
  useEffect(() => onStatus({ score: s.score, lives: s.lives, level: s.level }), [s.score, s.lives, s.level, onStatus]);
  useEffect(() => {
    if (s.over) onOver(s.score);
  }, [s.over, s.score, onOver]);
}

/** A board that keeps a portrait aspect ratio inside the room it's given. */
const fit = (width: number, height: number, aspect: number, maxW = 440) => {
  const w = Math.min(width, maxW, height / aspect);
  return { w, h: w * aspect };
};

/* ----------------------------- Falling blocks ----------------------------- */

function BlocksGame(p: GameProps) {
  const { theme, speed, running, width, height } = p;
  const [s, setS] = useState(() => G.newBlocks());
  const cell = Math.floor(Math.min((width - BOARD_EDGE) / G.BLOCKS_W, (height - 36) / G.BLOCKS_H));
  const step = useCallback((dt: number) => setS((x) => G.blocksTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useReport(s, p);
  useEffect(() => {
    if (s.cleared) haptics.medium();
  }, [s.cleared, s.lines]);
  const input = useCallback(
    (i: Input) => {
      if (!running) return;
      setS((x) => (i === 'left' ? G.blocksMove(x, -1) : i === 'right' ? G.blocksMove(x, 1) : i === 'down' ? G.blocksDrop(x) : G.blocksRotate(x)));
    },
    [running],
  );
  const controls = useControls(input, { dragStep: Math.max(cell * 0.9, 14) });
  useKeys(input, running);

  // What's on screen: the board, the falling piece, and a faint guide where it will land. Only
  // rebuilt when the board or the piece changes, not on every frame the piece just hangs there.
  const { board, piece } = s;
  const cells = useMemo(() => {
    const grid = [...board];
    const paint = (y0: number, v: number) =>
      piece.shape.forEach((row, r) =>
        row.forEach((on, c) => {
          const y = y0 + r;
          if (on && y >= 0 && !grid[y * G.BLOCKS_W + piece.x + c]) grid[y * G.BLOCKS_W + piece.x + c] = v;
        }),
      );
    paint(G.ghostY({ ...s, board, piece }), -1);
    paint(piece.y, piece.color);
    return (
      <>
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
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- s only feeds the guide, which board and piece decide
  }, [board, piece, cell, theme.accent]);

  return (
    <View style={{ alignItems: 'center', gap: space(2) }}>
      <View style={[styles.row, { gap: space(4) }]}>
        <Text style={[type.caption, { color: theme.muted }]}>LINES {s.lines}</Text>
        <View style={[styles.row, { gap: 2 }]}>
          <Text style={[type.caption, { color: theme.muted }]}>NEXT </Text>
          {G.SHAPES[s.next].map((row, r) => (
            <View key={r}>
              {row.map((v, c) => (
                <View key={c} style={{ width: 7, height: 7, margin: 0.5, backgroundColor: v ? BLOCK_COLORS[s.next] : 'transparent' }} />
              ))}
            </View>
          ))}
        </View>
      </View>
      <View {...controls} accessibilityLabel="Falling blocks board" style={[styles.board, { width: cell * G.BLOCKS_W + BOARD_EDGE, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
        {cells}
      </View>
    </View>
  );
}

/* ------------------------------- Lane runner ------------------------------ */

function RunnerGame(p: GameProps) {
  const { theme, speed, running, player, item, width, height } = p;
  const [s, setS] = useState(G.newRunner);
  const { w, h } = fit(width, height, 1.7, 420);
  const laneW = w / G.LANES;
  const size = Math.min(laneW * 0.6, 48);
  const step = useCallback((dt: number) => setS((x) => G.runnerTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useReport(s, p);
  const input = useCallback(
    (i: Input, x?: number) => {
      if (!running) return;
      const dir = i === 'left' ? -1 : i === 'right' ? 1 : i === 'tap' && x !== undefined ? (x < w / 2 ? -1 : 1) : 0;
      if (!dir) return;
      haptics.tap();
      setS((st) => G.runnerMove(st, dir as -1 | 1));
    },
    [running, w],
  );
  const controls = useControls(input);
  useKeys(input, running);

  return (
    <View {...controls} accessibilityLabel="Lane runner track" style={[styles.track, { width: w, height: h, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
      {[1, 2].map((k) => (
        <View key={k} pointerEvents="none" style={[styles.laneLine, { left: laneW * k - 1, borderColor: theme.accent }]} />
      ))}
      {s.obstacles.map((o) => (
        <Text key={o.id} pointerEvents="none" style={[styles.sprite, { fontSize: size, left: o.lane * laneW + (laneW - size * 1.2) / 2, top: o.y * h - size / 2 }]}>
          {item}
        </Text>
      ))}
      <Text pointerEvents="none" style={[styles.sprite, { fontSize: size, left: s.lane * laneW + (laneW - size * 1.2) / 2, top: G.RUNNER_Y * h - size / 2 }]}>
        {player}
      </Text>
    </View>
  );
}

/* ---------------------------------- Snake --------------------------------- */

function SnakeGame(p: GameProps) {
  const { theme, speed, running, item, width, height } = p;
  const [s, setS] = useState(() => G.newSnake());
  const cell = Math.floor(Math.min(width, height, 460) / G.SNAKE_N);
  const step = useCallback((dt: number) => setS((x) => G.snakeTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useReport(s, p);
  useEffect(() => {
    if (s.score) haptics.light();
  }, [s.score]);
  const input = useCallback(
    (i: Input) => {
      if (!running || i === 'tap' || i === 'drag') return;
      setS((x) => G.snakeTurn(x, i));
    },
    [running],
  );
  const controls = useControls(input);
  useKeys(input, running);
  const size = cell * G.SNAKE_N;

  return (
    <View {...controls} accessibilityLabel="Snake board" style={[styles.board, { width: size + BOARD_EDGE, height: size + BOARD_EDGE, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
      <Text pointerEvents="none" style={[styles.sprite, { fontSize: cell * 0.85, left: s.food[0] * cell, top: s.food[1] * cell - cell * 0.1, width: cell, textAlign: 'center' }]}>
        {item}
      </Text>
      {s.body.map(([x, y], k) => (
        <View
          key={k}
          pointerEvents="none"
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

function FlyerGame(p: GameProps) {
  const { theme, speed, running, player, width, height } = p;
  const [s, setS] = useState(G.newFlyer);
  const { w, h } = fit(width, height, 1.5);
  const step = useCallback((dt: number) => setS((x) => G.flyerTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useReport(s, p);
  const input = useCallback(
    (i: Input) => {
      if (!running || (i !== 'tap' && i !== 'up')) return;
      haptics.tap();
      setS(G.flyerFlap);
    },
    [running],
  );
  const controls = useControls(input);
  useKeys(input, running);
  const size = Math.max(24, G.FLYER_R * 2.6 * h);

  return (
    <View {...controls} accessibilityLabel="Flyer sky" style={[styles.track, { width: w, height: h, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
      {s.walls.map((wall) => {
        const top = (wall.gapY - wall.gapH / 2) * h;
        const bottom = (wall.gapY + wall.gapH / 2) * h;
        const common = { position: 'absolute' as const, left: wall.x * w, width: G.WALL_W * w, backgroundColor: theme.accent, borderColor: theme.border, borderWidth: stroke };
        return (
          <View key={wall.id} pointerEvents="none">
            <View style={[common, { top: -stroke, height: top + stroke, borderBottomLeftRadius: 6, borderBottomRightRadius: 6 }]} />
            <View style={[common, { top: bottom, height: h - bottom + stroke, borderTopLeftRadius: 6, borderTopRightRadius: 6 }]} />
          </View>
        );
      })}
      {/* Most animal emoji face left; mirror so the flyer faces where it's going. */}
      <Text
        pointerEvents="none"
        style={[styles.sprite, { fontSize: size * 0.8, left: G.FLYER_X * w - size / 2, top: s.y * h - size / 2, transform: [{ scaleX: -1 }, { rotate: `${-Math.max(-25, Math.min(60, s.vy * 60))}deg` }] }]}
      >
        {player}
      </Text>
      {!s.started && running && <Text style={[type.label, styles.hint, { color: theme.muted, top: h * 0.6 }]}>TAP TO FLY</Text>}
    </View>
  );
}

/* ------------------------------ Brick breaker ----------------------------- */

const BRICK_ROW_COLORS = ['#E8483F', '#F08A24', '#F5C518', '#2FBF5B', '#3BA7F0'];

function BricksGame(p: GameProps) {
  const { theme, speed, running, width, height } = p;
  const [s, setS] = useState(G.newBricks);
  const { w, h } = fit(width, height, 1.45);
  const step = useCallback((dt: number) => setS((x) => G.bricksTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useReport(s, p);
  const bricksLeft = s.bricks.filter(Boolean).length;
  useEffect(() => {
    if (bricksLeft) haptics.tap();
  }, [bricksLeft]);
  const input = useCallback(
    (i: Input, n?: number) => {
      if (!running) return;
      if (i === 'drag' && n !== undefined) setS((x) => G.bricksMove(x, n / w));
      else if (i === 'left' || i === 'right') setS((x) => G.bricksMove(x, i === 'left' ? -0.08 : 0.08));
    },
    [running, w],
  );
  const controls = useControls(input, { drag: true });
  useKeys(input, running);
  const bw = w / G.BRICK_COLS;
  const bh = G.BRICK_H * h;
  const r = G.BALL_R * w;

  return (
    <View {...controls} accessibilityLabel="Brick breaker" style={[styles.track, { width: w, height: h, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
      {s.bricks.map((hp, i) =>
        hp ? (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: (i % G.BRICK_COLS) * bw + 1.5,
              top: (G.BRICK_TOP + Math.floor(i / G.BRICK_COLS) * G.BRICK_H) * h + 1.5,
              width: bw - 3,
              height: bh - 3,
              borderRadius: 3,
              borderWidth: hp > 1 ? 3 : 1,
              borderColor: theme.border,
              backgroundColor: BRICK_ROW_COLORS[Math.floor(i / G.BRICK_COLS) % BRICK_ROW_COLORS.length],
            }}
          />
        ) : null,
      )}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: (s.paddle - G.PADDLE_W / 2) * w, top: G.PADDLE_Y * h, width: G.PADDLE_W * w, height: 12, borderRadius: 6, backgroundColor: theme.accent, borderWidth: stroke, borderColor: theme.border }}
      />
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: s.ball.x * w - r, top: s.ball.y * h - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: theme.text }}
      />
    </View>
  );
}

/* ------------------------------ Space shooter ----------------------------- */

function ShooterGame(p: GameProps) {
  const { theme, speed, running, player, item, width, height } = p;
  const [s, setS] = useState(G.newShooter);
  const { w, h } = fit(width, height, 1.6);
  const step = useCallback((dt: number) => setS((x) => G.shooterTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useReport(s, p);
  useEffect(() => {
    if (s.kills) haptics.tap();
  }, [s.kills]);
  const input = useCallback(
    (i: Input, n?: number) => {
      if (!running) return;
      if (i === 'drag' && n !== undefined) setS((x) => G.shooterMove(x, n / w));
      else if (i === 'left' || i === 'right') setS((x) => G.shooterMove(x, i === 'left' ? -0.08 : 0.08));
    },
    [running, w],
  );
  const controls = useControls(input, { drag: true });
  useKeys(input, running);
  const size = Math.min(40, w * 0.09);

  return (
    <View {...controls} accessibilityLabel="Space shooter" style={[styles.track, { width: w, height: h, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
      {s.shots.map((b) => (
        <View key={b.id} pointerEvents="none" style={{ position: 'absolute', left: b.x * w - 2, top: b.y * h - 7, width: 4, height: 14, borderRadius: 2, backgroundColor: theme.accent }} />
      ))}
      {s.enemies.map((e) => (
        <Text key={e.id} pointerEvents="none" style={[styles.sprite, { fontSize: size, left: e.x * w - size * 0.6, top: e.y * h - size * 0.6 }]}>
          {item}
        </Text>
      ))}
      <Text
        pointerEvents="none"
        style={[styles.sprite, { fontSize: size * 1.1, left: s.ship * w - size * 0.66, top: G.SHIP_Y * h - size * 0.66, opacity: s.grace > 0 ? 0.4 : 1, transform: [{ rotate: player === '🚀' ? '-45deg' : '0deg' }] }]}
      >
        {player}
      </Text>
    </View>
  );
}

/* --------------------------------- Catcher -------------------------------- */

function CatchGame(p: GameProps) {
  const { theme, speed, running, player, item, width, height } = p;
  const [s, setS] = useState(G.newCatch);
  const { w, h } = fit(width, height, 1.55);
  const step = useCallback((dt: number) => setS((x) => G.catchTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useReport(s, p);
  useEffect(() => {
    if (s.event === 'catch') haptics.tap();
  }, [s.event, s.caught]);
  const input = useCallback(
    (i: Input, n?: number) => {
      if (!running) return;
      if (i === 'drag' && n !== undefined) setS((x) => G.catchMove(x, n / w));
      else if (i === 'left' || i === 'right') setS((x) => G.catchMove(x, i === 'left' ? -0.08 : 0.08));
    },
    [running, w],
  );
  const controls = useControls(input, { drag: true });
  useKeys(input, running);
  const size = Math.min(40, w * 0.09);

  return (
    <View {...controls} accessibilityLabel="Catcher" style={[styles.track, { width: w, height: h, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
      {s.items.map((it) => (
        <Text key={it.id} pointerEvents="none" style={[styles.sprite, { fontSize: size, left: it.x * w - size * 0.6, top: it.y * h - size * 0.6 }]}>
          {it.bad ? '💣' : item}
        </Text>
      ))}
      <Text pointerEvents="none" style={[styles.sprite, { fontSize: size * 1.3, left: s.basket * w - size * 0.78, top: G.BASKET_Y * h - size * 0.7 }]}>
        {player}
      </Text>
    </View>
  );
}

/* ---------------------------------- Whack --------------------------------- */

function WhackGame(p: GameProps) {
  const { theme, speed, running, item, width, height } = p;
  const [s, setS] = useState(G.newWhack);
  const side = Math.min(width, height, 420);
  const cell = side / 3;
  const step = useCallback((dt: number) => setS((x) => G.whackTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useReport(s, p);
  useEffect(() => {
    if (s.hits) haptics.light();
  }, [s.hits]);

  return (
    <View accessibilityLabel="Whack board" style={[styles.whack, { width: side, height: side }]}>
      {s.holes.map((hole, i) => (
        // Raw touches, not a Pressable: the board re-renders every frame, and a Pressable can lose a
        // press that spans a re-render. The hit lands the moment the finger goes down.
        <View
          key={i}
          {...(Platform.OS === 'web'
            ? { onStartShouldSetResponder: () => running, onResponderGrant: () => setS((x) => G.whackHit(x, i)) }
            : // On phones every finger counts (two thumbs on two holes): touches aren't one-at-a-time like a responder.
              { onTouchStart: () => running && setS((x) => G.whackHit(x, i)) })}
          accessibilityRole="button"
          accessibilityLabel={hole.kind === 'none' ? `Hole ${i + 1}, empty` : `Hole ${i + 1}, ${hole.kind === 'bad' ? 'bomb' : 'target'}`}
          style={{ width: cell, height: cell, padding: 6 }}
        >
          <View pointerEvents="none" style={[styles.hole, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
            {hole.kind !== 'none' && <Text style={{ fontSize: cell * 0.45 }}>{hole.kind === 'bad' ? '💣' : item}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

const GAMES: Record<GameKind, (p: GameProps) => ReactNode> = {
  blocks: BlocksGame,
  runner: RunnerGame,
  snake: SnakeGame,
  flyer: FlyerGame,
  bricks: BricksGame,
  shooter: ShooterGame,
  catch: CatchGame,
  whack: WhackGame,
};

/* --------------------------------- Player --------------------------------- */

type Phase = 'ready' | 'countdown' | 'playing' | 'paused' | 'over';

/** Text that blinks, like an attract screen. */
function Blink({ children, style }: { children: ReactNode; style: object }) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.15, duration: 450, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.Text style={[style, { opacity }]}>{children}</Animated.Text>;
}

/** Does `score` make the top five? */
const qualifies = (score: number, top: HighScore[]) => score > 0 && (top.length < 5 || score > top[Math.min(4, top.length - 1)].score);

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
  /** Best scores so far, highest first. */
  topScores: HighScore[];
  best: number | null;
  /** Called once per finished run, with its score and the player's initials if they entered any. */
  onFinish(score: number, by?: string): Promise<void> | void;
}) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [count, setCount] = useState(3);
  const [status, setStatus] = useState<Status>({ score: 0 });
  const [final, setFinal] = useState<{ score: number; newBest: boolean; ask: boolean } | null>(null);
  const [initials, setInitials] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [area, setArea] = useState({ width: Math.min(winW - space(8), 460), height: 520 });
  const [shake] = useState(() => new Animated.Value(0));
  const info = GAME_INFO[kind];

  // The last initials used, so a new high score is one tap to save.
  useEffect(() => {
    AsyncStorage.getItem(INITIALS_KEY)
      .then((v) => v && setInitials(v))
      .catch(() => undefined);
  }, []);

  // Pause when the app goes to the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') setPhase((p) => (p === 'playing' || p === 'countdown' ? 'paused' : p));
    });
    return () => sub.remove();
  }, []);

  // 3, 2, 1, GO.
  useEffect(() => {
    if (phase !== 'countdown') return;
    const t = setTimeout(() => {
      if (count > 1) {
        haptics.tap();
        setCount(count - 1);
      } else {
        haptics.medium();
        setPhase('playing');
      }
    }, 550);
    return () => clearTimeout(t);
  }, [phase, count]);

  // Level-up banner and the shake on a lost life, driven by what the game reports.
  const last = useRef<Status>({ score: 0 });
  const onStatus = useCallback(
    (s: Status) => {
      const prev = last.current;
      last.current = s;
      setStatus(s);
      if (s.level && prev.level && s.level > prev.level) {
        haptics.success();
        setBanner(`LEVEL ${s.level}!`);
      }
      if (s.lives !== undefined && prev.lives !== undefined && s.lives < prev.lives) {
        haptics.error();
        Animated.sequence(
          [10, -10, 7, -7, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 45, useNativeDriver: Platform.OS !== 'web' })),
        ).start();
      }
    },
    [shake],
  );
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1100);
    return () => clearTimeout(t);
  }, [banner]);

  // Saving a score changes `best`, which re-runs the game's "over" effect; finish each run once.
  const finished = useRef(false);
  const saved = useRef(false);
  const onOver = useCallback(
    (s: number) => {
      if (finished.current) return;
      finished.current = true;
      haptics.error();
      setPhase('over');
      const ask = qualifies(s, topScores);
      setFinal({ score: s, newBest: s > 0 && (best === null || s > best), ask });
      // A run that won't make the table is saved straight away; a top-five one waits for initials.
      if (!ask) {
        saved.current = true;
        void Promise.resolve(onFinish(s)).catch(() => undefined);
      }
    },
    [best, onFinish, topScores],
  );

  /** Saves the finished run once, with initials if it made the table. */
  const commit = () => {
    if (!final || saved.current) return;
    saved.current = true;
    const by = initials.trim().toUpperCase().slice(0, 3) || undefined;
    if (by) void AsyncStorage.setItem(INITIALS_KEY, by).catch(() => undefined);
    void Promise.resolve(onFinish(final.score, final.ask ? by : undefined)).catch(() => undefined);
    setFinal({ ...final, ask: false });
  };

  /** Back to the start screen for another run, saving the finished one first. */
  const reset = () => {
    commit();
    finished.current = false;
    saved.current = false;
    last.current = { score: 0 };
    setRound((r) => r + 1);
    setStatus({ score: 0 });
    setFinal(null);
    setBanner(null);
    setCount(3);
    setPhase('ready');
  };
  const close = () => {
    // An abandoned run (closed mid-game) was never finished, so nothing is saved for it.
    reset();
    onClose();
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ width, height });
  };

  const Game = GAMES[kind];
  const hi = Math.max(best ?? 0, status.score);
  const hud = [type.label, { color: theme.muted, letterSpacing: 1 }];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="fullScreen">
      <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top + space(2), paddingBottom: insets.bottom + space(3) }]}>
        <View style={[styles.row, { gap: space(3) }]}>
          <IconButton icon="close" label="Close game" theme={theme} onPress={close} />
          <Text style={[type.label, { color: theme.text, flex: 1, letterSpacing: 1 }]} numberOfLines={1}>
            {title.toUpperCase()}
          </Text>
          {phase === 'playing' && <IconButton icon="pause" label="Pause" theme={theme} onPress={() => setPhase('paused')} />}
        </View>
        {/* Arcade HUD */}
        <View style={styles.hud}>
          <View>
            <Text style={hud}>SCORE</Text>
            <Text style={[type.title, { color: theme.text }]} accessibilityLabel={`Score ${status.score}`}>
              {status.score}
            </Text>
          </View>
          {status.lives !== undefined && (
            <Text style={{ fontSize: 20, letterSpacing: 2 }} accessibilityLabel={`${status.lives} lives`}>
              {'❤️'.repeat(Math.max(0, status.lives))}
              <Text style={{ opacity: 0.3 }}>{'🤍'.repeat(Math.max(0, G.START_LIVES - status.lives))}</Text>
            </Text>
          )}
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={hud}>HI</Text>
            <Text style={[type.title, { color: theme.text }]}>{hi}</Text>
          </View>
        </View>
        {status.level ? <Text style={[hud, { textAlign: 'center' }]}>LEVEL {status.level}</Text> : null}

        <Animated.View style={[styles.stage, { transform: [{ translateX: shake }] }]} onLayout={onLayout}>
          <Game
            key={round}
            theme={theme}
            speed={SPEED[speed] ?? 1}
            running={phase === 'playing'}
            player={player || info.player}
            item={item || info.item}
            width={area.width}
            height={area.height}
            onStatus={onStatus}
            onOver={onOver}
          />

          {banner && (
            <View style={styles.overlay} pointerEvents="none">
              <Text style={[type.display, styles.banner, { color: theme.accent }]}>{banner}</Text>
            </View>
          )}

          {phase === 'countdown' && (
            <View style={styles.overlay} pointerEvents="none">
              <Text style={[type.display, styles.banner, { color: theme.text, fontSize: 72, lineHeight: 80 }]}>{count}</Text>
            </View>
          )}

          {(phase === 'ready' || phase === 'paused') && (
            <Pressable
              style={styles.overlay}
              onPress={() => {
                haptics.light();
                // Resuming counts down too, so play never restarts under a finger that's still lifting.
                setCount(3);
                setPhase('countdown');
              }}
              accessibilityRole="button"
              accessibilityLabel={phase === 'paused' ? 'Resume' : 'Start'}
            >
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: theme.shadowSm }]}>
                <Text style={{ fontSize: 40 }}>{info.icon}</Text>
                <Blink style={[type.headline, { color: theme.accent, letterSpacing: 2 }]}>{phase === 'paused' ? 'PAUSED · TAP' : 'TAP TO START'}</Blink>
                <Text style={[type.caption, { color: theme.muted, textAlign: 'center' }]}>{info.how}</Text>
                {best !== null && <Text style={[type.caption, { color: theme.subtle, letterSpacing: 1 }]}>HI SCORE {best}</Text>}
              </View>
            </Pressable>
          )}

          {phase === 'over' && final && (
            <View style={styles.overlay}>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: theme.shadowSm }]}>
                <Text style={[type.overline, { color: theme.accent, letterSpacing: 2 }]}>{final.newBest ? 'NEW HIGH SCORE!' : 'GAME OVER'}</Text>
                <Text style={[type.display, { color: theme.text }]}>{final.score}</Text>
                {final.ask ? (
                  <View style={{ alignSelf: 'stretch', gap: space(2), alignItems: 'center' }}>
                    <Text style={[type.caption, { color: theme.muted }]}>You made the top 5! Enter your initials</Text>
                    <TextInput
                      value={initials}
                      onChangeText={(v) => setInitials(v.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 3))}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={3}
                      placeholder="AAA"
                      placeholderTextColor={theme.subtle}
                      accessibilityLabel="Your initials"
                      onSubmitEditing={commit}
                      style={[type.title, styles.initials, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}
                    />
                    <Button label="Save score" icon="trophy-outline" theme={theme} onPress={commit} />
                  </View>
                ) : (
                  <View style={{ alignSelf: 'stretch', gap: 2 }}>
                    <Text style={[type.caption, { color: theme.muted, letterSpacing: 1 }]}>HIGH SCORES</Text>
                    {(topScores.length ? topScores : [{ score: final.score }]).slice(0, 5).map((v, k) => (
                      <View key={k} style={[styles.row, { gap: space(3) }]}>
                        <Text style={[type.body, { color: theme.muted, width: 36 }]}>{['1ST', '2ND', '3RD', '4TH', '5TH'][k]}</Text>
                        <Text style={[type.body, { color: theme.text, width: 48, letterSpacing: 2 }]}>{v.by ?? '---'}</Text>
                        <Text style={[type.body, { color: theme.text, fontWeight: v.score === final.score ? '700' : '400' }]}>{v.score}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <View style={{ gap: space(2), alignSelf: 'stretch' }}>
                  <Button label="Play again" icon="refresh" theme={theme} onPress={reset} />
                  <Button label="Done" variant="secondary" theme={theme} onPress={close} />
                </View>
              </View>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: space(4), gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'center' },
  hud: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space(1) },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  board: { borderWidth: stroke, borderRadius: radius.md, padding: 1, overflow: 'hidden' },
  track: { borderWidth: stroke, borderRadius: radius.lg, overflow: 'hidden' },
  whack: { flexDirection: 'row', flexWrap: 'wrap' },
  hole: { flex: 1, borderRadius: 999, borderWidth: stroke, alignItems: 'center', justifyContent: 'center' },
  laneLine: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 2, borderStyle: 'dashed', opacity: 0.5 },
  sprite: { position: 'absolute' },
  hint: { position: 'absolute', alignSelf: 'center', letterSpacing: 2 },
  banner: { textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.25)', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 0 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: space(4) },
  card: { borderWidth: stroke, borderRadius: radius.lg, padding: space(5), gap: space(3), alignItems: 'center', width: '100%', maxWidth: 340 },
  initials: { width: 140, textAlign: 'center', letterSpacing: 8, borderWidth: stroke, borderRadius: radius.md, paddingVertical: space(2) },
});
