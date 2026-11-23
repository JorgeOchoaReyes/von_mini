import { Ionicons } from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
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
import type { ProgressStep } from '../ai/hybrid';
import { haptics } from './haptics';
import { FadeUp, Pulse, Shimmer, TypingDots } from './motion';
import { radius, space, type, useTheme, type Theme } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 18, color }: { name: IconName; size?: number; color: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

/** A surface painted with the theme's two-stop gradient. */
export function Gradient({
  theme,
  children,
  style,
  direction = 'diagonal',
}: {
  theme: Theme;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  direction?: 'diagonal' | 'down';
}) {
  return (
    <LinearGradient
      colors={theme.gradient}
      start={direction === 'down' ? { x: 0.5, y: 0 } : { x: 0, y: 0 }}
      end={direction === 'down' ? { x: 0.5, y: 1 } : { x: 1, y: 1 }}
      style={style}
    >
      {children}
    </LinearGradient>
  );
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
  const inner = loading ? (
    <ActivityIndicator color={fg} />
  ) : (
    <>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} color={fg} />}
      <Text style={[size === 'sm' ? type.label : styles.buttonText, { color: fg }]}>{label}</Text>
    </>
  );
  const press = () => {
    haptics.light();
    onPress();
  };
  const body =
    variant === 'primary' ? (
      <Gradient theme={theme} style={[styles.button, size === 'sm' && styles.buttonSm, style]}>
        {inner}
      </Gradient>
    ) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={press}
      disabled={off}
      style={({ pressed }) => [
        body ? { opacity: off ? 0.45 : pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] } : null,
        !body && [
          styles.button,
          size === 'sm' && styles.buttonSm,
          { backgroundColor: bg, opacity: off ? 0.45 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
          style,
        ],
      ]}
    >
      {body ?? inner}
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
      onPress={() => {
        haptics.tap();
        onPress();
      }}
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
  flat,
}: {
  children: ReactNode;
  theme: Theme;
  style?: StyleProp<ViewStyle>;
  tinted?: boolean;
  flat?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        tinted
          ? { backgroundColor: theme.accentSoft, borderColor: 'transparent' }
          : { backgroundColor: theme.surface, borderColor: theme.border },
        !flat && !tinted && { boxShadow: theme.shadow },
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
  disabled,
}: {
  label: string;
  onPress(): void;
  theme: Theme;
  selected?: boolean;
  icon?: IconName;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.accent : theme.surface,
          borderColor: selected ? theme.accent : theme.border,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
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
            onPress={() => {
              if (!on) haptics.tap();
              onChange(o.value);
            }}
            style={[styles.segment, on && { backgroundColor: theme.surface, boxShadow: theme.shadowSm }]}
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
        ? { icon: 'cloud-outline' as const, label: 'Cloud', color: ACCENT_CLOUD }
        : { icon: 'cube-outline' as const, label: 'Built-in', color: theme.muted };
  return (
    <View style={[styles.badge, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Icon name={meta.icon} size={12} color={meta.color} />
      <Text style={[styles.badgeText, { color: theme.muted }]}>{meta.label}</Text>
    </View>
  );
}

const ACCENT_CLOUD = '#1F6FEB';

/**
 * One compact line telling the user where their AI runs: on-device, cloud, or locked private.
 * This is the single most important piece of product state in a hybrid app, so it is always
 * visible on the home screen rather than buried in a settings screen.
 */
export function ModePill({
  status,
  online,
  privateMode,
  locked,
  onPress,
}: {
  status: DeviceStatus;
  online: boolean;
  privateMode: boolean;
  locked: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  const ready = status === 'available';
  const meta = locked
    ? { icon: 'lock-closed' as const, label: 'Private', color: theme.success }
    : privateMode
      ? { icon: 'lock-closed' as const, label: 'Private mode', color: theme.success }
      : ready
        ? { icon: 'phone-portrait' as const, label: 'On-device', color: theme.success }
        : online
          ? { icon: 'cloud' as const, label: 'Cloud', color: ACCENT_CLOUD }
          : { icon: 'cloud-offline' as const, label: 'Offline', color: theme.warning };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Inference: ${meta.label}. Tap for details.`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={[styles.pillDot, { backgroundColor: meta.color }]} />
      <Text style={[type.caption, { color: theme.text, fontWeight: '600' }]}>{meta.label}</Text>
      <Icon name={meta.icon} size={13} color={theme.muted} />
    </Pressable>
  );
}

const STATUS: Record<DeviceStatus, { title: string; body: string; icon: IconName; tone: 'ok' | 'warn' | 'off' }> = {
  available: { title: 'Gemini Nano is ready', body: 'AI runs privately on this device.', icon: 'sparkles', tone: 'ok' },
  downloadable: {
    title: 'Get on-device AI',
    body: 'Download Gemini Nano once to use AI offline.',
    icon: 'download-outline',
    tone: 'warn',
  },
  downloading: { title: 'Downloading Gemini Nano…', body: 'You can keep using the app.', icon: 'cloud-download-outline', tone: 'warn' },
  unavailable: { title: 'On-device AI unavailable', body: 'This device can’t run Gemini Nano.', icon: 'alert-circle-outline', tone: 'off' },
  unsupported: {
    title: 'No on-device AI here',
    body: 'Use desktop Chrome or a supported Android phone.',
    icon: 'alert-circle-outline',
    tone: 'off',
  },
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
          onValueChange={(v) => {
            haptics.tap();
            onTogglePrivate(v);
          }}
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
  autoFocus,
}: {
  value: string;
  onChange(v: string): void;
  onSubmit(): void;
  placeholder: string;
  theme: Theme;
  busy?: boolean;
  minHeight?: number;
  sendLabel?: string;
  autoFocus?: boolean;
}) {
  const can = !!value.trim() && !busy;
  return (
    <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: theme.shadowSm }]}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.subtle}
        multiline
        autoFocus={autoFocus}
        accessibilityLabel={placeholder}
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
          styles.sendWrap,
          { opacity: can ? (pressed ? 0.85 : 1) : 0.5, transform: [{ scale: pressed && can ? 0.94 : 1 }] },
        ]}
      >
        {can && !busy ? (
          <Gradient theme={theme} style={styles.send}>
            <Icon name="arrow-up" size={20} color={theme.onAccent} />
          </Gradient>
        ) : (
          <View style={[styles.send, { backgroundColor: theme.surfaceAlt }]}>
            {busy ? (
              <ActivityIndicator color={theme.muted} size="small" />
            ) : (
              <Icon name="arrow-up" size={20} color={theme.subtle} />
            )}
          </View>
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

/**
 * The build/edit progress checklist. Steps are real phases of the generation pipeline, so the
 * user sees what is happening instead of an unexplained spinner.
 */
export function StepList({ steps, theme }: { steps: ProgressStep[]; theme: Theme }) {
  return (
    <View style={{ gap: space(2) }}>
      {steps.map((s, i) => (
        <FadeUp key={s.id} delay={i * 60} distance={6}>
          <View style={styles.rowCenter}>
            {s.state === 'done' ? (
              <Icon name="checkmark-circle" size={16} color={theme.success} />
            ) : (
              <Pulse color={theme.accent} size={8} />
            )}
            <Text
              style={[
                type.caption,
                { color: s.state === 'done' ? theme.muted : theme.text, fontWeight: s.state === 'done' ? '400' : '600' },
              ]}
            >
              {s.label}
            </Text>
          </View>
        </FadeUp>
      ))}
    </View>
  );
}

/** Skeleton used while an app spec is still streaming in. */
export function SpecSkeleton({ theme }: { theme: Theme }) {
  return (
    <View style={{ gap: space(3) }}>
      <Shimmer color={theme.surfaceAlt} style={{ width: '45%', height: 20 }} />
      <Shimmer color={theme.surfaceAlt} style={{ width: '80%' }} />
      <Shimmer color={theme.surfaceAlt} style={{ width: '62%' }} />
    </View>
  );
}

export { TypingDots };

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
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    alignSelf: 'flex-start',
  },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  statusIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingLeft: space(4),
    paddingRight: space(2),
    paddingVertical: space(2),
    gap: space(2),
  },
  composerInput: {
    flex: 1,
    maxHeight: 160,
    paddingVertical: space(2),
    textAlignVertical: 'top',
    outlineStyle: 'none',
  } as never,
  sendWrap: { borderRadius: radius.pill },
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
