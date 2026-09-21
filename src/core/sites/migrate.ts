/**
 * Moving applications installed before origin isolation.
 *
 * Schema 2 archived a site into the Palm OS origin's own storage and served it
 * from `/site/<id>/…`. Those applications still work in the sense that their
 * bytes are intact, but they run with the OS's reach — which is exactly what
 * the current design exists to prevent. So they are moved, not left alone and
 * not silently deleted.
 *
 * The bytes are already local, so migration needs no network: each legacy file
 * is re-pathed into the new layout and handed to the application's own origin
 * through the installer, and only once that has succeeded is the legacy copy
 * removed. A migration that fails leaves the old records in place to be tried
 * again, rather than losing somebody's downloaded application.
 */

import { withAppOrigin } from './installer';
import { computeStatus, expectedOffline } from './manifest';
import { newAppId } from './origin';
import { legacySites, installedApps } from './storage';
import type { LegacySitePackage, LegacySiteFile } from './storage';
import {
  ARCHIVE_STATUS,
  ARCHIVE_VERSION,
  DEFAULT_APP_PERMISSIONS,
  EMPTY_DIAGNOSTICS,
  EXT_PREFIX,
} from './types';
import type { AppManifest, ArchiveFile, ArchiveResource, MissingResource } from './types';

export interface MigrationOutcome {
  migrated: AppManifest[];
  failed: Array<{ name: string; error: string }>;
}

/** True when there is anything from the old architecture left to move. */
export async function hasLegacyApps(): Promise<boolean> {
  return (await legacySites.list()).length > 0;
}

/**
 * Re-path a legacy archive entry.
 *
 * Old paths were `<host>/<pathname>` with no leading slash, relative to a
 * `/site/<id>/` prefix. New paths are rooted in the application's own origin,
 * with the primary host at the root and everything else under `/_ext/`.
 */
export function migratePath(legacyPath: string, primaryHost: string): string {
  const cleaned = legacyPath.replace(/^\/+/, '');
  const slash = cleaned.indexOf('/');
  const host = slash > 0 ? cleaned.slice(0, slash) : cleaned;
  const rest = slash > 0 ? cleaned.slice(slash) : '/index.html';
  if (host === primaryHost) return rest.startsWith('/') ? rest : `/${rest}`;
  return `${EXT_PREFIX}${host}${rest.startsWith('/') ? rest : `/${rest}`}`;
}

/**
 * Rewrite the `/site/<id>/…` references baked into migrated HTML and CSS.
 *
 * The old archiver wrote them into the documents themselves, so moving the
 * files without moving the references would produce an application whose every
 * link pointed at a path that no longer exists.
 */
export function migrateReferences(text: string, siteId: string, primaryHost: string): string {
  const pattern = new RegExp(`/site/${escapeRegExp(siteId)}/([^"'\\s)>]+)`, 'g');
  return text.replace(pattern, (_whole, path: string) => migratePath(path, primaryHost));
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Build the new manifest and files for one legacy package. */
export async function prepareMigration(
  legacy: LegacySitePackage,
  files: LegacySiteFile[],
): Promise<{ manifest: AppManifest; files: ArchiveFile[] }> {
  const appId = newAppId();
  const primaryHost = legacy.host;

  const converted: ArchiveFile[] = [];
  const resources: ArchiveResource[] = [];

  for (const file of files) {
    const path = migratePath(file.path, primaryHost);
    const rewritable = /^(text\/html|text\/css|application\/javascript|text\/javascript)/i.test(
      file.mime,
    );

    let data: Blob = file.data;
    if (rewritable) {
      const text = migrateReferences(await file.data.text(), legacy.id, primaryHost);
      data = new Blob([text], { type: file.mime });
    }

    converted.push({
      path,
      url: `https://${primaryHost}${path.startsWith(EXT_PREFIX) ? '' : path}`,
      mime: file.mime,
      data,
      source: 'static',
    });
    resources.push({
      path,
      url: `https://${primaryHost}${path}`,
      mime: file.mime,
      bytes: data.size,
      source: 'static',
    });
  }

  const entry = migratePath(legacy.entry, primaryHost);
  const missing: MissingResource[] = legacy.missing.map((url) => ({ url, reason: 'not-archived' }));
  const status = computeStatus({
    resourceCount: resources.length,
    hasEntry: resources.some((resource) => resource.path === entry),
    missing,
    diagnostics: EMPTY_DIAGNOSTICS,
  });

  const manifest: AppManifest = {
    id: appId,
    name: legacy.name,
    version: '1.0.0',
    source: legacy.url,
    primaryHost,
    entry,
    icon: legacy.icon || 'Globe',
    color: legacy.color || '#38b6f0',
    status,
    offline: expectedOffline(status),
    networkRequired: status === ARCHIVE_STATUS.onlineRequired,
    permissions: [...DEFAULT_APP_PERMISSIONS],
    resources,
    missingResources: missing,
    diagnostics: { ...EMPTY_DIAGNOSTICS },
    bytes: resources.reduce((sum, resource) => sum + resource.bytes, 0),
    fileCount: resources.length,
    createdAt: legacy.installedAt,
    updatedAt: Date.now(),
    archiveVersion: ARCHIVE_VERSION,
  };

  return { manifest, files: converted };
}

/**
 * Move every legacy application onto its own origin.
 *
 * `install` is injected so this can be tested without a browser: the real one
 * opens an installer frame on the application origin.
 */
export async function migrateLegacyApps(
  install: (manifest: AppManifest, files: ArchiveFile[]) => Promise<void> = defaultInstall,
): Promise<MigrationOutcome> {
  const legacy = await legacySites.list();
  const outcome: MigrationOutcome = { migrated: [], failed: [] };

  for (const site of legacy) {
    try {
      const files = await legacySites.filesOf(site.id);
      const prepared = await prepareMigration(site, files);
      await install(prepared.manifest, prepared.files);
      await installedApps.save(prepared.manifest);
      // Only now: a half-migrated application must not lose its only copy.
      await legacySites.remove(site.id);
      outcome.migrated.push(prepared.manifest);
    } catch (error) {
      outcome.failed.push({
        name: site.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcome;
}

async function defaultInstall(manifest: AppManifest, files: ArchiveFile[]): Promise<void> {
  await withAppOrigin(manifest.id, (channel) =>
    channel.require('palm.install', { manifest, files }),
  );
}
