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

const RESIZE_HANDLES: Array<{ edge: ResizeEdge; className: string; cursor: string }> = [
  { edge: 'n', className: 'left-2 right-2 -top-1 h-2', cursor: 'ns-resize' },
  { edge: 's', className: 'left-2 right-2 -bottom-1 h-2', cursor: 'ns-resize' },
  { edge: 'w', className: 'top-2 bottom-2 -left-1 w-2', cursor: 'ew-resize' },
  { edge: 'e', className: 'top-2 bottom-2 -right-1 w-2', cursor: 'ew-resize' },
  { edge: 'nw', className: '-top-1 -left-1 h-3 w-3', cursor: 'nwse-resize' },
  { edge: 'ne', className: '-top-1 -right-1 h-3 w-3', cursor: 'nesw-resize' },
  { edge: 'sw', className: '-bottom-1 -left-1 h-3 w-3', cursor: 'nesw-resize' },
  { edge: 'se', className: '-bottom-1 -right-1 h-3 w-3', cursor: 'nwse-resize' },
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
        'anim-pop absolute left-0 top-0 flex flex-col overflow-hidden',
        'border bg-surface will-change-transform',
        rounded ? 'rounded-none' : 'rounded-[var(--radius-window)]',
        focused
          ? 'border-edge/18 shadow-[var(--shadow-window)]'
          : 'border-edge/8 shadow-[0_8px_28px_-12px_rgb(0_0_0/0.5)]',
      )}
      style={{
        transform: `translate3d(${Math.round(win.bounds.x)}px, ${Math.round(win.bounds.y)}px, 0)`,
        width: Math.round(win.bounds.width),
        height: Math.round(win.bounds.height),
        zIndex: win.zIndex,
      }}
    >
      {/* ------------------------------ Title bar ------------------------------ */}
      <div
        onPointerDown={onTitleBarPointerDown}
        onDoubleClick={() => toggleMaximize(win.id)}
        onContextMenu={onTitleContextMenu}
        className={cn(
          'no-select flex h-9 shrink-0 items-center gap-2 border-b border-edge/8 px-2.5',
          'cursor-grab active:cursor-grabbing',
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
            className="flex h-6 w-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Icon name="Minus" size={13} />
          </button>
          {win.resizable ? (
            <button
              type="button"
              data-window-control
              onClick={() => toggleMaximize(win.id)}
              aria-label={win.mode === 'maximized' ? `Restore ${win.title}` : `Maximise ${win.title}`}
              title={win.mode === 'maximized' ? 'Restore' : 'Maximise'}
              className="flex h-6 w-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <Icon name={win.mode === 'maximized' || win.mode === 'snapped' ? 'Minimize2' : 'Maximize2'} size={12} />
            </button>
          ) : null}
          <button
            type="button"
            data-window-control
            onClick={requestClose}
            aria-label={`Close ${win.title}`}
            title="Close"
            className="flex h-6 w-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-danger hover:text-white"
          >
            <Icon name="X" size={13} />
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

      {/* ---------------------------- Resize handles --------------------------- */}
      {win.resizable && win.mode === 'normal'
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
