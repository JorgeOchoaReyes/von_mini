import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { DeviceStatus, InferenceSource } from '../ai/types';
import { radius, space, useTheme, type Theme } from './theme';

export function Button({
  label,
  onPress,
  theme,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  label: string;
  onPress(): void;
  theme: Theme;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const primary = variant === 'primary';
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: theme.accent }
          : variant === 'secondary'
            ? { backgroundColor: theme.input, borderColor: theme.border, borderWidth: 1 }
            : { backgroundColor: 'transparent' },
        { opacity: off ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? '#fff' : theme.accent} />
      ) : (
        <Text style={[styles.buttonText, { color: primary ? '#fff' : theme.accent }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, theme, style }: { children: ReactNode; theme: Theme; style?: ViewStyle }) {
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }, style]}>{children}</View>
  );
}

/** Shows where an answer was produced — the core of the hybrid story. */
export function SourceBadge({ source }: { source: InferenceSource | 'starter' }) {
  const theme = useTheme();
  const label = source === 'on_device' ? '📱 On-device' : source === 'in_cloud' ? '☁️ Cloud' : '📦 Built-in';
  return (
    <View style={[styles.badge, { backgroundColor: theme.input, borderColor: theme.border }]}>
      <Text style={[styles.badgeText, { color: theme.muted }]}>{label}</Text>
    </View>
  );
}

const STATUS_TEXT: Record<DeviceStatus, string> = {
  available: 'Gemini Nano ready on this device',
  downloadable: 'Gemini Nano can be downloaded',
  downloading: 'Downloading Gemini Nano…',
  unavailable: 'On-device AI unavailable: using cloud',
  unsupported: 'This device has no on-device AI: using cloud',
};

export function StatusPill({ status, online, privateMode }: { status: DeviceStatus; online: boolean; privateMode: boolean }) {
  const theme = useTheme();
  const dot = status === 'available' ? '#2E7D32' : status === 'downloadable' || status === 'downloading' ? '#C77700' : theme.muted;
  return (
    <View style={[styles.pill, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[styles.pillText, { color: theme.text }]} numberOfLines={1}>
        {STATUS_TEXT[status]}
        {!online ? ' · ✈️ Offline' : privateMode ? ' · 🔒 Private' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: space(5),
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space(4) },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: space(2),
    paddingVertical: 2,
  },
  badgeText: { fontSize: 12, fontWeight: '500' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 13, flexShrink: 1 },
});
