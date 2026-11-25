/**
 * Which apps work offline. Everything an app does runs on the phone except its AI: games,
 * trackers, checklists, stats and history never need the internet. AI buttons and voice chats
 * need a model, which is offline only where Gemini Nano is on the device.
 */
import type { AppSpec } from './types';

export type OfflineLevel = 'always' | 'with-nano';

export function offlineLevel(spec: AppSpec, hasCustomHtml = false): OfflineLevel {
  // A custom (code) app calls the AI through the bridge, so it counts as an AI app.
  return hasCustomHtml || spec.components.some((c) => c.type === 'ai' || c.type === 'voice') ? 'with-nano' : 'always';
}

/** A short label for this device: whether the app works offline here. */
export function offlineLabel(level: OfflineLevel, deviceHasNano: boolean): { text: string; offline: boolean } {
  if (level === 'always') return { text: 'Works offline', offline: true };
  return deviceHasNano ? { text: 'Works offline (Nano)', offline: true } : { text: 'AI needs internet here', offline: false };
}
