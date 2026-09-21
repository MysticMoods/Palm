import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const settingsApp: AppDefinition = {
  id: 'settings',
  name: 'Settings',
  description: 'Personalisation, display, sound, privacy and system options.',
  icon: 'Settings',
  color: '#8b94a8',
  category: 'System',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['filesystem', 'storage', 'notifications'],
  core: true,
  keywords: ['preferences', 'options', 'control panel', 'config', 'theme', 'wallpaper'],
  window: { width: 940, height: 640, minWidth: 460, minHeight: 380, singleton: true },
  component: lazy(() => import('./SettingsApp')),
};
