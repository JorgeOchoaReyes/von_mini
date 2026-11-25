/**
 * Text-to-speech through the platform's own voices (Android TTS, Web Speech synthesis), so
 * speaking works offline wherever the device has a voice installed.
 *
 * Replies are spoken a sentence at a time while the model is still writing: `SentenceSpeaker`
 * takes the growing text of a streamed answer and queues each sentence as soon as it is
 * complete, which is what makes an on-device voice chat feel responsive.
 */
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

let muted = false;
/** Mutes all speech output (the transcript still updates). */
export function setMuted(v: boolean) {
  muted = v;
  if (v) void Speech.stop();
}
export const isMuted = () => muted;

/**
 * On the web, browsers can default to a cloud voice (Chrome's "Google …" voices are streamed).
 * Pick an installed, local English voice instead, so speech is generated on the device.
 */
function localWebVoice(): string | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.speechSynthesis) return undefined;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.localService && /^en(-|_|$)/i.test(v.lang));
  return (voices.find((v) => /en-US/i.test(v.lang)) ?? voices[0])?.voiceURI;
}

/** Speaks one utterance and resolves when it has finished (or was stopped / failed). */
export function speak(text: string): Promise<void> {
  const clean = forSpeech(text);
  if (!clean || muted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve();
    };
    // Some engines (e.g. a browser with no installed voice) never report the end of an
    // utterance. Never let that freeze a conversation: give up after a generous estimate.
    const guard = setTimeout(finish, 2500 + clean.split(/\s+/).length * 550);
    Speech.speak(clean, {
      language: 'en-US',
      voice: localWebVoice(),
      rate: 1.02,
      onDone: finish,
      onStopped: finish,
      onError: finish,
    });
  });
}

export function stopSpeaking() {
  void Speech.stop();
}

/** Strips markdown and list markers that would otherwise be read out literally. */
export function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A sentence ends at . ! ? (optionally followed by quotes/brackets) or a line break. */
const SENTENCE = /[^.!?\n]*(?:[.!?]+["')\]]*(?=\s|$)|\n)/g;

/**
 * Speaks a streamed answer sentence by sentence.
 *
 * Call `update(textSoFar)` with each chunk, then `finish(finalText)`; `finish` resolves once
 * everything queued has been spoken. `stop()` silences it immediately.
 */
export class SentenceSpeaker {
  private spoken = 0;
  private tail: Promise<void> = Promise.resolve();
  private stopped = false;

  update(text: string) {
    if (this.stopped || text.length <= this.spoken) return;
    // Find the end of the last complete sentence in the not-yet-spoken part.
    const rest = text.slice(this.spoken);
    let end = 0;
    let m: RegExpExecArray | null;
    SENTENCE.lastIndex = 0;
    while ((m = SENTENCE.exec(rest)) && m[0]) end = m.index + m[0].length;
    if (!end) return;
    this.enqueue(rest.slice(0, end));
    this.spoken += end;
  }

  finish(text: string): Promise<void> {
    if (!this.stopped && text.length > this.spoken) this.enqueue(text.slice(this.spoken));
    this.spoken = text.length;
    return this.tail;
  }

  stop() {
    this.stopped = true;
    stopSpeaking();
  }

  private enqueue(chunk: string) {
    if (!forSpeech(chunk)) return;
    // Chain so sentences never overlap and `finish` can wait for the last one.
    this.tail = this.tail.then(() => (this.stopped ? undefined : speak(chunk)));
  }
}
