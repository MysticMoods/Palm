/** Application permission vocabulary. */

export type Permission =
  | 'filesystem'
  | 'notifications'
  | 'clipboard'
  | 'microphone'
  | 'camera'
  | 'location'
  | 'network'
  | 'storage';

export type PermissionDecision = 'granted' | 'denied' | 'prompt';

export interface PermissionDescriptor {
  id: Permission;
  label: string;
  /** Shown in the permission dialog — plain language, no jargon. */
  description: string;
  icon: string;
  /** Permissions that also need a real browser permission behind them. */
  browserBacked?: boolean;
  /** Granted without a prompt because it cannot leak anything. */
  implicit?: boolean;
}

export const PERMISSIONS: Record<Permission, PermissionDescriptor> = {
  filesystem: {
    id: 'filesystem',
    label: 'Files',
    description: 'Read and write files in your Palm OS filesystem.',
    icon: 'FolderOpen',
  },
  notifications: {
    id: 'notifications',
    label: 'Notifications',
    description: 'Show notifications in the notification centre.',
    icon: 'Bell',
  },
  clipboard: {
    id: 'clipboard',
    label: 'Clipboard',
    description: 'Read from and write to the system clipboard.',
    icon: 'Clipboard',
  },
  microphone: {
    id: 'microphone',
    label: 'Microphone',
    description: 'Record audio using your microphone.',
    icon: 'Mic',
    browserBacked: true,
  },
  camera: {
    id: 'camera',
    label: 'Camera',
    description: 'Capture video using your camera.',
    icon: 'Camera',
    browserBacked: true,
  },
  location: {
    id: 'location',
    label: 'Location',
    description: 'Access your approximate location.',
    icon: 'MapPin',
    browserBacked: true,
  },
  network: {
    id: 'network',
    label: 'Network',
    description: 'Open external links and check connection status.',
    icon: 'Wifi',
  },
  storage: {
    id: 'storage',
    label: 'App storage',
    description: 'Store its own settings and data on this device.',
    icon: 'Database',
    implicit: true,
  },
};

export const PERMISSION_LIST = Object.values(PERMISSIONS);

export interface PermissionRequest {
  id: string;
  appId: string;
  appName: string;
  appIcon: string;
  appColor: string;
  permission: Permission;
  /** Optional app-supplied justification shown in the dialog. */
  reason?: string;
  resolve: (granted: boolean) => void;
}
