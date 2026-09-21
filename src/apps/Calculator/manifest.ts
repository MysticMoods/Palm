import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const calculatorApp: AppDefinition = {
  id: 'calculator',
  name: 'Calculator',
  description: 'Arithmetic and scientific functions with a running history.',
  icon: 'Calculator',
  color: '#69c94a',
  category: 'Utilities',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['clipboard', 'storage'],
  core: true,
  keywords: ['math', 'maths', 'arithmetic', 'scientific', 'sum', 'percent'],
  window: { width: 380, height: 560, minWidth: 300, minHeight: 420 },
  component: lazy(() => import('./CalculatorApp')),
};
