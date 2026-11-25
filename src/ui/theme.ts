import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { useColorScheme, type TextStyle } from 'react-native';

import type { Accent } from '../spec/types';

/* ------------------------------------------------------------------ *
 * Appearance: follow the system, or force light or dark. Saved on the device.
 * ------------------------------------------------------------------ */

export type SchemePref = 'system' | 'light' | 'dark';
const PREF_KEY = 'vm:scheme';
let schemePref: SchemePref = 'system';
const prefListeners = new Set<() => void>();

const subscribePref = (l: () => void) => {
  prefListeners.add(l);
  return () => {
    prefListeners.delete(l);
  };
};

/** The saved appearance choice; re-renders when it changes. */
export const useSchemePref = () => useSyncExternalStore(subscribePref, () => schemePref, () => schemePref);

export function setSchemePref(p: SchemePref) {
  schemePref = p;
  prefListeners.forEach((l) => l());
  void AsyncStorage.setItem(PREF_KEY, p).catch(() => undefined);
}

/** Reads the saved choice once at startup. */
export async function loadSchemePref() {
  try {
    const v = await AsyncStorage.getItem(PREF_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') {
      schemePref = v;
      prefListeners.forEach((l) => l());
    }
  } catch {
    // Unreadable preference: follow the system.
  }
}

/**
 * Design tokens: a comic-book look.
 *
 * Following comic / pop-art conventions: thick black ink outlines on everything, flat primary pop
 * fills (comic yellow, red, blue) on warm newsprint paper, hard offset "printed" shadows instead of
 * soft blur, Ben-Day halftone dots for shading (never behind text), and bold condensed lettering
 * (Bangers) for headlines, buttons and labels, with a clean sans for body text. No gradients.
 *
 * The app's own chrome is comic yellow with black lettering; each generated app keeps its own pop
 * accent. Dark mode is a "night" comic: deep blue panels so the black ink still reads.
 */
const INK = '#111111';
const light = {
  bg: '#FBF5E2', // newsprint
  bgAlt: '#FFFBEF',
  surface: '#FFFFFF',
  surfaceAlt: '#FFF3C4', // pale caption-box yellow, for inputs
  text: INK,
  muted: '#3F3A33',
  subtle: '#7D7468',
  border: INK,
  borderStrong: INK,
  success: '#1FA34A',
  warning: '#E07A00',
  danger: '#E8322C', // comic red
  onAccent: INK,
  shadow: `4px 4px 0px ${INK}`,
  shadowSm: `3px 3px 0px ${INK}`,
  glow: `6px 6px 0px ${INK}`,
};
const dark: typeof light = {
  bg: '#0E1430', // night sky
  bgAlt: '#141C3E',
  surface: '#1F2A5C', // night panels, a clear step above the page
  surfaceAlt: '#2A3770',
  text: '#FFF8E6',
  muted: '#D7D2C4',
  subtle: '#A3A6C2',
  border: '#000000',
  borderStrong: '#000000',
  success: '#4ADE80',
  warning: '#FFB84D',
  danger: '#FF4D45',
  onAccent: INK,
  shadow: '4px 4px 0px #000000',
  shadowSm: '3px 3px 0px #000000',
  glow: '6px 6px 0px #000000',
};

/** Outline width for panels, buttons and inputs: the comic "ink line". */
export const stroke = 3;

/**
 * Flat comic pop colours, per app. `amber` is the comic yellow used for von mini's own chrome.
 * Same pops in dark mode (comics don't dim their inks).
 */
export const ACCENT_COLORS: Record<Accent, { light: string; dark: string }> = {
  amber: { light: '#FFD21F', dark: '#FFD21F' },
  rose: { light: '#E8322C', dark: '#FF4D45' },
  blue: { light: '#2E6FD8', dark: '#4C8DFF' },
  green: { light: '#1FA34A', dark: '#3DD068' },
  violet: { light: '#7A3CF0', dark: '#A77BFF' },
  teal: { light: '#00A6A6', dark: '#2FD3CB' },
};

/** A second pop per accent, for halftone shading and highlights. */
export const ACCENT_PARTNER: Record<Accent, { light: string; dark: string }> = {
  amber: { light: '#E8322C', dark: '#FF4D45' },
  rose: { light: '#FFD21F', dark: '#FFD21F' },
  blue: { light: '#FFD21F', dark: '#FFD21F' },
  green: { light: '#FFD21F', dark: '#FFD21F' },
  violet: { light: '#FF3DB4', dark: '#FF7AD0' },
  teal: { light: '#FFD21F', dark: '#FFD21F' },
};
/** Ink or white, whichever reads better on a colour (yellow buttons get black text). */
function onColor(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? INK : '#FFFFFF';
}

/** Appends an alpha channel to a #RRGGBB color. */
export const alpha = (hex: string, a: number) =>
  `${hex}${Math.round(a * 255)
    .toString(16)
    .padStart(2, '0')}`;

/** Blends two #RRGGBB colors. `t` is how much of `b` to mix in. */
export const mix = (a: string, b: string, t: number) => {
  const part = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const channel = (i: number) => Math.round(part(a, i) * (1 - t) + part(b, i) * t);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`;
};

export type Theme = typeof light & {
  scheme: 'light' | 'dark';
  accent: string;
  /** Second accent hue, for gradients. */
  accentAlt: string;
  /** Tinted background for accent areas. */
  accentSoft: string;
  /** Two-stop gradient for hero surfaces and primary buttons. */
  gradient: readonly [string, string];
  onAccent: string;
};

/** von mini's own chrome is comic yellow; generated apps pass their own accent. */
export function useTheme(accent: Accent = 'amber'): Theme {
  const system = useColorScheme() === 'dark' ? 'dark' : 'light';
  const pref = useSchemePref();
  const scheme = pref === 'system' ? system : pref;
  const base = scheme === 'dark' ? dark : light;
  const a = ACCENT_COLORS[accent][scheme];
  const b = ACCENT_PARTNER[accent][scheme];
  return {
    ...base,
    scheme,
    accent: a,
    accentAlt: b,
    accentSoft: alpha(a, scheme === 'dark' ? 0.28 : 0.22),
    // Flat colour, like a printed panel. (Two equal stops keep the Gradient component working.)
    gradient: [a, a] as const,
    onAccent: onColor(a),
  };
}

/** Tighter corners: comic panels, not soft pills. */
export const radius = { xs: 4, sm: 8, md: 10, lg: 14, xl: 18, pill: 999 };

/** The comic display face, loaded in the root layout (falls back to the system font until then). */
export const DISPLAY_FONT = 'Bangers_400Regular';
export const space = (n: number) => n * 4;

/** Breakpoint above which the builder shows chat and preview side by side. */
export const WIDE = 900;

/** Type scale. Colors are applied by components. */
export const type = {
  display: { fontSize: 42, lineHeight: 46, fontFamily: DISPLAY_FONT, letterSpacing: 1 },
  title: { fontSize: 28, lineHeight: 32, fontFamily: DISPLAY_FONT, letterSpacing: 0.8 },
  headline: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** Comic lettering for section labels and badges. */
  overline: { fontSize: 15, lineHeight: 18, fontFamily: DISPLAY_FONT, letterSpacing: 1.2, textTransform: 'uppercase' },
  /** Comic lettering for buttons and tabs. */
  button: { fontSize: 19, lineHeight: 22, fontFamily: DISPLAY_FONT, letterSpacing: 1, textTransform: 'uppercase' },
  mono: { fontSize: 12, lineHeight: 17, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
} satisfies Record<string, TextStyle>;

export const MAX_WIDTH = 760;
/** Wider cap for the two-pane builder. */
export const MAX_WIDTH_WIDE = 1240;
