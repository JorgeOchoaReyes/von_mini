/**
 * The full-screen arcade player behind a game block.
 *
 * Arcade conventions, kept minimal: SCORE / HI / LEVEL and lives at the top, a blinking
 * "TAP TO START", a 3-2-1 countdown, a level-up banner, a screen shake when you lose a life, and a
 * high-score table where a top-five run gets your three initials. Full screen means swipes and
 * drags steer the game instead of scrolling the page. The game pauses when the app goes to the
 * background (and on P or Esc on a keyboard).
 *
 * The rules live in `logic.ts`; each game here draws its state and plays what the rules report
 * happened (`fx`: particle bursts and floating score labels; `buzz`: a haptic).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  AppState,
  Easing,
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

export const GAME_INFO: Record<GameKind, { name: string; how: string; keys: string; player: string; item: string; icon: string }> = {
  blocks: {
    name: 'Falling blocks',
    how: 'Drag to slide, tap to turn, drag down to speed up, flick down to drop, flick up to hold. Fill rows to clear them.',
    keys: '← → move · ↑ or X turn · Z turn back · ↓ faster · Space drop · C hold · P pause',
    player: '',
    item: '',
    icon: '🧱',
  },
  runner: { name: 'Lane runner', how: 'Swipe or tap left and right to dodge. Grab the coins. It gets faster.', keys: '← → switch lanes · P pause', player: '🏃', item: '🚧', icon: '🏃' },
  snake: { name: 'Snake', how: 'Swipe to turn. Eat to grow, don’t bite yourself.', keys: 'Arrow keys turn · P pause', player: '', item: '🍎', icon: '🐍' },
  flyer: { name: 'Flyer', how: 'Tap to fly up. Slip through the gaps.', keys: 'Space or ↑ to fly · P pause', player: '🐤', item: '', icon: '🐤' },
  bricks: { name: 'Brick breaker', how: 'Drag the paddle to bounce the ball and break every brick. Breaks in a row score more.', keys: '← → move · P pause', player: '', item: '', icon: '🏓' },
  shooter: { name: 'Space shooter', how: 'Drag to move. Your ship fires by itself. Don’t let them past.', keys: '← → move · P pause', player: '🚀', item: '👾', icon: '🚀' },
  catch: { name: 'Catcher', how: 'Drag to catch the good ones, and the stars. Dodge the bombs, don’t drop any.', keys: '← → move · P pause', player: '🧺', item: '🍎', icon: '🧺' },
  whack: { name: 'Whack', how: 'Tap them as they pop up. Hits in a row score more. Leave the bombs alone.', keys: 'Tap or click · P pause', player: '', item: '🐹', icon: '🔨' },
};

const SPEED = { slow: 0.75, normal: 1, fast: 1.35 } as const;
export type GameSpeed = keyof typeof SPEED;

export interface HighScore {
  score: number;
  by?: string;
}

const INITIALS_KEY = 'vm:arcade:initials';
/** Keys the games use; while a run is on they never reach the page's buttons. */
const GAME_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'enter', 'p', 'escape', 'x', 'z', 'c', 'shift']);
const NATIVE = Platform.OS !== 'web';

/** Calls `step(dt)` every animation frame while `running`, with dt in seconds. */
function useFrames(step: (dt: number) => void, running: boolean) {
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (last) step(Math.min((t - last) / 1000, G.MAX_FRAME));
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
 *   - otherwise a release is a swipe (left/right/up/down) or a tap (with its x on the board).
 */
function useControls(onInput: (i: Input, n?: number) => void, opts: { drag?: boolean } = {}) {
  const touch = useRef({ x: 0, y: 0, lastX: 0, dragged: false });
  const { drag } = opts;
  return {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      const { pageX, pageY } = e.nativeEvent;
      touch.current = { x: pageX, y: pageY, lastX: pageX, dragged: false };
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const t = touch.current;
      if (!drag) return;
      const { pageX } = e.nativeEvent;
      onInput('drag', pageX - t.lastX);
      t.lastX = pageX;
      t.dragged = true;
    },
    onResponderRelease: (e: GestureResponderEvent) => {
      const t = touch.current;
      const dx = e.nativeEvent.pageX - t.x;
      const dy = e.nativeEvent.pageY - t.y;
      if (t.dragged && drag) return;
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
    // Capture phase: the player (below) stops game keys from reaching focused buttons.
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [onInput, active]);
}

export interface Status {
  score: number;
  lives?: number;
  level?: number;
  /** A score multiplier worth showing (streaks, combos). */
  mult?: number;
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
function useReport(s: { score: number; over: boolean; lives?: number; level?: number }, p: GameProps, mult?: number) {
  const { onStatus, onOver } = p;
  useEffect(() => onStatus({ score: s.score, lives: s.lives, level: s.level, mult }), [s.score, s.lives, s.level, mult, onStatus]);
  useEffect(() => {
    if (s.over) onOver(s.score);
  }, [s.over, s.score, onOver]);
}

const BUZZ: Record<Exclude<G.Buzz, null>, () => void> = {
  light: haptics.light,
  medium: haptics.medium,
  heavy: haptics.heavy,
  success: haptics.success,
  error: haptics.error,
};

/** Plays a state's haptic, once per state. */
function useBuzz(s: { buzz: G.Buzz }) {
  useEffect(() => {
    if (s.buzz) BUZZ[s.buzz]();
  }, [s]);
}

/** A board that keeps a portrait aspect ratio inside the room it's given. */
const fit = (width: number, height: number, aspect: number, maxW = 440) => {
  const w = Math.min(width, maxW, height / aspect);
  return { w, h: w * aspect };
};

/* ------------------------------ Effects layer ------------------------------ */

interface Spark {
  key: number;
  x: number;
  y: number;
  text?: string;
  color?: string;
  big?: boolean;
  /** Particle directions, as unit vectors with a speed. */
  dirs: [number, number][];
  t: Animated.Value;
}

const MAX_SPARKS = 24;
/** A repeatable 0..1 jitter, so particle spreads vary without randomness in render. */
const jitter = (n: number) => {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

/** Turns reported events into sparks: particle directions and an animation clock each. */
function toSparks(events: G.Fx[], firstKey: number): Spark[] {
  return events.map((e, k) => {
    const key = firstKey + k;
    const n = e.color ? (e.big ? 14 : 8) : 0;
    const dirs: [number, number][] = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + jitter(key * 31 + i) * 0.5;
      const v = (e.big ? 70 : 42) * (0.6 + jitter(key * 17 + i * 3) * 0.6);
      return [Math.cos(a) * v, Math.sin(a) * v];
    });
    return { key, ...e, dirs, t: new Animated.Value(0) };
  });
}

/**
 * Particle bursts, floating labels and a flash for big moments, over a board. Purely visual:
 * pointer events pass through, and everything animates on the native driver where there is one.
 */
const FxLayer = memo(function FxLayer({ events, width, height, theme }: { events: G.Fx[]; width: number; height: number; theme: Theme }) {
  const [sparks, setSparks] = useState<Spark[]>([]);
  const [seen, setSeen] = useState(events);
  const [nextKey, setNextKey] = useState(1);
  const [flash] = useState(() => new Animated.Value(0));
  // New events arrive as a new array: add their sparks while rendering (derived state), and
  // start their animations in the effect below.
  if (events !== seen) {
    setSeen(events);
    if (events !== G.NO_FX && events.length) {
      setSparks((cur) => [...cur, ...toSparks(events, nextKey)].slice(-MAX_SPARKS));
      setNextKey(nextKey + events.length);
    }
  }
  const started = useRef(new Set<number>());
  useEffect(() => {
    let big = false;
    for (const sp of sparks) {
      if (started.current.has(sp.key)) continue;
      started.current.add(sp.key);
      big ||= !!sp.big;
      Animated.timing(sp.t, { toValue: 1, duration: sp.text ? 900 : 600, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start(() => {
        started.current.delete(sp.key);
        setSparks((cur) => cur.filter((c) => c.key !== sp.key));
      });
    }
    if (big) {
      flash.setValue(0.35);
      Animated.timing(flash, { toValue: 0, duration: 260, useNativeDriver: NATIVE }).start();
    }
  }, [sparks, flash]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash }]} />
      {sparks.map((sp) => {
        const left = sp.x * width;
        const top = sp.y * height;
        const fade = sp.t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.9, 0] });
        return (
          <View key={sp.key} style={{ position: 'absolute', left, top }}>
            {sp.dirs.map(([dx, dy], i) => (
              <Animated.View
                key={i}
                style={{
                  position: 'absolute',
                  left: -3,
                  top: -3,
                  width: sp.big ? 7 : 6,
                  height: sp.big ? 7 : 6,
                  borderRadius: 2,
                  backgroundColor: sp.color,
                  opacity: fade,
                  transform: [
                    { translateX: sp.t.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
                    // A little gravity: out, then down.
                    { translateY: sp.t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, dy * 0.75, dy + 26] }) },
                    { scale: sp.t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) },
                  ],
                }}
              />
            ))}
            {sp.text ? (
              <Animated.Text
                style={[
                  type.label,
                  styles.popText,
                  {
                    color: sp.color ?? theme.text,
                    fontSize: sp.big ? 22 : 15,
                    opacity: fade,
                    transform: [{ translateY: sp.t.interpolate({ inputRange: [0, 1], outputRange: [-6, -46] }) }, { scale: sp.t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.15, 1] }) }],
                  },
                ]}
              >
                {sp.text}
              </Animated.Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
});

/** A small "×3" badge for a running multiplier. */
function MultBadge({ mult, theme }: { mult: number; theme: Theme }) {
  if (mult <= 1) return null;
  return (
    <View pointerEvents="none" style={[styles.badge, { backgroundColor: theme.accent, borderColor: theme.border }]}>
      <Text style={[type.label, { color: theme.onAccent }]}>×{mult}</Text>
    </View>
  );
}

/* ----------------------------- Falling blocks ----------------------------- */

/** A shape drawn small, for the hold and next boxes. */
function MiniShape({ id, size, dim }: { id: number | null; size: number; dim?: boolean }) {
  if (id === null) return <View style={{ width: size * 4, height: size * 2 }} />;
  const shape = G.trimShape(G.SHAPES[id]);
  return (
    <View style={{ width: size * 4, height: size * 2, alignItems: 'center', justifyContent: 'center', opacity: dim ? 0.35 : 1 }}>
      {shape.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((v, c) => (
            <View key={c} style={{ width: size, height: size, margin: 0.5, borderRadius: 1.5, backgroundColor: v ? G.BLOCK_COLORS[id] : 'transparent' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** The settled board: only rebuilt when the board itself changes, not on every frame. */
const BlocksBoard = memo(function BlocksBoard({ board, cell, theme }: { board: number[]; cell: number; theme: Theme }) {
  return (
    <>
      {Array.from({ length: G.BLOCKS_H }, (_, y) => (
        <View key={y} style={{ flexDirection: 'row' }}>
          {Array.from({ length: G.BLOCKS_W }, (_, x) => {
            const v = board[y * G.BLOCKS_W + x];
            return (
              <View
                key={x}
                style={{
                  width: cell,
                  height: cell,
                  borderWidth: v ? 1 : 0.5,
                  borderColor: v ? 'rgba(0,0,0,0.35)' : theme.border + '14',
                  borderRadius: 2,
                  backgroundColor: v ? G.BLOCK_COLORS[v - 1] : 'transparent',
                }}
              />
            );
          })}
        </View>
      ))}
    </>
  );
});

/** Rows that just cleared flash bright for a moment. */
function RowFlash({ rows, cell }: { rows: number[]; cell: number }) {
  const [shown, setShown] = useState<{ rows: number[]; t: Animated.Value } | null>(null);
  const [seen, setSeen] = useState(rows);
  if (rows !== seen) {
    setSeen(rows);
    if (rows.length) setShown({ rows, t: new Animated.Value(1) });
  }
  useEffect(() => {
    if (!shown) return;
    const { t } = shown;
    Animated.timing(t, { toValue: 0, duration: 320, useNativeDriver: NATIVE }).start(() => setShown((cur) => (cur?.t === t ? null : cur)));
  }, [shown]);
  if (!shown) return null;
  return (
    <>
      {shown.rows.map((y) => (
        <Animated.View key={y} pointerEvents="none" style={{ position: 'absolute', left: 1, right: 1, top: 1 + y * cell, height: cell, backgroundColor: '#fff', opacity: shown.t }} />
      ))}
    </>
  );
}

function BlocksGame(p: GameProps) {
  const { theme, speed, running, width, height } = p;
  const [s, setS] = useState(() => G.newBlocks());
  const cell = Math.max(8, Math.floor(Math.min((width - BOARD_EDGE) / G.BLOCKS_W, (height - 52) / G.BLOCKS_H)));
  const boardW = cell * G.BLOCKS_W;
  const boardH = cell * G.BLOCKS_H;
  const step = useCallback((dt: number) => setS((x) => G.blocksTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useReport(s, p, s.combo > 0 ? s.combo + 1 : undefined);
  useBuzz(s);

  type Act = 'left' | 'right' | 'cw' | 'ccw' | 'drop' | 'hold' | 'softOn' | 'softOff';
  const act = useCallback(
    (a: Act) => {
      // Letting go of soft drop always counts, even if play paused mid-drag.
      if (!running && a !== 'softOff') return;
      setS((x) => {
        switch (a) {
          case 'left':
            return G.blocksMove(x, -1);
          case 'right':
            return G.blocksMove(x, 1);
          case 'cw':
            return G.blocksRotate(x, 1);
          case 'ccw':
            return G.blocksRotate(x, -1);
          case 'drop':
            return G.blocksDrop(x);
          case 'hold':
            return G.blocksHold(x);
          case 'softOn':
            return G.blocksSoft(x, true);
          case 'softOff':
            return G.blocksSoft(x, false);
        }
      });
    },
    [running],
  );
  // Touch: drag sideways to slide (one column per cell dragged), drag down to soft-drop, flick
  // down to drop, flick up to hold, tap to turn.
  const touch = useRef({ x: 0, y: 0, t: 0, applied: 0, mode: null as null | 'h' | 'soft' });
  const controls = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now(), applied: 0, mode: null };
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const t = touch.current;
      const dx = e.nativeEvent.pageX - t.x;
      const dy = e.nativeEvent.pageY - t.y;
      const unit = Math.max(cell * 0.9, 14);
      if (!t.mode) {
        if (Math.abs(dx) > unit * 0.6 && Math.abs(dx) > Math.abs(dy)) t.mode = 'h';
        else if (dy > unit * 1.2 && dy > Math.abs(dx) * 1.3) {
          t.mode = 'soft';
          act('softOn');
        }
      }
      if (t.mode === 'h') {
        const steps = Math.trunc(dx / unit);
        while (t.applied !== steps) {
          const dir = steps > t.applied ? 1 : -1;
          t.applied += dir;
          act(dir > 0 ? 'right' : 'left');
        }
      }
    },
    onResponderRelease: (e: GestureResponderEvent) => {
      const t = touch.current;
      const dx = e.nativeEvent.pageX - t.x;
      const dy = e.nativeEvent.pageY - t.y;
      const quick = Date.now() - t.t < 240;
      if (t.mode === 'soft') {
        act('softOff');
        if (quick && dy > cell * 3) act('drop');
        return;
      }
      if (t.mode === 'h') return;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return act('cw');
      if (Math.abs(dy) > Math.abs(dx)) return act(dy > 0 ? 'drop' : 'hold');
      act(dx > 0 ? 'right' : 'left');
    },
  };

  // Keyboard on the web: the down key soft-drops while held.
  useEffect(() => {
    if (Platform.OS !== 'web' || !running) return;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const map: Record<string, Act> = { arrowleft: 'left', arrowright: 'right', arrowup: 'cw', x: 'cw', z: 'ccw', ' ': 'drop', c: 'hold', shift: 'hold' };
      if (k === 'arrowdown') {
        e.preventDefault();
        if (!e.repeat) act('softOn');
        return;
      }
      const a = map[k];
      if (!a) return;
      e.preventDefault();
      if (e.repeat && (a === 'drop' || a === 'hold' || a === 'cw' || a === 'ccw')) return;
      act(a);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') act('softOff');
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [act, running]);

  const { piece } = s;
  const ghost = G.ghostY(s);
  const pieceCells: [number, number][] = [];
  piece.shape.forEach((row, r) => row.forEach((v, c) => v && pieceCells.push([piece.x + c, r])));
  const color = G.BLOCK_COLORS[piece.color - 1];
  const mini = Math.max(6, Math.min(11, Math.floor(cell * 0.42)));

  return (
    <View style={{ alignItems: 'center', gap: space(2) }}>
      <View style={[styles.row, { width: boardW + BOARD_EDGE, justifyContent: 'space-between' }]}>
        <View style={{ alignItems: 'center' }}>
          <Text style={[type.caption, { color: theme.muted }]}>HOLD</Text>
          <MiniShape id={s.hold} size={mini} dim={!s.canHold} />
        </View>
        <Text style={[type.caption, { color: theme.muted }]}>LINES {s.lines}</Text>
        <View style={{ alignItems: 'center' }}>
          <Text style={[type.caption, { color: theme.muted }]}>NEXT</Text>
          <View style={[styles.row, { gap: 2 }]}>
            {s.queue.map((id, i) => (
              <MiniShape key={i} id={id} size={i === 0 ? mini : Math.max(5, mini - 3)} />
            ))}
          </View>
        </View>
      </View>
      <View {...controls} accessibilityLabel="Falling blocks board" style={[styles.board, { width: boardW + BOARD_EDGE, height: boardH + BOARD_EDGE, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
        <BlocksBoard board={s.board} cell={cell} theme={theme} />
        {/* The landing guide, then the falling piece, drawn over the settled board. */}
        {ghost !== piece.y &&
          pieceCells.map(([x, r], i) => {
            const y = ghost + r;
            return y >= 0 ? (
              <View key={`g${i}`} pointerEvents="none" style={[styles.cellAbs, { left: 1 + x * cell, top: 1 + y * cell, width: cell, height: cell, borderColor: color, borderWidth: 2, opacity: 0.5 }]} />
            ) : null;
          })}
        {pieceCells.map(([x, r], i) => {
          const y = piece.y + r;
          return y >= 0 ? (
            <View
              key={`p${i}`}
              pointerEvents="none"
              style={[styles.cellAbs, { left: 1 + x * cell, top: 1 + y * cell, width: cell, height: cell, backgroundColor: color, borderColor: 'rgba(0,0,0,0.35)', borderWidth: 1 }]}
            />
          ) : null;
        })}
        <RowFlash rows={s.clearedRows} cell={cell} />
        <FxLayer events={s.fx} width={boardW} height={boardH} theme={theme} />
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
  useBuzz(s);
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
  // Lane markings scroll with the distance run, so the track feels like it's moving.
  const dash = 0.14;
  const offset = (s.distance % dash) / dash;

  return (
    <View {...controls} accessibilityLabel="Lane runner track" style={[styles.track, { width: w, height: h, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
      {[1, 2].map((k) =>
        Array.from({ length: Math.ceil(1 / dash) + 1 }, (_, j) => (
          <View
            key={`${k}-${j}`}
            pointerEvents="none"
            style={{ position: 'absolute', left: laneW * k - 1.5, top: (j - 1 + offset) * dash * h, width: 3, height: dash * h * 0.5, borderRadius: 2, backgroundColor: theme.accent, opacity: 0.45 }}
          />
        )),
      )}
      {s.coins.map((c) => (
        <Text key={c.id} pointerEvents="none" style={[styles.sprite, { fontSize: size * 0.6, left: c.lane * laneW + (laneW - size * 0.72) / 2, top: c.y * h - size * 0.3 }]}>
          🪙
        </Text>
      ))}
      {s.obstacles.map((o) => (
        <Text key={o.id} pointerEvents="none" style={[styles.sprite, { fontSize: size, left: o.lane * laneW + (laneW - size * 1.2) / 2, top: o.y * h - size / 2 }]}>
          {item}
        </Text>
      ))}
      <Text pointerEvents="none" style={[styles.sprite, { fontSize: size, left: s.x * laneW + (laneW - size * 1.2) / 2, top: G.RUNNER_Y * h - size / 2 }]}>
        {player}
      </Text>
      <FxLayer events={s.fx} width={w} height={h} theme={theme} />
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
  useBuzz(s);
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
  // Draw each segment part-way between its last cell and its next, so the snake glides.
  const t = G.snakeProgress(s, speed);
  const eye = Math.max(2, cell * 0.14);
  const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[s.dir];

  return (
    <View {...controls} accessibilityLabel="Snake board" style={[styles.board, { width: size + BOARD_EDGE, height: size + BOARD_EDGE, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
      {s.food && (
        <Text pointerEvents="none" style={[styles.sprite, { fontSize: cell * 0.85, left: s.food[0] * cell, top: s.food[1] * cell - cell * 0.1, width: cell, textAlign: 'center' }]}>
          {item}
        </Text>
      )}
      {s.body.map(([x, y], k) => {
        const [px, py] = s.prev[k] ?? [x, y];
        const fx = px + (x - px) * t;
        const fy = py + (y - py) * t;
        const head = k === 0;
        return (
          <View
            key={k}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: fx * cell + 1,
              top: fy * cell + 1,
              width: cell - 2,
              height: cell - 2,
              borderRadius: head ? cell / 2.6 : cell / 4,
              backgroundColor: theme.accent,
              borderWidth: 1,
              borderColor: theme.border,
              opacity: head ? 1 : Math.max(0.55, 0.95 - k * 0.012),
            }}
          >
            {head && (
              <View style={StyleSheet.absoluteFill}>
                {[-1, 1].map((side) => (
                  <View
                    key={side}
                    style={{
                      position: 'absolute',
                      width: eye,
                      height: eye,
                      borderRadius: eye,
                      backgroundColor: theme.border,
                      left: (cell - 2) / 2 - eye / 2 + dx * cell * 0.18 + (dy !== 0 ? side * cell * 0.18 : 0),
                      top: (cell - 2) / 2 - eye / 2 + dy * cell * 0.18 + (dx !== 0 ? side * cell * 0.18 : 0),
                    }}
                  />
                ))}
              </View>
            )}
          </View>
        );
      })}
      <FxLayer events={s.fx} width={size} height={size} theme={theme} />
      {s.won && (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={[type.display, styles.banner, { color: theme.accent }]}>FULL BOARD!</Text>
        </View>
      )}
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
  useBuzz(s);
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
      <FxLayer events={s.fx} width={w} height={h} theme={theme} />
      {!s.started && running && <Text style={[type.label, styles.hint, { color: theme.muted, top: h * 0.6 }]}>TAP TO FLY</Text>}
    </View>
  );
}

/* ------------------------------ Brick breaker ----------------------------- */

function BricksGame(p: GameProps) {
  const { theme, speed, running, width, height } = p;
  const [s, setS] = useState(G.newBricks);
  const { w, h } = fit(width, height, G.BRICKS_ASPECT);
  const step = useCallback((dt: number) => setS((x) => G.bricksTick(x, dt, speed)), [speed]);
  useFrames(step, running && !s.over);
  useReport(s, p, s.chain > 1 ? Math.min(s.chain, 8) : undefined);
  useBuzz(s);
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
              backgroundColor: G.BRICK_ROW_COLORS[Math.floor(i / G.BRICK_COLS) % G.BRICK_ROW_COLORS.length],
            }}
          />
        ) : null,
      )}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: (s.paddle - G.PADDLE_W / 2) * w,
          top: G.PADDLE_Y * h,
          width: G.PADDLE_W * w,
          height: Math.max(10, G.PADDLE_H * h),
          borderRadius: 6,
          backgroundColor: theme.accent,
          borderWidth: stroke,
          borderColor: theme.border,
        }}
      />
      <View pointerEvents="none" style={{ position: 'absolute', left: s.ball.x * w - r, top: s.ball.y * h - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: theme.text }} />
      <FxLayer events={s.fx} width={w} height={h} theme={theme} />
      {s.stuck && running && <Text style={[type.label, styles.hint, { color: theme.muted, top: h * 0.6 }]}>GET READY</Text>}
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
  useBuzz(s);
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
  // A slow starfield, for a sense of motion.
  const stars = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ x: (i * 0.618) % 1, y: (i * 0.377) % 1, r: 1 + (i % 3) })), []);
  const scroll = (s.elapsed * 0.06) % 1;

  return (
    <View {...controls} accessibilityLabel="Space shooter" style={[styles.track, { width: w, height: h, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
      {stars.map((st, i) => (
        <View key={i} pointerEvents="none" style={{ position: 'absolute', left: st.x * w, top: ((st.y + scroll * (0.5 + st.r * 0.3)) % 1) * h, width: st.r, height: st.r, borderRadius: st.r, backgroundColor: theme.muted, opacity: 0.5 }} />
      ))}
      {s.shots.map((b) => (
        <View key={b.id} pointerEvents="none" style={{ position: 'absolute', left: b.x * w - 2, top: b.y * h - 7, width: 4, height: 14, borderRadius: 2, backgroundColor: theme.accent }} />
      ))}
      {s.enemies.map((e) => (
        <Text
          key={e.id}
          pointerEvents="none"
          style={[styles.sprite, { fontSize: e.tough ? size * 1.3 : size, left: e.x * w - size * (e.tough ? 0.78 : 0.6), top: e.y * h - size * (e.tough ? 0.78 : 0.6), opacity: e.tough && e.hp < 2 ? 0.7 : 1 }]}
        >
          {item}
        </Text>
      ))}
      <Text
        pointerEvents="none"
        style={[styles.sprite, { fontSize: size * 1.1, left: s.ship * w - size * 0.66, top: G.SHIP_Y * h - size * 0.66, opacity: s.grace > 0 ? 0.4 : 1, transform: [{ rotate: player === '🚀' ? '-45deg' : '0deg' }] }]}
      >
        {player}
      </Text>
      <FxLayer events={s.fx} width={w} height={h} theme={theme} />
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
  const mult = G.catchMultiplier(s.streak);
  useReport(s, p, mult > 1 ? mult : undefined);
  useBuzz(s);
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
        <Text key={it.id} pointerEvents="none" style={[styles.sprite, { fontSize: it.kind === 'gold' ? size * 1.15 : size, left: it.x * w - size * 0.6, top: it.y * h - size * 0.6 }]}>
          {it.kind === 'bad' ? '💣' : it.kind === 'gold' ? '⭐' : item}
        </Text>
      ))}
      <Text pointerEvents="none" style={[styles.sprite, { fontSize: size * 1.3, left: s.basket * w - size * 0.78, top: G.BASKET_Y * h - size * 0.7 }]}>
        {player}
      </Text>
      <MultBadge mult={mult} theme={theme} />
      <FxLayer events={s.fx} width={w} height={h} theme={theme} />
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
  const mult = G.whackMultiplier(s.streak);
  useReport(s, p, mult > 1 ? mult : undefined);
  useBuzz(s);

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
      <MultBadge mult={mult} theme={theme} />
      <FxLayer events={s.fx} width={side} height={side} theme={theme} />
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
        Animated.timing(opacity, { toValue: 0.15, duration: 450, useNativeDriver: NATIVE }),
        Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: NATIVE }),
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
  /** When the last run ended, so keys still held from play don't skip the score card. */
  const overAt = useRef(0);

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

  const start = useCallback(() => {
    haptics.light();
    // Resuming counts down too, so play never restarts under a finger that's still lifting.
    setCount(3);
    setPhase('countdown');
  }, []);

  // Keyboard on the web: P or Esc pauses; Enter or Space starts or resumes. While a run is on (or
  // about to be), game keys stop here, in the capture phase after the game's own listeners, so a
  // focused button (the modal focuses Close when it opens) can't be pressed by them.
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const on = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (phase === 'over') {
        // A drop key still held as the run ends shouldn't skip the score card.
        if (Date.now() - overAt.current < 900 && GAME_KEYS.has(k)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if ((k === 'p' || k === 'escape') && phase === 'playing') setPhase('paused');
      else if ((k === 'enter' || k === ' ' || k === 'p') && (phase === 'ready' || phase === 'paused')) start();
      if (GAME_KEYS.has(k)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (phase !== 'over' && GAME_KEYS.has(e.key.toLowerCase())) e.stopPropagation();
    };
    window.addEventListener('keydown', on, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', on, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [phase, visible, start]);

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
        Animated.sequence([10, -10, 7, -7, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 45, useNativeDriver: NATIVE }))).start();
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
      overAt.current = Date.now();
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
          {/* Out of keyboard focus during a run, so Enter and Space reach the game, not Close. */}
          <IconButton icon="close" label="Close game" theme={theme} onPress={close} focusable={phase === 'over'} />
          <Text style={[type.label, { color: theme.text, flex: 1, letterSpacing: 1 }]} numberOfLines={1}>
            {title.toUpperCase()}
          </Text>
          {phase === 'playing' && <IconButton icon="pause" label="Pause" theme={theme} onPress={() => setPhase('paused')} focusable={false} />}
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
        {status.level ? (
          <Text style={[hud, { textAlign: 'center' }]}>
            LEVEL {status.level}
            {status.mult && status.mult > 1 ? <Text style={{ color: theme.accent }}>{`   ×${status.mult}`}</Text> : null}
          </Text>
        ) : status.mult && status.mult > 1 ? (
          <Text style={[hud, { textAlign: 'center', color: theme.accent }]}>×{status.mult}</Text>
        ) : null}

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
            <Pressable style={styles.overlay} onPress={start} accessibilityRole="button" accessibilityLabel={phase === 'paused' ? 'Resume' : 'Start'}>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: theme.shadowSm }]}>
                <Text style={{ fontSize: 40 }}>{info.icon}</Text>
                <Blink style={[type.headline, { color: theme.accent, letterSpacing: 2 }]}>{phase === 'paused' ? 'PAUSED · TAP' : 'TAP TO START'}</Blink>
                <Text style={[type.caption, { color: theme.muted, textAlign: 'center' }]}>{info.how}</Text>
                {Platform.OS === 'web' && <Text style={[type.caption, { color: theme.subtle, textAlign: 'center' }]}>{info.keys}</Text>}
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
  cellAbs: { position: 'absolute', borderRadius: 2 },
  track: { borderWidth: stroke, borderRadius: radius.lg, overflow: 'hidden' },
  whack: { flexDirection: 'row', flexWrap: 'wrap' },
  hole: { flex: 1, borderRadius: 999, borderWidth: stroke, alignItems: 'center', justifyContent: 'center' },
  sprite: { position: 'absolute' },
  hint: { position: 'absolute', alignSelf: 'center', letterSpacing: 2 },
  banner: { textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.25)', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 0 },
  popText: { position: 'absolute', width: 220, left: -110, textAlign: 'center', fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 0 },
  badge: { position: 'absolute', top: 8, right: 8, borderWidth: stroke, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 2 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: space(4) },
  card: { borderWidth: stroke, borderRadius: radius.lg, padding: space(5), gap: space(3), alignItems: 'center', width: '100%', maxWidth: 340 },
  initials: { width: 140, textAlign: 'center', letterSpacing: 8, borderWidth: stroke, borderRadius: radius.md, paddingVertical: space(2) },
});
