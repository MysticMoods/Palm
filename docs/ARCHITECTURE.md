# Architecture

Palm OS separates an operating system core from the applications that run on
it. The rule that keeps it honest: **nothing in `src/core/` imports from
`src/apps/`**. Applications reach the system only through `core/os.ts`.

## Layers

```
          ┌─────────────────────────────────────────────┐
apps/     │ Files  Terminal  Editor  Browser  Notes  …  │
          └───────────────────┬─────────────────────────┘
                              │  useOS() → AppAPI
          ┌───────────────────▼─────────────────────────┐
core/os   │ openApp · openFile · fs · storage · notify  │
          │ clipboard · settings · window · permissions │
          └───────────────────┬─────────────────────────┘
          ┌───────────────────▼─────────────────────────┐
core/*    │ windows │ filesystem │ permissions │ search │
          │ apps    │ settings   │ notifications│ kbd   │
          └───────────────────┬─────────────────────────┘
          ┌───────────────────▼─────────────────────────┐
storage   │ IndexedDB: nodes · contents · kv            │
          └─────────────────────────────────────────────┘

desktop/  the shell that renders all of the above
```

## State

Each core concern owns a Zustand store. Components subscribe with selectors, so
a change to one window does not re-render the others.

Durable state is mirrored to IndexedDB by `core/storage/persist.ts`, which
hydrates a store at boot and writes a chosen slice back on a debounce. It also
flushes on `pagehide`, so the tail of a debounce window is never lost.

| Store | Persists |
| --- | --- |
| `settings` | Preferences and the local profile |
| `app-manager` | Installed, pinned, recent apps and launch counts |
| `permissions` | Per-app capability grants |
| `notifications` | The last 60 notifications |
| `desktop` | Icon grid positions and sort mode |
| `window-manager` | Per-app remembered geometry |
| `calendar` | Events |

Window positions, focus and the open-window list are deliberately **not**
persisted: restoring windows for apps that may have been uninstalled, at sizes
that may no longer fit, is worse than starting clean.

## Filesystem

`core/filesystem/vfs.ts` keeps node metadata in memory and mirrors it to
IndexedDB. Path resolution, listing and search are therefore synchronous;
only file payloads are read on demand, from a separate object store.

- **Nodes** carry `id`, `parentId`, `name`, `kind`, `mime`, `size`, timestamps
  and an optional `trash` record.
- **Trash** sets a `trash` marker rather than moving anything, so restoring
  puts a file back where it was and nested children follow their parent.
- **System folders** are flagged and cannot be renamed, moved or deleted.
- **Cycles** are guarded against in `pathOf`, `isAncestor` and `move`, and the
  backup validator rejects any import that contains one.

React binds to it through `useFs.ts`, which exposes a revision counter via
`useSyncExternalStore`. Components derive what they need from that number, so
the snapshot comparison is a single integer.

## Palm Disk

A real host folder, mounted as a second volume. It is deliberately *not* part
of the virtual filesystem, because the two have different guarantees: the VFS
is transactional, always available and private to this origin, while a real
folder can be edited behind our back, vanishes when permission lapses, and has
no atomic write.

`disk.ts` holds the volume, `disk-store.ts` the permission dance, and both are
written against a structural handle interface rather than the DOM types — which
is what lets `disk.test.ts` drive the whole thing against an in-memory fake. The
File System Access API is Chromium-only and cannot be exercised in a headless
test run, so without that seam the volume logic would be unverifiable.

Directories are listed on demand and cached, never walked at mount: pointing
this at a folder containing `node_modules` must not freeze the OS. Search walks
live within bounded limits and reports when it truncated, since there is no
index to consult.

Applications receive `volume: 'disk'` in their launch parameters and read
through the volume instead of the VFS. `OS.openDiskFile` picks the handler the
same way `OS.openFile` does.

Writing is scoped to what can be done safely: edit, create file, create folder.
Delete, rename and move are absent from the volume's API rather than guarded by
a dialog, because there is no Trash on a real disk to undo them. Permission is
escalated on first write — mounting asks only for `read` — and asks the *live
mounted handle*, not the one in storage: remembering the folder is best-effort,
and a failure to persist must not make a working volume unwritable.

## Installed web applications

A web application archived into Palm OS runs on **its own origin**. That is the
one fact the rest of this section serves, and it is not a detail:

```
https://palm.example/                    Palm OS
https://app-7f31c2a4b901.palm.example/   one installed application
```

An earlier design served archives from `/site/<id>/` on the OS's own origin.
That worked, and it meant an archived application could open Palm OS's
IndexedDB and read the user's files. Origin separation replaces a promise with
something the browser enforces. See [SECURITY.md](SECURITY.md).

### Where the pieces are

```
shared/origins.mjs      origin algebra, used by the server and the browser
shared/app-policy.mjs   the security headers an application origin gets
server/app-origin.mjs   routes by Host; never serves Palm OS on an app host
public/_papp/sw.js      one application's service worker, on its origin
public/_papp/installer  the only way bytes get into an application's storage
public/_papp/bridge.js  the `PalmOS` object an application sees
src/core/sites/         archiving, installing, validating, manifests
```

`shared/` exists because the origin rules have to hold identically on the
server (routing a request) and in the browser (pointing a frame). One
implementation, tested once, imported by both — a request routed one way and
framed another would be a hole, not a bug.

### Installing

```
archive → write into the application's own origin → start it once
        → fold what it actually asked for back into the manifest → publish
```

Palm OS cannot write to another origin, so installing means loading
`/_papp/installer.html` *on* that origin in a hidden frame and handing the
archive across with `postMessage`. Both ends check the other, exactly, by
origin and by window identity.

The third step is the one that makes the status honest. A modern bundle decides
at runtime what to load, so an archive built from static analysis alone is a
guess. Starting the application in its own origin and recording what its
service worker could not serve is the only way to know — and measurement
against a real build of Excalidraw is what sized the archiver's limits.

### Archiving

`rewrite.ts` is the URL algebra, separated out because a mangled URL produces
an application that is subtly broken in a way that is very hard to trace back
from a blank screen. Resources keep the site's own paths, so a bundle asking
for `/assets/chunk-a1f3.js` at runtime finds it; anything from another host
goes under `/_ext/<host>/`, the one shape the original site cannot have used.

`archive.ts` walks the graph six resources at a time. Serially, a four-hundred
file application took nearly three minutes, which is long enough that people
assume it has hung; concurrently it takes half a minute.

Scripts are **read, never run**. `scanScript` finds resource literals and
counts what it cannot follow — dynamic imports, workers, WebAssembly, the
site's own service worker, WebSocket endpoints, API paths. Those counts are
what separate `PARTIAL` from `ONLINE_REQUIRED`: a site that opens a socket is
not broken, it just cannot be offline, and that is a different thing to tell
the user.

### Serving

Each application's service worker (`public/_papp/sw.js`) serves its archive
from its own origin's IndexedDB. Written as a classic worker on purpose:
module service workers are still uneven across browsers, and an application
that will not start is worse than a file that cannot use `import`.

It also enforces the `NETWORK` permission for requests routed through the
application's own origin, records what it could not serve, and — when network
is permitted — fetches a miss and keeps it, which is how an archive becomes
more complete through use. Its report is written through to storage, because a
worker is terminated whenever the browser feels like it and a report that
evaporated would silently turn every archive into an apparently complete one.

### Status

`manifest.ts` holds the rules, apart from the archiver so they are testable
without downloading anything:

| | |
|---|---|
| `COMPLETE` | Everything it asked for was captured. Runs with no network. |
| `PARTIAL` | Runs, but some resources are missing. They are named. |
| `ONLINE_REQUIRED` | The front end archived fine; it needs a server to be useful. |
| `FAILED` | No entry document, or nothing captured. |

`ONLINE_REQUIRED` beats `PARTIAL` when both apply, because the files were never
the problem.

### Migration

Applications installed under the old same-origin design are moved, not deleted
and not left running that way. The bytes are already local, so migration needs
no network: each file is re-pathed, the `/site/<id>/` references baked into its
HTML and CSS are rewritten, and the legacy copy is removed **only** after the
new one is in place.

## Browsing

Palm OS shows a site in a window when the site permits it, and hands it to the
real browser when it does not — decided by reading `X-Frame-Options` and
`frame-ancestors` up front (`/_palm/frame-policy`), not by rendering a frame
and treating silence as refusal. The old approach showed a blank rectangle for
seven seconds and got it wrong whenever a slow site was merely slow.

Sign-in and OAuth addresses are recognised and sent to the real browser
whatever the headers say: a redirect URI is bound to a real origin, and no
amount of proxying changes that.

The headers are never stripped. `embedding.ts` holds the rules and is tested,
including the case where the check itself fails — which resolves to *try it*,
because a frame that fails is recoverable and a refusal that was wrong is just
Palm OS being needlessly useless.

## Fetch service

`server/` is the only server-side code, and it does two things: fetch URLs on
the browser's behalf, and route by Host so applications get their own origins.

`guards.mjs` is separated from `fetch-handler.mjs` on purpose. A URL-fetching
service is an SSRF primitive, so "may we fetch this?" is a pure, independently
testable function taking an injected resolver — which is how `guards.test.ts`
asserts that a *public* name resolving to a private address is rejected,
without any network. Validation runs again on every redirect hop, because a
redirect is a second, unvalidated URL.

## Window manager

Windows are plain records with a rectangle, a mode (`normal`, `minimized`,
`maximized`, `snapped`, `fullscreen`), a snap zone and a z-index.

Dragging and resizing write geometry **straight to the DOM** and commit to the
store once, on pointer-up. Committing every `pointermove` would re-render the
whole stack at pointer frequency.

Two details worth knowing:

- The window frame is split into an unclipped positioning box and an inner
  clipped chrome layer. Resize handles straddle the border, so they must live
  outside the `overflow-hidden` layer.
- The entrance animation lives on the inner layer, never the frame. A keyframe
  ending at `transform: none` with `fill: both` would permanently override the
  frame's inline transform and pin every window to the top-left corner.

The switcher freezes a most-recently-used order when the gesture begins and
steps a cursor through it. It has to freeze: `focus()` raises z-index, so
re-deriving the order on each press would destroy the sequence being stepped
through.

Below `COMPACT_BREAKPOINT` (820px) the manager switches to a phone-like mode:
every window is full-screen, dragging and resizing are disabled, and the
taskbar grows for touch.

## Applications

An application is a manifest plus a lazily-imported component:

```ts
interface AppDefinition {
  id; name; description; icon; color; category; version; developer;
  permissions: Permission[];
  window?: { width; height; minWidth; minHeight; resizable; singleton };
  handles?: FileCategory[];      // which files it can open
  handlesMime?: string[];        // exact MIME claims, checked first
  core?: boolean;                // ships with the OS, cannot be uninstalled
  component: LazyExoticComponent;
}
```

`registry.ts` knows what exists; `store.ts` knows what the user has installed
and pinned. `OS.openFile()` resolves a file to an application by consulting the
user's default for that category, then exact MIME claims, then category claims.

Each window renders its app inside an `AppContext` carrying an `AppAPI` scoped
to that app id and window id, wrapped in an error boundary. A thrown render
records a crash on the window record and shows "Application stopped responding"
with Restart and Close; the desktop is unaffected.

## Permissions

Applications receive nothing implicitly. `permissions.request(appId, cap)`
returns a remembered decision or queues a dialog rendered by the shell.
Concurrent requests for the same capability share one prompt.

System components (Files, Terminal, Settings) use the filesystem directly —
they *are* the system. User-facing applications (Text Editor, Notes, Image
Viewer, Media Player) go through `usePermissionGate`, so opening a document
genuinely prompts the first time and the answer is then remembered and
adjustable in Settings ▸ Applications.

## Search

`core/search/index.ts` fans a query out to independent providers (apps, files,
settings, notes), each of which may be async. Failures are logged and skipped
rather than failing the query. Results carry a score that separates groups and
ranks prefix matches above mid-word ones. Adding a source is one
`registerSearchProvider` call.

## Theming

All colour lives in CSS custom properties on `<html>`: `--os-surface`,
`--os-ink`, `--os-accent` and so on, as raw `R G B` triplets. Tailwind theme
tokens reference them, so switching theme, accent or contrast re-tints the
whole interface without re-rendering React.

> Tailwind v4 applies opacity modifiers with `color-mix()`, not the v3
> `<alpha-value>` placeholder. Theme tokens must be complete colour values — a
> stray `<alpha-value>` produces an invalid colour and everything using it
> silently renders transparent.

Accessibility settings are also attributes: `data-contrast="high"`,
`data-motion="reduced"`, `data-focus-ring="always"`, plus `--os-scale` for
interface scaling.

## First-run welcome

`desktop/Welcome/` renders over a live desktop rather than instead of one. That
is what lets a wallpaper or accent chosen during setup apply immediately —
`useSettingsStore.set` already drives `applySettings`, so the backdrop behind
the card is the real thing — and lets finishing simply dissolve the overlay to
reveal a desktop that already matches.

Because the shell is mounted underneath, global shortcuts are suspended for the
duration (`setShortcutsSuspended`); Super or Alt+Tab reaching the desktop
through a modal would be baffling. The overlay traps focus, Escape skips, and
`settings.welcomeCompleted` records that it has run. Settings ▸ System clears
that flag to replay it.

## Testing seams

The core is deliberately free of DOM and React dependencies, which is what lets
`npm run test` run it in plain Node. Stores are Zustand, so a test drives them
through `useWindowStore.getState()` with no renderer; the filesystem needs only
`fake-indexeddb`. Anything requiring a DOM opts in per file with
`// @vitest-environment jsdom`.

Two seams exist specifically so that browser-only behaviour stays testable:

- `DiskVolume` is written against a structural handle interface rather than the
  DOM's `FileSystemDirectoryHandle`, so `fake-handles.ts` can drive it.
- The end-to-end suite installs an in-memory `showDirectoryPicker` before the
  page loads, so the real mount and write paths run unchanged.

`e2e/` drives the production bundle with Playwright. `playwright.config.ts`
builds and serves it, so the tests can never run against a stale `dist`.

## Boot

`core/boot.ts` runs in order, guarding each step so one failure cannot stop the
desktop:

1. Hydrate settings and apply them to the document (so the right theme paints
   immediately, with no flash).
2. Initialise the filesystem; seed it on first run, repair standard folders
   otherwise.
3. Hydrate everything that depends on the app registry, in parallel.
4. Mark the shell ready.

If IndexedDB is unavailable — a private window, or blocked site data — the boot
screen says so instead of hanging.
