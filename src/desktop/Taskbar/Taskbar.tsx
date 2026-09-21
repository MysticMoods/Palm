import { memo, useCallback, useMemo } from 'react';
import { Icon } from '../../components/icons';
import { Tooltip } from '../../components/ui/Tooltip';
import { getApp } from '../../core/app-manager/registry';
import { usePinnedApps, useAppStore } from '../../core/app-manager/store';
import type { AppDefinition } from '../../core/app-manager/types';
import { OS } from '../../core/os';
import { useSettingsStore } from '../../core/settings/store';
import { useShellStore } from '../../core/shell/store';
import type { ContextMenuItem } from '../../core/shell/store';
import { useWindowStore } from '../../core/window-manager/store';
import type { WindowState } from '../../core/window-manager/types';
import { formatShortcut } from '../../core/keyboard/shortcuts';
import { cn } from '../../utils/cn';
import { SystemTray } from '../SystemTray/SystemTray';
import { TaskbarItem } from './TaskbarItem';

export const TASKBAR_THICKNESS = 48;

export const Taskbar = memo(function Taskbar() {
  const position = useSettingsStore((s) => s.settings.taskbarPosition);
  const searchShortcut = useSettingsStore((s) => s.settings.searchShortcut);
  const vertical = position === 'left' || position === 'right';

  const panel = useShellStore((s) => s.panel);
  const togglePanel = useShellStore((s) => s.togglePanel);
  const openContextMenu = useShellStore((s) => s.openContextMenu);

  const pinned = usePinnedApps();
  const windows = useWindowStore((s) => s.windows);
  const focusedId = useWindowStore((s) => s.focusedId);
  const minimizeAll = useWindowStore((s) => s.minimizeAll);

  /** Pinned apps first, then anything else that is running. */
  const items = useMemo(() => {
    const byApp = new Map<string, WindowState[]>();
    for (const win of windows) {
      const list = byApp.get(win.appId) ?? [];
      list.push(win);
      byApp.set(win.appId, list);
    }

    const result: Array<{ app: AppDefinition; windows: WindowState[] }> = [];
    const seen = new Set<string>();

    for (const app of pinned) {
      result.push({ app, windows: byApp.get(app.id) ?? [] });
      seen.add(app.id);
    }
    for (const [appId, appWindows] of byApp) {
      if (seen.has(appId)) continue;
      const app = getApp(appId);
      if (app) result.push({ app, windows: appWindows });
    }
    return result;
  }, [pinned, windows]);

  const activate = useCallback(
    (app: AppDefinition, appWindows: WindowState[]) => {
      const store = useWindowStore.getState();
      if (appWindows.length === 0) {
        OS.openApp(app.id);
        return;
      }
      if (appWindows.length === 1) {
        store.toggleMinimize(appWindows[0].id);
        return;
      }
      // Several windows: cycle focus through them, newest-on-top first.
      const ordered = [...appWindows].sort((a, b) => b.zIndex - a.zIndex);
      const active = ordered.find((w) => w.id === store.focusedId);
      if (active && ordered.length > 1) {
        const next = ordered[ordered.length - 1];
        store.focus(next.id);
      } else {
        store.focus(ordered[0].id);
      }
    },
    [],
  );

  const itemMenu = useCallback(
    (event: React.MouseEvent, app: AppDefinition, appWindows: WindowState[]) => {
      event.preventDefault();
      const isPinned = useAppStore.getState().pinned.includes(app.id);
      const items: ContextMenuItem[] = [
        {
          id: 'open',
          label: appWindows.length > 0 ? 'New window' : 'Open',
          icon: 'AppWindow',
          onSelect: () => OS.openApp(app.id, { forceNew: appWindows.length > 0 }),
        },
      ];

      if (appWindows.length > 1) {
        items.push({
          id: 'windows',
          label: `${appWindows.length} windows`,
          icon: 'Columns2',
          items: appWindows.map((win) => ({
            id: win.id,
            label: win.title,
            onSelect: () => useWindowStore.getState().focus(win.id),
          })),
        });
      }

      items.push(
        { id: 'sep-1', separator: true },
        {
          id: 'pin',
          label: isPinned ? 'Unpin from taskbar' : 'Pin to taskbar',
          icon: isPinned ? 'PinOff' : 'Pin',
          onSelect: () => useAppStore.getState().togglePin(app.id),
        },
      );

      if (appWindows.length > 0) {
        items.push(
          { id: 'sep-2', separator: true },
          {
            id: 'close',
            label: appWindows.length > 1 ? `Close all ${appWindows.length} windows` : 'Close',
            icon: 'X',
            danger: true,
            onSelect: () => useWindowStore.getState().closeApp(app.id),
          },
        );
      }

      openContextMenu({ x: event.clientX, y: event.clientY, items, label: `${app.name} options` });
    },
    [openContextMenu],
  );

  const taskbarMenu = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest('button')) return;
      event.preventDefault();
      const current = useSettingsStore.getState().settings.taskbarPosition;
      const items: ContextMenuItem[] = [
        {
          id: 'position',
          label: 'Taskbar position',
          icon: 'Move',
          items: (['bottom', 'top', 'left', 'right'] as const).map((value) => ({
            id: `pos-${value}`,
            label: value[0].toUpperCase() + value.slice(1),
            checked: current === value,
            onSelect: () => useSettingsStore.getState().set('taskbarPosition', value),
          })),
        },
        { id: 'sep', separator: true },
        { id: 'show-desktop', label: 'Show desktop', icon: 'Monitor', onSelect: minimizeAll },
        {
          id: 'settings',
          label: 'Taskbar settings',
          icon: 'Settings',
          onSelect: () => OS.openApp('settings', { params: { section: 'personalization' } }),
        },
      ];
      openContextMenu({ x: event.clientX, y: event.clientY, items, label: 'Taskbar menu' });
    },
    [minimizeAll, openContextMenu],
  );

  const edgeBorder = {
    bottom: 'border-t',
    top: 'border-b',
    left: 'border-r',
    right: 'border-l',
  }[position];

  return (
    <div
      role="toolbar"
      aria-label="Taskbar"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      onContextMenu={taskbarMenu}
      className={cn(
        'os-glass-strong absolute z-[500] flex border-edge/10',
        edgeBorder,
        vertical ? 'inset-y-0 w-[48px] flex-col items-center py-2' : 'inset-x-0 h-[48px] items-center px-2',
        position === 'bottom' && 'bottom-0',
        position === 'top' && 'top-0',
        position === 'left' && 'left-0',
        position === 'right' && 'right-0',
      )}
      style={{ ['--taskbar-thickness' as string]: `${TASKBAR_THICKNESS}px` }}
    >
      {/* ------------------------------ Start ------------------------------- */}
      <Tooltip content="Start" side={vertical ? 'right' : 'top'}>
        <button
          type="button"
          onClick={() => togglePanel('start')}
          aria-label="Open the start menu"
          aria-expanded={panel === 'start'}
          aria-haspopup="menu"
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
            panel === 'start' ? 'bg-accent text-accent-fg' : 'text-ink hover:bg-white/12',
          )}
        >
          <PalmGlyph />
        </button>
      </Tooltip>

      <Tooltip content={`Search — ${formatShortcut(searchShortcut)}`} side={vertical ? 'right' : 'top'}>
        <button
          type="button"
          onClick={() => togglePanel('search')}
          aria-label="Search applications, files and settings"
          aria-expanded={panel === 'search'}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-2 transition-colors duration-150',
            panel === 'search' ? 'bg-white/14 text-ink' : 'hover:bg-white/10 hover:text-ink',
          )}
        >
          <Icon name="Search" size={17} />
        </button>
      </Tooltip>

      <div className={cn('mx-1.5 bg-edge/12', vertical ? 'my-1 h-px w-6' : 'h-6 w-px')} aria-hidden="true" />

      {/* --------------------------- Applications --------------------------- */}
      <div
        className={cn(
          'os-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-auto',
          vertical ? 'flex-col overflow-x-hidden' : 'overflow-y-hidden',
        )}
      >
        {items.map(({ app, windows: appWindows }) => (
          <TaskbarItem
            key={app.id}
            app={app}
            windows={appWindows}
            focused={appWindows.some((w) => w.id === focusedId && w.mode !== 'minimized')}
            vertical={vertical}
            onActivate={() => activate(app, appWindows)}
            onContextMenu={(event) => itemMenu(event, app, appWindows)}
          />
        ))}
      </div>

      <div className={cn('mx-1.5 bg-edge/12', vertical ? 'my-1 h-px w-6' : 'h-6 w-px')} aria-hidden="true" />

      <SystemTray vertical={vertical} />

      {/* --------------------------- Show desktop --------------------------- */}
      {!vertical ? (
        <Tooltip content="Show desktop">
          <button
            type="button"
            onClick={minimizeAll}
            aria-label="Minimise all windows and show the desktop"
            className="ml-1 h-8 w-2 shrink-0 rounded-sm border-l border-edge/15 transition-colors hover:bg-white/15"
          />
        </Tooltip>
      ) : null}
    </div>
  );
});

/** The Palm mark used on the start button. */
function PalmGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21v-7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M12 13.5c0-3 2.2-5.4 5.2-5.4M12 13.5c0-3-2.2-5.4-5.2-5.4M12 13.5c.4-2.7 2.6-4.6 5.4-5.6M12 13.5c-.4-2.7-2.6-4.6-5.4-5.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="7" r="2.1" fill="currentColor" />
    </svg>
  );
}
