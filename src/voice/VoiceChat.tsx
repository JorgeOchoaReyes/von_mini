/**
 * The `voice` block: a spoken conversation inside a generated app.
 *
 *   tap to talk → speech-to-text (on-device when possible)
 *               → Gemini Nano writes the reply, streamed
 *               → each finished sentence is spoken with the device's own voice
 *
 * Hands-free mode listens again as soon as the AI stops talking, so a practice session (a mock
 * interview, a language drill) flows without touching the screen. Every turn is also typed out,
 * can be typed instead of spoken, and is saved with the app's other fields.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAI } from '../ai/AIContext';
import type { InferenceSource } from '../ai/types';
import { fillTemplate } from '../spec/validate';
import type { SpecComponent } from '../spec/types';
import { Button, Icon, IconButton, SourceBadge } from '../ui/components';
import { haptics } from '../ui/haptics';
import { Pulse, TypingDots } from '../ui/motion';
import { radius, space, type, type Theme } from '../ui/theme';
import { voiceReply, type Turn } from './cascade';
import { setMuted, speak, stopSpeaking } from './tts';
import { useListener, useSttSupport } from './useVoice';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Tap to talk',
  listening: 'Listening… tap when you’re done',
  thinking: 'Thinking on-device…',
  speaking: 'Speaking… tap to interrupt',
};

/** The conversation as plain text, which is what gets saved with the entry. */
export function transcriptText(turns: Turn[]) {
  return turns.map((t) => `${t.role === 'user' ? 'You' : 'AI'}: ${t.text}`).join('\n');
}

export function VoiceChat({
  c,
  values,
  theme,
  onTranscript,
}: {
  c: SpecComponent;
  /** The app's other field values, used to fill {field} placeholders in the persona. */
  values: Record<string, string>;
  theme: Theme;
  onTranscript(text: string): void;
}) {
  const ai = useAI();
  const support = useSttSupport();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [partial, setPartial] = useState('');
  const [draft, setDraft] = useState('');
  const [handsFree, setHandsFree] = useState(true);
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<InferenceSource | null>(null);

  const mic = useListener(setPartial);
  const turnsRef = useRef<Turn[]>([]);
  const abort = useRef<{ aborted: boolean } | null>(null);
  const active = useRef(false);
  const handsFreeRef = useRef(handsFree);
  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);

  const commit = useCallback(
    (next: Turn[]) => {
      turnsRef.current = next;
      setTurns(next);
      onTranscript(transcriptText(next.filter((t) => t.text)));
    },
    [onTranscript],
  );

  useEffect(
    () => () => {
      active.current = false;
      abort.current && (abort.current.aborted = true);
      stopSpeaking();
    },
    [],
  );

  const persona = fillTemplate(c.prompt ?? '', values);

  /** Runs the model for the latest user turn, speaking as it streams. */
  const respond = useCallback(
    async (history: Turn[]) => {
      const signal = { aborted: false };
      abort.current = signal;
      setPhase('thinking');
      const withReply = [...history, { role: 'assistant' as const, text: '' }];
      commit(withReply);
      try {
        const r = await voiceReply(history, {
          persona,
          ctx: ai,
          speak: !muted,
          signal,
          onText: (text) => {
            if (signal.aborted) return;
            setPhase('speaking');
            const next = [...history, { role: 'assistant' as const, text }];
            turnsRef.current = next;
            setTurns(next);
          },
        });
        setSource(r.source);
        commit([...history, { role: 'assistant', text: r.text || '…' }]);
        return !signal.aborted;
      } catch (e) {
        commit(history);
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        if (abort.current === signal) abort.current = null;
      }
    },
    [ai, commit, muted, persona],
  );

  /** One spoken user turn, then the reply; loops while hands-free is on. */
  const listenTurn = useCallback(async () => {
    active.current = true;
    while (active.current) {
      setError(null);
      setPartial('');
      setPhase('listening');
      const heard = await mic.start();
      setPartial('');
      if (!active.current) break;
      if (!heard) {
        setPhase('idle');
        break;
      }
      const ok = await respond([...turnsRef.current, { role: 'user', text: heard }]);
      setPhase('idle');
      if (!ok || !handsFreeRef.current) break;
    }
    active.current = false;
    setPhase('idle');
  }, [mic, respond]);

  /** Starts (or continues) the conversation: speaks the opening line first, then listens. */
  const start = async () => {
    haptics.tap();
    if (phase === 'listening') {
      mic.stop();
      return;
    }
    if (phase === 'speaking' || phase === 'thinking') {
      // Interrupt the AI and hand the floor back to the user.
      if (abort.current) abort.current.aborted = true;
      stopSpeaking();
    }
    if (!turnsRef.current.length && c.text) {
      commit([{ role: 'assistant', text: c.text }]);
      setPhase('speaking');
      if (!muted) await speak(c.text);
    }
    if (support?.available) await listenTurn();
    else setPhase('idle');
  };

  const sendTyped = async () => {
    const text = draft.trim();
    if (!text || phase === 'thinking') return;
    setDraft('');
    active.current = false;
    mic.stop();
    const base = !turnsRef.current.length && c.text ? [{ role: 'assistant' as const, text: c.text }] : turnsRef.current;
    await respond([...base, { role: 'user', text }]);
    setPhase('idle');
  };

  const stopAll = () => {
    active.current = false;
    mic.stop();
    if (abort.current) abort.current.aborted = true;
    stopSpeaking();
    setPhase('idle');
  };

  const restart = () => {
    stopAll();
    commit([]);
    setSource(null);
    setError(null);
  };

  const toggleMute = () => {
    const v = !muted;
    setMutedState(v);
    setMuted(v);
  };

  const running = phase !== 'idle';
  const canTalk = !!support?.available;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
          <Icon name="mic" size={16} color={theme.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: theme.text }]}>{c.label}</Text>
          <Text style={[type.caption, { color: theme.muted }]}>
            {support?.onDevice ? 'Voice, AI and speech all stay on this device.' : 'AI and speech run on this device.'}
          </Text>
          {/* Where the last reply was actually generated, as reported by Firebase AI Logic. */}
          {source && (
            <View style={{ alignSelf: 'flex-start', marginTop: space(1) }}>
              <SourceBadge source={source} />
            </View>
          )}
        </View>
        <IconButton
          icon={muted ? 'volume-mute-outline' : 'volume-high-outline'}
          label={muted ? 'Unmute replies' : 'Mute replies'}
          theme={theme}
          onPress={toggleMute}
        />
        {turns.length > 0 && <IconButton icon="refresh" label="Start over" theme={theme} onPress={restart} />}
      </View>

      {turns.length > 0 && (
        <View style={{ gap: space(2) }}>
          {turns.map((t, i) => (
            <View
              key={i}
              style={[
                styles.bubble,
                t.role === 'user'
                  ? { alignSelf: 'flex-end', backgroundColor: theme.accent }
                  : { alignSelf: 'flex-start', backgroundColor: theme.surfaceAlt },
              ]}
            >
              {t.text ? (
                <Text selectable style={[type.body, { color: t.role === 'user' ? theme.onAccent : theme.text }]}>
                  {t.text}
                </Text>
              ) : (
                <TypingDots color={theme.muted} />
              )}
            </View>
          ))}
          {phase === 'listening' && partial ? (
            <View style={[styles.bubble, { alignSelf: 'flex-end', backgroundColor: theme.accentSoft }]}>
              <Text style={[type.body, { color: theme.text, fontStyle: 'italic' }]}>{partial}</Text>
            </View>
          ) : null}
        </View>
      )}

      {canTalk ? (
        <View style={styles.talkRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={PHASE_LABEL[phase]}
            onPress={start}
            style={({ pressed }) => [
              styles.talk,
              { backgroundColor: phase === 'listening' ? theme.danger : theme.accent, transform: [{ scale: pressed ? 0.96 : 1 }] },
            ]}
          >
            <Icon name={phase === 'listening' ? 'stop' : 'mic'} size={30} color={theme.onAccent} />
          </Pressable>
          <View style={[styles.row, { justifyContent: 'center' }]}>
            {running && <Pulse color={phase === 'listening' ? theme.danger : theme.accent} />}
            <Text style={[type.caption, { color: theme.muted }]}>
              {turns.length || running ? PHASE_LABEL[phase] : c.text ? 'Tap to start the conversation' : PHASE_LABEL.idle}
            </Text>
          </View>
          {running && <Button label="End" size="sm" variant="secondary" theme={theme} onPress={stopAll} />}
        </View>
      ) : (
        <Text style={[type.caption, { color: theme.muted }]}>
          Speech recognition isn’t available here, so type your side; replies are still spoken aloud.
        </Text>
      )}

      <View style={[styles.typeRow, { backgroundColor: theme.surfaceAlt }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Or type your answer…"
          placeholderTextColor={theme.subtle}
          onSubmitEditing={sendTyped}
          accessibilityLabel="Type your answer"
          style={[type.body, { flex: 1, color: theme.text, paddingVertical: space(2) }]}
        />
        <IconButton icon="arrow-up" label="Send" theme={theme} filled onPress={sendTyped} disabled={!draft.trim() || phase === 'thinking'} />
      </View>

      <View style={styles.row}>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: handsFree }}
          onPress={() => setHandsFree((v) => !v)}
          style={[styles.row, { flexShrink: 1 }]}
        >
          <Icon name={handsFree ? 'checkbox' : 'square-outline'} size={18} color={handsFree ? theme.accent : theme.subtle} />
          <Text style={[type.caption, { color: theme.text, flexShrink: 1 }]}>Hands-free: keep listening after each reply</Text>
        </Pressable>
      </View>

      {(error || mic.error) && (
        <View style={styles.row}>
          <Icon name="alert-circle-outline" size={16} color={theme.danger} />
          <Text style={[type.caption, { color: theme.danger, flex: 1 }]}>{error ?? mic.error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space(4), gap: space(4) },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  badge: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '86%', borderRadius: radius.lg, paddingHorizontal: space(4), paddingVertical: space(3) },
  talkRow: { alignItems: 'center', gap: space(3) },
  talk: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), borderRadius: radius.md, paddingLeft: space(3), paddingRight: space(1) },
});
