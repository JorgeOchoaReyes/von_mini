/** "Works offline" / "AI needs internet here": whether an app works without a connection on this device. */
import { StyleSheet, Text, View } from 'react-native';

import { useAI } from '../ai/AIContext';
import { offlineLabel, offlineLevel } from '../spec/offline';
import type { AppSpec } from '../spec/types';
import { Icon } from './components';
import { radius, space, type, useTheme } from './theme';

export function OfflineBadge({ spec, html }: { spec: AppSpec; html?: boolean }) {
  const theme = useTheme();
  const ai = useAI();
  const { text, offline } = offlineLabel(offlineLevel(spec, html), ai.deviceStatus === 'available');
  const color = offline ? theme.success : theme.muted;
  return (
    <View style={[styles.badge, { borderColor: color }]} accessibilityLabel={text}>
      <Icon name={offline ? 'airplane-outline' : 'cloud-outline'} size={12} color={color} />
      <Text style={[type.caption, { color, fontSize: 11 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: space(2), paddingVertical: 2, alignSelf: 'flex-start' },
});
