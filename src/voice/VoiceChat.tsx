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
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppAI } from '../ai/appMode';
import type { InferenceSource } from '../ai/types';
import { fillTemplate } from '../spec/validate';
import type { SpecComponent } from '../spec/types';
import { Button, Icon, IconButton, SourceBadge, SpeechBubble } from '../ui/components';
import { haptics } from '../ui/haptics';
import { Breathe, FadeUp, PopIn, Ripples, TypingDots, usePressScale, Waveform } from '../ui/motion';
import { stroke, radius, space, type, type Theme } from '../ui/theme';
import { voiceReply, type Turn } from './cascade';
import { speak, stopSpeaking } from './tts';
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
  fill,
  theme,
  onTranscript,
}: {
  c: SpecComponent;
  /** The app's other field values, used to fill {field} placeholders in the persona. */
  values: Record<string, string>;
  /** Fills the persona with fields plus saved entries ({entries}, {today_entries}, {today}). */
  fill?(template: string): string;
  theme: Theme;
  onTranscript(text: string): void;
}) {
  const ai = useAppAI();
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
  const talkPress = usePressScale(0.92);
  const turnsRef = useRef<Turn[]>([]);
  const abort = useRef<{ aborted: boolean } | null>(null);
  // Bumped by every new action (talk, interrupt, send, stop). Older loops and replies see they
  // were overtaken and leave the transcript and status alone.
  const gen = useRef(0);
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

  /** Ends whatever is running: the mic, the reply and its speech. */
  const halt = useCallback(() => {
    gen.current++;
    mic.stop();
    if (abort.current) abort.current.aborted = true;
    abort.current = null;
    stopSpeaking();
  }, [mic]);

  useEffect(
    () => () => {
      gen.current++;
      if (abort.current) abort.current.aborted = true;
      stopSpeaking();
    },
    [],
  );

  const persona = fill ? fill(c.prompt ?? '') : fillTemplate(c.prompt ?? '', values);

  /** Runs the model for the latest user turn, speaking as it streams. Resolves true if it finished. */
  const respond = useCallback(
    async (history: Turn[], g: number) => {
      const signal = { aborted: false };
      abort.current = signal;
      const mine = () => gen.current === g && !signal.aborted;
      setPhase('thinking');
      commit([...history, { role: 'assistant' as const, text: '' }]);
      let said = '';
      try {
        const r = await voiceReply(history, {
          persona,
          ctx: ai,
          speak: !muted,
          signal,
          onText: (text) => {
            if (!mine()) return;
            said = text;
            setPhase('speaking');
            const next = [...history, { role: 'assistant' as const, text }];
            turnsRef.current = next;
            setTurns(next);
          },
        });
        if (!mine()) {
          // Interrupted: keep the words that came out, unless a newer turn already took over.
          if (turnsRef.current.length === history.length + 1) commit(said.trim() ? [...history, { role: 'assistant', text: said }] : history);
          return false;
        }
        setSource(r.source);
        commit([...history, { role: 'assistant', text: r.text || '…' }]);
        return true;
      } catch (e) {
        if (gen.current !== g) return false;
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
  const listenTurn = useCallback(
    async (g: number) => {
      const live = () => gen.current === g;
      while (live()) {
        setError(null);
        setPartial('');
        setPhase('listening');
        const heard = await mic.start();
        if (!live()) return;
        setPartial('');
        if (!heard) break;
        const ok = await respond([...turnsRef.current.filter((t) => t.text), { role: 'user', text: heard }], g);
        if (!ok || !handsFreeRef.current) break;
      }
      if (live()) setPhase('idle');
    },
    [mic, respond],
  );

  /** Starts (or continues) the conversation: speaks the opening line first, then listens. */
  const start = async () => {
    haptics.tap();
    if (phase === 'listening') {
      mic.stop();
      return;
    }
    // Interrupt the AI (if it's talking) and hand the floor back to the user.
    halt();
    const g = gen.current;
    if (!turnsRef.current.length && c.text) {
      commit([{ role: 'assistant', text: c.text }]);
      setPhase('speaking');
      if (!muted) await speak(c.text);
      if (gen.current !== g) return;
    }
    if (support?.available) await listenTurn(g);
    else setPhase('idle');
  };

  const sendTyped = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    halt();
    const g = gen.current;
    const base = !turnsRef.current.length && c.text ? [{ role: 'assistant' as const, text: c.text }] : turnsRef.current;
    await respond([...base, { role: 'user', text }], g);
    if (gen.current === g) setPhase('idle');
  };

  const stopAll = () => {
    halt();
    setPhase('idle');
  };

  const restart = () => {
    stopAll();
    commit([]);
    setSource(null);
    setError(null);
  };

  // Mute is this block's own: it silences this conversation's replies, not speech elsewhere.
  const toggleMute = () => {
    const v = !muted;
    setMutedState(v);
    if (v) stopSpeaking();
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
          {/* Spoken turns as comic speech balloons, tails toward each speaker. */}
          {turns.map((t, i) => (
            <FadeUp key={i} distance={8} style={{ alignSelf: t.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
              <SpeechBubble theme={theme} side={t.role === 'user' ? 'right' : 'left'} fill={t.role === 'user' ? theme.accent : theme.surfaceAlt}>
                {t.text ? (
                  <Text selectable style={[type.body, { color: t.role === 'user' ? theme.onAccent : theme.text }]}>
                    {t.text}
                  </Text>
                ) : (
                  <TypingDots color={theme.muted} />
                )}
              </SpeechBubble>
            </FadeUp>
          ))}
          {phase === 'listening' && partial ? (
            <View style={{ alignSelf: 'flex-end', maxWidth: '88%' }}>
              <SpeechBubble theme={theme} side="right" fill={theme.accentSoft}>
                <Text style={[type.body, { color: theme.text, fontStyle: 'italic' }]}>{partial}</Text>
              </SpeechBubble>
            </View>
          ) : null}
        </View>
      )}

      {canTalk ? (
        <View style={styles.talkRow}>
          {/* The mic shows the conversation's state: rings while it listens, a slow breath while
              Nano thinks, and a live waveform while the reply is spoken. */}
          <View style={styles.talkStage}>
            <Ripples size={76} color={theme.danger} active={phase === 'listening'} />
            <Ripples size={76} color={theme.accent} active={phase === 'speaking'} />
            <Breathe active={phase === 'thinking'}>
              <Pressable accessibilityRole="button" accessibilityLabel={PHASE_LABEL[phase]} onPress={start} {...talkPress.handlers}>
                <Animated.View
                  style={[
                    styles.talk,
                    talkPress.style,
                    { backgroundColor: phase === 'listening' ? theme.danger : theme.accent, boxShadow: theme.shadowSm },
                  ]}
                >
                  {phase === 'speaking' ? (
                    <Waveform color={theme.onAccent} active bars={5} height={26} />
                  ) : (
                    <PopIn trigger={phase}>
                      <Icon name={phase === 'listening' ? 'stop' : 'mic'} size={30} color={theme.onAccent} />
                    </PopIn>
                  )}
                </Animated.View>
              </Pressable>
            </Breathe>
          </View>
          <View style={[styles.row, { justifyContent: 'center' }]}>
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
          placeholder="Or type a message…"
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
  card: { borderWidth: stroke, borderRadius: radius.lg, padding: space(4), gap: space(4) },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  badge: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '86%', borderRadius: radius.lg, paddingHorizontal: space(4), paddingVertical: space(3) },
  talkRow: { alignItems: 'center', gap: space(3) },
  talkStage: { width: 152, height: 120, alignItems: 'center', justifyContent: 'center' },
  talk: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), borderRadius: radius.md, paddingLeft: space(3), paddingRight: space(1) },
});
