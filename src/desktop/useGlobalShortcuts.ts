/**
 * Registers the OS-level keyboard shortcuts.
 *
 * Deliberately avoids browser-reserved combinations (Ctrl+T/N/W, Ctrl+Shift+T,
 * F5, Ctrl+L): they cannot be reliably intercepted, and stealing them from the
 * user's own browser would be hostile. Window management therefore uses the
 * Super key, matching Windows and most Linux desktops.
 */

import { useEffect } from 'react';
import { registerShortcuts, shortcutsSuspended, startKeyboardManager } from '../core/keyboard/manager';
import { getSettings } from '../core/settings/store';
import { useShellStore } from '../core/shell/store';
import { useWindowStore } from '../core/window-manager/store';
import type { SnapZone } from '../core/window-manager/types';

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const stopManager = startKeyboardManager();

    const focused = () => {
      const { windows, focusedId } = useWindowStore.getState();
      return windows.find((w) => w.id === focusedId) ?? null;
    };

    const snap = (zone: SnapZone) => () => {
      const win = focused();
      if (win) useWindowStore.getState().snapTo(win.id, zone);
    };

    /** Open the switcher, or advance it if a gesture is already running. */
    const step = (direction: 1 | -1, sticky: boolean) => {
      const manager = useWindowStore.getState();
      if (manager.switcher) manager.moveSwitch(direction);
      else manager.beginSwitch(direction, sticky);
    };

    const unregister = registerShortcuts([
      {
        id: 'search',
        shortcut: getSettings().searchShortcut,
        description: 'Open system search',
        allowInInputs: true,
        handler: () => useShellStore.getState().togglePanel('search'),
      },
      {
        id: 'switch-window',
        shortcut: 'Alt+Tab',
        description: 'Switch between windows',
        allowInInputs: true,
        handler: () => step(1, false),
      },
      {
        id: 'switch-window-back',
        shortcut: 'Alt+Shift+Tab',
        description: 'Switch backwards between windows',
        allowInInputs: true,
        handler: () => step(-1, false),
      },
      {
        id: 'switch-window-sticky',
        shortcut: 'Ctrl+Alt+W',
        description: 'Open the window switcher',
        allowInInputs: true,
        handler: () => step(1, true),
      },
      {
        id: 'close-window',
        shortcut: 'Alt+F4',
        description: 'Close the active window',
        allowInInputs: true,
        handler: () => {
          const win = focused();
          if (win) useWindowStore.getState().close(win.id);
        },
      },
      {
        id: 'show-desktop',
        shortcut: 'Ctrl+Alt+D',
        description: 'Minimise every window',
        handler: () => useWindowStore.getState().minimizeAll(),
      },
      {
        id: 'maximize',
        shortcut: 'Meta+ArrowUp',
        description: 'Maximise the active window',
        handler: () => {
          const win = focused();
          if (win) useWindowStore.getState().maximize(win.id);
        },
      },
      {
        id: 'restore',
        shortcut: 'Meta+ArrowDown',
        description: 'Restore or minimise the active window',
        handler: () => {
          const win = focused();
          if (!win) return;
          const manager = useWindowStore.getState();
          if (win.mode === 'normal') manager.minimize(win.id);
          else manager.restore(win.id);
        },
      },
      {
        id: 'snap-left',
        shortcut: 'Meta+ArrowLeft',
        description: 'Snap the active window to the left half',
        handler: snap('left'),
      },
      {
        id: 'snap-right',
        shortcut: 'Meta+ArrowRight',
        description: 'Snap the active window to the right half',
        handler: snap('right'),
      },
      {
        id: 'notifications',
        shortcut: 'Ctrl+Alt+N',
        description: 'Open the notification centre',
        handler: () => useShellStore.getState().togglePanel('notifications'),
      },
      {
        id: 'quick-settings',
        shortcut: 'Ctrl+Alt+A',
        description: 'Open quick settings',
        handler: () => useShellStore.getState().togglePanel('quick-settings'),
      },
      {
        id: 'escape',
        shortcut: 'Escape',
        description: 'Close menus and panels',
        passive: true,
        allowInInputs: true,
        handler: () => {
          const manager = useWindowStore.getState();
          if (manager.switcher) {
            manager.cancelSwitch();
            return;
          }
          const state = useShellStore.getState();
          if (state.contextMenu) state.closeContextMenu();
          else if (state.panel) state.closePanel();
        },
      },
    ]);

    /*
     * The Super/Windows key on its own opens the start menu, as it does on
     * Windows and GNOME. A bare modifier has no keydown combination to match,
     * so it is tracked across keydown/keyup: the menu opens only if no other
     * key was pressed while Super was held.
     */
    let superAlone = false;
    const onKeyDown = (event: KeyboardEvent) => {
      superAlone = !shortcutsSuspended() && (event.key === 'Meta' || event.key === 'OS');

      /*
       * Cancelling a switch is handled here rather than through a registered
       * shortcut: the declarative binding for Escape requires no modifiers,
       * and during a held Alt+Tab gesture Alt is by definition down, so it
       * would never match.
       */
      if (event.key === 'Escape' && !shortcutsSuspended()) {
        const manager = useWindowStore.getState();
        if (manager.switcher) {
          event.preventDefault();
          manager.cancelSwitch();
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (shortcutsSuspended()) return;

      // Releasing Alt confirms a held Alt+Tab gesture, the way a desktop
      // switcher does. Sticky switchers ignore this and wait for Enter.
      if (event.key === 'Alt') {
        const manager = useWindowStore.getState();
        if (manager.switcher && !manager.switcher.sticky) manager.commitSwitch();
      }

      if ((event.key === 'Meta' || event.key === 'OS') && superAlone) {
        superAlone = false;
        useShellStore.getState().togglePanel('start');
      }
    };
    const clearSuper = () => {
      superAlone = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearSuper);
    window.addEventListener('pointerdown', clearSuper);

    return () => {
      unregister();
      stopManager();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearSuper);
      window.removeEventListener('pointerdown', clearSuper);
    };
  }, []);
}
