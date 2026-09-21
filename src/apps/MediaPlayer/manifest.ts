import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const mediaPlayerApp: AppDefinition = {
  id: 'media-player',
  name: 'Media Player',
  description: 'Play audio and video files stored in Palm OS.',
  icon: 'Film',
  color: '#f25ec0',
  category: 'Media',
  version: '1.0.0',
  developer: 'Palm OS',
  permissions: ['filesystem'],
  handles: ['audio', 'video'],
  core: true,
  keywords: ['music', 'video', 'play', 'sound', 'mp3', 'mp4', 'playlist'],
  window: { width: 820, height: 560, minWidth: 380, minHeight: 300 },
  component: lazy(() => import('./MediaPlayerApp')),
};
