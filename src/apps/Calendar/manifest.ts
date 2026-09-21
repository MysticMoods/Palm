import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const calendarApp: AppDefinition = {
  id: 'calendar',
  name: 'Calendar',
  description: 'A month view with events that persist between sessions.',
  icon: 'CalendarDays',
  color: '#f25ec0',
  category: 'Productivity',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['storage', 'notifications'],
  core: true,
  keywords: ['events', 'schedule', 'agenda', 'month', 'date', 'appointment'],
  window: { width: 860, height: 620, minWidth: 460, minHeight: 400 },
  component: lazy(() => import('./CalendarApp')),
};
