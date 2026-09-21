# Palm OS

A desktop environment that runs entirely in the browser. It has a window
manager, a virtual filesystem, a shell, twelve applications and a settings
system — and no backend at all. Everything you create is stored locally in
IndexedDB and survives a reload.

![Palm OS desktop](docs/screenshot.png)

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build    # type-check and produce dist/
npm run preview  # serve the production build on :4173
npm run lint     # oxlint
```

Requires Node 20 or newer. There is nothing to configure and no service to run:
open the URL and the OS boots, seeding a filesystem on first launch.

## What's in it

**Desktop** — wallpaper (image, gradient or solid), draggable and renamable
icons with persisted grid positions, marquee selection, a right-click menu, a
taskbar that can live on any edge, a start menu, system-wide search, a
notification centre, quick settings and a tray.

**Window manager** — move, resize from any edge or corner, minimise, maximise,
restore, snap to halves/quarters/fullscreen with a live drag preview, focus and
z-order management, per-app remembered geometry, and crash isolation so one
broken app cannot take the desktop down.

**Applications** — Files, Terminal, Text Editor, Browser, Notes, Calendar,
Calculator, Image Viewer, Media Player, System Monitor, Settings and an App
Store. Each is lazily loaded as its own bundle.

## Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl + Space` | System search (configurable in Settings ▸ Accessibility) |
| `Super` | Start menu |
| `Alt + Tab` / `Alt + Shift + Tab` | Cycle windows |
| `Alt + F4` | Close the active window |
| `Super + ←` / `Super + →` | Snap left / right |
| `Super + ↑` / `Super + ↓` | Maximise / restore |
| `Ctrl + Alt + D` | Show desktop |
| `Ctrl + Alt + N` | Notification centre |
| `Ctrl + Alt + A` | Quick settings |
| `Escape` | Close menus and panels |
| `F2` · `Delete` · `Ctrl + C/X/V` · `Ctrl + A` | Rename, trash, clipboard, select all |

Browser-reserved combinations (`Ctrl + T/N/W`, `F5`, `Ctrl + L`) are left alone
on purpose — see [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Architecture

```
src/
├── core/              OS services, independent of any application
│   ├── storage/       IndexedDB wrapper, namespaced key/value, persistence glue
│   ├── filesystem/    Virtual filesystem, paths, MIME, seed, real-disk bridge
│   ├── window-manager/ Window state, snapping geometry
│   ├── app-manager/    Application registry, install/pin state
│   ├── permissions/    Per-app capability grants
│   ├── notifications/  Notification centre and toasts
│   ├── settings/       Preferences, theming, wallpapers, section catalogue
│   ├── search/         Pluggable system-search providers
│   ├── keyboard/       Global shortcut manager
│   ├── clipboard/      Text and file clipboard
│   ├── calendar/       Shared event store
│   ├── sound/          Synthesised interface sounds
│   ├── backup.ts       Export/import with validation
│   ├── boot.ts         Startup sequence
│   └── os.ts           The OS API applications talk to
│
├── desktop/           The shell: desktop, taskbar, panels, window chrome
├── apps/              One folder per application (manifest + UI)
├── components/        Reusable UI primitives and the icon registry
├── hooks/             Cross-cutting React hooks
├── utils/             Formatting, colour, small helpers
└── styles/            Design tokens and global CSS
```

Nothing in `core/` imports from `apps/`. Applications reach the system only
through `core/os.ts`, which is what keeps the OS core independent of what runs
on it.

## Adding an application

Write a manifest and register it — that is the whole integration:

```ts
// src/apps/Weather/manifest.ts
import { lazy } from 'react';
import type { AppDefinition } from '../../core/app-manager/types';

export const weatherApp: AppDefinition = {
  id: 'weather',
  name: 'Weather',
  description: 'Local conditions and the week ahead.',
  icon: 'Cloud',                    // a name from components/icons.tsx
  color: '#38b6f0',
  category: 'Utilities',
  version: '1.0.0',
  developer: 'You',
  permissions: ['network', 'location'],
  window: { width: 520, height: 640 },
  component: lazy(() => import('./WeatherApp')),
};
```

Add it to the array in `src/apps/index.ts`. It now appears in the start menu,
system search and the App Store, and can be pinned, launched and uninstalled.

Inside the component, `useOS()` gives you a permission-scoped API:

```tsx
const { os, params } = useOS();

await os.fs.write('/Documents/report.txt', text);   // prompts for Files access
await os.notify({ title: 'Saved', body: 'report.txt' });
await os.storage.set('lastCity', 'Lisbon');          // private to this app
os.window.setTitle('Weather — Lisbon');
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit together
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — what a browser will not let a web
  page do, and what Palm OS does instead
- [docs/TESTING.md](docs/TESTING.md) — what was verified and how

## Data and privacy

There is no account, no server and no telemetry. Files, settings, notes and
application data live in this browser's IndexedDB on this device. Settings ▸
System exports the whole thing as a single JSON file and imports it back.
Settings ▸ Privacy ▸ Reset erases it.

Palm OS cannot see your real files unless you explicitly grant a folder in
Files ▸ Local Disk, which uses the File System Access API and works only in
Chromium-based browsers.

## Licence

MIT.
