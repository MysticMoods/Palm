import { useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';

export interface VirtualRange {
  start: number;
  end: number;
  paddingTop: number;
  totalHeight: number;
}

/**
 * Fixed-height row virtualisation.
 *
 * Large folders (and long terminal scrollback) would otherwise put thousands
 * of DOM nodes on screen. Below `threshold` items everything renders normally,
 * so small folders keep native find-in-page and scroll anchoring.
 */
export function useVirtualRows(
  containerRef: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  options: { overscan?: number; threshold?: number } = {},
): VirtualRange {
  const { overscan = 8, threshold = 120 } = options;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const onScroll = () => setScrollTop(element.scrollTop);
    element.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height));
    observer.observe(element);
    setViewportHeight(element.clientHeight);

    return () => {
      element.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [containerRef]);

  return useMemo(() => {
    const totalHeight = count * rowHeight;
    if (count <= threshold || viewportHeight === 0) {
      return { start: 0, end: count, paddingTop: 0, totalHeight };
    }
    const visible = Math.ceil(viewportHeight / rowHeight);
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(count, start + visible + overscan * 2);
    return { start, end, paddingTop: start * rowHeight, totalHeight };
  }, [count, rowHeight, scrollTop, viewportHeight, overscan, threshold]);
}
