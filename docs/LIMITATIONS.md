# Browser limitations, and what Palm OS does instead

Palm OS is a web page. Several things a desktop OS does are things a web page
is not allowed to do — usually for good reasons. This file lists every place
where a restriction shaped the implementation, so nothing here looks like an
oversight.

## The filesystem is virtual

The Palm OS filesystem lives in IndexedDB. It is not your disk, and the OS
cannot read your real files by default. This is the browser's origin sandbox
working correctly.

**What Palm OS does instead:** Files ▸ Palm Disk uses the
[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
to let you *explicitly* connect one folder, which then appears as a mounted
volume. The two filesystems are kept deliberately distinct — a separate
sidebar section, a persistent banner, muted icons, a read-only badge — because
confusing them is the one genuinely damaging mistake this app could invite.

Three consequences worth knowing:

**It is Chromium-only.** `showDirectoryPicker()` exists in Chrome, Edge, Opera
and Arc. Firefox and Safari have never shipped it, so there Palm Disk explains
itself and offers file import and download instead — the closest those browsers
permit.

**Mounting is a deliberate act.** The directory handle survives in IndexedDB
across sessions, but the *permission* attached to it does not: after a reload
it reverts to `prompt`, and re-requesting requires a user gesture. So Palm OS
restores the handle at boot and then waits for a click — "Reconnect" — rather
than reading anything behind your back. Chrome 122+ can persist permissions for
installed PWAs, which removes the click, but it cannot be relied on.

**Changes made outside are noticed, not watched.** The web has no
file-watching API. Palm Disk caches each directory listing, re-reads it when
the window regains focus, and offers an explicit refresh. A file you add in
another program appears the moment you look back at Palm OS.

**Writing is possible, but deliberately narrow.** Palm OS can edit existing
files and create new files and folders. It cannot delete, rename or move
anything on your disk — there is no Trash for real files, and an irreversible
operation with no undo is not something a web page should offer casually.

Write access is also escalated separately from mounting: connecting a folder
asks only for read, and the browser's write prompt arrives the first time you
actually save. Agreeing once does not carry across a reload. Overwriting an
existing file is acknowledged explicitly the first time per file, since the
previous contents are simply gone — the platform's `createWritable()` buffers
into a swap file and only replaces the original on close, so a failed write
leaves the file intact, but a *successful* one has no undo.

## Websites refuse to be embedded

The Browser renders remote pages in an `<iframe>`. Most sites send
`X-Frame-Options: DENY` or a restrictive `Content-Security-Policy:
frame-ancestors`, which instructs *your browser* to refuse. This is anti-
clickjacking protection and cannot be bypassed from JavaScript.

**What Palm OS does instead:** it reads the headers *before* framing anything,
and when the answer is no it shows a panel naming the header responsible and
offers to open the page in a real browser — which is where it is allowed to
render. You can still ask for embedded mode, and it will try. Bookmarks,
history and tabs work regardless.

Sign-in and OAuth addresses go to the real browser whatever the headers say: a
redirect URI is registered against a real origin, and proxying does not change
that. Nor do cookies travel, so an embedded page is never signed in — the
embedded view says so.

The iframe is sandboxed (`allow-scripts allow-forms allow-popups`, notably
*without* `allow-same-origin`), so an embedded page cannot reach into Palm OS.

### A proxy does not fix this

It is tempting to assume that routing pages through a server of our own makes
every site embeddable. It does not, and the fetch service deliberately does not
try:

- **Stripping `X-Frame-Options` would be the point of the exercise, and it is
  the one thing we will not do.** Those headers are the site's anti-clickjacking
  protection. A proxy that removes them turns Palm OS into a clickjacking tool
  aimed at whoever is logged in.
- **Cookies and credentials do not travel.** The fetch service is unauthenticated
  by design, so anything behind a login stays behind it. Proxying the session
  instead would mean holding the user's credentials for arbitrary third-party
  sites.
- **OAuth flows break.** Redirect URIs are registered against real origins.
- **WebSockets, EventSource and service workers of the remote origin do not
  survive** being rehosted under ours.
- **Sites actively defend against proxying** — origin checks, integrity hashes,
  bot detection, signed URLs with short lifetimes.

So "all sites work through the proxy" is not an achievable goal, and Palm OS
does not claim it. What *is* achievable is the narrower, genuinely useful case
below.

## Downloads are subject to CORS

Fetching a file into the virtual filesystem requires the server to allow a
cross-origin read. Most do not.

**What Palm OS does instead:** it tries the fetch, and on failure hands the URL
to the real browser's download manager and records the reason in the Downloads
list.

## Memory, CPU and battery reporting is limited

- `performance.memory` (JS heap) is a non-standard Chromium API. Firefox and
  Safari do not implement it.
- There is no API for system memory, CPU model, clock speed or CPU load —
  these are strong fingerprinting signals and browsers deliberately withhold
  them. `navigator.hardwareConcurrency` is the only figure published.
- The Battery Status API was removed by Firefox and Safari for the same reason.

**What Palm OS does instead:** System Monitor labels every unavailable figure
"not exposed by this browser" and explains why, rather than inventing numbers.
It measures frame rate with `requestAnimationFrame`, which is the closest
browser-visible proxy for rendering load.

## Screen resolution cannot be changed

Only the operating system can change a display mode.

**What Palm OS does instead:** Settings ▸ Display reports the real resolution,
viewport and pixel ratio, and offers interface scaling, which is the web
equivalent.

## Clipboard reads are permission-gated

`navigator.clipboard.readText()` is blocked outside a user gesture and is
unavailable entirely in some browsers.

**What Palm OS does instead:** it maintains its own in-memory clipboard,
mirrors writes to the system clipboard when allowed, and falls back to the
internal buffer on read. File "copy/cut" between folders is internal by
definition — a virtual filesystem node means nothing to other applications.

## Some keyboard shortcuts belong to the browser

`Ctrl + T`, `Ctrl + N`, `Ctrl + W`, `Ctrl + Shift + T`, `F5` and `Ctrl + L`
cannot be reliably intercepted, and hijacking them would break the user's own
browser.

**What Palm OS does instead:** window management uses the Super key (as Windows
and GNOME do), and panel shortcuts use `Ctrl + Alt + …`. No browser-reserved
combination is claimed.

## Alt+Tab usually belongs to your desktop, not the browser

Windows and most Linux window managers grab `Alt+Tab` before any application
sees it, so the page is never told it happened. macOS does not grab it (that is
`Cmd+Tab`), so there it reaches the page normally.

**What Palm OS does instead:** the switcher supports two interaction models
from one overlay. Where `Alt+Tab` arrives it behaves as expected — hold Alt,
press Tab to step, release to switch. Where it does not, `Ctrl+Alt+W` opens the
same switcher in a sticky mode that stays up and is driven with the arrow keys
and Enter. Clicking a taskbar button always works regardless.

## Audio needs a user gesture

Browsers block `AudioContext` until the page has been interacted with.

**What Palm OS does instead:** the audio context is created lazily on the first
sound and resumed if suspended. Settings ▸ Sound says a click may be needed
before test sounds are audible.

## Fullscreen needs a user gesture

`requestFullscreen()` is rejected outside a gesture and may be disabled
entirely by browser policy. The controls are disabled when
`document.fullscreenEnabled` is false rather than failing silently.

## Storage can be evicted

Browsers may clear site data under storage pressure, and clearing cookies or
site data in browser settings erases Palm OS.

**What Palm OS does instead:** Settings ▸ Storage shows the quota, offers
`navigator.storage.persist()` to request eviction protection (browsers grant
this at their discretion), and provides a full JSON export.

Recovery is the part that has to work regardless, so it is tested rather than
assumed. If the OS database is gone at boot, Palm OS re-seeds a filesystem and
comes up normally instead of failing — losing the files, which is what eviction
means, but not the desktop. If an *application's* origin is cleared, Palm OS
notices its files are missing, says so in the App Store, and offers to download
it again from the address in its manifest, keeping the same origin so anything
the application stored for itself survives. `e2e/resilience.spec.ts` evicts
both and asserts each recovers.

## Installed applications run third-party code — on their own origin

Palm OS can archive a self-contained web application and run it later with no
network. Running one means running JavaScript we did not write, which is a real
decision, and the install dialog says so before anything is downloaded.

What keeps it safe is not a promise: each application is served from its own
origin (`app-7f31c2a4b901.palm.example`), so the browser's same-origin policy
separates it from Palm OS's storage and from every other application. This is
asserted by tests that write data on one side and try to read it from the
other, not by inspection. See [SECURITY.md](SECURITY.md).

**This needs a deployment that can route by Host.** Wildcard DNS and a wildcard
certificate — see [DEPLOYMENT.md](DEPLOYMENT.md). Where that is unavailable,
for instance when Palm OS is reached by IP address, **installing is disabled**
with an explanation. It does not fall back to the OS origin.

## An application cannot bring its own service worker

Palm OS's worker owns the root scope on an application's origin — it is what
serves the archive. A second worker registered there would replace it and the
application would stop loading.

**What Palm OS does instead:** `navigator.serviceWorker.register` at the root
scope is refused with a reason, rather than resolving with a registration that
does nothing — which would leave an application waiting forever for an
`activated` event. A narrower scope still works. The offline behaviour the
application wanted is already provided; what it loses is control over the
caching strategy. Sites that do this are flagged in the archive's details.

## Large applications may not archive completely

An application that loads code at runtime cannot be fully discovered by reading
its source, and Palm OS will not execute a downloaded bundle during analysis to
find out.

**What Palm OS does instead:** it starts the application once, in its own
isolated origin, and records what its service worker could not serve. Anything
still missing is named, and the archive is marked `PARTIAL` rather than
presented as a working offline copy. Measured against a current build of
Excalidraw: 436 files archived in about thirty seconds, three resources
unreachable (two Twitter widget templates and an analytics pixel), reported
rather than hidden.

Some applications cannot be offline at all. A site that opens a WebSocket or
calls its own API is marked `ONLINE_REQUIRED`: the front end archived fine, and
it still needs a server. That is a different thing to tell the user than
"some files are missing", so it is a different status.

YouTube is the worked example. Archiving `www.youtube.com` succeeds — 99 files,
54 MB — and is correctly marked `ONLINE_REQUIRED`, with `/api/stats/qoe` among
the backend calls found in its code. Nothing is wrong with the archive. What
cannot be downloaded is YouTube: the video streams come from another host under
short-lived signed URLs, search and recommendations are API calls, and anything
personal needs a session. The same is true of Gmail, Google Docs, a social feed
or any site you sign in to.

**What Palm OS does instead:** opening one of these shows what is wrong instead
of a page that loads and then fails at every request — which is what you get
otherwise, since network access is off by default. It names the server the
application wants, and offers three things: open the real site, allow network
access, or show it anyway. Allowing network lets it reach that server through
Palm OS, but without cookies, so a sign-in still will not work — and it says so
rather than letting that be the next surprise.

## A backup holds an application's manifest, not its files

A backup is written by Palm OS, which cannot read another origin's storage —
the same property that keeps applications out of the OS's data.

**What Palm OS does instead:** the manifest travels, including the address the
application was archived from. Restoring a backup brings the application list
back, marks each one as needing its files, and offers to download it again in
one click. What cannot come back is whatever the application stored for itself
— your drawings inside an archived drawing tool live on its origin, not in the
OS. An application granted `FILES` can save through the bridge into the Palm OS
filesystem, and that *is* backed up.

The same machinery covers eviction: a browser reclaiming space from an
application origin produces exactly the same state, and the same repair.

## The fetch service is a server, and it is the one server here

Archiving needs a server-side fetch, because a browser cannot read a
cross-origin page. `server/` is that, and nothing more — it does not store, log
or proxy interactive traffic.

It is hardened against SSRF, because a service that fetches a URL on request is
an SSRF primitive by definition. `server/guards.mjs` resolves the hostname
first and refuses the request if *any* resolved address is private, loopback,
link-local, CGNAT or multicast, re-validating on every redirect hop. Cloud
metadata endpoints (`169.254.169.254`), `localhost`, `.local`/`.internal`, and
non-http(s) schemes are all rejected. Responses are capped at 12 MB and 20 s.

## Media playback depends on browser codecs

The Media Player uses `<video>`/`<audio>`, so it plays exactly what the browser
supports. Decoding failures are reported as such rather than as file errors.
