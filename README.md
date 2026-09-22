# Palm OS

A desktop environment that runs in the browser. It has a window manager, a
virtual filesystem, a shell, twelve applications and a settings system.
Everything you create is stored locally in IndexedDB and survives a reload —
there is no account, no server-side state and no telemetry.

A small Node service sits alongside it for two jobs the browser cannot do
itself: fetching pages for the offline archiver, and serving each installed web
application from its own origin. The desktop and everything in it is
client-side.

![Palm OS desktop](docs/screenshot.png)

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build     # type-check and produce dist/
npm run preview   # serve the production build on :4173
npm run serve     # serve dist/ with the standalone server
npm run test      # unit tests (Vitest)
npm run test:e2e  # end-to-end tests (Playwright)
npm run lint      # oxlint
```

Before the first `test:e2e` run, install the browser once:
`npx playwright install firefox`.

Requires Node 20 or newer. Nothing to configure: open the URL and the OS boots,
seeding a filesystem on first launch.

`dev`, `preview` and `serve` all mount the same small Node service. It fetches
URLs for the archiver, and it routes by `Host` so each installed application
gets its own origin — `http://app-7f31c2a4b901.localhost:5173`. The desktop
itself is entirely client-side and will run from any static host; installed
applications are what need the service. See
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## First run

The first time you open it, Palm OS runs a four-step welcome: your name and
avatar, then theme, accent colour and wallpaper. Every choice applies live —
the background behind the card *is* the desktop wallpaper — and finishing
dissolves the card to reveal the desktop already wearing them.

Skip it at any point, or run it again from Settings ▸ System.

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

**Palm Disk** — connect a real folder from your computer and work in it inside
the OS: browse it, open files in the Text Editor, Image Viewer and Media
Player, edit and save them, and create new files and folders. It is kept
deliberately distinct from the virtual filesystem, and never deletes, renames
or moves anything on your disk. Chromium-only; see below.

**Installed web applications** — archive a self-contained web application from
a URL (App Store ▸ Web applications, or `fetchsite <url>` in the Terminal) and
run it later with no network at all.

Each one is installed onto **its own origin** — `app-7f31c2a4b901.palm.example`
— with its own storage, its own service worker and its own permissions. That is
what keeps somebody else's JavaScript away from your files and settings: not a
sandbox attribute, but the browser's same-origin policy. Network access is off
by default, and every archive carries a status (`COMPLETE`, `PARTIAL`,
`ONLINE_REQUIRED`, `FAILED`) that names what is missing rather than implying it
works offline when it does not.

This needs a deployment that can route by Host — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Where that is unavailable, installing
is disabled with an explanation rather than falling back to the OS's origin.

## Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl + Space` | System search (configurable in Settings ▸ Accessibility) |
| `Super` | Start menu |
| `Alt + Tab` / `Alt + Shift + Tab` | Window switcher — hold Alt, Tab to step, release to switch |
| `Ctrl + Alt + W` | Window switcher, when your desktop grabs Alt+Tab |
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
│   └── Welcome/       First-run setup tour
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
- [docs/SECURITY.md](docs/SECURITY.md) — the origin boundary, the permission
  model, and what Palm OS will not do to make a website appear to work
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — wildcard DNS, certificates and
  reverse-proxy configuration for per-application origins
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — what a browser will not let a web
  page do, and what Palm OS does instead
- [docs/TESTING.md](docs/TESTING.md) — what was verified and how
- [docs/HOME-SERVER.md](docs/HOME-SERVER.md) — *proposal, not built*: running
  Palm OS on an always-on machine so one desktop follows you across devices

## Data and privacy

There is no account, no server and no telemetry. Files, settings, notes and
application data live in this browser's IndexedDB on this device. Settings ▸
System exports the whole thing as a single JSON file and imports it back.
Settings ▸ Privacy ▸ Reset erases it.

Installing a web application is the one operation that contacts a server: the
URL you give it is fetched by `server/`, which does not log, store or forward
anything and sends no cookies or credentials. Everything it downloads is stored
locally, in that application's own origin — which Palm OS itself cannot read,
and which is therefore not part of a backup.

Palm OS cannot see your real files unless you explicitly connect a folder in
Files ▸ Palm Disk. That uses the File System Access API, so it works only in
Chromium-based browsers, and access extends to exactly the folder you pick —
nothing else. Eject it at any time from Settings ▸ Storage.

## Licence

MIT.
