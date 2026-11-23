import { useColorScheme } from 'react-native';

import type { Accent } from '../spec/types';

const light = {
  bg: '#F7F7FB',
  card: '#FFFFFF',
  text: '#16161D',
  muted: '#6B6B7B',
  border: '#E4E4EC',
  input: '#F1F1F6',
  danger: '#C62828',
};
const dark: typeof light = {
  bg: '#0E0E13',
  card: '#1A1A22',
  text: '#F2F2F7',
  muted: '#9A9AAD',
  border: '#2C2C38',
  input: '#23232D',
  danger: '#EF5350',
};

export const ACCENT_COLORS: Record<Accent, { light: string; dark: string }> = {
  violet: { light: '#6D4AFF', dark: '#9C85FF' },
  blue: { light: '#1E6BFF', dark: '#6FA0FF' },
  teal: { light: '#00897B', dark: '#4DD0C1' },
  green: { light: '#2E7D32', dark: '#6CCF73' },
  amber: { light: '#C77700', dark: '#FFB74D' },
  rose: { light: '#D81B60', dark: '#F48FB1' },
};

export type Theme = typeof light & { accent: string; scheme: 'light' | 'dark' };

export function useTheme(accent: Accent = 'violet'): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { ...(scheme === 'dark' ? dark : light), accent: ACCENT_COLORS[accent][scheme], scheme };
}

export const radius = { sm: 10, md: 14, lg: 20 };
export const space = (n: number) => n * 4;
