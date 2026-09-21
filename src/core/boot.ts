/**
 * Boot sequence.
 *
 * Order matters: settings first so the correct theme paints immediately, then
 * the filesystem (seeding on first run), then everything that depends on the
 * app registry. Each step is individually guarded — a failure in, say, the
 * notification history must not stop the desktop from coming up.
 */

import { hydrateAppManager } from './app-manager/store';
import { hydrateCalendar } from './calendar/store';
import { restoreDisk } from './filesystem/disk-store';
import { retireOsWorker } from './sites/retire-sw';
import { useSitesStore } from './sites/store';
import { ensureDefaultFolders, needsSeed, seedFilesystem } from './filesystem/seed';
import { vfs } from './filesystem/vfs';
import { hydrateNotifications } from './notifications/store';
import { hydratePermissions } from './permissions/store';
import { hydrateSettings, useSettingsStore } from './settings/store';
import { startSettingsEffects } from './settings/apply';
import { hydrateDesktop } from './shell/desktop-store';
import { destroyDatabase } from './storage/db';
import { useShellStore } from './shell/store';
import { hydrateWindowPreferences } from './window-manager/store';

let booted: Promise<void> | null = null;

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[palm/boot] "${name}" failed`, err);
  }
}

export function bootPalmOS(): Promise<void> {
  if (booted) return booted;

  booted = (async () => {
    // 1. Settings decide how everything else looks, so they come first.
    await step('settings', hydrateSettings);
    startSettingsEffects();

    // 2. Filesystem — seed on first run, repair standard folders otherwise.
    await step('filesystem', async () => {
      await vfs.init();
      if (await needsSeed()) await seedFilesystem();
      else await ensureDefaultFolders();
    });

    // 3. State that depends on the app registry and the filesystem.
    await Promise.all([
      step('apps', hydrateAppManager),
      step('permissions', hydratePermissions),
      step('notifications', hydrateNotifications),
      step('desktop', hydrateDesktop),
      step('windows', hydrateWindowPreferences),
      step('calendar', hydrateCalendar),
      // Reattaches a remembered folder when the browser still permits it;
      // otherwise Files offers a Reconnect button, which has the gesture.
      step('disk', restoreDisk),
      // Installed web applications register themselves with the launcher as
      // they load. Their archives live on their own origins, not here.
      step('installed apps', () => useSitesStore.getState().load()),
      // Palm OS no longer serves anything through a worker of its own; an old
      // one left over from the previous design is removed.
      step('retire old worker', async () => {
        await retireOsWorker();
      }),
    ]);

    useShellStore.getState().setBoot('ready');
  })().catch((err) => {
    console.error('[palm/boot] fatal', err);
    useShellStore
      .getState()
      .setBoot('error', err instanceof Error ? err.message : 'Palm OS could not start.');
  });

  return booted;
}

/** Wipe every trace of Palm OS from this browser and reload. */
export async function resetPalmOS(): Promise<void> {
  useSettingsStore.getState().reset();
  await destroyDatabase();
  try {
    localStorage.removeItem('palm-os');
  } catch {
    /* storage may be blocked; the database is what matters */
  }
  window.location.reload();
}
