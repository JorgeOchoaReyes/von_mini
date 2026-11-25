/**
 * Speech-to-text on Android / iOS through the platform recognizer (expo-speech-recognition).
 * Web uses `stt.web.ts`, which talks to Chrome's Web Speech API directly.
 *
 * Recognition is asked to stay on the device whenever the phone supports it, so a voice chat
 * keeps working offline and the user's voice never leaves the phone.
 */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import type { Listening, ListenOptions, SttSupport } from './types';

export async function sttSupport(): Promise<SttSupport> {
  try {
    const available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
    return { available, onDevice: available && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition() };
  } catch {
    return { available: false, onDevice: false };
  }
}

export function listen({ onPartial, lang = 'en-US', offline }: ListenOptions): Listening {
  let text = '';
  const subs: { remove(): void }[] = [];
  const cleanup = () => subs.splice(0).forEach((s) => s.remove());

  const done = new Promise<string>((resolve, reject) => {
    void (async () => {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        reject(new Error('Microphone permission is needed to talk. You can still type.'));
        return;
      }
      const onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
      if (offline && !onDevice) {
        reject(new Error('Offline speech recognition is not available on this phone. Type instead, or go online.'));
        return;
      }
      subs.push(
        ExpoSpeechRecognitionModule.addListener('result', (e) => {
          text = e.results[0]?.transcript ?? text;
          onPartial?.(text);
        }),
        ExpoSpeechRecognitionModule.addListener('error', (e) => {
          cleanup();
          // Silence is not a failure: it just means there is nothing to send.
          if (e.error === 'no-speech' || e.error === 'speech-timeout' || e.error === 'aborted') resolve(text.trim());
          else reject(new Error(friendly(e.error, e.message)));
        }),
        ExpoSpeechRecognitionModule.addListener('end', () => {
          cleanup();
          resolve(text.trim());
        }),
      );
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        // Keep audio on the phone whenever it can be done there.
        requiresOnDeviceRecognition: onDevice,
      });
    })().catch((e: unknown) => {
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });

  return { done, stop: () => ExpoSpeechRecognitionModule.stop() };
}

function friendly(code: string, message: string) {
  if (code === 'not-allowed') return 'Microphone permission is needed to talk. You can still type.';
  if (code === 'network') return 'Speech recognition needs a connection on this phone. Type instead, or go online.';
  if (code === 'language-not-supported') return 'The English speech model is not installed on this phone yet.';
  return message || 'Could not hear that. Try again, or type instead.';
}
