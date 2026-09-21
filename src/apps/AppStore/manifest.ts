import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const appStoreApp: AppDefinition = {
  id: 'app-store',
  name: 'App Store',
  description: 'Install and remove Palm OS applications.',
  icon: 'Package',
  color: '#5884ff',
  category: 'System',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['storage', 'notifications'],
  core: true,
  keywords: ['install', 'uninstall', 'apps', 'packages', 'software', 'store'],
  window: { width: 900, height: 640, minWidth: 420, minHeight: 360, singleton: true },
  component: lazy(() => import('./AppStoreApp')),
};
