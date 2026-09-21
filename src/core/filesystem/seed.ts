/**
 * First-boot filesystem layout.
 *
 * Creates the root, the standard home folders and a small amount of sample
 * content so a fresh install is not an empty void.
 */

import { FOLDER_MIME } from './mime';
import { ROOT_ID, vfs } from './vfs';
import type { FSNode } from './types';

export const HOME = '/';

/** Folders the OS relies on; they are flagged `system` so they can't vanish. */
export const DEFAULT_FOLDERS: Array<{ name: string; icon: string }> = [
  { name: 'Desktop', icon: 'Monitor' },
  { name: 'Documents', icon: 'FileText' },
  { name: 'Downloads', icon: 'Download' },
  { name: 'Pictures', icon: 'Image' },
  { name: 'Music', icon: 'Music' },
  { name: 'Videos', icon: 'Video' },
  { name: 'Applications', icon: 'LayoutGrid' },
];

const WELCOME = `Welcome to Palm OS
==================

Palm OS is a small desktop environment that runs entirely inside your browser.
Nothing here is sent anywhere — every file, note and setting is stored locally
in your browser's IndexedDB.

Getting around
--------------
  • Press the Palm button (bottom-left) or the Super/Windows key for the menu.
  • Ctrl + Space opens system-wide search.
  • Drag a window to a screen edge to snap it; drag to the top to maximise.
  • Right-click the desktop for wallpaper and view options.
  • Alt + Tab cycles through open windows.

The filesystem
--------------
This filesystem is virtual. It is not your real disk, and Palm OS cannot read
your real files unless you explicitly grant access from Files ▸ Local Disk
(supported in Chromium-based browsers via the File System Access API).

Try it
------
  • Open Terminal and run: neofetch
  • Open Files and drag something into the Trash, then restore it.
  • Open Settings ▸ Personalisation to change the wallpaper and accent colour.

Everything you change is saved automatically and survives a reload.
`;

const SHELL_NOTES = `# Terminal quick reference

Palm OS ships a small shell that operates on the *virtual* filesystem.

    help              list every command
    ls -la /Documents long listing
    cd ~/Pictures     change directory
    cat welcome.txt   print a file
    echo hi > out.txt write a file
    cat out.txt | wc  pipe between commands
    neofetch          system summary

The shell is a simulation. It has no access to your real operating system,
and commands like \`sudo\` or \`apt\` do not exist here.
`;

const TODO = `Palm OS — things to try

[x] Boot the desktop
[ ] Change the wallpaper to a gradient
[ ] Pin an app to the taskbar
[ ] Snap two windows side by side
[ ] Write a note and search for it with Ctrl+Space
[ ] Export a backup from Settings > System
`;

const BUDGET = `Month,Category,Amount
January,Rent,1450
January,Groceries,412.55
January,Transport,88.20
February,Rent,1450
February,Groceries,398.10
February,Transport,102.75
March,Rent,1450
March,Groceries,455.30
March,Transport,76.40
`;

const CONFIG = `{
  "name": "palm-os",
  "version": "1.0.0",
  "theme": "dark",
  "features": {
    "windowSnapping": true,
    "notifications": true,
    "localDiskBridge": true
  }
}
`;

/** A pleasant generated wallpaper-ish image, stored as SVG (no scripts). */
function sampleImage(title: string, from: string, to: string, seed: number): string {
  const circles = Array.from({ length: 7 }, (_, i) => {
    const x = ((seed * (i + 3) * 37) % 100) + 5;
    const y = ((seed * (i + 5) * 53) % 70) + 10;
    const r = ((seed * (i + 2) * 17) % 90) + 30;
    return `<circle cx="${x}%" cy="${y}%" r="${r}" fill="#fff" opacity="0.06" />`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}" />
      <stop offset="100%" stop-color="${to}" />
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#g)" />
  ${circles}
  <text x="60" y="740" font-family="Inter, system-ui, sans-serif" font-size="34" fill="#ffffff" opacity="0.55">${title}</text>
</svg>`;
}

/** True when the filesystem has never been initialised. */
export async function needsSeed(): Promise<boolean> {
  await vfs.init();
  return vfs.isEmpty || vfs.getNode(ROOT_ID) === undefined;
}

export async function seedFilesystem(): Promise<void> {
  const now = Date.now();
  const root: FSNode = {
    id: ROOT_ID,
    name: '',
    parentId: null,
    kind: 'folder',
    mime: FOLDER_MIME,
    size: 0,
    createdAt: now,
    modifiedAt: now,
    trash: null,
    system: true,
  };
  await vfs.replaceAll([root], []);

  for (const folder of DEFAULT_FOLDERS) {
    await vfs.createFolder(ROOT_ID, folder.name, { system: true, icon: folder.icon });
  }

  const documents = vfs.requireNode('/Documents');
  const desktop = vfs.requireNode('/Desktop');
  const pictures = vfs.requireNode('/Pictures');

  await vfs.createFile(desktop.id, 'Welcome.txt', WELCOME, 'text/plain');
  await vfs.createFile(documents.id, 'Terminal notes.md', SHELL_NOTES, 'text/markdown');
  await vfs.createFile(documents.id, 'Todo.txt', TODO, 'text/plain');
  await vfs.createFile(documents.id, 'budget.csv', BUDGET, 'text/csv');
  await vfs.createFile(documents.id, 'config.json', CONFIG, 'application/json');

  const projects = await vfs.createFolder(documents.id, 'Projects');
  await vfs.createFile(projects.id, 'README.md', '# Projects\n\nScratch space for work in progress.\n', 'text/markdown');

  await vfs.createFile(
    pictures.id,
    'Aurora.svg',
    new Blob([sampleImage('Aurora', '#1b2a6b', '#5ad1c4', 3)], { type: 'image/svg+xml' }),
    'image/svg+xml',
  );
  await vfs.createFile(
    pictures.id,
    'Dusk.svg',
    new Blob([sampleImage('Dusk', '#3a1c53', '#f0704f', 7)], { type: 'image/svg+xml' }),
    'image/svg+xml',
  );
  await vfs.createFile(
    pictures.id,
    'Tide.svg',
    new Blob([sampleImage('Tide', '#06283d', '#47b5ff', 11)], { type: 'image/svg+xml' }),
    'image/svg+xml',
  );
}

/** Make sure the standard folders exist (e.g. after importing an old backup). */
export async function ensureDefaultFolders(): Promise<void> {
  if (!vfs.getNode(ROOT_ID)) {
    await seedFilesystem();
    return;
  }
  for (const folder of DEFAULT_FOLDERS) {
    if (!vfs.nodeAt(`/${folder.name}`)) {
      await vfs.createFolder(ROOT_ID, folder.name, { system: true, icon: folder.icon });
    }
  }
}
