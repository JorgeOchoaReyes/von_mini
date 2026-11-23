import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { useAI } from '../ai/AIContext';
import type { AppSpec } from '../spec/types';
import { listMessages, type ChatMessage } from '../storage/store';
import { Chip, Composer, Icon, SourceBadge, type IconName } from '../ui/components';
import { MAX_WIDTH, radius, space, type, useTheme, type Theme } from '../ui/theme';
import { isBusy, sendMessage, undoEdit, useChatVersion } from './chatJobs';

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

  const local = ai.privateMode || !ai.online;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
              Ask how it works or describe a change. Changes apply right away and you can undo them.
            </Text>
            <View style={styles.row}>
              <Icon name={local ? 'lock-closed-outline' : 'phone-portrait-outline'} size={14} color={theme.success} />
              <Text style={[type.caption, { color: theme.muted }]}>{local ? 'Runs on this device only' : 'Runs on-device first'}</Text>
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
              <View key={m.id} style={[styles.bubble, styles.mine, { backgroundColor: theme.accent }]}>
                <Text selectable style={[type.body, { color: theme.onAccent }]}>{m.text}</Text>
              </View>
            );
          }
          const isEdit = m.kind === 'edit';
          const isError = m.kind === 'error';
          return (
            <View key={m.id} style={styles.theirsRow}>
              <Avatar emoji={spec.emoji} theme={theme} />
              <View
                style={[
                  styles.bubble,
                  styles.theirs,
                  { backgroundColor: theme.surface, borderColor: isError ? theme.danger : theme.border },
                ]}
              >
                {isEdit && (
                  <View style={styles.row}>
                    <Icon name={m.undone ? 'arrow-undo' : 'checkmark-circle'} size={16} color={m.undone ? theme.subtle : theme.success} />
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
            </View>
          );
        })}

        {busy && (
          <View style={styles.theirsRow}>
            <Avatar emoji={spec.emoji} theme={theme} />
            <View style={[styles.bubble, styles.theirs, styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={[type.caption, { color: theme.muted }]}>{local ? 'Thinking on this device…' : 'Thinking…'}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.composerWrap, { borderColor: theme.border, backgroundColor: theme.bg }]}>
        <Composer value={draft} onChange={setDraft} onSubmit={() => send(draft)} placeholder="Ask or describe a change…" theme={theme} busy={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  list: { padding: space(4), gap: space(3), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center', flexGrow: 1 },
  intro: { alignItems: 'center', gap: space(3), paddingVertical: space(6), paddingHorizontal: space(2) },
  introIcon: { width: 64, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), justifyContent: 'center', marginTop: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  bubble: { maxWidth: '82%', borderRadius: radius.lg, paddingHorizontal: space(4), paddingVertical: space(3), gap: space(2) },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: radius.sm },
  theirsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space(2) },
  theirs: { borderWidth: 1, borderBottomLeftRadius: radius.sm, flexShrink: 1 },
  avatar: { width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  struck: { textDecorationLine: 'line-through', opacity: 0.6 },
  composerWrap: { padding: space(3), borderTopWidth: StyleSheet.hairlineWidth, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
});
