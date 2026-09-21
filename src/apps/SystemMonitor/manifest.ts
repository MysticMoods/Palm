import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const systemMonitorApp: AppDefinition = {
  id: 'system-monitor',
  name: 'System Monitor',
  description: 'Memory, storage, windows and what the browser will tell us.',
  icon: 'Gauge',
  color: '#69c94a',
  category: 'Utilities',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['storage'],
  core: true,
  keywords: ['task manager', 'performance', 'memory', 'cpu', 'resources', 'activity'],
  window: { width: 880, height: 620, minWidth: 420, minHeight: 360 },
  component: lazy(() => import('./SystemMonitorApp')),
};
