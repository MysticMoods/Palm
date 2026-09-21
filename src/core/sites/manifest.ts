/**
 * Deciding, and explaining, how complete an archive is.
 *
 * Kept apart from the archiver so the rules are testable on their own: the
 * difference between "works offline" and "looks like it works offline" is the
 * single most misleading thing this feature could get wrong, and it should not
 * depend on having successfully downloaded half the internet first.
 */

import { ARCHIVE_STATUS } from './types';
import type {
  AppManifest,
  AppPermission,
  ArchiveDiagnostics,
  ArchiveStatus,
  MissingResource,
} from './types';

export interface StatusInput {
  resourceCount: number;
  /** Whether the entry document itself was archived. */
  hasEntry: boolean;
  missing: MissingResource[];
  diagnostics: ArchiveDiagnostics;
}

/**
 * The headline status for an archive.
 *
 * Ordered by what the user most needs to know. An application that needs a
 * server is `ONLINE_REQUIRED` even if every file was captured, because the
 * files were never the problem.
 */
export function computeStatus(input: StatusInput): ArchiveStatus {
  if (!input.hasEntry || input.resourceCount === 0) return ARCHIVE_STATUS.failed;

  const { diagnostics } = input;
  if (diagnostics.websockets.length > 0 || diagnostics.backendHints.length > 0) {
    return ARCHIVE_STATUS.onlineRequired;
  }
  if (input.missing.length > 0 || diagnostics.truncated) return ARCHIVE_STATUS.partial;
  return ARCHIVE_STATUS.complete;
}

/** Whether an archive with this status should be expected to run offline. */
export function expectedOffline(status: ArchiveStatus): boolean {
  return status === ARCHIVE_STATUS.complete || status === ARCHIVE_STATUS.partial;
}

/**
 * One sentence saying what the user will actually get, in their own terms.
 *
 * The App Store shows this next to the badge. It deliberately does not soften:
 * "may be incomplete" is not useful when we know exactly what is missing.
 */
export function statusSummary(manifest: Pick<AppManifest, 'status' | 'missingResources' | 'diagnostics'>): string {
  const missing = manifest.missingResources.length;
  const { diagnostics } = manifest;

  switch (manifest.status) {
    case ARCHIVE_STATUS.complete:
      return 'Everything this application needs was downloaded. It runs with no network at all.';

    case ARCHIVE_STATUS.partial: {
      if (diagnostics.truncated) {
        return `The archive hit its size limit${missing > 0 ? ` with ${missing} resource${missing === 1 ? '' : 's'} left` : ''}. Parts of this application will be missing offline.`;
      }
      return `${missing} resource${missing === 1 ? '' : 's'} could not be downloaded. The application runs, but parts of it will be missing offline.`;
    }

    case ARCHIVE_STATUS.onlineRequired: {
      const reasons: string[] = [];
      if (diagnostics.websockets.length > 0) reasons.push('a live connection');
      if (diagnostics.backendHints.length > 0) reasons.push('a server of its own');
      return `The front end was archived successfully, but this application needs ${reasons.join(' and ')} to do anything useful. It will not work offline.`;
    }

    case ARCHIVE_STATUS.failed:
    default:
      return 'This application could not be archived.';
  }
}

/** Short badge text, for the launcher and the manager. */
export function statusLabel(status: ArchiveStatus): string {
  switch (status) {
    case ARCHIVE_STATUS.complete:
      return 'Offline';
    case ARCHIVE_STATUS.partial:
      return 'Partial archive';
    case ARCHIVE_STATUS.onlineRequired:
      return 'Online required';
    case ARCHIVE_STATUS.failed:
    default:
      return 'Failed';
  }
}

/**
 * Fold a validation run's findings back into a manifest.
 *
 * Running an application is the only way to learn what it loads lazily, so an
 * archive's status is provisional until it has been started once. Resources
 * captured at runtime resolve misses; requests that still failed become
 * misses. Either way the status is recomputed rather than assumed.
 */
export interface ValidationReport {
  /** Requests the worker could not satisfy. */
  misses: Array<{ url: string; reason: string }>;
  /** Resources fetched during the run and kept. */
  captured: Array<{ path: string; url: string; bytes: number; mime: string }>;
}

export function applyValidation(manifest: AppManifest, report: ValidationReport): AppManifest {
  const captured = report.captured.map((entry) => ({
    path: entry.path,
    url: entry.url,
    mime: entry.mime,
    bytes: entry.bytes,
    source: 'runtime' as const,
  }));

  const capturedUrls = new Set(captured.map((entry) => entry.url));
  const resources = [...manifest.resources];
  for (const entry of captured) {
    if (!resources.some((existing) => existing.path === entry.path)) resources.push(entry);
  }

  /*
   * A `spa-fallback` miss is not a missing resource: it is a client-side route
   * the application's own router will handle. Counting it would mark every
   * single-page application partial for doing exactly what it is meant to do.
   */
  const misses = report.misses.filter((miss) => miss.reason !== 'spa-fallback');

  const missing: MissingResource[] = [
    ...manifest.missingResources.filter((entry) => !capturedUrls.has(entry.url)),
    ...misses
      .filter(
        (miss) =>
          !capturedUrls.has(miss.url) &&
          !manifest.missingResources.some((existing) => existing.url === miss.url),
      )
      .map((miss) => ({ url: miss.url, reason: miss.reason })),
  ];

  const diagnostics: ArchiveDiagnostics = {
    ...manifest.diagnostics,
    dynamicImports: manifest.diagnostics.dynamicImports + captured.length,
  };

  const status = computeStatus({
    resourceCount: resources.length,
    hasEntry: resources.some((entry) => entry.path === manifest.entry),
    missing,
    diagnostics,
  });

  return {
    ...manifest,
    resources,
    missingResources: missing,
    diagnostics,
    status,
    offline: expectedOffline(status),
    networkRequired: status === ARCHIVE_STATUS.onlineRequired,
    bytes: resources.reduce((sum, entry) => sum + entry.bytes, 0),
    fileCount: resources.length,
    updatedAt: Date.now(),
  };
}

/** Permissions are only ever the ones we recognise, and never duplicated. */
export function sanitisePermissions(input: unknown, allowed: readonly AppPermission[]): AppPermission[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<AppPermission>();
  for (const value of input) {
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
      set.add(value as AppPermission);
    }
  }
  return [...set];
}
