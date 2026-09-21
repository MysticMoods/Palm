import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Calls `handler` when a pointer goes down outside every referenced element.
 * Listens on `pointerdown` so the menu closes before the click lands, which is
 * what makes "click the trigger again to close" behave correctly.
 */
export function useClickOutside(
  refs: Array<RefObject<HTMLElement | null>> | RefObject<HTMLElement | null>,
  handler: (event: PointerEvent) => void,
  active = true,
): void {
  useEffect(() => {
    if (!active) return;
    const list = Array.isArray(refs) ? refs : [refs];

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !target.isConnected) return;
      for (const ref of list) {
        if (ref.current?.contains(target)) return;
      }
      handler(event);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
    // `refs` is a fresh array each render; the ref objects themselves are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handler, active]);
}
