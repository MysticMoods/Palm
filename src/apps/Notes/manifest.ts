import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const notesApp: AppDefinition = {
  id: 'notes',
  name: 'Notes',
  description: 'Quick notes that save themselves as you type.',
  icon: 'Notebook',
  color: '#f0b429',
  category: 'Productivity',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['storage', 'clipboard', 'filesystem'],
  core: true,
  keywords: ['note', 'memo', 'scratch', 'todo', 'writing'],
  window: { width: 820, height: 560, minWidth: 420, minHeight: 320 },
  component: lazy(() => import('./NotesApp')),
};
