import { useEffect, useMemo } from 'react';
import { useSettingsStore } from '../core/settings/store';
import { useShellStore } from '../core/shell/store';
import { COMPACT_BREAKPOINT, useWindowStore } from '../core/window-manager/store';
import { useViewport } from '../hooks/useSystem';
import { CalendarPanel } from './CalendarPanel/CalendarPanel';
import { ContextMenuHost } from './ContextMenuHost';
import { Desktop } from './Desktop/Desktop';
import { NotificationCenter } from './NotificationCenter/NotificationCenter';
import { PermissionDialog } from './PermissionDialog';
import { QuickSettings } from './QuickSettings/QuickSettings';
import { SearchPanel } from './Search/SearchPanel';
import { StartMenu } from './StartMenu/StartMenu';
import { TASKBAR_THICKNESS, Taskbar } from './Taskbar/Taskbar';
import { Toasts } from './Toasts';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { WindowLayer } from './Window/WindowLayer';

/**
 * The desktop shell.
 *
 * Owns the work area calculation (viewport minus taskbar), which the window
 * manager uses for snapping, maximising and keeping windows on screen.
 */
export function Shell() {
  const viewport = useViewport();
  const taskbarPosition = useSettingsStore((s) => s.settings.taskbarPosition);
  const panel = useShellStore((s) => s.panel);
  const setWorkArea = useWindowStore((s) => s.setWorkArea);

  useGlobalShortcuts();

  const workArea = useMemo(() => {
    const thickness = TASKBAR_THICKNESS;
    switch (taskbarPosition) {
      case 'top':
        return { x: 0, y: thickness, width: viewport.width, height: viewport.height - thickness };
      case 'left':
        return { x: thickness, y: 0, width: viewport.width - thickness, height: viewport.height };
      case 'right':
        return { x: 0, y: 0, width: viewport.width - thickness, height: viewport.height };
      default:
        return { x: 0, y: 0, width: viewport.width, height: viewport.height - thickness };
    }
  }, [taskbarPosition, viewport.height, viewport.width]);

  useEffect(() => {
    setWorkArea(workArea);
    useWindowStore.setState({ compact: viewport.width < COMPACT_BREAKPOINT });
  }, [setWorkArea, viewport.width, workArea]);

  const desktopStyle = useMemo(() => {
    switch (taskbarPosition) {
      case 'top':
        return { top: TASKBAR_THICKNESS, left: 0, right: 0, bottom: 0 };
      case 'left':
        return { top: 0, left: TASKBAR_THICKNESS, right: 0, bottom: 0 };
      case 'right':
        return { top: 0, left: 0, right: TASKBAR_THICKNESS, bottom: 0 };
      default:
        return { top: 0, left: 0, right: 0, bottom: TASKBAR_THICKNESS };
    }
  }, [taskbarPosition]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <a
        href="#palm-taskbar"
        className="sr-only-focusable absolute left-2 top-2 z-[9999] rounded-md bg-accent px-3 py-2 text-sm text-accent-fg"
      >
        Skip to taskbar
      </a>

      <div className="absolute" style={desktopStyle}>
        <Desktop height={workArea.height} />
      </div>

      <WindowLayer />

      <div id="palm-taskbar">
        <Taskbar />
      </div>

      {panel === 'start' ? <StartMenu /> : null}
      {panel === 'search' ? <SearchPanel /> : null}
      {panel === 'notifications' ? <NotificationCenter /> : null}
      {panel === 'quick-settings' ? <QuickSettings /> : null}
      {panel === 'calendar' ? <CalendarPanel /> : null}

      <Toasts />
      <ContextMenuHost />
      <PermissionDialog />
    </div>
  );
}
