import { useCallback, useRef } from 'react';
import type { Permission } from '../core/permissions/types';
import { useOS } from './app-context';

/**
 * A one-shot permission gate for an application.
 *
 * Applications that reach the filesystem (or clipboard, or notifications)
 * call `ensure()` before their first access. The answer is remembered by the
 * permission store, so the user is asked once and the in-flight promise is
 * shared across concurrent callers.
 */
export function usePermissionGate(permission: Permission, reason: string) {
  const { os } = useOS();
  const pending = useRef<Promise<boolean> | null>(null);
  const granted = useRef(false);

  return useCallback(async (): Promise<boolean> => {
    if (granted.current) return true;
    if (!pending.current) {
      pending.current = os.requestPermission(permission, reason).then((result) => {
        granted.current = result;
        // Only cache a "yes": a denial should be re-checked if the user
        // changes their mind in Settings.
        if (!result) pending.current = null;
        return result;
      });
    }
    return pending.current;
  }, [os, permission, reason]);
}
