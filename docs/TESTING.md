# Testing

Two layers, both in the repository and both run by CI.

**Unit tests** (`npm run test`) cover the OS core — 447 tests across the shell
parser, calculator engine, virtual filesystem, Palm Disk volume and its mount
state machine, window manager, snapping geometry, path and MIME handling,
backup validation, shortcut parsing, the contrast maths, the archiver's URL
rewriting, archive-status rules, the origin algebra, the application security
policy, the bridge's message validation, legacy migration, framing-header
parsing and the fetch service's SSRF guards. They run in Node in
about two seconds, with `fake-indexeddb` standing in for browser storage and
jsdom only where a DOM is genuinely needed.

**End-to-end tests** (`npm run test:e2e`) drive the *production build* in
headless Firefox and Chromium — 85 tests across boot, every application launching, window
geometry and the switcher, the shell, the Files app, persistence across reload,
the first-run tour, Palm Disk, installing web applications, browsing modes,
migration from the previous architecture, origin isolation, the origin's
content security policy, and recovery from evicted storage. They run against the real bundle on purpose:
the bugs worth catching at this level — stacking contexts, animation fill
modes, lazy chunk loading — only appear there.

```bash
npm run test           # unit
npm run test:coverage  # with a coverage summary
npx playwright install firefox   # once
npm run test:e2e       # builds, serves and drives the bundle itself
```

Firefox is the suite of record: it is the strictest of the three engines about
the platform features Palm OS leans on, and the capability fallbacks — no File
System Access API — only exercise there.

Chromium runs too, as its own required job in CI, because it is what most
people use and the only engine with a real File System Access API. It cannot be
run in every development environment: a sandbox without access to Playwright's
browser CDN can only run Firefox locally and relies on CI for the rest.

Its first run was worth the trouble. Of 81 tests, 78 passed immediately; the
three failures found one real product weakness — a service worker reporting
itself installed from a cached manifest after its storage had been cleared —
and two tests that were passing by accident in Firefox. See the bug list below.

CI runs type-check, lint, unit tests and build in one job, and the end-to-end
suite in another.

## What was verified

### Boot and persistence
- Cold boot on an empty profile seeds the filesystem and renders the desktop,
  icons and taskbar with **zero console errors or warnings**.
- Settings (theme, accent, wallpaper, contrast, motion, taskbar position),
  desktop icon positions, files, folders and notes all survive a reload.
- Boot with IndexedDB unavailable shows the failure screen rather than hanging.

### Window manager
- Twelve applications opened simultaneously: unique z-order, exactly one
  focused window, taskbar tracking all twelve.
- Move by title bar; the store commits once on release.
- Resize from all eight edges and corners, including the minimum-size clamp
  (a 780px window clamps at its 380px minimum).
- Snap: drag to an edge shows the preview label ("Left half", "Top-left
  quarter"), release applies the exact geometry (700×852 on a 1400×900
  viewport).
- Minimise, restore from the taskbar, maximise (fills the work area), restore
  to the previous size, `Alt + Tab` focus cycling, close-all.

### Window switcher
With five windows open, holding Alt and pressing Tab steps through **all** of
them and wraps (`Calculator → Terminal → Files → Notes → Calculator`); the
overlay is visible while Alt is held and commits to the highlighted window on
release. Escape cancels without changing focus. `Ctrl+Alt+W` opens the sticky
switcher, which survives the modifiers being released and is driven with the
arrow keys and Enter.

### Filesystem
- Create folder and file, inline rename, move to Trash, Trash listing, restore
  from the context menu (verified back in its original folder), permanent
  delete, empty Trash.
- Grid and list views, sortable columns, per-folder search.
- Drag a file between folders; drag real files in from the host OS.
- **300 files in one folder**: the list renders 32 rows, recycles correctly
  while scrolling (rows 0–31 → 158–189 → 276–299) and reports the true count.
- Empty folders, empty Trash and a missing path all render their own states.

### Shell
```
mkdir -p /Documents/smoke && ls /Documents      # sequences
echo "hello" > /tmp.txt ; cat /tmp.txt          # redirection
cat /Desktop/Welcome.txt | grep Palm | wc       # pipelines
cd /Documents/smoke ; pwd                       # working directory
nosuchcmd || echo fallback-ran                  # conditional execution
neo<Tab>                                        # completion → "neofetch "
<ArrowUp>                                       # history recall
```
All pass, plus `neofetch`, `systeminfo`, `df`, `tree`, `find`, `sudo`.

### Applications
- Calculator: `sqrt(144) + 2^5 * (3 - 1)` → 76; `5/0` → "Cannot divide by
  zero"; `ln(0)`, `2 +`, `nope(2)` → specific messages; unary minus, `%`, `pi`,
  radians/degrees, history, keyboard entry.
- Text Editor: open, edit, autosave, find/replace (4 matches found and
  replaced), undo → redo → undo round trips, save-as, rename,
  unsaved-changes guard, live word/character count.
- Notes: create, autosave, search, pin, export to Documents.
- Browser: tabs, address parsing, `javascript:`/`data:` rejection, bookmarks,
  history, internal `palm:` pages.
- Image Viewer: opening a seeded image prompts for permission, then decodes it
  from a blob URL at its true 1200px natural width.
- Files, Settings, Calendar, Media Player, System Monitor and App Store all
  launch, render and respond.

### Welcome tour
- Appears on a fresh profile, not on the second boot, and can be replayed from
  Settings ▸ System.
- Choices apply live: selecting Teal repaints the accent (`88 132 255` →
  `43 196 176`) and selecting Nebula swaps the full-screen wallpaper while the
  card is still open.
- The name field starts empty rather than pre-filled, derives a username
  ("Ada Lovelace" → `adalovelace`) and that username shows up in the terminal
  prompt afterwards.
- Keyboard only: Enter advances, Tab stays inside the dialog across 12 presses,
  Escape skips. Global shortcuts are inert while the overlay is up — Ctrl+Space
  and Super do nothing — and work again once it closes.
- Zero unnamed controls or unlabelled inputs; the dialog is `aria-modal` with
  `aria-labelledby`, a labelled progress list and a live region for the step
  count.
- At 390×844 all four steps fit with no horizontal overflow.
- With `prefers-reduced-motion: reduce` (set as a real Firefox preference) the
  drifting backdrop, the floating logo, the halo and the staged reveals all
  drop to ~0s while the content still renders.

### Palm Disk
The volume logic is unit-tested against an in-memory fake implementing the
File System Access handle interface: listing order, nested paths, size and
modified time, MIME fallback, caching, invalidation, bounded search, and that
`..` resolves within the mount rather than escaping it.

The mount state machine is tested with stubbed storage, covering the paths a
headless Firefox cannot reach — a lapsed permission asking for a reconnect, a
refusal, and a husk left in storage being ignored rather than crashing.

End to end, `showDirectoryPicker` was polyfilled with an in-memory folder so
the real code path runs unchanged: connecting mounts and labels the volume,
the banner names it, listings and breadcrumbs work, `src/main.ts` opens in the
Text Editor with its real contents and Save disabled, a file added outside is
invisible until refresh and then appears, one removed outside disappears on
window focus, and search filters. On reload with an unpersistable handle it
prompts to connect again rather than crashing.

In Firefox, which has no File System Access API, Palm Disk reports itself
unavailable and offers file import instead.

Writing was driven the same way: mounting requests no write grant, the first
create confirms and escalates to `readwrite`, the folder and file appear, a
second create does not re-confirm, and editing `notes.txt` in the Text Editor
prompts *"Overwrite notes.txt on your computer?"* — the real file still holding
its original contents until the confirmation, and the new contents after. A
second save in the same window writes without asking again.

Palm Disk is exercised end to end by installing an in-memory
`showDirectoryPicker` before the page loads, so the real code path — mount,
permission escalation, listing, read, write — runs unchanged against a folder
the test controls.

**Not verified here:** the real Chromium picker and a genuine browser-issued
handle surviving a reload. Both are covered by the unit tests' stand-ins, but
the real API was not exercised — only Firefox is available in this environment.

### Fetch service
`server/guards.test.ts` asserts the SSRF boundary against an injected resolver:
`file:`, `javascript:` and other non-http(s) schemes, `localhost`, `.local`,
`.internal`, every private, loopback, link-local, CGNAT and multicast range in
v4 and v6 including `::ffff:`-mapped forms, and the two cases that matter most —
a *public* hostname that resolves to a private address, and one that resolves to
both a public and a private address. Both are rejected.

The live service was exercised manually against the real internet as well:
`file:///etc/passwd`, `http://localhost:5173`, `http://169.254.169.254/` and
`javascript:alert(1)` are all refused with a reason.

### Origin isolation
`e2e/isolation.spec.ts` is the suite that matters most, and it does not check
that the code *intends* isolation. It writes data on one side and tries to read
it from the other:

- Palm OS writes a marker to `localStorage` and has a populated `palm-os`
  database; from inside the application, the marker reads `null` and opening
  `palm-os` by name yields a *new, empty* database on that origin
- application A writes to its storage; application B reads `null`, and so does
  Palm OS
- Palm OS holds a handle to the application's frame and cannot read its document
- each application's service-worker registration is scoped to its own origin,
  and no worker at all controls the Palm OS origin
- an uninstalled application host does not serve Palm OS's document — booting a
  second copy of the OS on an application origin would blur the boundary

Verified against the real internet too: archiving `https://example.com` produced
an application at `http://app-6d02f1e3723c.localhost:4173/index.html`, serving
the right content with the right CSP, and reading `palm-os` from inside it
returned an empty database.

### Application policy
The security headers are read back from inside a running application:
`connect-src 'self' blob: data:` with no remote sources, `frame-ancestors`
naming only the Palm OS origin, `camera=()` and friends, and `nosniff`. A
cross-origin `fetch` from an offline application is blocked.

### The application bridge
`bridge-host.test.ts` covers the validation rules directly, including the ways
an origin check goes wrong — a prefix match would accept
`https://app-x.palm.example.evil.test`, and the right origin is not enough
without the right frame. End to end: the bridge is present, a request with no
permission is refused *with a reason* rather than left hanging, an unsupported
request is refused, and granting the permission makes the same call succeed.

### Archiving and completeness
`rewrite.test.ts` covers the URL algebra — path layout, query-string identity,
percent-encoding preserved exactly as the browser will ask for it, protocol-
relative references, `srcset`, CSS `url()` and `@import`, and the script
scanner (including that it does not execute what it reads, and does not hang on
a very large bundle).

`e2e/sites.spec.ts` drives the whole pipeline against fixture sites served by
intercepting `/_palm/fetch`: a static site archives COMPLETE with the expected
paths and no permissions; a site that opens a WebSocket and calls an API is
marked ONLINE_REQUIRED with both diagnostics recorded; a site that assembles a
request path at runtime is reported PARTIAL, by name, once it has been run.

Measured against a real build of Excalidraw: 436 files in about thirty seconds,
PARTIAL with three unreachable third-party resources named. That measurement is
what sized the archiver's limits and drove the move from serial to concurrent
fetching (the same archive took 2m 54s serially).

### Migration from the previous architecture
`e2e/migration.spec.ts` seeds a schema-2 record — an application archived into
Palm OS's *own* origin under `/site/<id>/` — reloads, and asserts it was moved
to an isolated origin, that the `/site/<id>/` references baked into its HTML
and CSS were rewritten (checked by the stylesheet still applying), that it
arrives with no permissions, and that the legacy records are gone. No fetch
service is routed in that test: migration works from the bytes already on the
device.

### Browsing modes
`e2e/browsing.spec.ts` covers the decision between embedded and normal mode. A
site sending `X-Frame-Options: DENY` produces a panel naming that header, with
"Open normally" and "Try embedded mode", and **no iframe at all** — rather than
a blank rectangle. A sign-in URL goes to the real browser even when the headers
would allow framing. Embedded mode still happens on request: the user's choice
wins after Palm OS has stated the trade-off.

**On proving "works offline":** `context.setOffline(true)` is *not* used, and
the reason is worth recording. Firefox's offline emulation rejects the request
before the service worker sees it, which a genuinely offline machine does not —
there, the worker answers from storage and no request is ever made. Asserting
through the emulation would test the harness, not the product. The test instead
aborts every request that is not to this machine and asserts both that the
application still runs and that the blocked list is empty.

**Not verified here:** a successful runtime *capture* through the fetch
service. Playwright's request interception does not reach service-worker-
initiated requests in Firefox, so a fixture cannot answer the worker's fetch.
What is verified is everything around it: the capture run happens, network
permission is dropped again afterwards, and the resource it could not get is
named in a PARTIAL archive. The capture path itself was exercised manually
against the real internet.

**Not verified here either:** a production wildcard-DNS deployment with real
certificates — `*.localhost` exercises the same browser behaviour (distinct
origin, secure context, per-origin service worker) but not the DNS and TLS
setup described in DEPLOYMENT.md.

### The Palm OS origin's policy
`e2e/policy.spec.ts` asserts the Content-Security-Policy is actually sent and
carries the directives that matter — `script-src 'self'`, no `unsafe-eval`,
`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` — and then
checks the harder half: that it does not break anything.

A CSP violation logs to the console and fails nothing, so a policy that
silently blocks a lazy chunk or an object URL looks exactly like one that
works. The test collects `securitypolicyviolation` events from the page before
any application code runs, opens five applications chosen for the things CSPs
usually break — lazy chunks, inline style attributes, object URLs, a
worker-backed view — and asserts the list is empty. A third test does the same
while the Browser embeds a site, since `frame-src` has to stay open enough for
the one thing that application exists to do.

Not applied by the dev server, which injects an inline script for Fast Refresh;
the tests run against the production build, where it is applied.

### Losing storage
Browsers evict origin storage under pressure and do not ask first, so
`e2e/resilience.spec.ts` deletes databases and checks what happens.

Deleting the OS's own database and reloading: the desktop comes up, the
filesystem is re-seeded, and no console errors are produced. The file created
beforehand is gone — that is what eviction means, and a test that pretended
otherwise would be testing nothing.

Deleting an *application's* database and unregistering its worker, which is
also the exact state a restored backup leaves behind: Palm OS reports "Files
missing" in the App Store with an explanation, and the "Download again" button
repairs it from the address in the manifest. A second test asserts the
application keeps the **same id**, because the id is the origin and the origin
is where the application keeps its own data — minting a new one to fix a
missing archive would silently discard whatever the user had saved in it.

`src/core/backup.roundtrip.test.ts` covers the other half against a real
IndexedDB: an export carries manifests but no archived bytes, a restore brings
the application list back, a manifest without a `source` is refused because it
could never be repaired, and a version 1 backup with no application list at all
still restores.

### Crash isolation
A deliberately throwing application was registered, built and launched. It
showed "Application stopped responding" with Restart and Close; the taskbar,
desktop and other applications kept working, and new applications still
launched. The test application was then removed.

### Permissions
Opening a document in the Text Editor prompts: *"Allow Text Editor to use
Files?"* with the app identity, the capability description, the app's stated
reason and "Remember this decision". Allowing loads the file; a second document
does **not** re-prompt. The grant appears in Settings ▸ Applications and toggles
Allowed → Blocked → Ask.

### Backup
Export produces `palm-os-backup-YYYY-MM-DD.json` containing the node graph,
text contents, base64-encoded binaries and the key/value space. A round trip
was verified: export, delete a file and add another, import, confirm the
deleted file is back with its original contents and the later addition is gone.
The validator rejects non-Palm files, missing parents and folder cycles.

### Responsive
At 390×844 with touch: windows are full-screen with no resize handles, the
taskbar grows to 56px, and Notes, Files and Settings each collapse to a single
pane with back navigation. No horizontal overflow at any tested size
(`scrollWidth === clientWidth`).

Split panes react to **window** width, not viewport width, so a narrow window
on a large display collapses correctly too.

### Accessibility
An automated audit across eight simultaneously-open applications found:
- **0** interactive elements without an accessible name
- **0** unlabelled form controls
- **0** images without `alt`
- 207 keyboard-focusable elements, with landmarks, headings, live regions and
  status roles present

Contrast was measured from the live custom properties:

| Pair | Dark | Light |
| --- | --- | --- |
| Primary text on surface | 15.25 | 16.94 |
| Secondary text on surface | 8.25 | 6.73 |
| Tertiary text on surface | 5.14 | 4.89 |
| Tertiary text on surface-2 | 4.54 | 4.51 |
| Accent text on surface | 5.15 | 4.89 |
| Accent label on accent fill | 5.54 | 5.54 |

All clear WCAG AA (4.5:1). Because the accent is user-chosen, a derived
`--os-accent-ink` is computed at runtime: a garish `#f0e040` on a light theme
becomes `120 112 32` (4.95:1) for text while the fill keeps the chosen colour.

## Bugs found by this process

1. **Every window rendered at 0,0.** The entrance animation used
   `fill: both` with a keyframe ending at `transform: none`, which permanently
   overrode each frame's inline transform. Fixed by moving the animation to an
   inner layer that carries no inline transform.
2. **Resize handles were unclickable.** They straddle the border by design but
   sat inside an `overflow-hidden` frame. Fixed by splitting the frame into an
   unclipped positioning box and a clipped chrome layer.
3. **Every themed colour was transparent.** The Tailwind theme used the v3
   `<alpha-value>` placeholder, which v4 does not substitute, producing invalid
   colours. Window backgrounds were see-through as a result.
4. **The wallpaper vanished** once backgrounds became opaque: its `-z-10`
   escaped to the root stacking context and painted behind the shell.
5. **The terminal prompt lost focus after every command**, because the input
   was `disabled` while busy. Changed to `readOnly`.
6. **`&&`, `;` and `||` were parsed as arguments**, so `mkdir a && ls` tried to
   create files called `&&` and `ls`. The parser now handles sequences.
7. **Stale calculator errors** persisted while typing a new expression.
8. **Implicit permissions displayed as toggleable** when they are always
   granted.
9. **Redo never became available, and Replace All could not be undone.** The
   undo stacks were mutated inside a `setState` updater, which React may run
   lazily, so the derived `canUndo`/`canRedo` flags read stacks that had not
   been touched yet. The mutations were moved out of the updater.
10. **A modifier-only shortcut rendered as "Super + ".** `formatShortcut`
    always appended a key label, even when the shortcut was a bare modifier.
    This showed in the welcome tips and in Settings ▸ Accessibility.
11. **The welcome's name field was pre-filled with "Palm User"**, so typing
    appended to it and produced a username like `palmuseradalovel`.
12. **Alt+Tab could not reach past the second window.** `cycleFocus` sorted by
    z-index and then focused the next window — but focusing raises z-index, so
    each press destroyed the ordering it had just derived. With four windows
    open it oscillated between the two most recent and the other two were
    unreachable by keyboard. Replaced with a frozen most-recently-used order
    captured when the gesture starts.
13. **Escape did not cancel a switch.** The declarative binding for Escape
    requires no modifiers, and during a held Alt+Tab gesture Alt is by
    definition down, so it never matched and the release committed anyway.

Found by the unit suite as it was written:

14. **A single `&` split an argument in two.** The tokeniser flushed the
    current token before checking whether the character began `&&`, so
    `echo a&b` produced two arguments instead of one.
15. **`tildify` never abbreviated anything.** It appended a separator to the
    home path to build its prefix — but Palm OS's home *is* the root, which
    already ends in one, so the test was against `"//"` and always failed. The
    terminal showed `~` at the root and absolute paths everywhere else.
16. **`isEditableTarget` could return `undefined`** despite being typed
    `boolean`, by returning `isContentEditable` unchecked.

Found while porting the browser checks into the repository:

17. **A setting could be lost by reloading straight after changing it.**
    Preferences were written on a 250ms debounce, and the `pagehide` flush can
    only *start* an IndexedDB write — it will not complete while the page is
    tearing down. Changing the theme and reloading within that window silently
    reverted it. Preferences and the desktop layout now persist without a
    debounce; coalescing buys nothing for changes made at human speed.
18. **`requestWrite` read the disk handle back from storage** rather than using
    the mounted one, so a folder that could not be remembered for next session
    became permanently unwritable in this one.
19. **Escape did not always dismiss the welcome tour.** It was handled by a
    React listener on the card, so it only worked while focus was inside —
    and focus falls to `<body>` for a moment whenever a button unmounts as the
    step changes. Moved to a window-level listener, as the window switcher
    already does.
20. **An application reported itself installed after its storage was cleared.**
    The service worker answered the health check from the manifest it holds in
    memory, so a worker still alive when its origin was evicted kept claiming
    to be installed while 404ing every request — and Palm OS never offered to
    repair it. It now checks the entry document is readable from storage.
    Found by the first Chromium run; invisible in Firefox, where the worker
    happened to be torn down first.
21. **Two tests were passing by accident.** The File System Access fallback
    test relied on the engine not having the API, so it tested nothing in
    Chromium; and the eviction helper used `deleteDatabase`, which blocks
    silently while any connection is open, so it could pass by not evicting.
    Both now arrange the condition explicitly.
22. **Granting a permission appeared not to work.** Toggling one reloaded the
    application immediately, while the change was still on its way to that
    application's service worker — so it restarted under the old policy and
    the user had to reload again by hand. The reload now waits for the change
    to land. Caught by the end-to-end test asserting a granted permission
    actually takes effect.
23. **The bridge asked the same question twice, in two vocabularies.** An
    application's `notification` request was routed through the OS's
    *built-in-application* permission system as well as its own, so a request
    the user had already allowed in the application's permission panel was
    refused with `"site:…" requested "notifications" which is not in its
    manifest`. Installed applications are governed by their own permission
    model; the bridge now applies its effects directly, with
    `bridge-host.validate` as the single gate.

## Reproducing

```bash
npm run build && npm run preview
```

Then exercise the checklist above against `http://localhost:4173`. The
harness used here lives outside the repository; it drives the same build a user
would run.
