/**
 * Installed web applications, from Palm OS's point of view.
 *
 * Installing is more than downloading. The sequence is:
 *
 *   archive → write into the application's own origin → start it once
 *   → fold what it actually asked for back into the manifest → publish
 *
 * That third step is the one that matters for honesty. A modern bundle decides
 * at runtime what to load, so an archive built from static analysis alone is a
 * guess; running the application in its own isolated origin and recording what
 * its service worker could not serve is the only way to know. The result is a
 * status the user can rely on rather than a hopeful "installed".
 *
 * Applications register with the app registry as they load, so they appear in
 * the start menu, search and the taskbar exactly like built-in applications.
 */

import { create } from 'zustand';
import { lazy } from 'react';
import { appSecurityHeaders } from '../../../shared/app-policy.mjs';
import { registerApp, unregisterApp } from '../app-manager/registry';
import { useAppStore } from '../app-manager/store';
import { notifications } from '../notifications/store';
import { archiveSite } from './archive';
import { AppOriginChannel, withAppOrigin } from './installer';
import { applyValidation, sanitisePermissions, statusSummary } from './manifest';
import { migrateLegacyApps, hasLegacyApps } from './migrate';
import { appOrigin, isolationStatus, osOrigin } from './origin';
import { installedApps } from './storage';
import {
  APP_PERMISSIONS,
  ARCHIVE_STATUS,
  DEFAULT_APP_PERMISSIONS,
  ArchiveError,
} from './types';
import type { AppManifest, AppPermission, ArchiveFile, ArchiveProgress } from './types';

/** Every installed application shares one viewer component, keyed by id. */
const AppViewer = lazy(() => import('../../apps/SiteViewer/SiteViewerApp'));

/** App ids are namespaced so an archive cannot shadow a built-in application. */
export const siteAppId = (id: string) => `site:${id}`;

/** How long to let an application run before asking what it loaded. */
const VALIDATION_SETTLE_MS = 3000;
const VALIDATION_LOAD_TIMEOUT_MS = 20_000;

interface SitesState {
  installed: AppManifest[];
  /** Archive in progress, keyed by the URL being downloaded. */
  downloading: Record<string, ArchiveProgress>;
  ready: boolean;
  /** Set when applications from the pre-isolation architecture were moved. */
  migrated: number;
  /**
   * Applications whose manifest Palm OS holds but whose files are gone from
   * their own origin — a restored backup, or storage the browser reclaimed.
   */
  missingArchives: string[];

  load: () => Promise<void>;
  install: (url: string, options?: InstallOptions) => Promise<AppManifest | null>;
  reinstall: (id: string) => Promise<AppManifest | null>;
  uninstall: (id: string) => Promise<void>;
  setPermissions: (id: string, permissions: AppPermission[]) => Promise<void>;
  revalidate: (id: string) => Promise<AppManifest | null>;
  verifyArchives: () => Promise<string[]>;
}

export interface InstallOptions {
  name?: string;
  /**
   * Reuse an existing application id instead of minting one.
   *
   * Re-downloading keeps the origin, so whatever the application stored for
   * itself survives — losing someone's documents to fix a missing archive
   * would be a strange trade.
   */
  appId?: string;
  /**
   * Start the application once, with network access, so the resources it loads
   * at runtime are captured too. On by default: without it, anything that
   * code-splits archives incomplete and says so.
   */
  captureRuntime?: boolean;
}

/* --------------------------------------------------------------------- *
 * The manifest as the application's own origin sees it
 * --------------------------------------------------------------------- */

/**
 * Palm OS keeps the full manifest; the service worker needs a slice of it.
 *
 * The security headers are computed here, on the OS side, from the same module
 * the server uses — so the policy applied to a worker-served response cannot
 * drift from the one the server sends with the bootstrap document.
 */
function workerManifest(manifest: AppManifest, permissions: AppPermission[]) {
  const os = osOrigin();
  return {
    id: manifest.id,
    name: manifest.name,
    entry: manifest.entry,
    primaryHost: manifest.primaryHost,
    osOrigin: os,
    permissions,
    security: {
      offline: appSecurityHeaders({ osOrigin: os, allowNetwork: false }),
      online: appSecurityHeaders({ osOrigin: os, allowNetwork: true }),
    },
  };
}

/** Make an installed application launchable like any other. */
function publish(manifest: AppManifest): void {
  registerApp({
    id: siteAppId(manifest.id),
    name: manifest.name,
    description: `Installed from ${manifest.primaryHost}`,
    icon: manifest.icon,
    color: manifest.color,
    category: 'Internet',
    version: manifest.version,
    developer: manifest.primaryHost,
    permissions: ['storage'],
    keywords: ['offline', 'web app', 'installed', manifest.primaryHost],
    window: { width: 1000, height: 680, minWidth: 420, minHeight: 320 },
    props: { siteId: manifest.id },
    component: AppViewer,
  });
  useAppStore.getState().install(siteAppId(manifest.id));
}

export const useSitesStore = create<SitesState>()((set, get) => ({
  installed: [],
  downloading: {},
  ready: false,
  migrated: 0,
  missingArchives: [],

  /* ------------------------------- Loading ------------------------------ */

  load: async () => {
    const installed = await installedApps.list();
    for (const manifest of installed) publish(manifest);
    set({ installed, ready: true });

    // Applications from before origin isolation are moved on first boot.
    if (await hasLegacyApps()) void migrateOnBoot(set, get);

    /*
     * Check the archives are actually still there — after a restored backup
     * they will not be, and a browser under storage pressure can reclaim an
     * application origin. Deliberately not awaited: it loads a frame per
     * application, and the desktop should not wait on it.
     */
    if (installed.length > 0) void get().verifyArchives();
  },

  /* ------------------------------ Installing ---------------------------- */

  install: async (url, options = {}) => {
    const normalised = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    if (get().downloading[normalised]) return null;

    const progress = (value: ArchiveProgress) =>
      set((state) => ({ downloading: { ...state.downloading, [normalised]: value } }));

    progress({ stage: 'fetching', message: 'Starting…', fetched: 0, total: 1 });

    try {
      const isolation = await isolationStatus();
      if (!isolation.available) {
        throw new ArchiveError(
          `${isolation.reason} Installing would mean running downloaded code on the Palm OS origin, which Palm OS will not do.`,
        );
      }
      if (!isolation.serviceWorkers) {
        throw new ArchiveError(
          'Service workers are unavailable in this browser context, so an application cannot be served offline.',
        );
      }

      const { manifest, files } = await archiveSite(normalised, {
        name: options.name,
        appId: options.appId,
        onProgress: progress,
      });

      const capture = options.captureRuntime !== false;
      progress({ stage: 'installing', message: 'Writing to its own origin…', fetched: 0, total: 1 });
      await writeToAppOrigin(manifest, files, capture);

      let final = manifest;
      if (capture) {
        progress({ stage: 'validating', message: 'Starting it once to see what it loads…', fetched: 0, total: 1 });
        final = await validateInPlace(manifest);
      }

      // Whatever happened during capture, the application settles on its
      // requested permissions — which do not include network access.
      await applyPermissions(final, final.permissions);

      await installedApps.save(final);
      publish(final);
      set((state) => ({
        installed: [final, ...state.installed.filter((m) => m.id !== final.id)],
        // Whatever was missing about this one no longer is.
        missingArchives: state.missingArchives.filter((id) => id !== final.id),
      }));

      notifications.push('app-store', {
        title:
          final.status === ARCHIVE_STATUS.complete
            ? `${final.name} is installed and works offline`
            : final.status === ARCHIVE_STATUS.onlineRequired
              ? `${final.name} is installed, but it will not work offline`
              : `${final.name} is installed, with pieces missing`,
        body: statusSummary(final),
        /*
         * An archive that will not do what the user expected is the one worth
         * interrupting for. Marking it low — as this did — put the quietest
         * notification on the outcome that most needs reading.
         */
        urgency: final.status === ARCHIVE_STATUS.complete ? 'low' : 'normal',
      });
      return final;
    } catch (error) {
      notifications.push('app-store', {
        title: 'Could not install that application',
        body: error instanceof Error ? error.message : String(error),
        urgency: 'critical',
      });
      return null;
    } finally {
      set((state) => {
        const downloading = { ...state.downloading };
        delete downloading[normalised];
        return { downloading };
      });
    }
  },

  /**
   * Download an application again, keeping its id and therefore its origin.
   *
   * Used when the files are gone but the manifest is not: a backup restored
   * onto a fresh browser, or storage the browser reclaimed under pressure.
   */
  reinstall: async (id) => {
    const manifest = get().installed.find((candidate) => candidate.id === id);
    if (!manifest) return null;
    return get().install(manifest.source, {
      name: manifest.name,
      appId: manifest.id,
      captureRuntime: false,
    });
  },

  /* ------------------------------ Verifying ----------------------------- */

  /**
   * Ask each application's origin whether it still has its files.
   *
   * Palm OS cannot read that storage, so the only way to know is to ask the
   * service worker over there. Done one at a time: each check loads a frame on
   * another origin, and doing several at once for no benefit would make boot
   * feel worse than it is.
   */
  verifyArchives: async () => {
    const missing: string[] = [];

    for (const manifest of get().installed) {
      try {
        const present = await withAppOrigin(manifest.id, async (channel) => {
          const result = await channel.send('palm.status');
          return result?.installed === true;
        });
        if (!present) missing.push(manifest.id);
      } catch {
        // An origin that cannot be reached at all counts as missing; the
        // remedy offered is the same either way.
        missing.push(manifest.id);
      }
    }

    set({ missingArchives: missing });
    return missing;
  },

  /* ----------------------------- Uninstalling --------------------------- */

  uninstall: async (id) => {
    /*
     * The bytes are on the application's origin, so removal has to be asked
     * for there. A failure must not strand the manifest: the entry is removed
     * either way, and the application origin's storage is the browser's to
     * reclaim if the frame could not be reached.
     */
    try {
      await withAppOrigin(id, (channel) => channel.require('palm.uninstall'));
    } catch (error) {
      console.warn('[palm/sites] could not clear the application origin:', error);
    }

    await installedApps.remove(id);
    useAppStore.getState().uninstall(siteAppId(id));
    unregisterApp(siteAppId(id));
    set((state) => ({
      installed: state.installed.filter((manifest) => manifest.id !== id),
      missingArchives: state.missingArchives.filter((candidate) => candidate !== id),
    }));
  },

  /* ------------------------------ Permissions --------------------------- */

  setPermissions: async (id, permissions) => {
    const manifest = get().installed.find((candidate) => candidate.id === id);
    if (!manifest) return;

    const cleaned = sanitisePermissions(
      [...DEFAULT_APP_PERMISSIONS, ...permissions],
      APP_PERMISSIONS,
    );
    const next: AppManifest = { ...manifest, permissions: cleaned, updatedAt: Date.now() };

    await applyPermissions(next, cleaned);
    await installedApps.save(next);
    set((state) => ({
      installed: state.installed.map((candidate) => (candidate.id === id ? next : candidate)),
    }));
  },

  /* ------------------------------ Validation ---------------------------- */

  revalidate: async (id) => {
    const manifest = get().installed.find((candidate) => candidate.id === id);
    if (!manifest) return null;

    const updated = await validateInPlace(manifest);
    await installedApps.save(updated);
    publish(updated);
    set((state) => ({
      installed: state.installed.map((candidate) => (candidate.id === id ? updated : candidate)),
    }));
    return updated;
  },
}));

/* --------------------------------------------------------------------- *
 * Steps
 * --------------------------------------------------------------------- */

/** Hand the archive to the application's own origin. */
async function writeToAppOrigin(
  manifest: AppManifest,
  files: ArchiveFile[],
  captureRuntime: boolean,
): Promise<void> {
  /*
   * During capture the application is allowed network access, because that is
   * what capture *is*: starting it once, with a connection, to find the chunks
   * static analysis could not. Afterwards it drops back to its real permissions.
   */
  const permissions: AppPermission[] = captureRuntime
    ? [...manifest.permissions, 'NETWORK']
    : [...manifest.permissions];

  await withAppOrigin(manifest.id, (channel) =>
    channel.require('palm.install', {
      manifest: workerManifest(manifest, permissions),
      files,
    }),
  );
}

/** Push a permission set through to the application's service worker. */
async function applyPermissions(
  manifest: AppManifest,
  permissions: AppPermission[],
): Promise<void> {
  const worker = workerManifest(manifest, permissions);
  await withAppOrigin(manifest.id, (channel) =>
    channel.require('palm.permissions', {
      permissions,
      security: worker.security,
    }),
  );
}

/**
 * Start the application once and record what it loaded.
 *
 * The frame runs on the application's own origin, so this is the application
 * executing normally — in the same isolation it will have every time it is
 * opened, not a special mode with extra reach.
 */
async function validateInPlace(manifest: AppManifest): Promise<AppManifest> {
  const origin = appOrigin(manifest.id);
  if (!origin) return manifest;

  await runOnce(`${origin}${manifest.entry}`, manifest.name);

  try {
    const channel = await AppOriginChannel.open(manifest.id);
    try {
      const result = await channel.require('palm.report', { reset: true });
      return applyValidation(manifest, {
        misses: Array.isArray(result.misses) ? (result.misses as Array<{ url: string; reason: string }>) : [],
        captured: Array.isArray(result.captured)
          ? (result.captured as Array<{ path: string; url: string; bytes: number; mime: string }>)
          : [],
      });
    } finally {
      channel.close();
    }
  } catch (error) {
    // A validation that cannot be collected leaves the static status standing,
    // which is the conservative direction: it will not claim COMPLETE.
    console.warn('[palm/sites] validation report unavailable:', error);
    return manifest;
  }
}

/** Load a URL in a hidden frame, wait for it to settle, then discard it. */
function runOnce(url: string, name: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('title', `Checking ${name}`);
    // Not visible, but given a real size: a bundle that lazy-loads on layout
    // would load nothing at all in a zero-sized frame.
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;visibility:hidden';

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(hardStop);
      frame.remove();
      resolve();
    };

    const hardStop = setTimeout(finish, VALIDATION_LOAD_TIMEOUT_MS);
    frame.addEventListener('load', () => {
      // `load` fires when the document is ready; the interesting requests come
      // after that, as the bundle boots and pulls in what it needs.
      setTimeout(finish, VALIDATION_SETTLE_MS);
    });

    frame.src = url;
    document.body.appendChild(frame);
  });
}

/* --------------------------------------------------------------------- *
 * Migration
 * --------------------------------------------------------------------- */

type SetState = (partial: Partial<SitesState> | ((state: SitesState) => Partial<SitesState>)) => void;

/** Move pre-isolation applications onto their own origins, in the background. */
async function migrateOnBoot(set: SetState, get: () => SitesState): Promise<void> {
  const isolation = await isolationStatus();
  if (!isolation.available) {
    notifications.push('app-store', {
      title: 'Downloaded applications are not available here',
      body: `${isolation.reason} They were installed under an older design that shared the Palm OS origin, and will not be run that way.`,
      urgency: 'critical',
    });
    return;
  }

  const outcome = await migrateLegacyApps();
  if (outcome.migrated.length > 0) {
    for (const manifest of outcome.migrated) publish(manifest);
    set({
      installed: [...outcome.migrated, ...get().installed],
      migrated: outcome.migrated.length,
    });
    notifications.push('app-store', {
      title: `Moved ${outcome.migrated.length} application${outcome.migrated.length === 1 ? '' : 's'} to isolated origins`,
      body: 'They previously ran with the same access as Palm OS itself. Each one now has its own origin and its own storage.',
    });
  }
  if (outcome.failed.length > 0) {
    notifications.push('app-store', {
      title: 'Some applications could not be moved',
      body: outcome.failed.map((entry) => `${entry.name}: ${entry.error}`).join('; '),
      urgency: 'critical',
    });
  }
}

export { installedApps };
