import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const terminalApp: AppDefinition = {
  id: 'terminal',
  name: 'Terminal',
  description: 'A shell for the Palm OS virtual filesystem.',
  icon: 'SquareTerminal',
  color: '#2bc4b0',
  category: 'Development',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['filesystem', 'clipboard', 'notifications'],
  core: true,
  keywords: ['shell', 'console', 'command line', 'bash', 'cli', 'prompt'],
  window: { width: 780, height: 500, minWidth: 380, minHeight: 240 },
  component: lazy(() => import('./TerminalApp')),
};
