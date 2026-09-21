# Security model

Palm OS runs code it did not write. An installed web application is somebody
else's JavaScript, downloaded from an address a user typed, and executed. That
is the feature. This document is about what stands between that code and the
user's data.

---

## The boundary is the origin

Everything else here is detail. The load-bearing claim is:

> Palm OS and every installed application are on different origins, so the
> browser's same-origin policy is what separates them.

```
https://palm.example/                    Palm OS: files, settings, IndexedDB
https://app-7f31c2a4b901.palm.example/   one application, its own everything
https://app-9b02de114c27.palm.example/   another, isolated from the first
```

A separate origin gets its own IndexedDB, localStorage, sessionStorage, Cache
Storage, cookies and service-worker registration. None of it is reachable from
another origin — not by a bug in Palm OS, not by a missing check, not by an
application that decides to try.

This is deliberately *not* a sandbox attribute. `sandbox` without
`allow-same-origin` produces an opaque origin, which no service worker can
control, so the application could not be served at all. And a sandbox is a
promise the parent makes; an origin is a fact the browser enforces.

### Why the frame still says `allow-same-origin`

Because the frame is already cross-origin. `allow-same-origin` there means
"keep your own origin" — the application's, not Palm OS's. It is what lets an
application have storage and a service worker. It grants nothing over Palm OS,
because Palm OS is somewhere else.

On a same-origin frame that attribute would be the whole vulnerability. On a
cross-origin one it is required for the application to work at all. The
difference is the reason this architecture exists.

### Tested, not asserted

`e2e/isolation.spec.ts` puts data on one side and tries to read it from the
other:

- Palm OS writes a marker; the application reads `null` and an empty database
- application A writes to its storage; application B reads `null`
- Palm OS holds a handle to the application's frame and cannot read its document
- each service worker's scope is its own origin, and no worker controls the OS
- Palm OS's document is never served on an application host

---

## What an application is allowed

Nothing, by default, beyond its own origin's storage — which the browser gives
it regardless and which reaches nothing else.

| Permission | Default | What it allows |
|---|---|---|
| `STORAGE` | always | Its own isolated storage. Not revocable, not dangerous. |
| `NETWORK` | **off** | Contact servers. Off so an offline copy stays offline. |
| `FILES` | off | Ask the OS to open or save a file, one at a time, through a picker. |
| `CLIPBOARD` | off | Put text on the clipboard. |
| `NOTIFICATIONS` | off | Post a notification, attributed to the application. |
| `WINDOW_CONTROL` | off | Set its own window title; close its own window. |
| `SYSTEM_API` | off | Read the colour theme, language, online state. |

Device access — camera, microphone, geolocation, payment, USB, serial, MIDI, XR
— is not a permission an application can be granted. It is refused by
`Permissions-Policy` on every application response.

### Network blocking is enforced twice

A service worker sees every request from the pages it controls, so it can
refuse them. But it cannot see a WebSocket, and it cannot see a request from a
frame it does not control. So `connect-src` in the application's CSP does the
complete job, and the worker does the part CSP cannot: refusing to act as a
proxy for a resource the application asks for by a same-origin path.

```
connect-src 'self' blob: data:        offline — no server, no socket, no stream
connect-src 'self' blob: data: https: http:   after the user grants NETWORK
```

---

## The bridge

An application can ask Palm OS for a few things. Every request is a
cross-origin `postMessage`, which means it is untrusted input in the strictest
sense — the sender chose every byte.

`src/core/sites/bridge-host.ts` answers one question before anything else looks
at the payload: *may this message, from this origin, cause this action?* It is
a pure function, and it is tested against the ways an origin check goes wrong:

- an exact origin match, never a prefix — `https://app-x.palm.example.evil.test`
  shares a prefix with the origin we expect
- the right origin is not enough; it must be the frame we created, so a popup
  the application opened cannot speak for it
- the permission is checked before the payload, so an application without a
  permission learns nothing about what payloads would have been accepted
- a save-file name may not contain a path — the application does not choose
  where its file goes
- sizes are capped: notification title, body, clipboard text, file bytes

What is never exposed: Palm OS's IndexedDB, arbitrary filesystem access, any
way to run code on the OS origin, privileged system APIs, or OS internal state.

### Authority inside an application origin

The application's service worker accepts commands that change what is
installed. It accepts them only from `/_papp/installer.html`, and checks that
itself using the sending client's URL.

A shared secret was the obvious alternative and is the wrong one: any code on
that origin — including the archived application — can read that origin's
IndexedDB, so a token stored there would be readable by exactly the party it
was meant to exclude. Where a message comes from cannot be forged that way.
The installer, in turn, acts only on messages from the Palm OS origin, so the
chain holds end to end.

---

## The fetch service

A server that fetches arbitrary URLs on request is an SSRF primitive unless it
is deliberately restrained. `server/guards.mjs` resolves the hostname first and
refuses if **any** resolved address is private, loopback, link-local, CGNAT or
multicast — v4 and v6, including `::ffff:`-mapped forms — and re-validates on
every redirect hop, because a redirect is a second, unvalidated URL. Cloud
metadata (`169.254.169.254`), `localhost`, `.local`/`.internal` and non-HTTP
schemes are rejected. Responses are capped at 12 MB and 20 seconds.

It forwards no cookies, no credentials and none of the caller's headers, so it
cannot be used to reach anything behind a login.

---

## What we will not do

**Strip `X-Frame-Options` or `frame-ancestors`.** Those headers are a site's
anti-clickjacking control. A proxy that removes them turns Palm OS into a
clickjacking tool aimed at whoever is logged in. Palm OS reads them instead,
and offers the real browser when the answer is no.

**Fall back to the OS origin.** If a deployment cannot give applications their
own origins, installing is disabled with an explanation. A fallback that
"worked" would be the one outcome this design exists to prevent.

**Forward credentials.** The fetch service is unauthenticated by design.
Anything behind a login stays behind it, and Palm OS says so rather than
holding the user's credentials for third-party sites.

**Fake OAuth.** Redirect URIs are registered against real origins. Rewriting
one to point at Palm OS does not make the flow work; it makes it fail in a more
confusing way. Those addresses are sent to the real browser.

---

## Known weaknesses

**Palm OS's own origin has no CSP.** The OS is first-party code and does not
use `eval`, `new Function` or `dangerouslySetInnerHTML`, but a policy would be
defence in depth against a future mistake. It is not applied yet because a CSP
that breaks the OS is worse than one that is missing, and getting it right
needs its own pass.

**An application can spend the device's resources.** Origin isolation stops it
reading anything; it does not stop it allocating memory or burning CPU. It runs
in the same process tree as the desktop, so a busy loop is noticeable. The
window can be closed, which unloads it.

**Archives are not verified against their source.** There is no signing model
for arbitrary websites, and nothing to check a signature against. What is
downloaded is what the address served at that moment.

**The capture run executes the application with network access.** Finding what
a bundle loads at runtime means running it. It runs on its own isolated origin,
through the SSRF-guarded fetch service, with no cookies — but it does run, and
the install dialog says so before anything is downloaded. It can be turned off,
at the cost of an incomplete archive.

**Installed applications are not included in backups.** A backup is written by
Palm OS, which cannot read another origin's storage. The manifests could be
exported so a restore could offer to reinstall; the bytes could not.
