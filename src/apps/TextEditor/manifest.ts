import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const textEditorApp: AppDefinition = {
  id: 'text-editor',
  name: 'Text Editor',
  description: 'Edit text, Markdown and source files with find and replace.',
  icon: 'FileText',
  color: '#5884ff',
  category: 'Productivity',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['filesystem', 'clipboard', 'notifications'],
  handles: ['text', 'code'],
  core: true,
  keywords: ['editor', 'notepad', 'write', 'markdown', 'code', 'txt'],
  window: { width: 880, height: 620, minWidth: 420, minHeight: 320 },
  component: lazy(() => import('./TextEditorApp')),
};
