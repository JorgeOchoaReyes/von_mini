/**
 * Shared motion primitives, built on React Native's own `Animated` API.
 *
 * Why not react-native-reanimated: it is a fine library, but on web it adds roughly 700 KB of
 * JavaScript to the initial bundle, and faster startup is an explicit goal for this project.
 * Every animation here is a simple opacity/transform/width tween, which `Animated` handles with
 * the native driver on Android and with a small JS loop on web. Measured bundle sizes are in
 * SUBMISSION.md.
 *
 * All animations respect the OS "reduce motion" setting: when it is on, values jump to their
 * final state instead of tweening.
 *
 * Animated values are held in state initialisers rather than refs: they are created once per
 * component and never need to be re-created, and this keeps them out of the "refs during render"
 * lint rule that React 19's compiler rules enforce.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export const motion = {
  fast: 160,
  base: 240,
  slow: 420,
  /** Standard ease-out curve used by modern design systems. */
  ease: Easing.bezier(0.2, 0.8, 0.2, 1),
  /** Snappy, slightly bouncy spring for things the user touches. */
  press: { stiffness: 520, damping: 26, mass: 0.7 },
  /** Softer spring for things that arrive on screen. */
  enter: { stiffness: 220, damping: 22, mass: 0.9 },
} as const;

/** A stable animated value, created once. */
const useValue = (initial: number) => useState(() => new Animated.Value(initial))[0];

/** Reads the OS "reduce motion" preference without pulling in a dependency. */
export function useReduceMotion(): boolean {
  return useMemo(() => {
    // react-native-web maps this to the CSS media query; native reports false.
    const reduce = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    );
    return !!reduce?.matches;
  }, []);
}

/**
 * Fades its children in while they spring up into place (with a hint of scale), so content
 * settles rather than slides. Pass increasing `delay`s for a staggered list.
 */
export function FadeUp({
  children,
  delay = 0,
  distance = 10,
  style,
}: {
  children: ReactNode;
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const fade = useValue(reduce ? 1 : 0);
  const rise = useValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      fade.setValue(1);
      rise.setValue(1);
      return;
    }
    const anim = Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: motion.base, delay, easing: motion.ease, useNativeDriver: true }),
      Animated.sequence([Animated.delay(delay), Animated.spring(rise, { toValue: 1, ...motion.enter, useNativeDriver: true })]),
    ]);
    anim.start();
    return () => anim.stop();
  }, [fade, rise, delay, reduce]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: fade,
          transform: [
            { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
            { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Spring press feedback. Spread `handlers` on a Pressable and put `style` on the Animated.View
 * inside it: the content dips when pressed and springs back with a little overshoot on release.
 */
export function usePressScale(to = 0.96) {
  const reduce = useReduceMotion();
  const v = useValue(1);
  const go = (toValue: number) =>
    reduce ? v.setValue(1) : Animated.spring(v, { toValue, ...motion.press, useNativeDriver: true }).start();
  return {
    style: { transform: [{ scale: v }] },
    handlers: { onPressIn: () => go(to), onPressOut: () => go(1) },
  };
}

/** Pops its children in from small, with a springy overshoot. Re-pops when `trigger` changes. */
export function PopIn({ children, trigger, delay = 0 }: { children: ReactNode; trigger?: unknown; delay?: number }) {
  const reduce = useReduceMotion();
  const v = useValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      v.setValue(1);
      return;
    }
    v.setValue(0);
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.spring(v, { toValue: 1, stiffness: 420, damping: 14, mass: 0.8, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [v, trigger, delay, reduce]);
  return (
    <Animated.View
      style={{
        opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/** A value that loops 0→1 forever (linear), for continuous ambient motion. */
function useLoop(duration: number, active = true, delay = 0) {
  const reduce = useReduceMotion();
  const v = useValue(0);
  useEffect(() => {
    if (reduce || !active) {
      v.setValue(0);
      return;
    }
    v.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration, active, delay, reduce]);
  return v;
}

/**
 * Concentric rings that expand and fade from behind a round control: the "I'm listening" signal.
 * Render it as a sibling *behind* the button, centred on it.
 */
export function Ripples({ size, color, active }: { size: number; color: string; active: boolean }) {
  const a = useLoop(1800, active, 0);
  const b = useLoop(1800, active, 600);
  const c = useLoop(1800, active, 1200);
  if (!active) return null;
  const ring = (v: Animated.Value) => ({
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
    opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.32, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
  });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <Animated.View style={ring(a)} />
      <Animated.View style={ring(b)} />
      <Animated.View style={ring(c)} />
    </View>
  );
}

/** A live-looking audio waveform: bars bouncing at different rates while the AI speaks. */
export function Waveform({ color, active, bars = 5, height = 22 }: { color: string; active: boolean; bars?: number; height?: number }) {
  const reduce = useReduceMotion();
  const [vals] = useState(() => Array.from({ length: bars }, () => new Animated.Value(0.3)));
  useEffect(() => {
    if (reduce || !active) {
      vals.forEach((v) => v.setValue(0.3));
      return;
    }
    const loops = vals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 260 + ((i * 97) % 180), easing: motion.ease, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25 + ((i * 37) % 30) / 100, duration: 300 + ((i * 71) % 200), easing: motion.ease, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [vals, active, reduce]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height }}>
      {vals.map((v, i) => (
        <Animated.View
          key={i}
          style={{ width: 4, height, borderRadius: 2, backgroundColor: color, transform: [{ scaleY: v }] }}
        />
      ))}
    </View>
  );
}

/** Slow breathing scale, for "thinking" states. Wraps its children. */
export function Breathe({ children, active, style }: { children: ReactNode; active: boolean; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useValue(0);
  useEffect(() => {
    if (reduce || !active) {
      Animated.spring(v, { toValue: 0, ...motion.press, useNativeDriver: true }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, active, reduce]);
  return (
    <Animated.View style={[style, { transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Very slow drifting motion for decorative shapes, so a screen feels alive without distracting. */
export function Drift({ children, style, range = 18, duration = 9000 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; range?: number; duration?: number }) {
  const v = useLoop(duration);
  const wave = v.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 1, 0, -1, 0] });
  const wave2 = v.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, 0, -1, 0, 1] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        style,
        {
          transform: [
            { translateX: Animated.multiply(wave, range) },
            { translateY: Animated.multiply(wave2, range * 0.6) },
            { scale: wave2.interpolate({ inputRange: [-1, 1], outputRange: [0.96, 1.04] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Grows a bar from 0 to `progress` (0–1). Used for model downloads and build progress. */
export function ProgressBar({ progress, color, track }: { progress: number; color: string; track: string }) {
  const reduce = useReduceMotion();
  const w = useValue(0);
  useEffect(() => {
    const to = Math.max(0, Math.min(1, progress));
    if (reduce) {
      w.setValue(to);
      return;
    }
    Animated.timing(w, { toValue: to, duration: motion.base, easing: motion.ease, useNativeDriver: false }).start();
  }, [progress, w, reduce]);
  return (
    <View style={[styles.track, { backgroundColor: track }]}>
      <Animated.View
        style={[
          styles.fill,
          {
            backgroundColor: color,
            width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          },
        ]}
      />
    </View>
  );
}

/** A soft pulsing dot, used while a model is thinking. */
export function Pulse({ color, size = 8 }: { color: string; size?: number }) {
  const reduce = useReduceMotion();
  const v = useValue(0.6);
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 620, easing: motion.ease, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.45, duration: 620, easing: motion.ease, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, reduce]);
  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        { opacity: v, transform: [{ scale: v }] },
      ]}
    />
  );
}

/** A three-dot typing indicator, one animated value per dot so no hook is called in a loop. */
export function TypingDots({ color }: { color: string }) {
  const reduce = useReduceMotion();
  const a = useValue(0);
  const b = useValue(0);
  const c = useValue(0);
  useEffect(() => {
    if (reduce) return;
    const step = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 340, easing: motion.ease, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 340, easing: motion.ease, useNativeDriver: true }),
          Animated.delay(700 - delay),
        ]),
      );
    const loops = [step(a, 0), step(b, 140), step(c, 280)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [a, b, c, reduce]);
  const style = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
  });
  return (
    <View style={styles.dots}>
      <Animated.View style={[styles.dot, { backgroundColor: color }, style(a)]} />
      <Animated.View style={[styles.dot, { backgroundColor: color }, style(b)]} />
      <Animated.View style={[styles.dot, { backgroundColor: color }, style(c)]} />
    </View>
  );
}

/** A slow shimmering sheen for skeleton placeholders. */
export function Shimmer({ color, style }: { color: string; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useValue(0);
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 900, easing: motion.ease, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 900, easing: motion.ease, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, reduce]);
  return (
    <Animated.View
      style={[
        styles.skeleton,
        { backgroundColor: color },
        style,
        { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 999, overflow: 'hidden', width: '100%' },
  fill: { height: '100%', borderRadius: 999 },
  dots: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  skeleton: { borderRadius: 8, height: 14 },
});
