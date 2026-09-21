import { createContext, useContext } from 'react';
import type { AppAPI } from '../core/os';

export interface AppContextValue {
  /** Permission-scoped OS API for the owning application. */
  os: AppAPI;
  windowId: string;
  appId: string;
  /** Launch parameters passed to `OS.openApp`. */
  params: Record<string, unknown>;
}

export const AppContext = createContext<AppContextValue | null>(null);

/**
 * Access the OS from inside an application.
 *
 * Throws when used outside a window: an app component is only ever valid as a
 * window's content, and a silent `null` here would surface as a confusing
 * crash much later.
 */
export function useOS(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error('useOS() must be called inside an application window.');
  }
  return value;
}

/** Typed launch parameters for the current window. */
export function useAppParams<T extends Record<string, unknown>>(): Partial<T> {
  return useOS().params as Partial<T>;
}
