/**
 * Installed web applications: sites archived into Palm OS so they run offline.
 *
 * An installed application lives on its own origin (`app-<id>.<host>`) and its
 * archive lives in that origin's storage. What Palm OS keeps here is the
 * manifest — metadata only, never the bytes — which is what the App Store
 * lists, what the launcher registers, and what the user is shown before they
 * agree to install anything.
 */

/* --------------------------------------------------------------------- *
 * Completeness
 * --------------------------------------------------------------------- */

/**
 * How much of an application actually made it into the archive.
 *
 * The categories exist so the OS never has to imply "this works offline" when
 * it does not know that. An application that quietly renders half of itself is
 * worse than one that says what is missing.
 */
export const ARCHIVE_STATUS = {
  /** Everything it asked for during archiving and validation was captured. */
  complete: 'COMPLETE',
  /** It runs, but some resources could not be captured. */
  partial: 'PARTIAL',
  /** The front end is archived; it still needs a server to be useful. */
  onlineRequired: 'ONLINE_REQUIRED',
  /** The archive could not be built or validated at all. */
  failed: 'FAILED',
} as const;

export type ArchiveStatus = (typeof ARCHIVE_STATUS)[keyof typeof ARCHIVE_STATUS];

/* --------------------------------------------------------------------- *
 * Permissions
 * --------------------------------------------------------------------- */

/**
 * What an installed application is allowed to do.
 *
 * Distinct from the OS's own `Permission` vocabulary: these are granted to
 * third-party code on another origin, and the default for every one of them is
 * "no". `STORAGE` is the exception only in the sense that an application always
 * has its own origin's storage — which Palm OS could not take away if it
 * wanted to, and which reaches nothing but the application itself.
 */
export const APP_PERMISSIONS = [
  'NETWORK',
  'STORAGE',
  'FILES',
  'CLIPBOARD',
  'NOTIFICATIONS',
  'WINDOW_CONTROL',
  'SYSTEM_API',
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

export interface AppPermissionDescriptor {
  id: AppPermission;
  label: string;
  /** Plain language, shown in the install dialog and the manager. */
  description: string;
  icon: string;
  /** True when the application has it whether or not Palm OS agrees. */
  inherent?: boolean;
}

export const APP_PERMISSION_INFO: Record<AppPermission, AppPermissionDescriptor> = {
  NETWORK: {
    id: 'NETWORK',
    label: 'Network access',
    description:
      'Contact servers over the internet. Off by default: an offline copy should not need it, and blocking it stops archived code phoning home.',
    icon: 'Wifi',
  },
  STORAGE: {
    id: 'STORAGE',
    label: 'Its own storage',
    description:
      'Keep data in its own isolated storage. This reaches nothing belonging to Palm OS or to any other application.',
    icon: 'Database',
    inherent: true,
  },
  FILES: {
    id: 'FILES',
    label: 'Open and save files',
    description: 'Ask Palm OS to open or save a file. Every request shows you the file first.',
    icon: 'FolderOpen',
  },
  CLIPBOARD: {
    id: 'CLIPBOARD',
    label: 'Clipboard',
    description: 'Put text on the system clipboard.',
    icon: 'Clipboard',
  },
  NOTIFICATIONS: {
    id: 'NOTIFICATIONS',
    label: 'Notifications',
    description: 'Post notifications to the Palm OS notification centre.',
    icon: 'Bell',
  },
  WINDOW_CONTROL: {
    id: 'WINDOW_CONTROL',
    label: 'Window control',
    description: 'Set its own window title, and close its own window.',
    icon: 'AppWindow',
  },
  SYSTEM_API: {
    id: 'SYSTEM_API',
    label: 'System information',
    description: 'Read basic system information such as the colour theme.',
    icon: 'Settings',
  },
};

/** Nothing is granted on installation. The user turns things on deliberately. */
export const DEFAULT_APP_PERMISSIONS: AppPermission[] = ['STORAGE'];

/* --------------------------------------------------------------------- *
 * Manifest
 * --------------------------------------------------------------------- */

/** One archived resource. The bytes live on the application's origin. */
export interface ArchiveResource {
  /** Path within the application origin, e.g. `/assets/main.js`. */
  path: string;
  /** Where it came from. */
  url: string;
  mime: string;
  bytes: number;
  /** Whether static analysis found it, or the application requested it. */
  source: 'static' | 'runtime';
}

export interface MissingResource {
  url: string;
  reason: string;
}

/**
 * Signals gathered while archiving that bear on whether this can work offline.
 *
 * These are reported, never used to silently change behaviour: a site that
 * opens a WebSocket is not broken, it just cannot be fully offline, and the
 * user is the one who should decide what to do about that.
 */
export interface ArchiveDiagnostics {
  /** WebSocket endpoints referenced in the code. */
  websockets: string[];
  /** Hints that the application talks to a backend (API paths, fetch calls). */
  backendHints: string[];
  /** The original site registered a service worker of its own. */
  serviceWorker: boolean;
  /** WebAssembly modules were referenced. */
  wasm: boolean;
  /** Web Workers were referenced. */
  workers: number;
  /** Dynamic `import()` calls, which static analysis cannot follow. */
  dynamicImports: number;
  /** The archive hit a size or count limit before it ran out of references. */
  truncated: boolean;
}

export const EMPTY_DIAGNOSTICS: ArchiveDiagnostics = {
  websockets: [],
  backendHints: [],
  serviceWorker: false,
  wasm: false,
  workers: 0,
  dynamicImports: 0,
  truncated: false,
};

export interface AppManifest {
  /** `app-<12 hex>`; also the subdomain label of the application's origin. */
  id: string;
  name: string;
  version: string;
  /** The address it was archived from. */
  source: string;
  /** Host of the entry document; resources from elsewhere live under /_ext/. */
  primaryHost: string;
  /** Path the application opens at, within its own origin. */
  entry: string;
  icon: string;
  color: string;

  status: ArchiveStatus;
  /** True when it is expected to run with no network at all. */
  offline: boolean;
  /** True when it needs a server to be useful, whatever was archived. */
  networkRequired: boolean;

  permissions: AppPermission[];
  resources: ArchiveResource[];
  missingResources: MissingResource[];
  diagnostics: ArchiveDiagnostics;

  bytes: number;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
  /** Bumped when the archive format changes, so old installs can be migrated. */
  archiveVersion: number;
}

export const ARCHIVE_VERSION = 2;

/* --------------------------------------------------------------------- *
 * Transfer
 * --------------------------------------------------------------------- */

/** A resource on its way to an application origin. */
export interface ArchiveFile {
  path: string;
  url: string;
  mime: string;
  data: Blob;
  source: 'static' | 'runtime';
}

/** Progress reported while archiving, so the UI can show something truthful. */
export interface ArchiveProgress {
  stage: 'fetching' | 'parsing' | 'assets' | 'installing' | 'validating' | 'done';
  message: string;
  fetched: number;
  total: number;
}

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

/** Where third-party hosts' resources are placed inside an application origin. */
export const EXT_PREFIX = '/_ext/';
