import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const browserApp: AppDefinition = {
  id: 'browser',
  name: 'Browser',
  description: 'Tabs, bookmarks, history and downloads for the open web.',
  icon: 'Compass',
  color: '#38b6f0',
  category: 'Internet',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['network', 'storage', 'clipboard', 'filesystem'],
  handlesMime: ['text/html'],
  core: true,
  keywords: ['web', 'internet', 'www', 'surf', 'url', 'bookmarks', 'history'],
  window: { width: 1020, height: 680, minWidth: 460, minHeight: 360 },
  component: lazy(() => import('./BrowserApp')),
};
