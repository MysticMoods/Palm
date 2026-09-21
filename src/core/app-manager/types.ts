/** Application metadata contract. */

import type { ComponentType, LazyExoticComponent } from 'react';
import type { FileCategory } from '../filesystem/mime';
import type { Permission } from '../permissions/types';

export type AppCategory =
  | 'System'
  | 'Productivity'
  | 'Utilities'
  | 'Media'
  | 'Internet'
  | 'Development';

/** Props every application component receives from the window host. */
export interface AppProps<P = Record<string, unknown>> {
  /** Id of the window this instance is rendered in. */
  windowId: string;
  /** Launch payload — e.g. `{ path: '/Documents/notes.txt' }`. */
  params: P;
}

export interface AppWindowDefaults {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  /** Only ever one window for this app. */
  singleton?: boolean;
}

export interface AppDefinition {
  id: string;
  name: string;
  description: string;
  /** Lucide icon name. */
  icon: string;
  /** Hex tint for the app's icon tile. */
  color: string;
  category: AppCategory;
  version: string;
  developer: string;
  /** Permissions the app may request at runtime. */
  permissions: Permission[];
  window?: AppWindowDefaults;
  /** File categories this app can open, in preference order. */
  handles?: FileCategory[];
  /** Specific MIME types this app claims, checked before `handles`. */
  handlesMime?: string[];
  /** Core apps ship with the OS and cannot be uninstalled. */
  core?: boolean;
  /** Extra search terms for the launcher. */
  keywords?: string[];
  /** Hidden from the launcher (e.g. dialogs, the Trash view). */
  hidden?: boolean;
  /**
   * Launch parameters baked into the manifest.
   *
   * Archived web apps all share one viewer component and are distinguished by
   * the site id carried here.
   */
  props?: Record<string, unknown>;
  /** Lazily-loaded UI. */
  component: LazyExoticComponent<ComponentType<AppProps<never>>> | ComponentType<AppProps<never>>;
}

export interface InstalledApp {
  id: string;
  installedAt: number;
}
