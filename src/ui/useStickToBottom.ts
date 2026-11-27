/**
 * Keeps a chat's ScrollView on its newest message: it opens at the bottom (no animated trip down
 * from the top), and stays there as messages arrive, replies stream in or the keyboard resizes it.
 */
import { useCallback, useRef, type RefObject } from 'react';

/** Anything that can scroll to its end (a ScrollView instance). */
type Scrollable = { scrollToEnd(options?: { animated?: boolean }): void };

export function useStickToBottom(scroll: RefObject<Scrollable | null>) {
  /** False until the list has been placed at the bottom once; that first jump isn't animated. */
  const placed = useRef(false);
  const toEnd = useCallback(() => {
    const animated = placed.current;
    placed.current = true;
    scroll.current?.scrollToEnd({ animated });
    // Android can measure content a frame late on first open: settle at the bottom once more.
    if (!animated) requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false }));
  }, [scroll]);
  return { onContentSizeChange: toEnd, onLayout: toEnd };
}
