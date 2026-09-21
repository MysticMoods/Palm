# Browser limitations, and what Palm OS does instead

Palm OS is a web page. Several things a desktop OS does are things a web page
is not allowed to do — usually for good reasons. This file lists every place
where a restriction shaped the implementation, so nothing here looks like an
oversight.

## The filesystem is virtual

The Palm OS filesystem lives in IndexedDB. It is not your disk, and the OS
cannot read your real files by default. This is the browser's origin sandbox
working correctly.

**What Palm OS does instead:** Files ▸ Local Disk uses the
[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
to let you *explicitly* grant one folder. The two filesystems are kept
visually distinct, and the real-disk view carries a banner saying so.

**Caveat:** `showDirectoryPicker()` is Chromium-only. In Firefox and Safari the
Local Disk view falls back to a file picker for importing and a download for
exporting, which is the closest equivalent those browsers permit. Even in
Chromium, a granted handle may lose permission between sessions, so the app
re-requests rather than assuming.

## Websites refuse to be embedded

The Browser renders remote pages in an `<iframe>`. Most sites send
`X-Frame-Options: DENY` or a restrictive `Content-Security-Policy:
frame-ancestors`, which instructs *your browser* to refuse. This is anti-
clickjacking protection and cannot be bypassed from JavaScript.

**What Palm OS does instead:** it detects a frame that never loads, shows a
panel naming the site and explaining why, and offers to open the page in a real
browser tab. Bookmarks, history and tabs keep working regardless. The start
page states the limitation up front rather than letting you discover it as a
blank rectangle.

The iframe is sandboxed (`allow-scripts allow-forms allow-popups`, notably
*without* `allow-same-origin`), so an embedded page cannot reach into Palm OS.

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

## There is no third-party application execution

The App Store lists only applications compiled into the build. Downloading and
running arbitrary code would need a real sandbox and a signing model, and
without those it would be a security hole rather than a feature.

**What Palm OS does instead:** the application registry is keyed by manifest,
so an audited source can be added later without changing the OS core. Nothing
uses `eval`, `new Function` or `dangerouslySetInnerHTML`; all file and note
content renders as text.

## Media playback depends on browser codecs

The Media Player uses `<video>`/`<audio>`, so it plays exactly what the browser
supports. Decoding failures are reported as such rather than as file errors.
