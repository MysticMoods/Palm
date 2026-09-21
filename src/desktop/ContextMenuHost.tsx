import { useEffect } from 'react';
import { MenuSurface } from '../components/ui/Menu';
import { useShellStore } from '../core/shell/store';

/**
 * Renders whichever context menu the shell has requested.
 *
 * Any pointer-down outside the menu closes it, and menus are dismissed when a
 * window is focused so a stale menu never floats over unrelated UI.
 */
export function ContextMenuHost() {
  const request = useShellStore((s) => s.contextMenu);
  const close = useShellStore((s) => s.closeContextMenu);

  useEffect(() => {
    if (!request) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="menu"]')) return;
      close();
    };
    // `setTimeout` lets the opening click finish before we start listening.
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [request, close]);

  if (!request) return null;

  return (
    <MenuSurface
      items={request.items}
      x={request.x}
      y={request.y}
      onClose={close}
      label={request.label}
    />
  );
}
