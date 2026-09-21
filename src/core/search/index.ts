/**
 * System-wide search.
 *
 * Results come from independent providers, so a new source (an app's data, a
 * future web index) is added without touching the search UI. Providers may be
 * async; failures are logged and skipped rather than breaking the whole query.
 */

import { launchableApps } from '../app-manager/registry';
import { useAppStore } from '../app-manager/store';
import { categoryForMime, describeMime } from '../filesystem/mime';
import { vfs } from '../filesystem/vfs';
import { OS } from '../os';
import { SETTINGS_SECTIONS } from '../settings/sections';
import { appNamespace, kv } from '../storage/kv';
import { matches } from '../../utils/misc';

export type SearchGroup = 'Applications' | 'Files' | 'Folders' | 'Notes' | 'Settings';

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

/**
 * Rank a candidate. `base` separates the groups (apps before files before
 * settings); within a group, prefix matches beat mid-word matches and shorter
 * titles beat longer ones.
 */
function score(text: string, query: string, base: number): number {
  const haystack = text.toLowerCase();
  const index = haystack.indexOf(query.toLowerCase());
  if (index === -1) return base + 400;
  return base + (index === 0 ? 0 : 40 + index) + haystack.length * 0.05;
}

const CATEGORY_ICONS: Record<string, string> = {
  text: 'FileText',
  code: 'FileCode',
  image: 'FileImage',
  audio: 'FileAudio',
  video: 'FileVideo',
  archive: 'FileArchive',
  document: 'FileText',
};

const appProvider: SearchProvider = {
  id: 'apps',
  search: (query) => {
    const store = useAppStore.getState();
    return launchableApps()
      .filter((app) => store.isInstalled(app.id))
      .filter(
        (app) =>
          matches(app.name, query) ||
          matches(app.description, query) ||
          matches(app.category, query) ||
          (app.keywords?.some((keyword) => matches(keyword, query)) ?? false),
      )
      .map((app) => ({
        id: `app:${app.id}`,
        group: 'Applications' as const,
        title: app.name,
        subtitle: app.description,
        icon: app.icon,
        color: app.color,
        score: score(app.name, query, 0),
        run: () => OS.openApp(app.id),
      }));
  },
};

const fileProvider: SearchProvider = {
  id: 'files',
  search: (query) =>
    vfs.search(query, { limit: 24 }).map((node) => ({
      id: `file:${node.id}`,
      group: node.kind === 'folder' ? ('Folders' as const) : ('Files' as const),
      title: node.name,
      subtitle: `${describeMime(node.mime)} · ${vfs.pathOf(node.id)}`,
      icon: node.kind === 'folder' ? 'Folder' : (CATEGORY_ICONS[categoryForMime(node.mime)] ?? 'File'),
      color: node.kind === 'folder' ? '#f0c060' : '#7f8aa3',
      score: score(node.name, query, 100),
      run: () => OS.openFile(node),
    })),
};

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

/** Shape the Notes app persists; kept in sync with `apps/Notes/storage.ts`. */
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
];
