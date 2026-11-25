/**
 * "Add a shared app": paste a share link, a code, or the whole message someone sent, and open the
 * app's preview to add a copy. Works offline, since the code carries the whole design.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../ui/components';
import { haptics } from '../ui/haptics';
import { radius, space, stroke, type, type Theme } from '../ui/theme';
import { decodeApp, findCode, findLegacyShareId } from './code';
import { canScan, Scanner, type ScanTarget } from './Scanner';

export function AddShared({ visible, onClose, theme }: { visible: boolean; onClose(): void; theme: Theme }) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  /** Opens a shared app's preview: from its share code, or an older link's id (loaded from Firestore). */
  const openTarget = (target: ScanTarget) => {
    setText('');
    setError(null);
    onClose();
    router.push({ pathname: '/s/[id]', params: { id: 'code' in target ? target.code : target.legacyId } });
  };

  const open = () => {
    const code = findCode(text);
    if (!code) {
      const legacyId = findLegacyShareId(text);
      if (legacyId) return openTarget({ legacyId });
    }
    try {
      decodeApp(text); // check it before leaving, so a bad paste gets an answer right here
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    openTarget({ code: code! });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: theme.bg, borderColor: theme.border, paddingBottom: insets.bottom + space(4) }]}>
        <View style={styles.header}>
          <Text style={[type.headline, { color: theme.text, flex: 1 }]}>Add a shared app</Text>
          <IconButton icon="close" label="Close" theme={theme} onPress={onClose} />
        </View>
        {canScan && (
          <>
            <Button label="Scan a QR code" icon="scan-outline" theme={theme} onPress={() => setScanning(true)} />
            <Text style={[type.caption, { color: theme.subtle, textAlign: 'center' }]}>or</Text>
          </>
        )}
        <Text style={[type.caption, { color: theme.muted }]}>
          Paste the link or message someone sent you. You get your own copy; nothing of theirs but the design comes with it.
        </Text>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            setError(null);
          }}
          placeholder="vonmini://s/VM1.…"
          placeholderTextColor={theme.subtle}
          accessibilityLabel="Share link or code"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={[type.body, styles.input, { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
        />
        {error && <Text style={[type.caption, { color: theme.danger }]}>{error}</Text>}
        <Button label="Open" icon="arrow-forward" variant={canScan ? 'secondary' : 'primary'} theme={theme} disabled={!text.trim()} onPress={open} />
      </View>
      {canScan && <Scanner visible={scanning} onClose={() => setScanning(false)} onScan={openTarget} theme={theme} />}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: stroke, padding: space(5), gap: space(3), maxWidth: 560, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  input: { minHeight: 96, maxHeight: 180, borderWidth: stroke, borderRadius: radius.md, padding: space(3), textAlignVertical: 'top' },
});
