import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { useAI } from '../ai/AIContext';
import { quickEdits } from '../spec/edit';
import type { AppSpec } from '../spec/types';
import { listMessages, type ChatMessage } from '../storage/store';
import { Chip, Composer, Icon, SourceBadge, SpeechBubble, StepList, TypingDots, type IconName } from '../ui/components';
import { FadeUp } from '../ui/motion';
import { alpha, stroke, MAX_WIDTH, radius, space, type, useTheme, type Theme } from '../ui/theme';
import { MicButton } from '../voice/MicButton';
import { speak, stopSpeaking } from '../voice/tts';
import { chatSteps, isBusy, sendMessage, stopMessage, undoEdit, useChatVersion } from './chatJobs';

const SUGGESTIONS: { label: string; icon: IconName }[] = [
  { label: 'What does this app do?', icon: 'help-circle-outline' },
  { label: 'Add a field for the date', icon: 'add-circle-outline' },
  { label: 'Make the AI answers shorter', icon: 'cut-outline' },
  { label: 'How could I improve it?', icon: 'bulb-outline' },
];

function Avatar({ emoji, theme }: { emoji: string; theme: Theme }) {
  return (
    <View style={[styles.avatar, { backgroundColor: theme.accentSoft }]}>
      <Text style={{ fontSize: 15 }}>{emoji}</Text>
    </View>
  );
}

/** A one-line "what changed" diff, shown above the preview after any edit. */
export function ChangeSummary({
  changes,
  theme,
  onUndo,
  onDismiss,
  onShowHistory,
}: {
  changes: string[];
  theme: Theme;
  onUndo(): void;
  onDismiss(): void;
  onShowHistory(): void;
}) {
  if (!changes.length) return null;
  return (
    <FadeUp distance={6}>
      <View style={[styles.diff, { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: theme.shadowSm }]}>
        <View style={styles.row}>
          <Icon name="git-commit-outline" size={15} color={theme.success} />
          <Text style={[type.label, { color: theme.text, flex: 1 }]} numberOfLines={1}>
            {changes.length === 1 ? changes[0] : `${changes.length} changes applied`}
          </Text>
          <Pressable onPress={onDismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Icon name="close" size={16} color={theme.subtle} />
          </Pressable>
        </View>
        {changes.length > 1 &&
          changes.slice(0, 4).map((c, i) => (
            <View key={i} style={styles.row}>
              <Text style={[type.caption, { color: theme.accent }]}>+</Text>
              <Text style={[type.caption, { color: theme.muted, flex: 1 }]}>{c}</Text>
            </View>
          ))}
        <View style={styles.row}>
          <Pressable onPress={onUndo} hitSlop={6} style={styles.row} accessibilityRole="button">
            <Icon name="arrow-undo-outline" size={14} color={theme.accent} />
            <Text style={[type.label, { color: theme.accent }]}>Undo</Text>
          </Pressable>
          <Pressable onPress={onShowHistory} hitSlop={6} style={styles.row} accessibilityRole="button">
            <Icon name="time-outline" size={14} color={theme.muted} />
            <Text style={[type.label, { color: theme.muted }]}>History</Text>
          </Pressable>
        </View>
      </View>
    </FadeUp>
  );
}

/**
 * Chat about one app: ask questions or request changes.
 *
 * Two edit paths live here, and the distinction is the point:
 *   - the quick-edit chips are pure functions over the spec — instant, offline, exactly what they
 *     say, no model involved;
 *   - free-text changes go to the model, stream in, and report what changed afterwards.
 */
export function ChatPanel({
  appId,
  spec,
  onShowApp,
  onLocalEdit,
  onShowHistory,
}: {
  appId: string;
  spec: AppSpec;
  onShowApp(): void;
  /** Applies a chip edit (already a complete spec) and records it. */
  onLocalEdit(next: AppSpec, change: string): void;
  onShowHistory(): void;
}) {
  const theme = useTheme(spec.accent);
  const ai = useAI();
  const version = useChatVersion();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);
  const busy = isBusy(appId);
  const steps = chatSteps(appId);
  const chips = useMemo(() => quickEdits(spec), [spec]);

  useEffect(() => {
    let alive = true;
    listMessages(appId).then((m) => alive && setMessages(m));
    return () => {
      alive = false;
    };
  }, [appId, version]);

  /**
   * Set when a message was spoken: the reply to it is read aloud, so editing an app can be a
   * spoken back-and-forth (speech-to-text → Gemini → text-to-speech). Holds the index the
   * spoken message will take in the thread; the first assistant message after it is spoken.
   */
  const speakReplyAfter = useRef<number | null>(null);

  const send = (text: string, spoken = false) => {
    if (!text.trim() || busy) return;
    setDraft('');
    speakReplyAfter.current = spoken ? messages.length : null;
    // Not awaited: the job keeps running even if this screen closes.
    sendMessage(appId, text, ai);
  };

  useEffect(() => {
    const since = speakReplyAfter.current;
    if (since == null) return;
    const reply = messages.slice(since + 1).find((m) => m.role === 'assistant');
    if (!reply) return;
    speakReplyAfter.current = null;
    void speak(reply.kind === 'edit' ? `Done. ${reply.text}` : reply.text);
  }, [messages]);

  useEffect(() => () => stopSpeaking(), []);

  const local = ai.privateMode || !ai.online;

  return (
    // The app screen lifts its content above the keyboard (useKeyboardInset), so no avoiding view here.
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={styles.intro}>
            <View style={[styles.introIcon, { backgroundColor: theme.accentSoft }]}>
              <Text style={{ fontSize: 30 }}>{spec.emoji}</Text>
            </View>
            <Text style={[type.title, { color: theme.text, textAlign: 'center' }]}>Improve {spec.name}</Text>
            <Text style={[type.body, { color: theme.muted, textAlign: 'center' }]}>
              Describe a change in your own words, or tap a quick edit below. Every change is saved as a version you
              can put back.
            </Text>
            <View style={styles.row}>
              <Icon name={local ? 'lock-closed-outline' : 'phone-portrait-outline'} size={14} color={theme.success} />
              <Text style={[type.caption, { color: theme.muted }]}>
                {local ? 'Runs on this device only' : 'Runs on-device first'}
              </Text>
            </View>
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <Chip key={s.label} label={s.label} icon={s.icon} theme={theme} onPress={() => send(s.label)} />
              ))}
            </View>
          </View>
        )}

        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <FadeUp key={m.id} distance={8} style={styles.mine}>
                <SpeechBubble theme={theme} side="right" fill={theme.accent}>
                  <Text selectable style={[type.body, { color: theme.onAccent }]}>
                    {m.text}
                  </Text>
                </SpeechBubble>
              </FadeUp>
            );
          }
          const isEdit = m.kind === 'edit';
          const isError = m.kind === 'error';
          return (
            <FadeUp key={m.id} distance={8} style={styles.theirsRow}>
              <Avatar emoji={spec.emoji} theme={theme} />
              <SpeechBubble theme={theme} side="left" fill={isError ? alpha(theme.danger, 0.12) : theme.surface} style={styles.theirs}>
                <View style={{ gap: space(2) }}>
                {isEdit && (
                  <View style={styles.row}>
                    <Icon
                      name={m.undone ? 'arrow-undo' : 'checkmark-circle'}
                      size={16}
                      color={m.undone ? theme.subtle : theme.success}
                    />
                    <Text style={[type.label, { color: m.undone ? theme.subtle : theme.text }]}>
                      {m.undone ? 'Change undone' : 'Updated your app'}
                    </Text>
                  </View>
                )}
                {isEdit ? (
                  <View style={{ gap: space(1) }}>
                    {m.text.split('\n').map((line, i) => (
                      <View key={i} style={[styles.row, { alignItems: 'flex-start' }]}>
                        <Text style={[type.body, { color: theme.accent }]}>•</Text>
                        <Text style={[type.body, { color: theme.text, flex: 1 }, m.undone && styles.struck]}>{line}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={[styles.row, { alignItems: 'flex-start' }]}>
                    {isError && <Icon name="alert-circle-outline" size={16} color={theme.danger} />}
                    <Text selectable style={[type.body, { color: isError ? theme.danger : theme.text, flex: 1 }]}>
                      {m.text}
                    </Text>
                  </View>
                )}
                {(m.source || (isEdit && !m.undone)) && (
                  <View style={[styles.row, { flexWrap: 'wrap', gap: space(3) }]}>
                    {m.source && <SourceBadge source={m.source} />}
                    {isEdit && !m.undone && (
                      <>
                        <Pressable onPress={onShowApp} hitSlop={6} style={styles.row} accessibilityRole="button">
                          <Icon name="eye-outline" size={14} color={theme.accent} />
                          <Text style={[type.label, { color: theme.accent }]}>View app</Text>
                        </Pressable>
                        <Pressable onPress={() => undoEdit(appId, m)} hitSlop={6} style={styles.row} accessibilityRole="button">
                          <Icon name="arrow-undo-outline" size={14} color={theme.muted} />
                          <Text style={[type.label, { color: theme.muted }]}>Undo</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                )}
                </View>
              </SpeechBubble>
            </FadeUp>
          );
        })}

        {busy && (
          <View style={styles.theirsRow}>
            <Avatar emoji={spec.emoji} theme={theme} />
            <SpeechBubble theme={theme} side="left" fill={theme.surface} style={styles.theirs}>
              {steps.length ? (
                <StepList steps={steps} theme={theme} />
              ) : (
                <View style={styles.row}>
                  <TypingDots color={theme.subtle} />
                  <Text style={[type.caption, { color: theme.muted }]}>
                    {local ? 'Thinking on this device…' : 'Thinking…'}
                  </Text>
                </View>
              )}
            </SpeechBubble>
          </View>
        )}
      </ScrollView>

      <View style={[styles.composerWrap, { borderColor: theme.border, backgroundColor: theme.bg }]}>
        {chips.length > 0 && !busy && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <View style={styles.row}>
              <Icon name="flash-outline" size={13} color={theme.subtle} />
              <Text style={[type.caption, { color: theme.subtle }]}>Quick edits</Text>
            </View>
            {chips.map((q) => (
              <Chip
                key={q.label}
                label={q.label}
                theme={theme}
                onPress={() => onLocalEdit(q.apply(spec), q.label)}
              />
            ))}
            <Chip label="History" icon="time-outline" theme={theme} onPress={onShowHistory} />
          </ScrollView>
        )}
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={() => send(draft)}
          placeholder="Ask or describe a change…"
          theme={theme}
          busy={busy}
          // While it's thinking or streaming, the send button becomes Stop.
          onStop={() => {
            stopMessage(appId);
            stopSpeaking();
          }}
          accessory={
            <MicButton
              theme={theme}
              label="Say a change or a question"
              onPartial={setDraft}
              onFinal={(t) => send(t, true)}
            />
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: space(4), gap: space(3), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center', flexGrow: 1 },
  intro: { alignItems: 'center', gap: space(3), paddingVertical: space(6), paddingHorizontal: space(2) },
  introIcon: { width: 64, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), justifyContent: 'center', marginTop: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  bubble: { maxWidth: '82%', borderRadius: radius.lg, paddingHorizontal: space(4), paddingVertical: space(3), gap: space(2) },
  mine: { alignSelf: 'flex-end', maxWidth: '86%' },
  theirsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space(2) },
  theirs: { flexShrink: 1 },
  avatar: { width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  struck: { textDecorationLine: 'line-through', opacity: 0.6 },
  composerWrap: {
    padding: space(3),
    gap: space(2),
    borderTopWidth: stroke,
    maxWidth: MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
  },
  chips: { gap: space(2), alignItems: 'center', paddingRight: space(4) },
  diff: { borderWidth: stroke, borderRadius: radius.md, padding: space(3), gap: space(2) },
});
