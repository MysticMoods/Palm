import { Suspense, memo, useCallback, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Feedback';
import { getApp } from '../../core/app-manager/registry';
import { createAppAPI } from '../../core/os';
import { useShellStore } from '../../core/shell/store';
import type { ContextMenuItem } from '../../core/shell/store';
import { useWindowStore } from '../../core/window-manager/store';
import type { WindowState } from '../../core/window-manager/types';
import { cn } from '../../utils/cn';
import { AppContext } from '../app-context';
import { useWindowGestures } from './useWindowGestures';
import type { ResizeEdge } from './useWindowGestures';

/**
 * Resize zones straddle the window border by a few pixels on each side, the
 * way desktop window managers do — an edge that is only grabbable *inside* the
 * frame is fiddly to hit.
 */
const RESIZE_HANDLES: Array<{ edge: ResizeEdge; className: string; cursor: string }> = [
  { edge: 'n', className: 'left-3 right-3 -top-[5px] h-[10px]', cursor: 'ns-resize' },
  { edge: 's', className: 'left-3 right-3 -bottom-[5px] h-[10px]', cursor: 'ns-resize' },
  { edge: 'w', className: 'top-3 bottom-3 -left-[5px] w-[10px]', cursor: 'ew-resize' },
  { edge: 'e', className: 'top-3 bottom-3 -right-[5px] w-[10px]', cursor: 'ew-resize' },
  { edge: 'nw', className: '-top-[5px] -left-[5px] h-4 w-4', cursor: 'nwse-resize' },
  { edge: 'ne', className: '-top-[5px] -right-[5px] h-4 w-4', cursor: 'nesw-resize' },
  { edge: 'sw', className: '-bottom-[5px] -left-[5px] h-4 w-4', cursor: 'nesw-resize' },
  { edge: 'se', className: '-bottom-[5px] -right-[5px] h-4 w-4', cursor: 'nwse-resize' },
];

interface WindowFrameProps {
  win: WindowState;
  focused: boolean;
}

function WindowFrameInner({ win, focused }: WindowFrameProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const { onTitleBarPointerDown, startResize } = useWindowGestures(win, elementRef);

  const close = useWindowStore((s) => s.close);
  const minimize = useWindowStore((s) => s.minimize);
  const toggleMaximize = useWindowStore((s) => s.toggleMaximize);
  const focus = useWindowStore((s) => s.focus);
  const snapTo = useWindowStore((s) => s.snapTo);
  const setCrash = useWindowStore((s) => s.setCrash);
  const compact = useWindowStore((s) => s.compact);
  const restartWindow = useWindowStore((s) => s.restartWindow);
  const openContextMenu = useShellStore((s) => s.openContextMenu);

  const app = getApp(win.appId);

  const api = useMemo(() => createAppAPI(win.appId, win.id), [win.appId, win.id]);
  const contextValue = useMemo(
    () => ({ os: api, windowId: win.id, appId: win.appId, params: win.props }),
    [api, win.id, win.appId, win.props],
  );

  const requestClose = useCallback(() => {
    if (win.closeGuard) setConfirmClose(true);
    else close(win.id);
  }, [close, win.closeGuard, win.id]);

  const onTitleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const items: ContextMenuItem[] = [
        {
          id: 'restore',
          label: 'Restore',
          icon: 'Minimize2',
          disabled: win.mode === 'normal',
          onSelect: () => useWindowStore.getState().restore(win.id),
        },
        { id: 'minimize', label: 'Minimise', icon: 'Minus', onSelect: () => minimize(win.id) },
        {
          id: 'maximize',
          label: 'Maximise',
          icon: 'Maximize2',
          disabled: win.mode === 'maximized',
          onSelect: () => useWindowStore.getState().maximize(win.id),
        },
        { id: 'sep-1', separator: true },
        {
          id: 'snap',
          label: 'Snap',
          icon: 'Columns2',
          items: [
            { id: 'snap-left', label: 'Left half', onSelect: () => snapTo(win.id, 'left') },
            { id: 'snap-right', label: 'Right half', onSelect: () => snapTo(win.id, 'right') },
            { id: 'snap-top', label: 'Top half', onSelect: () => snapTo(win.id, 'top') },
            { id: 'snap-bottom', label: 'Bottom half', onSelect: () => snapTo(win.id, 'bottom') },
            { id: 'snap-sep', separator: true },
            { id: 'snap-tl', label: 'Top-left quarter', onSelect: () => snapTo(win.id, 'top-left') },
            { id: 'snap-tr', label: 'Top-right quarter', onSelect: () => snapTo(win.id, 'top-right') },
            { id: 'snap-bl', label: 'Bottom-left quarter', onSelect: () => snapTo(win.id, 'bottom-left') },
            { id: 'snap-br', label: 'Bottom-right quarter', onSelect: () => snapTo(win.id, 'bottom-right') },
          ],
        },
        { id: 'sep-2', separator: true },
        {
          id: 'close',
          label: 'Close',
          icon: 'X',
          danger: true,
          hint: 'Alt + F4',
          onSelect: requestClose,
        },
      ];
      openContextMenu({ x: event.clientX, y: event.clientY, items, label: `${win.title} window menu` });
    },
    [minimize, openContextMenu, requestClose, snapTo, win.id, win.mode, win.title],
  );

  if (win.mode === 'minimized') return null;

  const AppComponent = app?.component;
  const rounded = win.mode === 'maximized' || win.mode === 'snapped';

  return (
    <div
      ref={elementRef}
      role="dialog"
      aria-label={win.title}
      aria-modal={false}
      data-window-id={win.id}
      data-focused={focused || undefined}
      onPointerDown={() => focus(win.id)}
      className={cn(
        'absolute left-0 top-0',
        rounded ? 'rounded-none' : 'rounded-[var(--radius-window)]',
        focused
          ? 'shadow-[var(--shadow-window)]'
          : 'shadow-[0_8px_28px_-12px_rgb(0_0_0/0.5)]',
      )}
      style={{
        transform: `translate3d(${Math.round(win.bounds.x)}px, ${Math.round(win.bounds.y)}px, 0)`,
        width: Math.round(win.bounds.width),
        height: Math.round(win.bounds.height),
        zIndex: win.zIndex,
      }}
    >
      {/*
        The entrance animation lives on this inner layer, never on the frame:
        a keyframe that ends at `transform: none` with `fill: both` would
        permanently override the frame's inline transform and pin every window
        to the top-left corner.
      */}
      <div
        className={cn(
          'anim-pop flex h-full flex-col overflow-hidden border bg-surface',
          rounded ? 'rounded-none' : 'rounded-[var(--radius-window)]',
          focused ? 'border-edge/18' : 'border-edge/8',
        )}
      >
      {/* ------------------------------ Title bar ------------------------------ */}
      <div
        onPointerDown={compact ? undefined : onTitleBarPointerDown}
        onDoubleClick={compact ? undefined : () => toggleMaximize(win.id)}
        onContextMenu={onTitleContextMenu}
        className={cn(
          'no-select flex shrink-0 items-center gap-2 border-b border-edge/8 px-2.5',
          compact ? 'h-11' : 'h-9 cursor-grab active:cursor-grabbing',
          focused ? 'bg-surface-2/80' : 'bg-surface-2/40',
        )}
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px]"
          style={{ backgroundColor: `${app?.color ?? '#5884ff'}22`, color: app?.color ?? '#5884ff' }}
        >
          <Icon name={win.icon} size={12} />
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[12.5px] font-medium',
            focused ? 'text-ink' : 'text-ink-3',
          )}
        >
          {win.title}
        </span>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            data-window-control
            onClick={() => minimize(win.id)}
            aria-label={`Minimise ${win.title}`}
            title="Minimise"
            className={cn(
              'flex items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink',
              compact ? 'h-9 w-9' : 'h-6 w-7',
            )}
          >
            <Icon name="Minus" size={compact ? 16 : 13} />
          </button>
          {win.resizable && !compact ? (
            <button
              type="button"
              data-window-control
              onClick={() => toggleMaximize(win.id)}
              aria-label={win.mode === 'maximized' ? `Restore ${win.title}` : `Maximise ${win.title}`}
              title={win.mode === 'maximized' ? 'Restore' : 'Maximise'}
              className={cn(
                'flex items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink',
                compact ? 'h-9 w-9' : 'h-6 w-7',
              )}
            >
              <Icon name={win.mode === 'maximized' || win.mode === 'snapped' ? 'Minimize2' : 'Maximize2'} size={compact ? 15 : 12} />
            </button>
          ) : null}
          <button
            type="button"
            data-window-control
            onClick={requestClose}
            aria-label={`Close ${win.title}`}
            title="Close"
            className={cn(
              'flex items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-danger hover:text-white',
              compact ? 'h-9 w-9' : 'h-6 w-7',
            )}
          >
            <Icon name="X" size={compact ? 16 : 13} />
          </button>
        </div>
      </div>

      {/* ----------------------------- Content area ---------------------------- */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-surface">
        {win.crash ? (
          <CrashPanel
            message={win.crash.message}
            onRestart={() => restartWindow(win.id)}
            onClose={() => close(win.id)}
          />
        ) : AppComponent ? (
          <AppContext.Provider value={contextValue}>
            <ErrorBoundary
              key={win.generation}
              resetKey={win.generation}
              onError={(error) =>
                setCrash(win.id, { message: error.message, stack: error.stack, at: Date.now() })
              }
              fallback={() => null}
            >
              <Suspense fallback={<WindowLoading />}>
                <AppComponent windowId={win.id} params={win.props as never} />
              </Suspense>
            </ErrorBoundary>
          </AppContext.Provider>
        ) : (
          <CrashPanel
            message={`The application "${win.appId}" is not installed.`}
            onRestart={() => restartWindow(win.id)}
            onClose={() => close(win.id)}
          />
        )}
      </div>
      </div>

      {/* ---------------------------- Resize handles --------------------------- */}
      {!compact && win.resizable && (win.mode === 'normal' || win.mode === 'snapped')
        ? RESIZE_HANDLES.map(({ edge, className, cursor }) => (
            <div
              key={edge}
              role="presentation"
              onPointerDown={startResize(edge)}
              className={cn('absolute z-10', className)}
              style={{ cursor }}
            />
          ))
        : null}

      <ConfirmDialog
        open={confirmClose}
        title="Close without saving?"
        description={`"${win.title}" has unsaved changes. Closing now will discard them.`}
        confirmLabel="Discard and close"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setConfirmClose(false);
          close(win.id);
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}

function WindowLoading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-ink-3">
      <Spinner size={18} />
      <span className="text-xs">Loading…</span>
    </div>
  );
}

function CrashPanel({
  message,
  onRestart,
  onClose,
}: {
  message: string;
  onRestart: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-4 bg-surface p-8 text-center"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/15 text-danger">
        <Icon name="AlertTriangle" size={22} />
      </span>
      <div>
        <p className="text-[15px] font-semibold text-ink">Application stopped responding</p>
        <p className="mx-auto mt-1.5 max-w-sm break-words text-xs leading-relaxed text-ink-3">{message}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" icon="RotateCcw" onClick={onRestart}>
          Restart
        </Button>
        <Button variant="ghost" icon="X" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

export const WindowFrame = memo(WindowFrameInner);
