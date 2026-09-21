import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const filesApp: AppDefinition = {
  id: 'files',
  name: 'Files',
  description: 'Browse, organise and search your Palm OS filesystem.',
  icon: 'FolderOpen',
  color: '#f0b429',
  category: 'System',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['filesystem', 'clipboard', 'notifications'],
  handles: ['folder'],
  core: true,
  keywords: ['explorer', 'finder', 'folder', 'documents', 'trash', 'recycle bin', 'disk'],
  window: { width: 960, height: 620, minWidth: 460, minHeight: 340 },
  component: lazy(() => import('./FilesApp')),
};
