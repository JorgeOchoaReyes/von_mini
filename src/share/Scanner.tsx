/**
 * Scan a shared app's QR code with the camera. A von mini code opens its preview right away;
 * anything else gets a short note and scanning carries on. Works offline: the code carries the app.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../ui/components';
import { haptics } from '../ui/haptics';
import { radius, space, type, type Theme } from '../ui/theme';
import { decodeApp, findCode, findLegacyShareId } from './code';

/**
 * Whether this platform can scan: phones always; browsers that can open a camera (expo-camera
 * brings a barcode-detector polyfill where the browser has none, e.g. Safari and Firefox).
 */
export const canScan =
  Platform.OS !== 'web' || (typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);

/** What a scanned QR code can open: a share code (the app itself) or an older Firestore link id. */
export type ScanTarget = { code: string } | { legacyId: string };

export function Scanner({
  visible,
  onClose,
  onScan,
  theme,
}: {
  visible: boolean;
  onClose(): void;
  /** Called once with what the QR code opens. The scanner closes itself first. */
  onScan(target: ScanTarget): void;
  theme: Theme;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [note, setNote] = useState<string | null>(null);
  // The camera reports the same code many times a second; act on the first good one only, and
  // react to each bad one once (a Set, so two foreign codes in view don't buzz back and forth).
  const done = useRef(false);
  const bad = useRef(new Set<string>());
  const found = useRef<ScanTarget | null>(null);

  // The permission may change outside the app (phone settings): read it again whenever the
  // scanner opens and whenever the app comes back to the foreground while it's open.
  useEffect(() => {
    if (!visible) return;
    void getPermission();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void getPermission();
    });
    return () => sub.remove();
  }, [visible, getPermission]);

  const reset = () => {
    done.current = false;
    found.current = null;
    bad.current = new Set();
    setNote(null);
  };

  const reject = (data: string, message: string) => {
    bad.current.add(data);
    haptics.error();
    setNote(message);
  };

  const onScanned = ({ data }: { data: string }) => {
    if (done.current || bad.current.has(data)) return;
    const code = findCode(data);
    if (code) {
      try {
        decodeApp(code);
      } catch (e) {
        return reject(data, e instanceof Error ? e.message : String(e));
      }
      found.current = { code };
    } else {
      const legacyId = findLegacyShareId(data);
      if (!legacyId) return reject(data, 'That QR code isn’t a von mini app. Try another.');
      found.current = { legacyId };
    }
    done.current = true;
    haptics.success();
    // Close first; the parent navigates once this modal is fully gone (see onDismiss / below), so
    // two modals never close in the same instant (that can leave one stuck on iOS).
    onClose();
    if (Platform.OS !== 'ios') hand();
  };

  /** Hands the scanned target over once the scanner is closed. */
  const hand = () => {
    const target = found.current;
    found.current = null;
    if (target) onScan(target);
  };

  const close = () => {
    reset();
    onClose();
  };

  const ask = async () => {
    const r = await requestPermission();
    if (!r.granted && Platform.OS === 'web') setNote('The browser blocked the camera. Allow it in this site’s settings (the icon next to the address), then try again.');
  };

  const granted = permission?.granted;
  // Browsers always report "can ask again", so a blocked camera on the web is just "denied".
  const blocked = permission && !permission.granted && (Platform.OS === 'web' ? permission.status === 'denied' : !permission.canAskAgain);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={close}
      presentationStyle="fullScreen"
      onShow={reset}
      // iOS: navigate only once the scanner is fully dismissed.
      onDismiss={hand}
    >
      <View style={[styles.screen, { paddingTop: insets.top + space(2), paddingBottom: insets.bottom + space(4) }]}>
        <View style={styles.header}>
          <Text style={[type.headline, { color: '#FFFFFF', flex: 1 }]}>Scan a shared app</Text>
          <IconButton icon="close" label="Close scanner" theme={theme} onPress={close} color="#FFFFFF" />
        </View>

        {granted ? (
          <View style={styles.stage}>
            {visible && (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onScanned}
              />
            )}
            {/* A frame to aim with. */}
            <View pointerEvents="none" style={styles.frameWrap}>
              <View style={[styles.frame, { borderColor: theme.accent }]} />
            </View>
          </View>
        ) : (
          <View style={[styles.stage, styles.ask]}>
            <Text style={[type.title, { color: '#FFFFFF', textAlign: 'center' }]}>Allow the camera</Text>
            <Text style={[type.body, { color: '#D9D9E3', textAlign: 'center' }]}>
              The camera is only used to read QR codes of apps people share with you. Nothing is recorded or sent.
            </Text>
            {blocked && Platform.OS !== 'web' ? (
              <Button label="Open phone settings" icon="settings-outline" theme={theme} onPress={() => void Linking.openSettings()} />
            ) : (
              <Button label="Allow camera" icon="camera-outline" theme={theme} onPress={() => void ask()} />
            )}
          </View>
        )}

        <Text style={[type.body, styles.hint]}>
          {note ??
            (blocked && Platform.OS === 'web'
              ? 'The browser blocked the camera. Allow it in this site’s settings, then try again.'
              : 'Point at the QR code from “Share” in someone’s von mini app.')}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0B12', paddingHorizontal: space(4), gap: space(4) },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  stage: { flex: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000000' },
  ask: { alignItems: 'center', justifyContent: 'center', gap: space(4), padding: space(6) },
  frameWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '70%', aspectRatio: 1, borderWidth: 4, borderRadius: radius.xl },
  hint: { color: '#FFFFFF', textAlign: 'center' },
});
