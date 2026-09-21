import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Width of an element, tracked with a ResizeObserver.
 *
 * Applications live inside windows, so a viewport media query is the wrong
 * question — a window can be 400px wide on a 4K display. Layout decisions are
 * therefore made from the app's own width.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>, initial = 0): number {
  const [width, setWidth] = useState(initial);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    setWidth(Math.round(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

/** True once the element is narrower than `breakpoint` (and has been measured). */
export function useIsNarrow(ref: RefObject<HTMLElement | null>, breakpoint = 640): boolean {
  const width = useElementWidth(ref);
  return width > 0 && width < breakpoint;
}
