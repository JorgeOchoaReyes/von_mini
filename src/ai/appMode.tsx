/**
 * Where one app's own AI runs: its AI buttons, voice chat and custom-HTML AI calls.
 *
 *   auto    hybrid, like the rest of von mini: Gemini Nano when this device has it, else the cloud
 *   device  Gemini Nano only (private, offline; needs a device with Nano)
 *   cloud   Gemini in the cloud only (bigger model; needs a connection)
 *
 * Von mini's own Private mode (and being offline) still wins: nothing goes to the cloud then.
 * The app screen provides the app's choice; the components that run its AI read it here.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useAI } from './AIContext';
export { appModeProblem } from './hybrid';

export type AppAiMode = 'auto' | 'device' | 'cloud';

export const APP_AI_MODES: { value: AppAiMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'device', label: 'On-device' },
  { value: 'cloud', label: 'Cloud' },
];

const Ctx = createContext<AppAiMode>('auto');

export function AppAiModeProvider({ mode, children }: { mode: AppAiMode | undefined; children: ReactNode }) {
  return <Ctx.Provider value={mode ?? 'auto'}>{children}</Ctx.Provider>;
}

/** The AI context for code running inside an app: von mini's state plus this app's choice. */
export function useAppAI() {
  const ai = useAI();
  const appMode = useContext(Ctx);
  return useMemo(() => ({ ...ai, appMode }), [ai, appMode]);
}
