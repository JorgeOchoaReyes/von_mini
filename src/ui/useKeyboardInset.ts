/**
 * How much of a view the on-screen keyboard covers, so the view can pad its bottom by that much.
 *
 * Android apps now draw edge-to-edge (Expo SDK 58), and in that mode the window is no longer
 * resized when the keyboard opens, so `KeyboardAvoidingView` without a behaviour does nothing and
 * text boxes at the bottom end up under the keyboard. This measures the view against the
 * keyboard's top edge on every platform instead. JS-only, so it ships over the air.
 */
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Platform, type View } from 'react-native';

export function useKeyboardInset() {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      const keyboardTop = e.endCoordinates.screenY;
      ref.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => setInset(Math.max(0, Math.round(y + h - keyboardTop))));
    });
    const hide = Keyboard.addListener(hideEvent, () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return { ref, inset };
}
