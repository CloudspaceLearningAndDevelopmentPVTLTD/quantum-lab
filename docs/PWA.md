# PWA, installability and offline support

Quantum Lab is installable and works offline. This document explains what is cached,
why each request class gets the strategy it does, and how to work with the service
worker day to day.

## Why this app is worth making offline-capable

The visualizations, the circuit simulator and the entire course are pure client-side
TypeScript (`apps/web/lib/quantum.ts`). There is no server in the loop for any of it.
Once the HTML and JS chunks for a route are cached, that route genuinely works with the
network switched off — the amplitudes are still being computed, not replayed.

The exceptions are the AI tutor (`/tutor`), billing (`/pricing`, `/account`), admin
(`/admin`) and saved-circuit sync — all of which go through `/api/*`. The caching
strategy is built around exactly that split.

## The files

| Path | Role |
| --- | --- |
| `apps/web/public/manifest.webmanifest` | Name, colours, `display: standalone`, icons, three launcher shortcuts (Simulator, Course, Visualizations). |
| `apps/web/public/sw.js` | The service worker. Hand-written plain JS, served verbatim — no `next-pwa`, no Workbox, no build step. |
| `apps/web/public/icons/icon.svg` | 512x512 vector app icon, `purpose: "any maskable"`. |
| `apps/web/public/icons/README.md` | How to generate PNG icons for iOS and older Android launchers. |
| `apps/web/components/pwa/ServiceWorkerRegistrar.tsx` | Registers the worker on `load` at `/sw.js?v=<build stamp>`; announces updates. |
| `apps/web/components/pwa/OfflineBanner.tsx` | Offline banner + "new version ready" banner. |
| `apps/web/components/pwa/InstallPrompt.tsx` | Custom install card driven by `beforeinstallprompt`. |
| `apps/web/app/offline/page.tsx` | Fallback page listing what still works offline. |

`apps/web/app/layout.tsx` links the manifest, exports `viewport.themeColor`, and mounts
the three components. Nothing else in the app is aware the PWA exists.

## What is precached

At `install` the worker precaches a deliberately tiny app shell:

```
/                      the home route
/offline               the fallback page
/manifest.webmanifest
/icons/icon.svg
```

Everything else is cached at runtime, as the user actually visits it. Precaching every
route would be guesswork about which lessons and visualizations any given user cares
about, and would download megabytes nobody asked for on first load.

## Strategy per request class

| Request class | Strategy | Why |
| --- | --- | --- |
| Any non-`GET` | Not intercepted | A POST/PUT/DELETE is a server-side side effect. Caching or replaying it would be wrong, and the Cache API refuses to store it anyway. |
| Cross-origin | Not intercepted | Opaque responses have an unknown status and a padded storage cost. Those hosts (Supabase, Stripe, analytics) manage their own caching. |
| `/api/*` | Network only; JSON `503` on failure | Tutor answers, billing state and sync must never be stale. The failure body is JSON, not HTML, so the calling `fetch()` gets something parseable. |
| Navigations (`request.mode === 'navigate'`) | Network-first with a ~3s timeout → cache → `/` → `/offline` | HTML must reflect a new deploy immediately, so cache-first is wrong. But "connected to dead Wi-Fi" is the common failure: without the timeout the user stares at a blank tab while a perfectly good cached copy sits unused. The timeout uses `Promise.race` plus an `AbortController` so the losing request is actually cancelled. |
| `/_next/static/*` | Cache-first, and store | Filenames are content-hashed, so a URL's bytes can never change. Revalidation would be pure waste. New deploys produce new URLs. |
| Everything else same-origin | Stale-while-revalidate | Fonts, images, the manifest, non-hashed public assets. Instant from cache, refreshed in the background, so a changed file is at most one visit out of date. |

A response is only ever written to the cache when `response.ok` **and**
`response.type === 'basic'` — never an error page, never an opaque cross-origin
response.

## Routes that work offline once visited

`/`, `/learn`, all ten `/learn/<slug>` lessons, `/learn/certificate`,
`/visualizations`, all eight `/visualizations/<slug>` pages, `/simulator`, `/circuits`,
`/certify`.

Routes that need the network: `/tutor`, `/pricing`, `/account`, `/admin`, `/api/*`.

## The service worker is disabled in development

`ServiceWorkerRegistrar` returns early unless `process.env.NODE_ENV === 'production'`.

A worker in dev caches the dev server's HTML and asset URLs and then keeps serving them
over a freshly recompiled bundle, so your edits appear not to apply and you lose an
afternoon to a phantom bug. Test PWA behaviour against a production build:

```sh
npm run build --workspace apps/web
npm run start --workspace apps/web
```

If you already have a dev-registered worker stuck on `localhost` from some earlier
experiment: DevTools → Application → Service Workers → **Unregister**, then
Application → Storage → **Clear site data**.

## Testing offline in Chrome DevTools

1. Load the production build and visit a few routes (`/simulator`, a lesson, two or
   three visualizations) so they land in the runtime cache.
2. DevTools → **Application** → **Service Workers**. Confirm the worker is
   "activated and is running".
3. Tick **Offline** on that panel. (Prefer this over the Network panel's throttling
   dropdown — the Network panel does not always cut off the service worker itself.)
4. Reload. You should get the cached page, and the amber banner
   "You're offline — the simulator, visualizations, and course still work."
5. Navigate to a route you have *not* visited. You should land on `/offline`, which
   lists what does still work.
6. Application → **Cache Storage** → `quantum-lab-v2-<build stamp>` shows exactly what
   is stored. The stamp should match `apps/web/.next/BUILD_ID` — if it does not, the
   page is being served by a worker from an older build (see "Deploy invalidation").
7. Application → **Manifest** validates the manifest and previews the icon, including
   the maskable crop.

## Forcing an update

A new worker installs in the background and waits. When it does,
`ServiceWorkerRegistrar` dispatches a `ql:sw-update-ready` window event (only if there
is already a controlling worker — no point nagging on a first install), and
`OfflineBanner` shows "A new version is ready" with a **Reload** button. That button
posts `{ type: 'SKIP_WAITING' }` to the waiting worker and reloads.

Manually, from the console:

```js
// Activate the waiting worker now
navigator.serviceWorker.getRegistration()
  .then((r) => r?.waiting?.postMessage({ type: 'SKIP_WAITING' }))

// Nuke every cache this origin owns
navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_CACHE' })

// Check for a new sw.js immediately
navigator.serviceWorker.getRegistration().then((r) => r?.update())
```

Or in DevTools: Application → Service Workers → **Update** / **skipWaiting** /
**Unregister**, plus the **Update on reload** checkbox while developing the worker.

## Deploy invalidation

> **This section replaces the old "CACHE_VERSION discipline" section, which described a
> hand-bumped `const CACHE_VERSION = 'v1'`. That mechanism was broken and is gone.**

### What was wrong

`sw.js` used to name its cache from a constant that a comment told a human to bump on
every deploy. That could not work, for a reason that has nothing to do with discipline:

`public/sw.js` is served verbatim. A deploy that changes application code but not that
file ships **byte-identical** worker bytes. The browser's update check is a byte
comparison — it fetches `/sw.js`, sees no difference, and installs nothing. No install
means no `activate`, and `activate` is the only thing that deletes old caches. So the
previous deploy's cache survived indefinitely, including its cached HTML.

That matters because navigations are network-first *with a 3 s timeout*. On a slow
connection the timeout fires and the user is served cached HTML from an arbitrarily old
deploy, whose `/_next/static/...` chunk hashes the current origin may no longer serve —
a white page or a permanently stuck loading skeleton, on a route that works fine for
everyone else. A wrong service worker is worse than none, and this was the wrong one.

Nothing in the repo would have caught it: the worker was correct in every unit sense.

### What it does now

Three files are coupled, on purpose:

| File | Its part |
|---|---|
| `apps/web/next.config.mjs` | Computes `BUILD_STAMP` (`VERCEL_GIT_COMMIT_SHA` → `GITHUB_SHA` → `Date.now()`), returns it from `generateBuildId`, and exposes it as `NEXT_PUBLIC_BUILD_STAMP`. Next's build id and the stamp are therefore the same string. |
| `apps/web/components/pwa/ServiceWorkerRegistrar.tsx` | Registers `/sw.js?v=<stamp>` rather than `/sw.js`. |
| `apps/web/public/sw.js` | Reads `?v=` back out of `self.location` and names its cache `quantum-lab-<SCHEMA_VERSION>-<stamp>`. |

A new build is a new stamp is a new script URL. The browser treats a different script
URL as a different script, installs it, and `activate` deletes every cache that is not
the new one. **A build id change now actually invalidates.** Nobody has to remember
anything.

`SCHEMA_VERSION` (currently `v2`) still exists and is still manual, but it means
something different: bump it when the *shape* of what is cached changes — a new
`APP_SHELL` entry, a different strategy — so that even a rebuild of the same commit
rotates. It is not a deploy counter.

If the query parameter is missing (an old registration from before this change, or a
hand-typed URL), both files fall back to the literal stamp `unversioned`. That degrades
to the old never-rotating behaviour rather than breaking; the next registration from the
app supplies a stamp and rotates it.

### The other half: the worker no longer calls `skipWaiting()` on install

It used to, unconditionally. With a per-build cache name that becomes actively
dangerous: the new worker would activate — and delete the old cache — while tabs were
still running the *previous* build's HTML. Those tabs' lazily-loaded chunks (three.js on
`/visualizations/bloch-sphere` and `/visualizations/decoherence`, via `next/dynamic`)
would be gone from cache, and a self-hosted `next start` does not serve a previous
build's hashed chunks. The visualization breaks in a tab the user never navigated.

It also made the update banner pointless: the worker never entered `waiting`, so
`OfflineBanner`'s Reload button had nothing to `postMessage` to and was a plain reload
with extra steps.

Now the new worker waits, `ServiceWorkerRegistrar` sees it and dispatches
`ql:sw-update-ready`, the banner appears, and the user's click sends `SKIP_WAITING`
immediately before the reload — so the old cache is evicted at the one moment nothing is
relying on it. A **first** install still activates immediately (there is no controller to
wait behind) and `clients.claim()` still gives offline support without a second reload.
Waiting only ever delays an update.

The visible trade: a user who never clicks Reload stays on the old build until they
close every tab. They are not stuck on stale HTML — navigations are network-first and
the network wins whenever it responds inside 3 s — they are just on last deploy's JS,
which still has its chunks cached and therefore still works.

### It is tested, and the test fails when the feature is removed

```bash
node scripts/check-sw-invalidation.mjs
```

Runs `public/sw.js` twice in a `node:vm` sandbox with a fake `ServiceWorkerGlobalScope`
and a fake Cache Storage — as build `buildAAA`, then as build `buildBBB` — and asserts
on observed behaviour: build B leaves exactly one cache, it is B's, A's cached chunk is
gone, install did not call `skipWaiting`, `SKIP_WAITING` does, and re-registering at the
*same* stamp does **not** churn the cache. Four further assertions read
`ServiceWorkerRegistrar.tsx` and `next.config.mjs`, because the `?v=` coupling spans
files and sw.js cannot see it: if the registrar reverted to `/sw.js`, every in-sandbox
assertion would still pass while the real thing silently stopped rotating.

Verified to fail when the feature is deleted: replacing the derived `CACHE_NAME` with the
old `'quantum-lab-v1'` constant turns 3 checks red and exits 1.

CI runs it in the `Web` job, before the build (it needs no build output).

## Graceful degradation

Nothing here is required for the app to work:

- No `serviceWorker` in `navigator` → registration is skipped, the app behaves exactly
  as it did before.
- Registration throws (no HTTPS, blocked by enterprise policy, storage full) → caught
  and swallowed; the user sees nothing.
- No `beforeinstallprompt` (Firefox, Safari) → the install card never renders. Safari
  users install via Share → Add to Home Screen.
- `localStorage` unavailable (private mode, blocked cookies) → the dismissal check is
  wrapped in try/catch and treated as "never dismissed".
- Registration is deferred to the window `load` event, so it never competes with the
  first render.

## Install prompt behaviour

`beforeinstallprompt` is Chromium-only and cancellable — we call `preventDefault()` to
suppress the browser's mini-infobar and show our own card bottom-right instead. The
event object is **single-use**: after `prompt()` it is discarded.

Dismissal is stored in `localStorage` under `quantum-lab.install-dismissed` as a
timestamp, and we do not re-prompt for 30 days. `appinstalled` hides the card and
records the install. The card never renders when already running standalone
(`matchMedia('(display-mode: standalone)')` or `navigator.standalone` on iOS).

## Icons

Only `icon.svg` ships. That is fine for Chrome, Edge and Firefox, but iOS Safari
ignores manifest icons entirely and wants a PNG `apple-touch-icon`, and some Android
launchers prefer raster 192/512. `apps/web/public/icons/README.md` has the exact
`sharp` and ImageMagick commands and the manifest entries to add.
