/**
 * The Chat tab: start a conversation (type or talk), and come back to past ones. Conversations
 * save themselves as they happen.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteConversation, listConversations, type Conversation } from '../../chat/conversations';
import { MIC_OVERHANG } from '../../ui/BottomBar';
import { Button, Card, EmptyState, Icon, relativeTime } from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { FadeUp } from '../../ui/motion';
import { OfflineBadge } from '../../ui/OfflineBadge';
import { MAX_WIDTH, radius, space, stroke, type, useTheme } from '../../ui/theme';

// The Chat tab is an AI feature: it shows where that AI runs, like any other app.
const CHAT_SPEC = { name: 'Chat', emoji: '💬', accent: 'blue' as const, description: '', components: [{ type: 'voice' as const }] };

export default function ChatTab() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Conversation[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      void listConversations().then(setList);
    }, []),
  );

  const remove = (c: Conversation) => {
    const go = async () => {
      await deleteConversation(c.id);
      setList(await listConversations());
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete “${c.title}”?`)) void go();
      return;
    }
    Alert.alert('Delete this chat?', c.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void go() },
    ]);
  };

  const open = (id: string) => router.push({ pathname: '/chat/[id]', params: { id } });

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[styles.page, { paddingTop: (Platform.OS === 'web' ? 0 : insets.top) + space(4) }]}
    >
      <Text style={[type.display, { color: theme.text }]}>Chat</Text>
      <Card theme={theme} style={{ gap: space(3) }}>
        <Text style={[type.body, { color: theme.muted }]}>Ask anything. Type, or tap the mic and talk: replies are read aloud.</Text>
        <OfflineBadge spec={CHAT_SPEC} />
        <Button label="New chat" icon="chatbubbles-outline" theme={theme} onPress={() => open('new')} />
      </Card>

      <Text style={[type.overline, { color: theme.text }]}>YOUR CHATS</Text>
      {list === null ? null : list.length === 0 ? (
        <EmptyState icon="chatbubbles-outline" title="No chats yet" body="Your conversations are saved here, on this phone." theme={theme} />
      ) : (
        list.map((c, i) => {
          const last = [...c.turns].reverse().find((t) => t.role === 'assistant' && !t.error && t.text !== '(stopped)')?.text ?? '';
          return (
            <FadeUp key={c.id} delay={Math.min(i * 30, 200)}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open chat: ${c.title}`}
                accessibilityHint="Long-press to delete"
                onPress={() => {
                  haptics.tap();
                  open(c.id);
                }}
                onLongPress={() => {
                  haptics.medium();
                  remove(c);
                }}
                style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <View style={[styles.icon, { backgroundColor: theme.accentSoft }]}>
                  <Icon name="chatbubble-ellipses-outline" size={18} color={theme.accent} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[type.label, { color: theme.text }]} numberOfLines={1}>
                    {c.title}
                  </Text>
                  <Text style={[type.caption, { color: theme.muted }]} numberOfLines={1}>
                    {last.replace(/\s+/g, ' ') || '…'}
                  </Text>
                </View>
                <Text style={[type.caption, { color: theme.subtle }]}>{relativeTime(c.updatedAt)}</Text>
              </Pressable>
            </FadeUp>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space(4), paddingBottom: MIC_OVERHANG + space(8), gap: space(4), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3), borderWidth: stroke, borderRadius: radius.lg },
  icon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
