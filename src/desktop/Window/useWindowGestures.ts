/**
 * Pointer-driven move and resize for windows.
 *
 * While a gesture is in flight the element's geometry is written straight to
 * the DOM and the store is left alone; committing on every pointermove would
 * re-render every window in the stack at 120 Hz. The store is updated once, on
 * release.
 */

import { useCallback, useRef } from 'react';
import { clamp } from '../../utils/misc';
import { constrainToArea, snapRect, zoneForPointer } from '../../core/window-manager/snap';
import { useWindowStore } from '../../core/window-manager/store';
import type { Rect, SnapZone, WindowState } from '../../core/window-manager/types';
import { getSettings } from '../../core/settings/store';

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface GestureRefs {
  element: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  startRect: Rect;
  zone: SnapZone | null;
  moved: boolean;
}

function applyRect(element: HTMLElement, rect: Rect) {
  element.style.transform = `translate3d(${Math.round(rect.x)}px, ${Math.round(rect.y)}px, 0)`;
  element.style.width = `${Math.round(rect.width)}px`;
  element.style.height = `${Math.round(rect.height)}px`;
}

export interface WindowGestures {
  onTitleBarPointerDown: (event: React.PointerEvent) => void;
  startResize: (edge: ResizeEdge) => (event: React.PointerEvent) => void;
}

export function useWindowGestures(
  win: WindowState,
  elementRef: React.RefObject<HTMLElement | null>,
): WindowGestures {
  const gesture = useRef<GestureRefs | null>(null);

  const onTitleBarPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Ignore secondary buttons and clicks that land on the window controls.
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest('[data-window-control]')) return;

      const element = elementRef.current;
      if (!element) return;

      const store = useWindowStore.getState();
      store.focus(win.id);

      const area = store.workArea;
      const current = win.bounds;
      let startRect = current;

      // Dragging a maximised or snapped window pops it back to its restore
      // size, keeping the pointer at the same relative spot on the title bar.
      if (win.mode === 'maximized' || win.mode === 'snapped') {
        const restore = win.restoreBounds ?? { ...current, width: 860, height: 560 };
        const ratio = current.width > 0 ? (event.clientX - current.x) / current.width : 0.5;
        startRect = {
          width: restore.width,
          height: restore.height,
          x: event.clientX - restore.width * ratio,
          y: Math.max(area.y, event.clientY - 18),
        };
        applyRect(element, startRect);
      }

      gesture.current = {
        element,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startRect,
        zone: null,
        moved: false,
      };

      element.setPointerCapture(event.pointerId);
      element.style.transition = 'none';
      document.body.style.cursor = 'grabbing';

      const snapEnabled = getSettings().snapAssist;

      const onMove = (moveEvent: PointerEvent) => {
        const state = gesture.current;
        if (!state || moveEvent.pointerId !== state.pointerId) return;

        const dx = moveEvent.clientX - state.startX;
        const dy = moveEvent.clientY - state.startY;
        if (!state.moved && Math.hypot(dx, dy) < 3) return;
        state.moved = true;

        const next = constrainToArea(
          { ...state.startRect, x: state.startRect.x + dx, y: state.startRect.y + dy },
          useWindowStore.getState().workArea,
        );
        applyRect(state.element, next);
        state.startRect = { ...state.startRect };

        if (snapEnabled) {
          const zone = zoneForPointer(
            moveEvent.clientX,
            moveEvent.clientY,
            useWindowStore.getState().workArea,
          );
          if (zone !== state.zone) {
            state.zone = zone;
            useWindowStore
              .getState()
              .setSnapPreview(
                zone ? { zone, rect: snapRect(zone, useWindowStore.getState().workArea) } : null,
              );
          }
        }
      };

      const finish = (upEvent: PointerEvent) => {
        const state = gesture.current;
        if (!state || upEvent.pointerId !== state.pointerId) return;
        gesture.current = null;

        state.element.releasePointerCapture?.(upEvent.pointerId);
        state.element.style.transition = '';
        document.body.style.cursor = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);

        const manager = useWindowStore.getState();
        manager.setSnapPreview(null);

        if (!state.moved) return;

        if (state.zone) {
          manager.snapTo(win.id, state.zone);
          return;
        }

        const rect = state.element.getBoundingClientRect();
        manager.setBounds(win.id, {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [win.id, win.bounds, win.mode, win.restoreBounds, elementRef],
  );

  const startResize = useCallback(
    (edge: ResizeEdge) => (event: React.PointerEvent) => {
      if (event.button !== 0 || !win.resizable) return;
      event.preventDefault();
      event.stopPropagation();

      const element = elementRef.current;
      if (!element) return;

      const store = useWindowStore.getState();
      store.focus(win.id);

      const startRect = element.getBoundingClientRect();
      gesture.current = {
        element,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startRect: { x: startRect.left, y: startRect.top, width: startRect.width, height: startRect.height },
        zone: null,
        moved: false,
      };

      element.setPointerCapture(event.pointerId);
      element.style.transition = 'none';

      const onMove = (moveEvent: PointerEvent) => {
        const state = gesture.current;
        if (!state || moveEvent.pointerId !== state.pointerId) return;
        state.moved = true;

        const area = useWindowStore.getState().workArea;
        const dx = moveEvent.clientX - state.startX;
        const dy = moveEvent.clientY - state.startY;
        const base = state.startRect;

        let { x, y, width, height } = base;

        if (edge.includes('e')) width = base.width + dx;
        if (edge.includes('s')) height = base.height + dy;
        if (edge.includes('w')) {
          width = base.width - dx;
          x = base.x + dx;
        }
        if (edge.includes('n')) {
          height = base.height - dy;
          y = base.y + dy;
        }

        // Clamp against the minimum size *and* pin the moving edge, so
        // dragging a west/north edge past the minimum stops rather than
        // dragging the whole window along.
        const maxWidth = area.x + area.width - (edge.includes('w') ? 0 : x);
        const clampedWidth = clamp(width, win.minWidth, Math.max(win.minWidth, maxWidth));
        if (edge.includes('w')) x = base.x + base.width - clampedWidth;
        width = clampedWidth;

        const clampedHeight = clamp(height, win.minHeight, Math.max(win.minHeight, area.height));
        if (edge.includes('n')) y = base.y + base.height - clampedHeight;
        height = clampedHeight;

        y = clamp(y, area.y, area.y + area.height - 40);

        applyRect(state.element, { x, y, width, height });
      };

      const finish = (upEvent: PointerEvent) => {
        const state = gesture.current;
        if (!state || upEvent.pointerId !== state.pointerId) return;
        gesture.current = null;

        state.element.releasePointerCapture?.(upEvent.pointerId);
        state.element.style.transition = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);

        if (!state.moved) return;
        const rect = state.element.getBoundingClientRect();
        useWindowStore.getState().setBounds(win.id, {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [win.id, win.minWidth, win.minHeight, win.resizable, elementRef],
  );

  return { onTitleBarPointerDown, startResize };
}
