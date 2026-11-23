/**
 * Haptic feedback, safe to call on every platform.
 *
 * On Android and iOS this is real tactile feedback; on web `expo-haptics` maps to the Vibration
 * API and silently does nothing when the browser has no vibrator, so no platform check is needed
 * and no call can throw into a render path.
 */
import * as Haptics from 'expo-haptics';

const fire = (p: Promise<void>) => {
  p.catch(() => {});
};

export const haptics = {
  /** Selection changed (chip, tab, toggle). */
  tap: () => fire(Haptics.selectionAsync()),
  /** Light impact (button press). */
  light: () => fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Medium impact (something meaningful happened). */
  medium: () => fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Completed successfully (app built, change applied). */
  success: () => fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Failed (generation error). */
  error: () => fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
