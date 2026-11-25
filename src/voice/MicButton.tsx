/**
 * A microphone button for any text box: tap, speak, and the words land in the box. Used in the
 * builder's prompt, the edit chat, and every text field of a generated app.
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Pulse } from '../ui/motion';

import { haptics } from '../ui/haptics';
import { Icon } from '../ui/components';
import type { Theme } from '../ui/theme';
import { useListener, useSttSupport } from './useVoice';

export function MicButton({
  theme,
  onPartial,
  onFinal,
  onError,
  size = 40,
  label = 'Speak',
}: {
  theme: Theme;
  /** Live transcript while the user is speaking. */
  onPartial?(text: string): void;
  /** Final transcript ('' if nothing was said). */
  onFinal(text: string): void;
  onError?(message: string): void;
  size?: number;
  label?: string;
}) {
  const support = useSttSupport();
  const mic = useListener(onPartial);
  useEffect(() => {
    if (mic.error) onError?.(mic.error);
  }, [mic.error, onError]);
  if (!support?.available) return null;

  const listening = mic.state === 'listening';
  const press = async () => {
    haptics.tap();
    if (listening) {
      mic.stop();
      return;
    }
    const text = await mic.start();
    if (text) onFinal(text);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listening ? 'Stop listening' : label}
      accessibilityState={{ busy: listening }}
      onPress={press}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: listening ? theme.accent : theme.surfaceAlt,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {listening ? (
        <>
          <Icon name="stop" size={size * 0.4} color={theme.onAccent} />
          <View style={styles.pulse} pointerEvents="none">
            <Pulse color={theme.onAccent} size={6} />
          </View>
        </>
      ) : mic.state === 'error' ? (
        <Icon name="mic-off-outline" size={size * 0.45} color={theme.danger} />
      ) : (
        <Icon name="mic-outline" size={size * 0.48} color={theme.accent} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
  pulse: { position: 'absolute', top: 5, right: 5 },
});
