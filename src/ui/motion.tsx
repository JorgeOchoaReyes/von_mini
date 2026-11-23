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
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export const motion = {
  fast: 160,
  base: 240,
  slow: 420,
  /** Standard ease-out curve used by modern design systems. */
  ease: Easing.bezier(0.2, 0.8, 0.2, 1),
} as const;

/** Reads the OS "reduce motion" preference without pulling in a dependency. */
function useReduceMotion(): boolean {
  return useMemo(() => {
    // react-native-web maps this to the CSS media query; native reports false.
    const reduce = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    );
    return !!reduce?.matches;
  }, []);
}

/** Fades and lifts its children in on mount. */
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
  const t = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) {
      t.setValue(1);
      return;
    }
    Animated.timing(t, { toValue: 1, duration: motion.base, delay, easing: motion.ease, useNativeDriver: true }).start();
  }, [t, delay, reduce]);
  return (
    <Animated.View
      style={[
        style,
        { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Grows a bar from 0 to `progress` (0–1). Used for model downloads and build progress. */
export function ProgressBar({ progress, color, track }: { progress: number; color: string; track: string }) {
  const reduce = useReduceMotion();
  const w = useRef(new Animated.Value(0)).current;
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
  const v = useRef(new Animated.Value(0.6)).current;
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
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, { opacity: v, transform: [{ scale: v }] }]}
    />
  );
}

/** A three-dot typing indicator, one `Animated.Value` per dot so no hook is called in a loop. */
export function TypingDots({ color }: { color: string }) {
  const reduce = useReduceMotion();
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;
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
  const v = useRef(new Animated.Value(0)).current;
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
      style={[styles.skeleton, { backgroundColor: color }, style, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) }]}
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
