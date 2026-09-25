# Proposal: Palm OS as a home server

**Status: proposal. Nothing here is built.** It exists so the architecture can
be argued about before any of it is written.

---

## The idea

An old PC sits in a corner, switched on. It runs Palm OS. You open a browser on
any device in the house — or outside it — and there is your desktop, your files,
your applications, exactly as you left them.

That is not what Palm OS does today, and the gap is specific enough to name in
one sentence:

> **The server is stateless. Everything you have lives in the browser you are
> sitting at.**

Open Palm OS from a second device today and you get a *second, empty* Palm OS
that happens to be served from the same machine. Closing that gap means putting
the filesystem on the server, which reverses the original "no backend,
everything local" premise. That is the decision this document is for.

## The companion idea, and why it resolves itself

The other thought was giving an old PC a second life as a *client* — browse to
Palm OS instead of running heavy local software. That runs into a hard wall:
the build emits 181 `color-mix()` and 68 `@property` declarations, which is
Tailwind v4's baseline of **Chrome 111 / Safari 16.4 / Firefox 128** — all 2023
or later. Windows 7 and 8.1 cannot reach that on any browser (Chrome stops at
109, Firefox at 115 ESR).

The home-server idea sidesteps this neatly:

| Role | What the machine needs |
|---|---|
| **Host** (the old PC) | Node 22+ and a disk. No browser at all. |
| **Client** (what you look at) | A 2023-or-later browser — your phone, your laptop |

An old PC makes a fine host. It makes a poor client, and no amount of
server-side work changes that. If you also want the old machine to *display*
Palm OS, that is a separate piece of work — dropping the Tailwind v4 baseline —
and it is not part of this proposal.

One caveat: Node 22 needs glibc 2.28+ (Debian 10, Ubuntu 20.04) and 64-bit. A
genuinely ancient 32-bit machine cannot host.

---

## What the code says about cost

I went looking before writing any of this, and the answer is better than it
looks from outside.

**The whole OS touches storage in four files:**

```
src/core/filesystem/vfs.ts     9 persistence call sites
src/core/storage/kv.ts         settings, profile, per-app data
src/core/sites/storage.ts      installed application manifests
src/core/storage/db.ts         the IndexedDB wrapper itself
```

More importantly, `vfs.ts` is **an in-memory index with async persistence**. It
holds `Map<id, FSNode>` plus a parent→children index, and every read —
`nodeAt`, `list`, `pathOf`, `search`, `descendants`, `stats` — is *synchronous*
against that index. Only writes and content reads touch storage.

That shape is exactly what a server backend wants:

- `init()` fetches the node index once, over HTTP instead of from IndexedDB
- writes go to an API instead of an object store
- content reads fetch bytes instead of reading a blob

Counted across `src/`:

| | |
|---|---|
| Synchronous VFS reads (`nodeAt`, `list`, `pathOf`, `search`, …) | **155 call sites — unchanged** |
| Async VFS calls (`readNode`, `createFile`, `move`, …) | **157 call sites — unchanged**, the method bodies change |
| Persistence calls *inside* `vfs.ts` | **9 — these are the work** |

So this is a storage-adapter swap behind an interface that already exists, not
a rewrite of the filesystem. Three hundred-odd call sites across the OS carry
on as they are. The expensive parts are elsewhere: auth, the API, concurrency,
and the test suite.

---

## Architecture

```
                    old PC, always on
  ┌───────────────────────────────────────────────┐
  │  node server/serve.mjs                        │
  │                                               │
  │   ├── auth          sessions, password hash   │
  │   ├── /api/fs       nodes + content           │
  │   ├── /api/kv       settings, app data        │
  │   ├── /api/apps     manifests + archive blobs │
  │   ├── /_palm/fetch  archiver (now authed)     │
  │   └── Host routing  per-application origins   │
  │                                               │
  │   data/palm.db      SQLite (node:sqlite)      │
  │   data/blobs/       content-addressed files   │
  └───────────────────────────────────────────────┘
                          │  HTTPS
          ┌───────────────┼───────────────┐
        phone          laptop         the old PC itself
                                      (needs a 2023+ browser)
```

### What moves to the server

| State | Today | Proposed |
|---|---|---|
| Filesystem (`nodes`, `contents`) | browser IndexedDB | **server** |
| Settings, profile, desktop layout | browser IndexedDB | **server** |
| Per-app data (browser history, notes, calendar) | browser IndexedDB | **server** |
| Installed application manifests | browser IndexedDB | **server** |
| Installed application *archives* | each app origin's IndexedDB | **server**, pushed to each device |
| An archived app's own internal storage | app origin, per device | **stays per device** |
| Palm Disk (a real folder) | the client's disk | **stays the client's disk** |

### The two that do not move, and why

**An archived application's own storage.** If you install Excalidraw and draw
something, that drawing is in Excalidraw's IndexedDB, on its origin, in that
browser. Palm OS cannot reach it — that is the isolation boundary working, and
it is the same property that stops the app reading your files. Nothing short of
the app cooperating changes this.

The practical answer is the bridge: an application granted `FILES` can
`PalmOS.request('save-file', …)`, and *that* lands in the Palm OS filesystem,
which does follow you. Worth saying plainly in the UI, because "my drawing
isn't on my laptop" is otherwise a bug report.

**Palm Disk.** The File System Access API mounts a folder on whichever machine
the *browser* is running on. Mounting a folder on the *server* is a different
feature with a different security model, and conflating them would be
confusing. Later, if wanted, as "Host folder" — clearly distinct.

---

## Authentication

### The trap worth knowing about first

Palm OS is at `palm.example`. Applications are at `app-<id>.palm.example`.

If the session cookie is set with `Domain=.palm.example`, **every archived
application's origin sends it on every request to the server.** The app cannot
*read* an `HttpOnly` cookie — but it does not need to. It can simply call
`/api/fs/...` and the browser will attach your session. Third-party JavaScript
would have full authenticated access to your filesystem, and the entire origin
isolation effort would be undone by one cookie attribute.

**So the session cookie must be host-only** — no `Domain` attribute at all —
scoped to the exact OS host. This should be a comment in the code and a test,
not folklore.

### Recommended scheme

```
POST /api/auth/setup    first run only, while no user exists
POST /api/auth/login    username + password → session cookie
POST /api/auth/logout
GET  /api/auth/me
```

- **Argon2id** for the password hash. Node has no built-in Argon2; `scrypt` is
  in `node:crypto` and is acceptable, which keeps the zero-dependency property.
  Worth a deliberate choice rather than a default.
- Session cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`, **no `Domain`**.
- Store a **hash** of the session token, not the token — a readable `sessions`
  table is otherwise a list of working credentials.
- Rate-limit login. An always-on box on the internet gets knocked on.
- `/_palm/fetch` moves behind the session. Today it is unauthenticated: exposed
  to the internet it is an open fetch proxy — SSRF-guarded, but anyone who
  finds it can use your machine to fetch arbitrary URLs.

**Passkeys (WebAuthn)** are the better answer for a personal server and the RP
ID is stable (the domain). They are also a second implementation. Suggest
password first, passkeys as a follow-on, not as the initial bar.

**Escape hatch:** a deployment behind Tailscale or an authenticating reverse
proxy may want to trust an upstream identity header instead. Worth supporting
explicitly rather than having people disable auth.

---

## Data model

`node:sqlite` is built into Node 22+ — verified present here — so this adds
**no dependencies**.

```sql
users     (id, username UNIQUE, password_hash, created_at)
sessions  (token_hash PRIMARY KEY, user_id, expires_at, created_at, user_agent)

nodes     (id, user_id, parent_id, name, kind, mime, size,
           created_at, modified_at, trash_json, system, icon,
           version INTEGER)          -- optimistic concurrency
          INDEX (user_id, parent_id)

blobs     (hash PRIMARY KEY, bytes INTEGER, refcount INTEGER)
contents  (node_id PRIMARY KEY, user_id, blob_hash)

kv        (user_id, namespace, key, value_json, updated_at)
          PRIMARY KEY (user_id, namespace, key)

apps      (id, user_id, manifest_json, created_at, updated_at)
app_files (app_id, user_id, path, mime, blob_hash, source)
          PRIMARY KEY (app_id, path)
```

**Blobs live on disk**, content-addressed at `data/blobs/<sha256>`, with only
the hash in SQLite. Three reasons: an archive can be 64 MB and SQLite is not
the right home for that; two files with identical content are stored once; and
a content hash gives immutable cache headers for free. That also delivers the
content-hashing and deduplication that was listed as a gap in §34 of the
original spec.

`version` on `nodes` is what makes concurrent edits safe (below).

---

## API surface

```
GET    /api/fs/index                 whole node index, one request
GET    /api/fs/content/:id           bytes
POST   /api/fs/node                  create
PATCH  /api/fs/node/:id              rename / move / write  (If-Match: version)
DELETE /api/fs/node/:id              trash or permanent

GET    /api/kv/:namespace
PUT    /api/kv/:namespace/:key
DELETE /api/kv/:namespace/:key

GET    /api/apps                     manifests
POST   /api/apps                     install (manifest + files)
GET    /api/apps/:id/files           archive bytes, for hydrating a new device
DELETE /api/apps/:id

GET    /api/events                   SSE: change notifications
```

`GET /api/fs/index` returns metadata only. A filesystem with ten thousand files
is a few hundred KB of JSON — one request on boot, and then every synchronous
read in the OS works exactly as it does now.

---

## Sync model

Three options were considered:

| | |
|---|---|
| **Server-authoritative** | Client holds the index in memory; every write goes to the server. Simple, conflict-free by construction, no offline desktop. |
| **Client-first with sync** | IndexedDB stays the working store, syncs in the background. Full offline, and genuinely hard — tombstones, vector clocks, merge UI. |
| **Server-authoritative + read cache** | As the first, plus the index and recently-read content mirrored to IndexedDB. Read-only offline. |

**Recommendation: server-authoritative, with the read cache as a later
addition.**

The reasoning is that the offline story people actually care about is
*installed applications*, and those stay local on their own origins regardless
— they are served by their own service workers from their own storage. The
desktop needing the server is a much smaller loss than it sounds, especially on
a LAN where latency is sub-millisecond. And it avoids inventing a
conflict-resolution model, which is where projects of this shape go to die.

Say it plainly in the UI: **the desktop needs the server; installed
applications do not.**

### Concurrency

Two browsers, one file.

- Every node carries a `version`. A write sends `If-Match: <version>`; the
  server rejects a stale one with `409` and the client refetches.
- For file *content*, a rejected write saves alongside as
  `notes (edited on laptop).txt` rather than discarding someone's typing.
- `GET /api/events` (SSE) pushes change notifications so a second device
  updates without polling. One-way, so SSE rather than a WebSocket — and
  WebSockets through a reverse proxy are a class of support problem worth not
  buying.

### A detail that will bite

Settings currently persist with `debounceMs: 0` — deliberately, because a
reload inside a debounce window lost the setting. Against a network that
becomes a request per keystroke on a colour picker. Needs a different fix:
debounce with a `sendBeacon` or `keepalive` flush on `pagehide`.

---

## Applications across devices

Archives are on the server; each device's application origins are **hydrated on
demand**:

1. You log in on a new device.
2. Palm OS reads the manifests from `/api/apps`.
3. For each one, it opens the installer frame on that application's origin and
   asks whether it already has the archive.
4. If not, Palm OS fetches the bytes from the server — **authenticated as the
   OS origin** — and pushes them through the existing installer channel.

The important property: this reuses the install path that already exists and
is tested. The application origin never talks to the API and never holds a
credential, so no new authentication surface appears. Hydration can be lazy —
on first launch rather than at login — so signing in on a phone does not
download every archive you own.

---

## What breaks

Honest list.

1. **The e2e suite.** 74 tests assume a fresh browser profile means a fresh OS.
   With server state, each test needs an isolated server — a temp SQLite file
   per worker, or a reset endpoint gated to test mode. This is the single
   largest piece of collateral work.
2. **First run.** The welcome tour currently triggers on an empty filesystem.
   It becomes account creation, then the tour.
3. **`resetPalmOS()`.** Wipes browser storage today. Must wipe the server too,
   with a confirmation that means it.
4. **Backup and restore.** Becomes server-side. Simpler, and it can finally
   include installed applications — the server *can* read those archives, where
   the browser cannot.
5. **Boot ordering.** `boot.ts` currently runs eight steps in parallel against
   local storage. Against a network that wants sequencing and a real failure
   state — "cannot reach your Palm OS server" is a screen that has to exist.
6. **Offline desktop.** Gone, until the read cache lands. Must be said up front,
   not discovered.
7. **Multi-user.** The schema has `user_id` throughout, but nothing in the UI
   does. Single user to start; the schema does not have to be redone later.

---

## Migration

Existing installs have everything in browser IndexedDB, and there is already a
module that serialises exactly that: `createBackup()` produces nodes, contents
and kv as one document.

So: on first login to a server-backed instance, if the browser holds a
filesystem and the server does not, offer **"upload this browser's Palm OS to
the server"**. It reuses `createBackup()` and a restore endpoint, and the local
copy is left alone until the upload is confirmed.

Installed applications migrate the same way the isolation change did — read the
archive back out of each application origin through its installer frame, and
POST it. That path exists.

---

## Phasing

Each phase is useful on its own and leaves the thing working.

**1 — Auth, and close the open proxy.**
Sessions, login, host-only cookie, `/_palm/fetch` behind it. No state moves.
Small, and it is the piece that makes exposing the box on a network defensible
at all. Worth doing even if the rest is never built.

**2 — Server filesystem and kv.**
SQLite schema, `/api/fs` and `/api/kv`, and a storage adapter behind `vfs.ts`
and `kv.ts`. The adapter is genuinely contained — 9 call sites — but the API,
the schema, error handling and the boot-failure path are real work. Medium.

**3 — Applications across devices.**
Archive blobs server-side, lazy hydration through the existing installer
channel. Medium, and mostly reuse.

**4 — Migration and backup.**
Upload-this-browser, server-side backup including archives. Small, reuses
`backup.ts`.

**5 — Test isolation.**
Per-worker server state for the e2e suite. Medium, and unavoidable — without it
the suite stops being trustworthy the moment phase 2 lands.

**Later — read cache.** Mirror the index and recent content to IndexedDB for a
read-only offline desktop.

---

## Decisions I need from you

1. **Server-authoritative, or hold out for full offline sync?** I recommend the
   former and think the latter is a trap, but it is a product call: if you want
   to use Palm OS on a laptop on a train, the answer changes.
2. **Single user, or accounts from the start?** The schema carries `user_id`
   either way; the UI cost is real.
3. **Password, or passkeys first?** Password is less work and less nice.
4. **How is the box reached?** LAN only, a Tailscale-style tunnel, or a public
   domain. This decides the auth hardening *and* whether installed applications
   work at all — they need wildcard DNS and HTTPS, and a bare LAN IP gets
   isolation disabled by design. See [DEPLOYMENT.md](DEPLOYMENT.md).
5. **Does the old PC also need to be a client?** If yes, that is the separate
   Tailwind-baseline job, and it should be scoped on its own.
