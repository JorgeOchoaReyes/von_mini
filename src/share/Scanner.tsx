/**
 * Scan a shared app's QR code with the camera. A von mini code opens its preview right away;
 * anything else gets a short note and scanning carries on. Works offline: the code carries the app.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Linking, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../ui/components';
import { haptics } from '../ui/haptics';
import { radius, space, type, type Theme } from '../ui/theme';
import { decodeApp, findCode } from './code';

/** Whether this platform can scan: phones always; browsers only with the Barcode Detection API. */
export const canScan = Platform.OS !== 'web' || (typeof window !== 'undefined' && 'BarcodeDetector' in window);

export function Scanner({
  visible,
  onClose,
  onCode,
  theme,
}: {
  visible: boolean;
  onClose(): void;
  /** Called once with a valid share code. */
  onCode(code: string): void;
  theme: Theme;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [note, setNote] = useState<string | null>(null);
  // The camera reports the same code many times a second; act on the first good one only.
  const done = useRef(false);
  const lastBad = useRef('');

  const onScanned = ({ data }: { data: string }) => {
    if (done.current) return;
    const code = findCode(data);
    if (!code) {
      if (lastBad.current !== data) {
        lastBad.current = data;
        haptics.error();
        setNote('That QR code isn’t a von mini app. Try another.');
      }
      return;
    }
    try {
      decodeApp(code);
    } catch (e) {
      if (lastBad.current !== data) {
        lastBad.current = data;
        haptics.error();
        setNote(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    done.current = true;
    haptics.success();
    onCode(code);
  };

  const close = () => {
    done.current = false;
    lastBad.current = '';
    setNote(null);
    onClose();
  };

  const granted = permission?.granted;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="fullScreen" onShow={() => {
        done.current = false;
      }}>
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
            {permission && !permission.canAskAgain ? (
              <Button label="Open phone settings" icon="settings-outline" theme={theme} onPress={() => void Linking.openSettings()} />
            ) : (
              <Button label="Allow camera" icon="camera-outline" theme={theme} onPress={() => void requestPermission()} />
            )}
          </View>
        )}

        <Text style={[type.body, styles.hint]}>
          {note ?? 'Point at the QR code from “Share” in someone’s von mini app.'}
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
