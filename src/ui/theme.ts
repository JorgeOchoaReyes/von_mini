import { useColorScheme, type TextStyle } from 'react-native';

import type { Accent } from '../spec/types';

/**
 * Design tokens.
 *
 * One palette, one type scale, one spacing rhythm and one radius set, so every screen looks like
 * it came from the same product. Light and dark are both first-class; accents are per-app so a
 * mood journal and an expense log feel like different apps while staying in one system.
 */
const light = {
  bg: '#F7F6FB',
  bgAlt: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F1EFF7',
  text: '#141319',
  muted: '#615F76',
  subtle: '#9694A9',
  border: '#E6E4EE',
  borderStrong: '#D5D2E0',
  success: '#1B8A4B',
  warning: '#A96200',
  danger: '#C62828',
  onAccent: '#FFFFFF',
  shadow: '0px 1px 2px rgba(20, 16, 40, 0.05), 0px 8px 24px rgba(20, 16, 40, 0.07)',
  shadowSm: '0px 1px 2px rgba(20, 16, 40, 0.06)',
  glow: '0px 12px 40px rgba(107, 78, 255, 0.18)',
};
const dark: typeof light = {
  bg: '#0C0B11',
  bgAlt: '#131219',
  surface: '#16151E',
  surfaceAlt: '#201E29',
  text: '#F4F3F9',
  muted: '#A5A3B8',
  subtle: '#6F6D82',
  border: '#292735',
  borderStrong: '#3A3749',
  success: '#5BD08A',
  warning: '#FFB74D',
  danger: '#FF6B6B',
  onAccent: '#FFFFFF',
  shadow: '0px 1px 2px rgba(0, 0, 0, 0.5), 0px 8px 28px rgba(0, 0, 0, 0.45)',
  shadowSm: '0px 1px 2px rgba(0, 0, 0, 0.4)',
  glow: '0px 12px 40px rgba(160, 140, 255, 0.22)',
};

export const ACCENT_COLORS: Record<Accent, { light: string; dark: string }> = {
  violet: { light: '#6B4EFF', dark: '#A08CFF' },
  blue: { light: '#1F6FEB', dark: '#6EA8FF' },
  teal: { light: '#0E8A7E', dark: '#4FD1C2' },
  green: { light: '#2B8A3E', dark: '#69DB7C' },
  amber: { light: '#C76B00', dark: '#FFC069' },
  rose: { light: '#D6336C', dark: '#F783AC' },
};

/** A second hue per accent, for gradients that read as "designed" rather than flat. */
export const ACCENT_PARTNER: Record<Accent, { light: string; dark: string }> = {
  violet: { light: '#B14EFF', dark: '#C9A0FF' },
  blue: { light: '#3FA9F5', dark: '#9CCBFF' },
  teal: { light: '#2BC4A8', dark: '#8AE8D8' },
  green: { light: '#5BBF6A', dark: '#A6E8AF' },
  amber: { light: '#F0A32B', dark: '#FFD79A' },
  rose: { light: '#FF7AA8', dark: '#FFB3CC' },
};

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

export function useTheme(accent: Accent = 'violet'): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const base = scheme === 'dark' ? dark : light;
  const a = ACCENT_COLORS[accent][scheme];
  const b = ACCENT_PARTNER[accent][scheme];
  return {
    ...base,
    scheme,
    accent: a,
    accentAlt: b,
    accentSoft: alpha(a, scheme === 'dark' ? 0.2 : 0.1),
    // Kept deliberately tight: a wide two-hue gradient puts white button text on a pale stop.
    gradient: [a, mix(a, b, 0.35)] as const,
    onAccent: '#FFFFFF',
  };
}

export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };
export const space = (n: number) => n * 4;

/** Breakpoint above which the builder shows chat and preview side by side. */
export const WIDE = 900;

/** Type scale. Colors are applied by components. */
export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.9 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  headline: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  mono: { fontSize: 12, lineHeight: 17, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
} satisfies Record<string, TextStyle>;

export const MAX_WIDTH = 760;
/** Wider cap for the two-pane builder. */
export const MAX_WIDTH_WIDE = 1240;
