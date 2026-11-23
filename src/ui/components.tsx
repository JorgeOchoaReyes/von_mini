import { Ionicons } from '@react-native-vector-icons/ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { DeviceStatus, InferenceSource } from '../ai/types';
import { radius, space, type, useTheme, type Theme } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 18, color }: { name: IconName; size?: number; color: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  theme,
  variant = 'primary',
  icon,
  loading,
  disabled,
  size = 'md',
  style,
}: {
  label: string;
  onPress(): void;
  theme: Theme;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  const fg =
    variant === 'primary' ? theme.onAccent : variant === 'danger' ? theme.danger : variant === 'secondary' ? theme.text : theme.accent;
  const bg = variant === 'primary' ? theme.accent : variant === 'secondary' ? theme.surfaceAlt : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        { backgroundColor: bg, opacity: off ? 0.45 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} color={fg} />}
          <Text style={[size === 'sm' ? type.label : styles.buttonText, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  theme,
  label,
  filled,
  disabled,
  color,
}: {
  icon: IconName;
  onPress(): void;
  theme: Theme;
  label: string;
  filled?: boolean;
  disabled?: boolean;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: filled ? theme.accent : 'transparent', opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Icon name={icon} size={20} color={filled ? theme.onAccent : (color ?? theme.muted)} />
    </Pressable>
  );
}

export function Card({
  children,
  theme,
  style,
  tinted,
}: {
  children: ReactNode;
  theme: Theme;
  style?: StyleProp<ViewStyle>;
  tinted?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        tinted
          ? { backgroundColor: theme.accentSoft, borderColor: 'transparent' }
          : { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: theme.shadow },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Chip({
  label,
  onPress,
  theme,
  selected,
  icon,
}: {
  label: string;
  onPress(): void;
  theme: Theme;
  selected?: boolean;
  icon?: IconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.accent : theme.surface,
          borderColor: selected ? theme.accent : theme.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon && <Icon name={icon} size={14} color={selected ? theme.onAccent : theme.accent} />}
      <Text style={[type.caption, { color: selected ? theme.onAccent : theme.text, fontWeight: '500' }]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  theme,
}: {
  options: { value: T; label: string; icon?: IconName; dot?: boolean }[];
  value: T;
  onChange(v: T): void;
  theme: Theme;
}) {
  return (
    <View style={[styles.segmented, { backgroundColor: theme.surfaceAlt }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: theme.surface, boxShadow: theme.shadow }]}
          >
            {o.icon && <Icon name={o.icon} size={16} color={on ? theme.accent : theme.muted} />}
            <Text style={[type.label, { color: on ? theme.text : theme.muted }]}>{o.label}</Text>
            {o.dot && <View style={[styles.dot, { backgroundColor: theme.accent }]} />}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Shows where an answer was produced — the core of the hybrid story. */
export function SourceBadge({ source }: { source: InferenceSource | 'starter' }) {
  const theme = useTheme();
  const meta =
    source === 'on_device'
      ? { icon: 'phone-portrait-outline' as const, label: 'On-device', color: theme.success }
      : source === 'in_cloud'
        ? { icon: 'cloud-outline' as const, label: 'Cloud', color: '#1F6FEB' }
        : { icon: 'cube-outline' as const, label: 'Built-in', color: theme.muted };
  return (
    <View style={[styles.badge, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Icon name={meta.icon} size={12} color={meta.color} />
      <Text style={[styles.badgeText, { color: theme.muted }]}>{meta.label}</Text>
    </View>
  );
}

const STATUS: Record<DeviceStatus, { title: string; body: string; icon: IconName; tone: 'ok' | 'warn' | 'off' }> = {
  available: { title: 'Gemini Nano is ready', body: 'AI runs privately on this device.', icon: 'sparkles', tone: 'ok' },
  downloadable: { title: 'Get on-device AI', body: 'Download Gemini Nano once to use AI offline.', icon: 'download-outline', tone: 'warn' },
  downloading: { title: 'Downloading Gemini Nano…', body: 'You can keep using the app.', icon: 'cloud-download-outline', tone: 'warn' },
  unavailable: { title: 'On-device AI unavailable', body: 'This device can’t run Gemini Nano.', icon: 'alert-circle-outline', tone: 'off' },
  unsupported: { title: 'No on-device AI here', body: 'Use desktop Chrome or a supported Android phone.', icon: 'alert-circle-outline', tone: 'off' },
};

export function StatusBanner({
  status,
  online,
  privateMode,
  locked,
  onTogglePrivate,
  onDownload,
  downloadProgress,
}: {
  status: DeviceStatus;
  online: boolean;
  privateMode: boolean;
  locked: boolean;
  onTogglePrivate(v: boolean): void;
  onDownload(): void;
  downloadProgress: number | null;
}) {
  const theme = useTheme();
  const s = STATUS[status];
  const tone = s.tone === 'ok' ? theme.success : s.tone === 'warn' ? theme.warning : theme.subtle;
  return (
    <Card theme={theme} style={{ gap: space(3) }}>
      <View style={styles.rowCenter}>
        <View style={[styles.statusIcon, { backgroundColor: `${tone}22` }]}>
          <Icon name={s.icon} size={18} color={tone} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: theme.text }]}>{s.title}</Text>
          <Text style={[type.caption, { color: theme.muted }]}>
            {s.body}
            {!online ? ' You’re offline.' : ''}
          </Text>
        </View>
        {status === 'downloadable' && (
          <Button
            label={downloadProgress != null ? `${Math.round(downloadProgress * 100)}%` : 'Download'}
            size="sm"
            theme={theme}
            loading={downloadProgress === 0}
            onPress={onDownload}
          />
        )}
      </View>
      <View style={[styles.divider, { backgroundColor: theme.border }]} />
      <View style={styles.rowCenter}>
        <Icon name="lock-closed-outline" size={16} color={theme.muted} />
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: theme.text }]}>Private mode</Text>
          <Text style={[type.caption, { color: theme.muted }]}>
            {locked ? 'Offline build: everything stays on this device.' : 'Never send anything to the cloud.'}
          </Text>
        </View>
        <Switch
          value={privateMode}
          onValueChange={onTogglePrivate}
          disabled={locked}
          trackColor={{ true: theme.accent, false: theme.border }}
          accessibilityLabel="Private mode"
        />
      </View>
    </Card>
  );
}

export function SectionHeader({ title, theme, right }: { title: string; theme: Theme; right?: ReactNode }) {
  return (
    <View style={[styles.rowCenter, { justifyContent: 'space-between' }]}>
      <Text style={[type.headline, { color: theme.text }]}>{title}</Text>
      {right}
    </View>
  );
}

/** Multi-line input with an inline send button (builder and chat). */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  theme,
  busy,
  minHeight = 48,
  sendLabel = 'Send',
}: {
  value: string;
  onChange(v: string): void;
  onSubmit(): void;
  placeholder: string;
  theme: Theme;
  busy?: boolean;
  minHeight?: number;
  sendLabel?: string;
}) {
  const can = !!value.trim() && !busy;
  return (
    <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.subtle}
        multiline
        onKeyPress={(e) => {
          // Web: Enter sends, Shift+Enter adds a line.
          const ne = e.nativeEvent as { key: string; shiftKey?: boolean };
          if (ne.key === 'Enter' && !ne.shiftKey && can) {
            (e as unknown as { preventDefault?: () => void }).preventDefault?.();
            onSubmit();
          }
        }}
        style={[styles.composerInput, type.body, { color: theme.text, minHeight }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sendLabel}
        onPress={onSubmit}
        disabled={!can}
        style={({ pressed }) => [
          styles.send,
          { backgroundColor: can ? theme.accent : theme.surfaceAlt, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        {busy ? (
          <ActivityIndicator color={theme.onAccent} size="small" />
        ) : (
          <Icon name="arrow-up" size={20} color={can ? theme.onAccent : theme.subtle} />
        )}
      </Pressable>
    </View>
  );
}

export function EmptyState({ icon, title, body, theme }: { icon: IconName; title: string; body: string; theme: Theme }) {
  return (
    <View style={[styles.empty, { borderColor: theme.border }]}>
      <Icon name={icon} size={22} color={theme.subtle} />
      <Text style={[type.label, { color: theme.text }]}>{title}</Text>
      <Text style={[type.caption, { color: theme.muted, textAlign: 'center' }]}>{body}</Text>
    </View>
  );
}

export function relativeTime(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(at).toLocaleDateString();
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: space(5),
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  buttonSm: { minHeight: 36, paddingHorizontal: space(3), borderRadius: radius.sm },
  buttonText: { fontSize: 16, fontWeight: '600' },
  iconButton: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space(4) },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    flexDirection: 'row',
    gap: space(1),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    borderRadius: radius.sm,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space(2),
    paddingVertical: 2,
  },
  badgeText: { fontSize: 12, fontWeight: '500' },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  statusIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingLeft: space(4),
    paddingRight: space(2),
    paddingVertical: space(2),
    gap: space(2),
  },
  composerInput: { flex: 1, maxHeight: 160, paddingVertical: space(2), textAlignVertical: 'top', outlineStyle: 'none' } as never,
  send: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  empty: {
    alignItems: 'center',
    gap: space(1),
    padding: space(5),
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
  },
});
