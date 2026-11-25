/**
 * The bottom navigation: Home, a raised voice button, Settings.
 *
 * The voice button is a front door to the whole product. Tap it and say what you want:
 *   - a name that matches one of your apps ("open mood journal") opens that app;
 *   - anything else ("a calorie tracker with meal reminders") builds a new app from it.
 * Speech is recognized on the device when the platform supports it, like every other mic.
 */
import type { BottomTabBarProps } from 'expo-router/tabs';
import { router } from 'expo-router';
import { useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { STARTERS } from '../spec/starters';
import { listApps, type SavedApp } from '../storage/store';
import { useListener, useSttSupport } from '../voice/useVoice';
import { Gradient, Icon, type IconName } from './components';
import { haptics } from './haptics';
import { FadeUp, Ripples, usePressScale } from './motion';
import { radius, space, type, useTheme } from './theme';

const TABS: Record<string, { label: string; icon: IconName; iconOn: IconName }> = {
  index: { label: 'Home', icon: 'home-outline', iconOn: 'home' },
  settings: { label: 'Settings', icon: 'settings-outline', iconOn: 'settings' },
};

/** Finds an app whose name the user said ("open the mood journal" -> Mood Journal). */
export function matchApp(said: string, apps: SavedApp[]): SavedApp | undefined {
  const s = said.toLowerCase();
  return apps
    .filter((a) => a.spec.name.length > 2 && s.includes(a.spec.name.toLowerCase()))
    .sort((a, b) => b.spec.name.length - a.spec.name.length)[0];
}

export function BottomBar({ state, navigateToTab, insets }: BottomTabBarProps) {
  const theme = useTheme();
  const support = useSttSupport();
  const [partial, setPartial] = useState('');
  const [open, setOpen] = useState(false);
  const mic = useListener(setPartial);
  const micPress = usePressScale(0.9);
  const listening = mic.state === 'listening';

  const go = (key: string, focused: boolean) => {
    if (focused) return;
    haptics.tap();
    navigateToTab(key);
  };

  const talk = async () => {
    haptics.medium();
    if (listening) {
      mic.stop();
      return;
    }
    setPartial('');
    setOpen(true);
    const said = (await mic.start()).trim();
    // Nothing heard (or an error): the sheet stays open and says so; tap the mic to try again.
    if (!said) return;
    setOpen(false);
    const apps = [...(await listApps()), ...STARTERS];
    const hit = matchApp(said, apps);
    if (hit) {
      router.push({ pathname: '/app/[id]', params: { id: hit.id } });
    } else {
      // Build it: Home picks this up and starts the build, with the usual progress UI.
      router.navigate({ pathname: '/', params: { build: said, at: String(Date.now()) } });
    }
  };

  const canTalk = !!support?.available;

  return (
    <>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space(2)), backgroundColor: theme.surface, borderColor: theme.border }]}>
        {state.routes.map((route, i) => {
          const meta = TABS[route.name];
          if (!meta) return null;
          const focused = state.index === i;
          const tab = (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.label}
              onPress={() => go(route.key, focused)}
              style={styles.tab}
            >
              <Icon name={focused ? meta.iconOn : meta.icon} size={24} color={focused ? theme.accent : theme.subtle} />
              <Text style={[type.caption, { color: focused ? theme.accent : theme.subtle, fontWeight: focused ? '700' : '500', fontSize: 12 }]}>
                {meta.label}
              </Text>
            </Pressable>
          );
          // The voice button sits between the two tabs.
          return i === 0 ? (
            <View key={route.key} style={styles.pair}>
              {tab}
              <View style={styles.center}>
                <View style={styles.micStage}>
                  <Ripples size={64} color={theme.accent} active={listening} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={listening ? 'Stop listening' : 'Say what you want: open an app or build a new one'}
                    disabled={!canTalk}
                    onPress={talk}
                    {...micPress.handlers}
                  >
                    <Animated.View style={[micPress.style, { opacity: canTalk ? 1 : 0.5 }]}>
                      <Gradient theme={theme} style={[styles.mic, { borderColor: theme.surface }]}>
                        <Icon name={listening ? 'stop' : 'mic'} size={28} color={theme.onAccent} />
                      </Gradient>
                    </Animated.View>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : (
            tab
          );
        })}
      </View>

      {/* What you're saying, live, above the bar. */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => (mic.stop(), setOpen(false))}>
        <Pressable style={styles.scrim} onPress={() => (mic.stop(), setOpen(false))}>
          <FadeUp style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border, marginBottom: insets.bottom + 96 }]}>
            <Text style={[type.overline, { color: theme.accent }]}>{listening ? 'Listening…' : 'Didn’t catch that'}</Text>
            <Text style={[type.title, { color: partial ? theme.text : theme.subtle }]}>
              {mic.error ?? (partial || (listening ? 'Say “open Mood Journal”, or describe a new app.' : 'Tap the mic and try again.'))}
            </Text>
            <Text style={[type.caption, { color: theme.muted }]}>
              Name one of your apps to open it, or describe a new one to build it.
            </Text>
          </FadeUp>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space(2),
    paddingHorizontal: space(4),
  },
  pair: { flex: 2, flexDirection: 'row', alignItems: 'flex-end' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 52 },
  center: { flex: 1, alignItems: 'center' },
  micStage: { width: 64, height: 64, marginTop: -28, alignItems: 'center', justifyContent: 'center' },
  mic: { width: 64, height: 64, borderRadius: 32, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,8,20,0.35)', paddingHorizontal: space(4) },
  sheet: { borderWidth: 1, borderRadius: radius.xl, padding: space(5), gap: space(2) },
});
