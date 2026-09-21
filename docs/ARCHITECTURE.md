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
