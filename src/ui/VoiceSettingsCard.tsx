/**
 * Settings > Reply voice: pick one of the phone's installed voices, its speed and pitch, and hear
 * it. Applies everywhere replies are spoken (Chat, voice chats in apps).
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { listVoices, speak, stopSpeaking } from '../voice/tts';
import { DEFAULT_VOICE, setVoiceSettings, useVoiceSettings } from '../voice/voiceSettings';
import { Button, Icon, Segmented } from './components';
import { haptics } from './haptics';
import { radius, space, stroke, type, type Theme } from './theme';

const SAMPLE = 'Hi! This is how I’ll sound when I read your replies.';
const SPEEDS = [
  { value: '0.85', label: 'Slower' },
  { value: '1.02', label: 'Normal' },
  { value: '1.25', label: 'Faster' },
];
const PITCHES = [
  { value: '0.85', label: 'Lower' },
  { value: '1', label: 'Normal' },
  { value: '1.15', label: 'Higher' },
];

type VoiceOption = Awaited<ReturnType<typeof listVoices>>[number];

/** Nearest preset, so a stored value still highlights a choice. */
const nearest = (v: number, opts: { value: string }[]) =>
  opts.reduce((a, b) => (Math.abs(Number(b.value) - v) < Math.abs(Number(a.value) - v) ? b : a)).value;

export function VoiceSettingsCard({ theme }: { theme: Theme }) {
  const settings = useVoiceSettings();
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    // Browsers load their voice list lazily; try again shortly if it's empty at first.
    const load = () => void listVoices().then((v) => alive && setVoices(v));
    load();
    const t = setTimeout(load, 1200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  const preview = () => {
    haptics.light();
    stopSpeaking();
    void speak(SAMPLE, true);
  };

  const choose = (id: string | undefined) => {
    haptics.tap();
    setVoiceSettings({ voice: id });
    stopSpeaking();
    // Speak after the setting is stored so the sample uses the new voice.
    setTimeout(() => void speak(SAMPLE, true), 50);
  };

  const shown = voices ? (showAll ? voices : voices.slice(0, 6)) : [];
  // A saved voice this phone doesn't have plays as the default, so show it that way.
  const selected = voices?.length && settings.voice && !voices.some((v) => v.id === settings.voice) ? undefined : settings.voice;

  const row = (id: string | undefined, label: string, note?: string) => {
    const on = selected === id;
    return (
      <Pressable
        key={id ?? 'default'}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        accessibilityLabel={`Voice: ${label}${note ? `, ${note}` : ''}`}
        onPress={() => choose(id)}
        style={[styles.voice, { borderColor: on ? theme.accent : theme.border, backgroundColor: on ? theme.accentSoft : theme.surface }]}
      >
        <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={18} color={on ? theme.accent : theme.subtle} />
        <Text style={[type.body, { color: theme.text, flex: 1 }]} numberOfLines={1}>
          {label}
        </Text>
        {note ? <Text style={[type.caption, { color: theme.muted }]}>{note}</Text> : null}
      </Pressable>
    );
  };

  return (
    <View style={{ gap: space(3) }}>
      <Text style={[type.label, { color: theme.text }]}>Reply voice</Text>
      <View style={{ gap: space(2) }}>
        {row(undefined, 'Phone default')}
        {voices === null ? (
          <Text style={[type.caption, { color: theme.muted }]}>Loading voices…</Text>
        ) : voices.length === 0 ? (
          <Text style={[type.caption, { color: theme.muted }]}>
            No other voices found. Add voices in your phone’s text-to-speech settings.
          </Text>
        ) : (
          shown.map((v) => row(v.id, v.label, [v.enhanced ? 'enhanced' : '', v.offline ? '' : 'needs internet'].filter(Boolean).join(' · ') || undefined))
        )}
        {voices && voices.length > 6 && (
          <Pressable onPress={() => setShowAll(!showAll)} accessibilityRole="button">
            <Text style={[type.caption, { color: theme.accent }]}>{showAll ? 'Show fewer' : `Show all ${voices.length} voices`}</Text>
          </Pressable>
        )}
      </View>
      <Text style={[type.label, { color: theme.text }]}>Speed</Text>
      <Segmented
        theme={theme}
        value={nearest(settings.rate, SPEEDS)}
        onChange={(v) => setVoiceSettings({ rate: Number(v) })}
        options={SPEEDS}
      />
      <Text style={[type.label, { color: theme.text }]}>Pitch</Text>
      <Segmented
        theme={theme}
        value={nearest(settings.pitch, PITCHES)}
        onChange={(v) => setVoiceSettings({ pitch: Number(v) })}
        options={PITCHES}
      />
      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <Button label="Test voice" icon="play" variant="secondary" theme={theme} onPress={preview} />
        </View>
        {(settings.voice || settings.rate !== DEFAULT_VOICE.rate || settings.pitch !== DEFAULT_VOICE.pitch) && (
          <Button label="Reset" variant="ghost" theme={theme} onPress={() => setVoiceSettings({ ...DEFAULT_VOICE, voice: undefined })} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  voice: { flexDirection: 'row', alignItems: 'center', gap: space(2), borderWidth: stroke, borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(2) },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
});
