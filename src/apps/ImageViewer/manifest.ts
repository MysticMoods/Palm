import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const imageViewerApp: AppDefinition = {
  id: 'image-viewer',
  name: 'Image Viewer',
  description: 'View, zoom and rotate images from your filesystem.',
  icon: 'Image',
  color: '#a06bff',
  category: 'Media',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['filesystem'],
  handles: ['image'],
  core: true,
  keywords: ['photo', 'picture', 'gallery', 'png', 'jpeg', 'svg', 'zoom'],
  window: { width: 900, height: 640, minWidth: 380, minHeight: 300 },
  component: lazy(() => import('./ImageViewerApp')),
};
