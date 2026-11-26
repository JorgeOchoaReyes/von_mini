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

import { getVoiceSettings } from './voiceSettings';

let muted = false;
/**
 * Bumped by every stop. A queued sentence only plays if nothing was stopped since its reply
 * began, so Stop, mute or leaving a screen silences the rest of a reply, not just one sentence.
 */
let epoch = 0;
/** Mutes all speech output (the transcript still updates). */
export function setMuted(v: boolean) {
  muted = v;
  if (v) stopSpeaking();
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

/**
 * Speaks one utterance and resolves when it has finished (or was stopped / failed). Uses the
 * voice, speed and pitch chosen in Settings; `force` speaks even when muted (a Settings preview).
 */
export function speak(text: string, force = false): Promise<void> {
  const clean = forSpeech(text);
  if (!clean || (muted && !force)) return Promise.resolve();
  const { rate, pitch } = getVoiceSettings();
  // A saved voice the phone no longer has (deleted, or settings from another phone) would make
  // iOS fail silently on every sentence: fall back to the default voice.
  let voice = getVoiceSettings().voice;
  if (voice && known && !known.has(voice)) voice = undefined;
  if (!known) void listVoices();
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
    const guard = setTimeout(finish, 2500 + (clean.split(/\s+/).length * 550) / rate);
    Speech.speak(clean, {
      language: voice ? undefined : 'en-US',
      voice: voice ?? localWebVoice(),
      rate,
      pitch,
      onDone: finish,
      onStopped: finish,
      onError: finish,
    });
  });
}

/** Ids of the voices the device has, once read. */
let known: Set<string> | null = null;

/** The device's installed voices, best first: offline ones before ones that need the internet. */
export async function listVoices(): Promise<{ id: string; label: string; language: string; offline: boolean; enhanced: boolean }[]> {
  let voices: Speech.Voice[] = [];
  try {
    voices = await Speech.getAvailableVoicesAsync();
  } catch {
    return [];
  }
  // Browsers fill their list lazily; only trust a non-empty one.
  if (voices.length) known = new Set(voices.map((v) => v.identifier));
  const lang = (Intl.DateTimeFormat().resolvedOptions().locale || 'en').slice(0, 2).toLowerCase();
  const seen = new Set<string>();
  const out = voices
    .filter((v) => {
      const l = (v.language || '').toLowerCase();
      return (l.startsWith('en') || l.startsWith(lang)) && !seen.has(v.identifier) && seen.add(v.identifier);
    })
    .map((v) => {
      // Android names voices like "en-us-x-tpf-local"; web and iOS give readable names.
      const network = /network|online/i.test(v.identifier + v.name);
      const local = (v as Speech.Voice & { localService?: boolean }).localService;
      const offline = Platform.OS === 'web' ? local !== false && !/google|online|natural/i.test(v.name) : !network;
      return { id: v.identifier, label: v.name, language: v.language, offline, enhanced: v.quality === Speech.VoiceQuality.Enhanced };
    });
  // Give cryptic Android names a friendly label: "English (US) 3".
  const counts: Record<string, number> = {};
  for (const v of out) {
    if (/^[a-z]{2,3}-[a-z]{2}-x-/i.test(v.label)) {
      const key = v.language;
      counts[key] = (counts[key] ?? 0) + 1;
      let region = v.language;
      try {
        region = new Intl.DisplayNames(['en'], { type: 'language' }).of(v.language.replace('_', '-')) ?? v.language;
      } catch {
        // Older engines without Intl.DisplayNames keep the code.
      }
      v.label = `${region} ${counts[key]}`;
    }
  }
  return out.sort((a, b) => Number(b.offline) - Number(a.offline) || Number(b.enhanced) - Number(a.enhanced) || a.label.localeCompare(b.label));
}

export function stopSpeaking() {
  epoch++;
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
  private readonly epoch = epoch;

  /** Stopped directly, or by any stopSpeaking() since this reply began. */
  get isStopped() {
    return this.stopped || this.epoch !== epoch;
  }

  update(text: string) {
    if (this.isStopped || text.length <= this.spoken) return;
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
    if (!this.isStopped && text.length > this.spoken) this.enqueue(text.slice(this.spoken));
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
    this.tail = this.tail.then(() => (this.isStopped ? undefined : speak(chunk)));
  }
}
