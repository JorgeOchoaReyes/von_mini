/**
 * Picks the AI engine at runtime.
 *
 * Normally this is the real Firebase AI Logic engine (native on Android, `firebase/ai` on web).
 * A development-only mock can be enabled with `EXPO_PUBLIC_MOCK_ENGINE=true` so the build/edit
 * flows can be exercised — and screenshotted — on machines without Gemini Nano. It is never on
 * by default and never runs in a release build (see `mockEngine.ts`).
 */
import { engine as platformEngine } from './engine';
import { mockEngine, mockEnabled } from './mockEngine';
import type { AIEngine } from './types';

export const engine: AIEngine = mockEnabled ? mockEngine : platformEngine;
