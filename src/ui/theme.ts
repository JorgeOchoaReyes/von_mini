import { useColorScheme, type TextStyle } from 'react-native';

import type { Accent } from '../spec/types';

const light = {
  bg: '#F6F5FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEDF5',
  text: '#15141A',
  muted: '#64627A',
  subtle: '#9A98AD',
  border: '#E3E1EC',
  success: '#1F8A4C',
  warning: '#B26A00',
  danger: '#C62828',
  shadow: '0px 1px 2px rgba(20, 16, 40, 0.06), 0px 4px 16px rgba(20, 16, 40, 0.06)',
};
const dark: typeof light = {
  bg: '#0D0C12',
  surface: '#17161F',
  surfaceAlt: '#211F2B',
  text: '#F3F2F8',
  muted: '#A3A1B8',
  subtle: '#6E6C82',
  border: '#2A2836',
  success: '#5BD08A',
  warning: '#FFB74D',
  danger: '#FF6B6B',
  shadow: '0px 1px 2px rgba(0, 0, 0, 0.4)',
};

export const ACCENT_COLORS: Record<Accent, { light: string; dark: string }> = {
  violet: { light: '#6B4EFF', dark: '#A08CFF' },
  blue: { light: '#1F6FEB', dark: '#6EA8FF' },
  teal: { light: '#0E8A7E', dark: '#4FD1C2' },
  green: { light: '#2B8A3E', dark: '#69DB7C' },
  amber: { light: '#C76B00', dark: '#FFC069' },
  rose: { light: '#D6336C', dark: '#F783AC' },
};

/** Appends an alpha channel to a #RRGGBB color. */
export const alpha = (hex: string, a: number) =>
  `${hex}${Math.round(a * 255)
    .toString(16)
    .padStart(2, '0')}`;

export type Theme = typeof light & {
  scheme: 'light' | 'dark';
  accent: string;
  /** Tinted background for accent areas. */
  accentSoft: string;
  onAccent: string;
};

export function useTheme(accent: Accent = 'violet'): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const base = scheme === 'dark' ? dark : light;
  const a = ACCENT_COLORS[accent][scheme];
  return { ...base, scheme, accent: a, accentSoft: alpha(a, scheme === 'dark' ? 0.18 : 0.1), onAccent: '#FFFFFF' };
}

export const radius = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 };
export const space = (n: number) => n * 4;

/** Type scale. Colors are applied by components. */
export const type = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.3 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
} satisfies Record<string, TextStyle>;

export const MAX_WIDTH = 720;
