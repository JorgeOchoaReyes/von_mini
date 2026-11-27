/**
 * One conversation in the Chat tab: type or talk, and the AI answers. Saved as it goes.
 *
 * Voice works like a phone call you can drop in and out of: tap the mic and speak, the reply is
 * read aloud, and it listens again until you stop or start typing. Typed messages get quiet
 * replies unless "Read replies aloud" is on. Replies run on Gemini Nano when the phone has it,
 * otherwise in the cloud, through the same hybrid routing as everything else.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { useStickToBottom } from '../../ui/useStickToBottom';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAI } from '../../ai/AIContext';
import { getConversation, newConversation, saveConversation, titleFor, type ChatTurn, type Conversation } from '../../chat/conversations';
import { RichText } from '../../runtime/SpecRenderer';
import { Chip, Icon, IconButton, SourceBadge } from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { Ripples, TypingDots } from '../../ui/motion';
import { MAX_WIDTH, radius, space, stroke, type, useTheme } from '../../ui/theme';
import { useKeyboardInset } from '../../ui/useKeyboardInset';
import { TEXT_RULES, voiceReply } from '../../voice/cascade';
import { stopSpeaking } from '../../voice/tts';
import { useListener, useSttSupport } from '../../voice/useVoice';

const PERSONA =
  'You are a friendly, helpful assistant in a phone app. Answer questions, help brainstorm, and explain things simply.';

const SUGGESTIONS = ['Explain black holes simply', 'Plan a 20-minute workout', 'Ideas for a birthday gift', 'Help me write a kind text'];

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const ai = useAI();
  const insets = useSafeAreaInsets();
  const stt = useSttSupport();
  const { ref: keyboardRef, inset: keyboardInset } = useKeyboardInset();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const stick = useStickToBottom(scroll);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  const [convo, setConvo] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [readAloud, setReadAloud] = useState(false);
  const signal = useRef<{ aborted: boolean } | null>(null);
  // Voice conversation: after a spoken turn and its reply, listen again until stopped.
  const talking = useRef(false);
  const convoRef = useRef<Conversation | null>(null);
  // Which send owns the conversation: a send that was stopped and then overtaken by a newer one
  // must not write its leftovers over the newer turn.
  const owner = useRef(0);
  // The user typed while listening: their text wins over the transcript.
  const typedOver = useRef(false);

  // Only a live voice conversation writes the transcript into the box; late results don't.
  const mic = useListener((t) => {
    if (talking.current) setDraft(t);
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const found = id && id !== 'new' ? await getConversation(String(id)) : undefined;
      if (!alive) return;
      const c = found ?? newConversation();
      convoRef.current = c;
      setConvo(c);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Stop talking and listening when leaving the screen.
  useEffect(
    () => () => {
      talking.current = false;
      if (signal.current) signal.current.aborted = true;
      stopSpeaking();
    },
    [],
  );

  const update = useCallback((turns: ChatTurn[], persist = false) => {
    const c = convoRef.current;
    if (!c) return;
    const next = { ...c, turns };
    convoRef.current = next;
    setConvo(next);
    if (persist) saveConversation(next).catch(() => undefined);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 30);
  }, []);

  /** Sends a message and streams the reply, speaking it if asked. Resolves true if it finished. */
  const send = useCallback(
    async (text: string, spoken: boolean): Promise<boolean> => {
      const message = text.trim();
      const c = convoRef.current;
      // One reply at a time (Enter on the web can fire while a reply is still coming).
      if (!message || !c || signal.current) return false;
      haptics.light();
      setDraft('');
      const history: ChatTurn[] = [...c.turns.filter((t) => !t.error), { role: 'user', text: message, at: Date.now() }];
      // Show a typing bubble, but store only the message: an empty reply never gets saved.
      update([...history, { role: 'assistant', text: '', at: Date.now() }]);
      saveConversation({ ...c, turns: history }).catch(() => undefined);
      const s = { aborted: false };
      signal.current = s;
      const me = ++owner.current;
      const mine = () => owner.current === me;
      let partial = '';
      setPhase('thinking');
      try {
        const r = await voiceReply(history, {
          persona: PERSONA,
          rules: spoken ? undefined : TEXT_RULES,
          ctx: ai,
          speak: spoken || readAloud,
          signal: s,
          onText: (t) => {
            if (s.aborted) return;
            partial = t;
            setPhase(spoken || readAloud ? 'speaking' : 'thinking');
            update([...history, { role: 'assistant', text: t, at: Date.now() }]);
          },
        });
        if (s.aborted) {
          // Keep what was said before Stop; a reply cut off before any words is dropped.
          if (mine()) update(partial.trim() ? [...history, { role: 'assistant', text: partial, at: Date.now() }] : history, true);
          return false;
        }
        update([...history, { role: 'assistant', text: r.text || '…', at: Date.now(), source: r.source }], true);
        return true;
      } catch (e) {
        if (!mine()) return false;
        update([...history, { role: 'assistant', text: e instanceof Error ? e.message : String(e), at: Date.now(), error: true }], true);
        haptics.error();
        return false;
      } finally {
        if (signal.current === s) signal.current = null;
        if (mine()) setPhase('idle');
      }
    },
    [ai, readAloud, update],
  );

  /** Talk: listen, send what was said, hear the reply, and listen again until stopped. */
  const talk = useCallback(async () => {
    if (phase === 'listening') {
      talking.current = false;
      mic.stop();
      return;
    }
    talking.current = true;
    typedOver.current = false;
    haptics.medium();
    while (talking.current) {
      setPhase('listening');
      const said = (await mic.start()).trim();
      setPhase('idle');
      if (!said) break;
      if (!talking.current) {
        // Stopped by the mic button: leave what was heard in the box to edit or send. If the
        // user started typing instead, keep their text.
        if (!typedOver.current) setDraft(said);
        break;
      }
      const ok = await send(said, true);
      if (!ok) break;
    }
    talking.current = false;
  }, [mic, phase, send]);

  const stop = () => {
    talking.current = false;
    mic.stop();
    if (signal.current) signal.current.aborted = true;
    // Free the box for the next message right away; the stopped send cleans up after itself.
    signal.current = null;
    stopSpeaking();
    setPhase('idle');
  };

  const busy = phase === 'thinking' || phase === 'speaking';
  const canTalk = !!stt?.available;
  const turns = convo?.turns ?? [];

  return (
    <View ref={keyboardRef} style={{ flex: 1, backgroundColor: theme.bg, paddingBottom: keyboardInset }}>
      <Stack.Screen
        options={{
          title: titleFor(turns),
          headerRight: () => (
            <IconButton
              icon={readAloud ? 'volume-high' : 'volume-mute-outline'}
              label={readAloud ? 'Read replies aloud: on' : 'Read replies aloud: off'}
              theme={theme}
              filled={readAloud}
              onPress={() => {
                haptics.tap();
                if (readAloud) stopSpeaking();
                setReadAloud(!readAloud);
              }}
            />
          ),
        }}
      />
      {!convo ? (
        <ActivityIndicator style={{ marginTop: space(10) }} color={theme.accent} />
      ) : (
        <ScrollView ref={scroll} {...stick} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {turns.length === 0 ? (
            <View style={styles.empty}>
              <Text style={{ fontSize: 44 }}>💬</Text>
              <Text style={[type.title, { color: theme.text, textAlign: 'center' }]}>Ask anything</Text>
              <Text style={[type.body, { color: theme.muted, textAlign: 'center' }]}>
                Type below, or tap the mic and talk. Replies are read aloud when you talk.
              </Text>
              <View style={styles.chips}>
                {SUGGESTIONS.map((s) => (
                  <Chip key={s} label={s} theme={theme} onPress={() => void send(s, false)} />
                ))}
              </View>
            </View>
          ) : (
            turns.map((t, i) => {
              const mine = t.role === 'user';
              return (
                <View key={i} style={[styles.msgRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
                  <View
                    style={[
                      styles.bubble,
                      mine
                        ? { backgroundColor: theme.accent, borderColor: theme.border, borderBottomRightRadius: 4 }
                        : { backgroundColor: t.error ? theme.surfaceAlt : theme.surface, borderColor: t.error ? theme.danger : theme.border, borderBottomLeftRadius: 4 },
                    ]}
                  >
                    {mine ? (
                      <Text selectable style={[type.body, { color: theme.onAccent }]}>
                        {t.text}
                      </Text>
                    ) : t.text ? (
                      t.error ? (
                        <Text selectable style={[type.caption, { color: theme.danger }]}>
                          {t.text}
                        </Text>
                      ) : (
                        <RichText text={t.text} theme={theme} />
                      )
                    ) : (
                      <TypingDots color={theme.muted} />
                    )}
                    {!mine && t.source ? <SourceBadge source={t.source} /> : null}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* State of a voice conversation, just above the input. */}
      {phase !== 'idle' && (
        <View style={styles.status}>
          <Text style={[type.caption, { color: theme.muted }]}>
            {phase === 'listening' ? 'Listening… tap the mic to stop' : phase === 'thinking' ? 'Thinking…' : 'Speaking…'}
          </Text>
        </View>
      )}

      <View style={[styles.bar, { borderColor: theme.border, backgroundColor: theme.surface, paddingBottom: keyboardInset ? space(2) : Math.max(insets.bottom, space(2)) }]}>
        <View style={[styles.inputWrap, { backgroundColor: theme.surfaceAlt }]}>
          <TextInput
            value={draft}
            onChangeText={(v) => {
              setDraft(v);
              // Typing takes over from a voice conversation.
              if (phase === 'listening') {
                typedOver.current = true;
                talking.current = false;
                mic.stop();
              }
            }}
            placeholder={phase === 'listening' ? 'Listening…' : 'Message'}
            placeholderTextColor={theme.subtle}
            multiline
            accessibilityLabel="Message"
            // Enter sends on the web, like any chat (react-native-web reads blurOnSubmit); on phones
            // it's a new line and the button sends.
            {...(Platform.OS === 'web' ? { blurOnSubmit: true } : { submitBehavior: 'newline' as const })}
            onSubmitEditing={() => {
              void send(draft, false);
              setTimeout(() => input.current?.focus(), 50);
            }}
            ref={input}
            style={[type.body, styles.input, { color: theme.text }]}
          />
        </View>
        {busy ? (
          <IconButton icon="stop" label="Stop" theme={theme} filled onPress={stop} />
        ) : draft.trim() && phase !== 'listening' ? (
          <IconButton icon="arrow-up" label="Send" theme={theme} filled onPress={() => void send(draft, false)} />
        ) : (
          <View style={styles.micWrap}>
            <Ripples size={48} color={theme.danger} active={phase === 'listening'} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={phase === 'listening' ? 'Stop listening' : canTalk ? 'Talk' : 'Voice input isn’t available here'}
              disabled={!canTalk}
              onPress={() => void talk()}
              style={[styles.mic, { backgroundColor: phase === 'listening' ? theme.danger : theme.accent, borderColor: theme.border, opacity: canTalk ? 1 : 0.45 }]}
            >
              <Icon name={phase === 'listening' ? 'stop' : 'mic'} size={22} color={phase === 'listening' ? '#FFFFFF' : theme.onAccent} />
            </Pressable>
          </View>
        )}
      </View>
      {mic.error && phase === 'idle' ? (
        <Pressable onPress={() => router.push('/settings')} style={[styles.status, { paddingBottom: space(2) }]}>
          <Text style={[type.caption, { color: theme.danger }]}>{mic.error}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: space(4), gap: space(3), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center', flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(3), paddingVertical: space(10) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space(2), marginTop: space(2) },
  msgRow: { flexDirection: 'row' },
  bubble: { maxWidth: '86%', borderWidth: stroke, borderRadius: radius.lg, paddingHorizontal: space(3), paddingVertical: space(2), gap: space(1) },
  status: { alignItems: 'center', paddingVertical: space(1) },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: space(2), paddingHorizontal: space(3), paddingTop: space(2), borderTopWidth: stroke },
  inputWrap: { flex: 1, borderRadius: radius.lg, paddingHorizontal: space(3) },
  // No browser focus ring inside the rounded box (web only; phones don't draw one).
  input: { minHeight: 44, maxHeight: 140, paddingVertical: space(2), ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  micWrap: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  mic: { width: 46, height: 46, borderRadius: 23, borderWidth: stroke, alignItems: 'center', justifyContent: 'center' },
});
