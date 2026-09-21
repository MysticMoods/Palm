/**
 * System-wide search.
 *
 * Results come from independent providers so a new source (an app's data, a
 * future web index) is added without touching the search UI. Providers may be
 * async; the UI renders whatever has arrived.
 */

import { getApp } from '../app-manager/registry';
import { useAppStore } from '../app-manager/store';
import { categoryForMime, describeMime } from '../filesystem/mime';
import { vfs } from '../filesystem/vfs';
import { OS } from '../os';
import { SETTINGS_SECTIONS } from '../settings/sections';
import { appNamespace, kv } from '../storage/kv';
import { matches } from '../../utils/misc';

export type SearchGroup = 'Applications' | 'Files' | 'Folders' | 'Notes' | 'Settings' | 'Actions';

export interface SearchResult {
  id: string;
  group: SearchGroup;
  title: string;
  subtitle?: string;
  icon: string;
  color?: string;
  /** Relevance; lower sorts first. */
  score: number;
  run: () => void;
}

export interface SearchProvider {
  id: string;
  search: (query: string) => SearchResult[] | Promise<SearchResult[]>;
}

/** Prefix matches rank above substring matches; shorter titles win ties. */
function score(text: string, query: string, base: number): number {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index === -1) return base + 500;
  return base + (index === 0 ? 0 : 50 + index) + haystack.length * 0.05;
}

const appProvider: SearchProvider = {
  id: 'apps',
  search: (query) => {
    const installed = useAppStore.getState();
    return OS.filesystem === undefined
      ? []
      : appsMatching(query).map((app) => ({
          id: `app:${app.id}`,
          group: 'Applications' as const,
          title: app.name,
          subtitle: app.description,
          icon: app.icon,
          color: app.color,
          score: score(app.name, query, 0),
          run: () => OS.openApp(app.id),
        }))
        .filter(() => true)
        .filter((result) => installed.isInstalled(result.id.slice(4)));
  },
};

function appsMatching(query: string) {
  const apps = useAppStore.getState();
  const ids = new Set<string>();
  const results = [];
  for (const id of [...apps.pinned, ...apps.recent]) ids.add(id);
  const all = [...ids].map((id) => getApp(id)).filter(Boolean);
  void all;
  // Search the whole registry, not just recents.
  const registry = (
    [] as Array<ReturnType<typeof getApp>>
  ).concat(...[SETTINGS_SECTIONS.length ? [] : []]);
  void registry;
  return allAppsMatching(query);
}

function allAppsMatching(query: string) {
  const { launchableApps } = require_registry();
  return launchableApps().filter(
    (app: { name: string; description: string; keywords?: string[]; category: string }) =>
      matches(app.name, query) ||
      matches(app.description, query) ||
      matches(app.category, query) ||
      app.keywords?.some((keyword) => matches(keyword, query)),
  );
}

// Indirection kept so the module graph stays acyclic at import time.
function require_registry() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return { launchableApps: registryRef.launchableApps };
}

const registryRef: { launchableApps: () => never[] } = { launchableApps: () => [] };

const fileProvider: SearchProvider = {
  id: 'files',
  search: (query) =>
    vfs.search(query, { limit: 24 }).map((node) => ({
      id: `file:${node.id}`,
      group: node.kind === 'folder' ? ('Folders' as const) : ('Files' as const),
      title: node.name,
      subtitle: `${describeMime(node.mime)} · ${vfs.pathOf(node.id)}`,
      icon: node.kind === 'folder' ? 'Folder' : iconForCategory(categoryForMime(node.mime)),
      score: score(node.name, query, 100),
      run: () => OS.openFile(node),
    })),
};

function iconForCategory(category: string): string {
  const map: Record<string, string> = {
    text: 'FileText',
    code: 'FileCode',
    image: 'FileImage',
    audio: 'FileAudio',
    video: 'FileVideo',
    archive: 'FileArchive',
    document: 'FileText',
  };
  return map[category] ?? 'File';
}

const settingsProvider: SearchProvider = {
  id: 'settings',
  search: (query) =>
    SETTINGS_SECTIONS.filter(
      (section) =>
        matches(section.label, query) ||
        matches(section.description, query) ||
        section.keywords.some((keyword) => matches(keyword, query)),
    ).map((section) => ({
      id: `setting:${section.id}`,
      group: 'Settings' as const,
      title: section.label,
      subtitle: section.description,
      icon: section.icon,
      color: '#8b94a8',
      score: score(section.label, query, 200),
      run: () => OS.openApp('settings', { params: { section: section.id } }),
    })),
};

interface StoredNote {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
}

const notesProvider: SearchProvider = {
  id: 'notes',
  search: async (query) => {
    const notes = (await kv.get<StoredNote[]>(appNamespace('notes'), 'notes')) ?? [];
    return notes
      .filter((note) => matches(note.title, query) || matches(note.body, query))
      .slice(0, 10)
      .map((note) => ({
        id: `note:${note.id}`,
        group: 'Notes' as const,
        title: note.title || 'Untitled note',
        subtitle: note.body.slice(0, 90).replace(/\s+/g, ' ') || 'Empty note',
        icon: 'Notebook',
        color: '#f0b429',
        score: score(note.title || note.body, query, 150),
        run: () => OS.openApp('notes', { params: { noteId: note.id } }),
      }));
  },
};

const providers: SearchProvider[] = [appProvider, fileProvider, settingsProvider, notesProvider];

export function registerSearchProvider(provider: SearchProvider): () => void {
  providers.push(provider);
  return () => {
    const index = providers.indexOf(provider);
    if (index >= 0) providers.splice(index, 1);
  };
}

/** Wire the app registry in after module init, avoiding an import cycle. */
export function connectAppRegistry(launchableApps: () => never[]): void {
  registryRef.launchableApps = launchableApps;
}

export async function runSearch(query: string, limit = 30): Promise<SearchResult[]> {
  const needle = query.trim();
  if (needle.length === 0) return [];

  const settled = await Promise.allSettled(providers.map((provider) => provider.search(needle)));
  const results: SearchResult[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') results.push(...outcome.value);
    else console.warn('[palm/search] provider failed', outcome.reason);
  }
  return results.sort((a, b) => a.score - b.score).slice(0, limit);
}

export const SEARCH_GROUP_ORDER: SearchGroup[] = [
  'Applications',
  'Files',
  'Folders',
  'Notes',
  'Settings',
  'Actions',
];
