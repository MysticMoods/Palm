# Deployment

Palm OS is a static bundle plus one small Node service. The static half can be
served by anything. The service exists for two reasons, and the second one is
not optional if you want installed applications.

---

## What the server does

**1. The fetch service** — `GET /_palm/fetch?url=…`

A browser cannot read a cross-origin resource whose server has not opted into
sharing it, so archiving a site needs something outside the browser to do the
fetching. This is that, hardened against SSRF (see
[SECURITY.md](SECURITY.md)). It also answers `GET /_palm/frame-policy?url=…`,
which reports whether a site permits being embedded.

**2. Routing by Host** — one origin per installed application

Every installed application is served from its own subdomain:

```
https://palm.example/                  Palm OS
https://app-7f31c2a4b901.palm.example/ one installed application
https://app-9b02de114c27.palm.example/ another, isolated from the first
```

This is the whole security model. Without it, an archived application would
have to run on Palm OS's origin, where it could read the OS's IndexedDB — its
files, settings and everything else. Palm OS will not do that: if application
origins are unavailable, installing is **disabled**, with an explanation, and
nothing falls back to the OS origin.

---

## Requirements

### DNS

A wildcard record pointing at the same server as Palm OS:

```
palm.example.     A     203.0.113.10
*.palm.example.   A     203.0.113.10
```

Application hostnames are `app-` followed by 12 hex characters, so a wildcard
is the only practical option. Nothing else is served from the wildcard: a
subdomain that is not a valid application id is treated as the OS host.

If Palm OS is served from a subdomain of its own — say `os.palm.example` —
applications hang off *that*, at `app-<id>.os.palm.example`, and the wildcard
must be `*.os.palm.example`. The derivation is automatic: application origins
are always one label below wherever the OS is being served.

### TLS

A wildcard certificate covering the application hosts:

```
palm.example
*.palm.example
```

Let's Encrypt issues wildcards over DNS-01 only, so the certificate needs a DNS
provider the ACME client can write to. A per-host certificate is not workable —
hostnames are generated when the user installs something.

Service workers need a secure context, and an installed application will not
run without one. Plain HTTP works only on `localhost` and `*.localhost`, which
browsers treat as trustworthy.

### The server

```bash
npm run build
node server/proxy.mjs --port 8788 --root dist
```

It serves `dist/`, routes by `Host`, and mounts the fetch service. Behind a
reverse proxy, pass the original host and scheme through:

```nginx
server {
  server_name palm.example *.palm.example;

  location / {
    proxy_pass http://127.0.0.1:8788;
    proxy_set_header Host              $host;       # required
    proxy_set_header X-Forwarded-Proto $scheme;     # required
    proxy_set_header X-Forwarded-For   $remote_addr;
  }
}
```

`Host` is how application requests are routed, and `X-Forwarded-Proto` is how
the server knows to build `https://` origins. Getting either wrong does not
fail loudly — it produces application origins that do not match where the
browser actually is, and installation stops working.

To check a deployment without installing anything:

```bash
curl https://palm.example/_palm/origin-info
```

```json
{
  "osOrigin": "https://palm.example",
  "isolation": "available",
  "appOriginTemplate": "https://app-<id>.palm.example"
}
```

`"isolation": "unavailable"` means applications cannot be installed, and the
App Store will say so with the reason.

---

## Serving the bundle from a CDN

You can, for the OS itself. The static files in `dist/` have no server
requirements. But a CDN or object store cannot give
`app-7f31c2a4b901.palm.example` different content from `palm.example`, and that
difference is the isolation boundary — so a CDN-only deployment gets Palm OS
with installed applications disabled.

If you want both, put the Node server on the wildcard and the CDN on the OS
host, and point `/_palm/*` at the server.

---

## Reached by IP address

```
http://203.0.113.10:8788/
```

works, and Palm OS runs normally — but `app-x.203.0.113.10` is not a name that
resolves, so applications cannot be isolated. Installing is disabled and the
App Store says why. This is deliberate: a fallback that "worked" would be the
one outcome the architecture exists to prevent.

---

## Local development

```bash
npm run dev       # http://localhost:5173
npm run preview   # http://localhost:4173
```

Both mount the same middleware chain, and `*.localhost` resolves to loopback in
current browsers and counts as a secure context — so application origins,
service workers and storage isolation all behave exactly as they do in
production. An installed application appears at
`http://app-7f31c2a4b901.localhost:5173`.

This is also why the end-to-end tests can assert isolation for real rather than
approximating it.

---

## Security headers

Applied by the server and reapplied by each application's service worker, from
one shared definition (`shared/app-policy.mjs`) so the two cannot drift.

| | Palm OS origin | Application origins |
|---|---|---|
| `X-Frame-Options` | `DENY` | — (uses `frame-ancestors`) |
| `Content-Security-Policy` | — | full policy, `frame-ancestors <OS origin>` |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `no-referrer` |
| `Permissions-Policy` | — | camera, microphone, geolocation, payment, USB, serial, MIDI, XR all `()` |

No CSP is applied to the Palm OS origin itself. Adding one is worthwhile and is
noted in [LIMITATIONS.md](LIMITATIONS.md); it is a separate change from this
one, and applying a policy that breaks the OS would be worse than not having it
yet.
