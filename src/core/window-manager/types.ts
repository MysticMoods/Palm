/** Window manager data model. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SnapZone =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'maximize';

export type WindowMode = 'normal' | 'minimized' | 'maximized' | 'snapped' | 'fullscreen';

export interface WindowCrash {
  message: string;
  stack?: string;
  at: number;
}

export interface WindowState {
  id: string;
  appId: string;
  title: string;
  /** Lucide icon name, resolved by `components/AppIcon`. */
  icon: string;
  bounds: Rect;
  /** Geometry to return to when un-maximising or un-snapping. */
  restoreBounds: Rect | null;
  mode: WindowMode;
  snap: SnapZone | null;
  zIndex: number;
  /** Launch payload handed to the application component. */
  props: Record<string, unknown>;
  resizable: boolean;
  minWidth: number;
  minHeight: number;
  /** Set when the app's error boundary trips. */
  crash: WindowCrash | null;
  /** Bumped to force a remount when the user chooses "Restart". */
  generation: number;
  createdAt: number;
  /** Blocks close/minimise while a modal dialog is open inside the window. */
  busy: boolean;
  /** Prompt shown by `OS.window.setCloseGuard` before closing. */
  closeGuard: boolean;
}

export interface OpenWindowOptions {
  appId: string;
  title?: string;
  icon?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
  props?: Record<string, unknown>;
  /** Focus an existing window for this app instead of opening a second one. */
  singleton?: boolean;
  /** Open maximised (used on small screens). */
  maximized?: boolean;
}
