/** Browser tabs, history, bookmarks and downloads. */

import { uid } from '../../utils/misc';
import type { BrowseMode, FramePolicy } from './embedding';
import { INTERNAL_PAGES } from './url';

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  /** Back/forward stack for this tab. */
  history: string[];
  historyIndex: number;
  status: 'idle' | 'loading' | 'loaded' | 'blocked';
  /**
   * Whether this tab is showing the site in a window or handing it to the
   * real browser. Decided from the site's own framing headers, and
   * overridable by the user per tab.
   */
  mode: BrowseMode;
  /** What the site's headers said, once checked. */
  policy: FramePolicy | null;
  /** True while the framing check is in flight. */
  checking: boolean;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  addedAt: number;
}

export interface DownloadRecord {
  id: string;
  url: string;
  filename: string;
  startedAt: number;
  /** Where it landed in the virtual filesystem, when the copy succeeded. */
  savedTo?: string;
  status: 'complete' | 'failed';
  error?: string;
}

export function createTab(url: string = INTERNAL_PAGES.start): BrowserTab {
  return {
    id: uid('tab'),
    title: url === INTERNAL_PAGES.start ? 'New tab' : url,
    url,
    history: [url],
    historyIndex: 0,
    status: 'idle',
    mode: 'embedded',
    policy: null,
    checking: false,
  };
}

/** Navigate a tab, truncating any forward history. */
export function navigateTab(tab: BrowserTab, url: string): BrowserTab {
  if (tab.url === url) return { ...tab, status: 'loading' };
  const history = [...tab.history.slice(0, tab.historyIndex + 1), url];
  return {
    ...tab,
    url,
    title: url,
    history,
    historyIndex: history.length - 1,
    status: 'loading',
    // A new address is a new question: what the last site allowed says
    // nothing about this one.
    policy: null,
    mode: 'embedded',
    checking: false,
  };
}

export function stepTab(tab: BrowserTab, delta: -1 | 1): BrowserTab {
  const index = tab.historyIndex + delta;
  if (index < 0 || index >= tab.history.length) return tab;
  return {
    ...tab,
    historyIndex: index,
    url: tab.history[index],
    status: 'loading',
    policy: null,
    mode: 'embedded',
    checking: false,
  };
}

export const MAX_HISTORY_ENTRIES = 500;
