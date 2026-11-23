import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { useAI } from '../ai/AIContext';
import type { AppSpec } from '../spec/types';
import { listMessages, type ChatMessage } from '../storage/store';
import { Button, SourceBadge } from '../ui/components';
import { radius, space, useTheme } from '../ui/theme';
import { isBusy, sendMessage, undoEdit, useChatVersion } from './chatJobs';

const SUGGESTIONS = ['What does this app do?', 'Add a field for the date', 'Make the AI answers shorter', 'How could I improve it?'];

/** Chat about one app: ask questions or request changes. Changes apply immediately and can be undone. */
export function ChatPanel({ appId, spec, onShowApp }: { appId: string; spec: AppSpec; onShowApp(): void }) {
  const theme = useTheme(spec.accent);
  const ai = useAI();
  const version = useChatVersion();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);
  const busy = isBusy(appId);

  useEffect(() => {
    let alive = true;
    listMessages(appId).then((m) => alive && setMessages(m));
    return () => {
      alive = false;
    };
  }, [appId, version]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    setDraft('');
    // Not awaited: the job keeps running even if this screen closes.
    sendMessage(appId, text, ai);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={{ gap: space(3) }}>
            <Text style={[styles.empty, { color: theme.muted }]}>
              Ask about {spec.emoji} {spec.name}, or tell me what to change. Everything runs{' '}
              {ai.privateMode || !ai.online ? 'on this device' : 'on-device first'}.
            </Text>
            <View style={styles.chips}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} onPress={() => send(s)} style={[styles.chip, { borderColor: theme.border }]}>
                  <Text style={{ color: theme.text, fontSize: 13 }}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {messages.map((m) => {
          const mine = m.role === 'user';
          return (
            <View key={m.id} style={[styles.row, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
              <View
                style={[
                  styles.bubble,
                  mine
                    ? { backgroundColor: theme.accent }
                    : { backgroundColor: theme.card, borderColor: m.kind === 'error' ? theme.danger : theme.border, borderWidth: 1 },
                ]}
              >
                {m.kind === 'edit' && (
                  <Text style={[styles.tag, { color: theme.accent }]}>{m.undone ? '↩︎ Change undone' : '✓ Updated your app'}</Text>
                )}
                <Text
                  selectable
                  style={[
                    styles.text,
                    { color: mine ? '#fff' : m.kind === 'error' ? theme.danger : theme.text },
                    m.undone && { textDecorationLine: 'line-through', opacity: 0.6 },
                  ]}
                >
                  {m.kind === 'edit' ? m.text.split('\n').map((l) => `• ${l}`).join('\n') : m.text}
                </Text>
                {!mine && (m.source || m.kind === 'edit') && (
                  <View style={styles.actions}>
                    {m.source && <SourceBadge source={m.source} />}
                    {m.kind === 'edit' && !m.undone && (
                      <>
                        <Pressable onPress={onShowApp} hitSlop={6}>
                          <Text style={[styles.link, { color: theme.accent }]}>View app</Text>
                        </Pressable>
                        <Pressable onPress={() => undoEdit(appId, m)} hitSlop={6}>
                          <Text style={[styles.link, { color: theme.muted }]}>Undo</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {busy && (
          <View style={[styles.row, { justifyContent: 'flex-start' }]}>
            <View style={[styles.bubble, { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1 }]}>
              <Text style={[styles.text, { color: theme.muted }]}>Thinking on-device…</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.composer, { borderColor: theme.border, backgroundColor: theme.bg }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask or request a change…"
          placeholderTextColor={theme.muted}
          multiline
          onSubmitEditing={() => send(draft)}
          style={[styles.input, { color: theme.text, backgroundColor: theme.input, borderColor: theme.border }]}
        />
        <Button label="Send" theme={theme} onPress={() => send(draft)} disabled={!draft.trim() || busy} style={styles.send} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  list: { padding: space(4), gap: space(3), maxWidth: 760, width: '100%', alignSelf: 'center' },
  empty: { fontSize: 15, lineHeight: 21 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: space(3), paddingVertical: space(2) },
  row: { flexDirection: 'row' },
  bubble: { maxWidth: '85%', borderRadius: radius.lg, paddingHorizontal: space(4), paddingVertical: space(3), gap: space(2) },
  tag: { fontSize: 12, fontWeight: '700' },
  text: { fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space(3), flexWrap: 'wrap' },
  link: { fontSize: 13, fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space(2),
    padding: space(3),
    borderTopWidth: 1,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  input: { flex: 1, maxHeight: 120, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(2), fontSize: 15 },
  send: { minHeight: 44 },
});
