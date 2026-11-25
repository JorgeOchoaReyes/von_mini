/**
 * Sharing an app as a QR code or a link. Both carry the whole design as a share code (see
 * code.ts), so it works offline, phone to phone, with no account or server. Only the design is
 * shared: never entries, chats or anything typed into the app.
 */
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppSpec } from '../spec/types';
import { Button, Icon, IconButton } from '../ui/components';
import { haptics } from '../ui/haptics';
import { QRCode } from '../ui/QRCode';
import { radius, space, stroke, type, type Theme } from '../ui/theme';
import { encodeApp, MAX_QR_CODE } from './code';
import { shareUrl } from './share';

export function ShareSheet({
  visible,
  onClose,
  spec,
  request,
  theme,
}: {
  visible: boolean;
  onClose(): void;
  spec: AppSpec;
  request: string;
  theme: Theme;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [copied, setCopied] = useState(false);
  const code = useMemo(() => (visible ? encodeApp(spec) : ''), [visible, spec]);
  const url = code ? shareUrl(code) : '';
  const fitsQr = code.length <= MAX_QR_CODE;
  const qrSize = Math.min(width - space(12), 360);
  const message = `${spec.emoji} ${spec.name}, made with von mini. Open this link, or paste it into von mini (Home > Add a shared app) to add your own copy: ${url}`;

  const shareLink = async () => {
    haptics.light();
    if (Platform.OS === 'web') {
      const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
      if (nav.share) await nav.share({ title: spec.name, text: message }).catch(() => undefined);
      else await copy();
      return;
    }
    await Share.share({ message }).catch(() => undefined);
  };

  /** Copies the link (web only; on phones the share sheet has "Copy"). */
  const copy = async () => {
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(true);
    haptics.success();
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close sharing" />
      <View style={[styles.sheet, { backgroundColor: theme.bg, borderColor: theme.border, paddingBottom: insets.bottom + space(4) }]}>
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.header}>
            <Text style={[type.headline, { color: theme.text, flex: 1 }]} numberOfLines={1}>
              Share {spec.emoji} {spec.name}
            </Text>
            <IconButton icon="close" label="Close" theme={theme} onPress={onClose} />
          </View>
          {fitsQr ? (
            <View style={[styles.qrFrame, { borderColor: theme.border }]}>
              <QRCode value={url} size={qrSize} label={`QR code for ${spec.name}`} />
            </View>
          ) : (
            <Text style={[type.caption, { color: theme.muted, textAlign: 'center' }]}>
              This app is too big for a QR code. Share the link instead.
            </Text>
          )}
          <Text style={[type.caption, { color: theme.muted, textAlign: 'center' }]}>
            Scan with von mini, or send the link. It carries the whole app, so it works offline and needs no account.
          </Text>
          <View style={[styles.note, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
            <Icon name="lock-closed-outline" size={16} color={theme.success} />
            <Text style={[type.caption, { color: theme.text, flex: 1 }]}>
              Only the design is shared. Your entries, scores and chats stay on this phone.
            </Text>
          </View>
          <Button label="Share link" icon="share-social-outline" theme={theme} onPress={shareLink} />
          {/* Phones copy from the share sheet; the web has no share sheet everywhere, so copy directly. */}
          {Platform.OS === 'web' && (
            <Button label={copied ? 'Copied!' : 'Copy link'} icon={copied ? 'checkmark' : 'copy-outline'} variant="secondary" theme={theme} onPress={copy} />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: stroke, maxHeight: '92%' },
  body: { padding: space(5), gap: space(4), alignItems: 'stretch', maxWidth: 480, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  qrFrame: { alignSelf: 'center', padding: space(2), backgroundColor: '#FFFFFF', borderWidth: stroke, borderRadius: radius.lg },
  note: { flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(3), borderRadius: radius.md, borderWidth: stroke },
});
