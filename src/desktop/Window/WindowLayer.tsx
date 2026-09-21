import { memo } from 'react';
import { SNAP_ZONE_LABELS } from '../../core/window-manager/snap';
import { useWindowStore } from '../../core/window-manager/store';
import { WindowFrame } from './Window';

/** Translucent preview of where a dragged window will land. */
const SnapPreview = memo(function SnapPreview() {
  const preview = useWindowStore((s) => s.snapPreview);
  if (!preview) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-[80] rounded-lg border-2 border-accent/70 bg-accent/18 backdrop-blur-[2px] transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{
        left: preview.rect.x,
        top: preview.rect.y,
        width: preview.rect.width,
        height: preview.rect.height,
      }}
    >
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs font-medium text-white drop-shadow">
        {SNAP_ZONE_LABELS[preview.zone]}
      </span>
    </div>
  );
});

/**
 * Renders every open window.
 *
 * Each frame is memoised on its own window record, so moving one window does
 * not re-render the others.
 */
export const WindowLayer = memo(function WindowLayer() {
  const windows = useWindowStore((s) => s.windows);
  const focusedId = useWindowStore((s) => s.focusedId);

  return (
    <>
      <SnapPreview />
      {windows.map((win) => (
        <WindowFrame key={win.id} win={win} focused={win.id === focusedId} />
      ))}
    </>
  );
});
