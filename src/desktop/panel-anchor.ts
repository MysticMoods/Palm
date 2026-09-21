import type { CSSProperties } from 'react';
import type { TaskbarPosition } from '../core/settings/types';
import { TASKBAR_THICKNESS } from './Taskbar/Taskbar';

type PanelKind = 'start' | 'tray' | 'search';

const GAP = 8;

/**
 * Position a system panel relative to the taskbar.
 *
 * The start menu hugs the taskbar's leading edge; tray panels hug its trailing
 * edge; search is centred. All of them flip side when the taskbar moves.
 */
export function panelAnchor(position: TaskbarPosition, kind: PanelKind): CSSProperties {
  const offset = TASKBAR_THICKNESS + GAP;

  if (kind === 'search') {
    const base: CSSProperties = { left: '50%', transform: 'translateX(-50%)' };
    switch (position) {
      case 'top':
        return { ...base, top: offset };
      case 'left':
        return { left: offset, top: '8vh', transform: 'none' };
      case 'right':
        return { right: offset, top: '8vh', transform: 'none' };
      default:
        return { ...base, bottom: offset };
    }
  }

  const leading = kind === 'start';

  switch (position) {
    case 'top':
      return leading ? { top: offset, left: GAP } : { top: offset, right: GAP };
    case 'left':
      return leading ? { left: offset, bottom: GAP } : { left: offset, bottom: GAP };
    case 'right':
      return leading ? { right: offset, bottom: GAP } : { right: offset, bottom: GAP };
    default:
      return leading ? { bottom: offset, left: GAP } : { bottom: offset, right: GAP };
  }
}
