# Performance audit — Quantum Lab

First measurement of this codebase. Everything below is a number from a build or a
browser, not a judgement about the code. Where a suspicion turned out to be wrong, it is
recorded as wrong rather than quietly dropped.

Measured on Next.js 14.2.35, production build, node 22. Browser numbers come from
headless chromium (`/opt/pw-browsers/chromium-1194`) driven by Playwright against
`next start`.

**Update, after this audit was written:** the visibility gate described in Fix 2 below was
applied to only 3 of the 8 canvas visualizations at the time — the other 5 were flagged as
follow-up work under "Deliberately NOT done". That follow-up has since landed: all 8 now
have the gate. The numbers in this document (the TL;DR, Fix 2's table, and the final
re-run table) were measured only for the original 3 and were not re-measured for the other
5 — see the note under "Deliberately NOT done" for exactly what was and was not
re-verified.

**Second update — 2026-08-17.** Everything above is the original one-off audit and is
kept as written. Since then the numbers moved and nothing noticed, so there is now a
budget check that fails CI. Read **Part 2: budgets** at the bottom of this file for the
current per-route numbers, what regressed, and where each heavyweight dependency is
actually loaded. The tables in Part 1 are history, not the current state.

---

## TL;DR

| | before | after |
|---|---|---|
| `/visualizations/bloch-sphere` First Load JS | **239 kB** | **108 kB** (−131 kB, −55%) |
| `/visualizations/decoherence` First Load JS | **235 kB** | **103 kB** (−132 kB, −56%) |
| Routes flagged >1.5x median by the analyzer | 2 | **0** |
| rAF frames in 2 s with the canvas scrolled off screen (tunneling) | **117** | **0** |
| rAF frames in 2 s with the tab hidden (tunneling) | **100** | **0** |
| Shared-by-all JS | 87.3 kB | 87.4 kB (unchanged) |

Two changes did the work: `next/dynamic` for the two three.js routes, and gating the
animation loops on visibility. One considered change (`optimizePackageImports`) was
measured, made things *worse*, and was reverted. Four of the seven things on the audit
list turned out to be non-problems and were left alone.

---

## How to re-measure

```bash
cd /home/claude/quantum-lab
npm run build                       # prints First Load JS per route
node scripts/analyze-bundle.mjs     # per-route table from disk, sorted, with flags
node scripts/analyze-bundle.mjs --json > bundle.json   # for diffing in CI
```

`scripts/analyze-bundle.mjs` is dependency-free. It reads `.next/build-manifest.json`
and `.next/app-build-manifest.json`, resolves every chunk each route loads to a file on
disk, sums the raw bytes, sorts, flags anything over 1.5x the median, and lists the
chunks shared by every route. Run it after any build.

Two caveats worth knowing before you compare numbers:

- The script reports **raw bytes on disk**; `next build` reports compressed sizes. The
  absolute numbers differ by roughly 3x. Compare script-to-script and build-to-build,
  never script-to-build.
- Chunk hashes change on every build, so byte-for-byte equality across builds is not
  expected even with no source change.

---

## Before — First Load JS, every route

From `npm run build` (compressed kB, as Next reports them). Baseline kept at
`/tmp/before.txt`; the analyzer's raw-byte view at `/tmp/before-bundle.txt`.

| Route | First Load JS |
|---|---|
| `/coach` | 213 kB |
| `/certify` | 204 kB |
| `/admin` | 194 kB |
| `/certify/[examId]` | 181 kB |
| `/challenges/[id]` | 164 kB |
| `/learn/[slug]` | 156 kB |
| `/learn/certificate` | 156 kB |
| `/learn` | 153 kB |
| `/offline` | 152 kB |
| `/simulator` | 149 kB |
| `/hardware` | 147 kB |
| `/instructor` | 147 kB |
| `/circuits` | 139 kB |
| `/pricing` | 138 kB |
| `/account` | 136 kB |
| `/insights` | 136 kB |
| `/welcome` | 111 kB |
| `/visualizations/superposition` | 110 kB |
| `/visualizations/entanglement` | 109 kB |
| `/visualizations/grover` | 109 kB |
| `/visualizations/qft` | 108 kB |
| `/challenges` | 107 kB |
| `/visualizations/double-slit` | 105 kB |
| `/visualizations/tunneling` | 104 kB |
| `/tutor` | 97.3 kB |
| `/` | 96.2 kB |
| `/visualizations` | 96.2 kB |
| `/_not-found` | 88.2 kB |
| **`/visualizations/bloch-sphere`** | **239 kB** |
| **`/visualizations/decoherence`** | **235 kB** |
| _shared by all_ | 87.3 kB |

API routes (`/api/*`), `/robots.txt`, `/sitemap.xml`, `/icon.svg` and `/opengraph-image`
are 0 B of client JS and are omitted.

The analyzer's raw-byte view of the same build, which is what made the cause legible:

```
30 routes · median 463.9 kB · flag threshold 1.5x = 695.9 kB

/visualizations/bloch-sphere     864.0 kB   << 1.86x median   (569.6 kB route-specific)
/visualizations/decoherence      853.1 kB   << 1.84x median   (558.8 kB route-specific)
/coach                           684.3 kB
...
/                                320.0 kB

Flagged (> 1.5x median): 2
  /visualizations/bloch-sphere
          512.2 kB  static/chunks/9d78c252-1bd77654b3a4153d.js
           25.4 kB  static/chunks/6340-319ef3a4a23e19f9.js
  /visualizations/decoherence
          512.2 kB  static/chunks/9d78c252-1bd77654b3a4153d.js

Shared by all 30 routes: 294.4 kB across 4 chunks
      168.8 kB  static/chunks/1dd3208c-5db06b2627fd0216.js
      121.4 kB  static/chunks/1528-35734194aea61d5c.js
```

---

## Findings

### 1. Bundle: one 512 kB chunk explains both heavy routes

`static/chunks/9d78c252-*.js` is 512.2 kB raw and appears in exactly two routes' chunk
lists. Identified positively rather than by assumption:

```
$ grep -o "WebGLRenderer\|BufferGeometry" .next/static/chunks/9d78c252-*.js | sort | uniq -c
     14 BufferGeometry
     35 WebGLRenderer
```

That is three.js. Nothing else on either route is remarkable.

### 2. three.js is NOT in the shared chunk — the suspicion was wrong

The brief's hypothesis was that a landing-page visitor might be paying for three.js.
**They were not.** Verified against chunk contents, not by reading imports:

- The chunks shared by all 30 routes total 294.4 kB across 4 files. Grepping them:
  `1dd3208c` matches `react-dom` and zero three.js symbols; `1528` matches neither;
  the other two are the webpack runtime and `main-app`, 4.2 kB combined.
- `/` and `/visualizations` are 320.0 kB raw = 294.4 kB shared + 25.7 kB of their own.
  The three.js chunk is not in their manifest entry at all.

Next's automatic chunking had already isolated three.js correctly. **No fix was needed
for this, and none was made.**

What *was* still true: three.js sat in the two routes' **initial** payload. It was
fetched and parsed before hydration, so the sliders, presets and prose surrounding the
canvas stayed inert while 512 kB of WebGL library downloaded — even though nothing can be
drawn until the browser hands over a WebGL context anyway. That is what got fixed.

### 3. The rAF loops never stopped — the biggest real-world finding

All eight canvas visualizations run `requestAnimationFrame` loops. Before this audit,
`visibilitychange` and `IntersectionObserver` appeared **zero times** in the entire
codebase:

```
$ grep -rn "visibilitychange\|IntersectionObserver" apps/web/components apps/web/app
(no matches)
```

Every loop ran for as long as the component was mounted, regardless of whether anyone
could see it. Measured with Playwright by wrapping `window.requestAnimationFrame` with a
counter before app code runs, then counting callbacks over 2-second windows:

| | on screen | scrolled 4000 px away | tab hidden |
|---|---|---|---|
| tunneling (2D canvas) | 121 | **117** | **100** |
| bloch-sphere (WebGL) | 46 | **25** | **19** |
| decoherence (WebGL) | 42 | **21** | **46** |

The WebGL numbers are low in absolute terms because headless chromium falls back to
software rasterisation; the tunneling canvas is 2D and hits a true 60 fps. The ratio is
the finding: **an off-screen canvas ran at essentially the same rate as an on-screen
one.** Since each of these pages puts the canvas above several screens of explainer
prose, scrolling down to read is the normal case, and it left a full-rate render loop
running behind the text.

Note the hidden-tab column is nonzero here because the test stubs `document.hidden` and
dispatches the event rather than genuinely backgrounding the tab; a real backgrounded
Chrome tab already suspends rAF on its own. So the `visibilitychange` half of the fix is
insurance for engines that do not, and the `IntersectionObserver` half is the measured
win.

### 4. The PDE does **not** allocate per frame — no fix needed

The audit brief asked whether the 600-point Schrödinger solve allocates new typed arrays
every frame. **It does not.** `buildSim()` allocates the four `Float64Array`s once per
*generation* (a control change or reset), and `step()` mutates them in place with no
allocation at all. Benchmarked by transcribing `step()`/`measure()` verbatim into node:

```
frames=600 substeps/frame=40 N=600
total 94.1 ms  => 0.157 ms/frame  (6375 fps ceiling)
at 60fps that is 0.9% of one core, continuously
heap delta over 600 frames: -597.6 kB  (-1020.0 B/frame)
```

The heap delta is *negative* — GC reclaimed more than the loop allocated over the window.
The only per-frame allocation is the small `{transmission, reflection}` object literal
returned by `measure()`, which is a scalar cost and is not worth restructuring the API
for. **"Hoist typed-array allocations out of the PDE inner loop" was on the list of fixes
to consider and was deliberately not done, because the allocations it targets do not
exist.**

The integrator is also not the hot spot people assume: 0.157 ms/frame leaves ~16 ms of
budget untouched. The reason it mattered was purely that it ran when nobody was watching.

### 5. Re-render pressure: already handled — no fix needed

`/simulator` calls `simulateSteps` on every change, which was flagged as suspicious. It
is already memoised:

```tsx
const frames = useMemo(() => simulateSteps(circuit), [circuit])
const displayState = useMemo(...)
const qasm = useMemo(() => toQasm(circuit), [circuit])
const histogramData = useMemo<HistogramDatum[]>(...)
```

Four `useMemo`s covering every expensive derivation on the page. The Bloch page similarly
memoises its `StateVector` construction on `[theta, phi]`. Nothing heavy runs in render.
**No change made.**

### 6. Images and fonts: nothing to do — confirmed, not assumed

- `next/font`, `@font-face` and `next/image` appear **zero times** across `app/` and
  `components/`. The site uses system font stacks (`ui-sans-serif, system-ui`,
  `ui-monospace`). There is no web font to preload, subset or swap.
- `public/` contains one SVG icon, `manifest.webmanifest` and `sw.js`. No raster images.
  The single `<img>` in `components/pwa/InstallPrompt.tsx` points at that static SVG and
  already carries a comment explaining why it bypasses `next/image`.

No LCP image, no font-blocking, no CLS from either. **Confirmed and moved on.**

### 7. Service worker precache: small and correct — no fix needed

```js
const APP_SHELL = ['/', '/offline', '/manifest.webmanifest', '/icons/icon.svg']
```

Four entries: the shell, the offline fallback, the manifest, the icon. It does **not**
try to precache build chunks (which would break on every deploy as hashes change) or the
heavy visualization routes. `cache.addAll` is atomic, and the file already documents that
this is deliberate so a 404 fails the install loudly. Activation deletes every cache not
matching the current `CACHE_NAME`, so there is no stale-cache growth. **Nothing to fix.**

---

## Fixes made

### Fix 1 — defer three.js off the two heavy routes' initial payload

`apps/web/components/viz/LazyViz.tsx` (new) wraps `next/dynamic` with `ssr: false` and a
loading placeholder that reserves the exact height the real canvas occupies. Applied in
`app/visualizations/bloch-sphere/page.tsx` and `app/visualizations/decoherence/page.tsx`.

`ssr: false` is required rather than merely convenient: both components touch `document`,
`window.matchMedia` and WebGL inside their effects, and their server-rendered markup is an
empty sized div regardless.

| | before | after | delta |
|---|---|---|---|
| `/visualizations/bloch-sphere` First Load JS | 239 kB | **108 kB** | **−131 kB (−55%)** |
| `/visualizations/decoherence` First Load JS | 235 kB | **103 kB** | **−132 kB (−56%)** |
| bloch-sphere, analyzer raw bytes | 864.0 kB | **350.1 kB** | −513.9 kB |
| decoherence, analyzer raw bytes | 853.1 kB | **338.4 kB** | −514.7 kB |
| routes flagged >1.5x median | 2 | **0** | — |

Both routes now sit *below* the site median instead of 1.85x above it. three.js still
downloads — it has to, the page draws a 3D sphere — but after hydration, on a chunk that
no longer blocks the controls.

**Layout shift:** none. The placeholder is `min-height: 420px`, matching the
`min-h-[420px]` on both components' root elements. Playwright measured the mounted
canvas at exactly `766 x 420` on both routes, so the box does not change size when the
real component swaps in. If that Tailwind class ever changes, `VIZ_MIN_HEIGHT` in
`LazyViz.tsx` must change with it — there is a comment saying so.

### Fix 2 — pause the animation loops when nobody is looking

Applied at the time to `BlochSphere.tsx`, `DecoherenceLab.tsx` and `TunnelingLab.tsx`: an
`IntersectionObserver` (128 px `rootMargin`, so the loop is already warm by the time the
canvas scrolls in) plus a `visibilitychange` listener, both feeding a single `shouldRun()`
predicate that gates loop scheduling. Cleanup removes both.

**Since this doc was written, the same gate was extended to the remaining five viz
components** (`DoubleSlit.tsx`, `EntanglementLab.tsx`, `GroverLab.tsx`, `QFTLab.tsx`,
`SuperpositionLab.tsx`) — see "Deliberately NOT done" below for what that follow-up
changed and what it did not re-measure.

rAF callbacks counted over 2-second windows, before vs after:

| | on screen | off screen (before → after) | tab hidden (before → after) | resumed on scroll back |
|---|---|---|---|---|
| tunneling | 121 | 117 → **0** | 100 → **0** | 120 |
| bloch-sphere | 46 | 25 → **0** | 19 → **0** | 41 |
| decoherence | 42 | 21 → **0** | 46 → **0** | 44 |

The "resumed" column matters as much as the zeros: a gate that pauses and never restarts
would be a bug, not an optimisation. All three come back at full rate.

For tunneling this eliminates 117 x 40 = **4,680 lattice sweeps per 2 seconds** of a
600-site PDE plus two 600-point canvas path strokes, all previously spent below the fold.

**Physics is unchanged, and this was checked rather than asserted.** The gate changes
*when* the integrator runs, never *how*. `buildSim()`, `step()` and `measure()` are
byte-identical to their previous versions:

```
$ git show HEAD:...TunnelingLab.tsx | sed -n '/^function step/,/^function measure/p' | md5sum
8599a44e5f0db871150840f1b1383a05
$ sed -n '/^function step/,/^function measure/p' ...TunnelingLab.tsx | md5sum
8599a44e5f0db871150840f1b1383a05          # buildSim likewise: b3cc782d... both sides
```

The scheme is frame-counted, not wall-clock driven, so pausing freezes the packet and
resuming continues from the identical state — there is no elapsed-time term that could
produce a skipped or double-sized step. Reference values from the node harness, for
anyone changing this code later: after 420 frames at the default settings
(V₀ = 1.5, width = 20, E = 1.0, σ = 20), `T = 0.376883661535`, `R = 0.623116338465`,
grid norm `0.955929172749`.

One deliberate behavioural detail: `scheduleRef` in `TunnelingLab` now routes through
`startLoop`, so a slider moved while the canvas is off screen does not wake the
integrator. The pending generation is picked up by `ensureSim()` on the first frame after
it becomes visible, which is the same state the user would have seen anyway.

---

## Tried, measured, reverted

### `experimental.optimizePackageImports: ['three']` — made it worse, reverted

On the list of fixes to consider, so it was tried and measured rather than reasoned about.

| | three.js chunk size |
|---|---|
| without `optimizePackageImports` | 524,526 bytes |
| with `optimizePackageImports: ['three']` | **530,361 bytes** |
| delta | **+5,835 bytes (+1.1%) — worse** |

Route First Load JS was identical either way (108 kB / 103 kB). The reason is
mechanical: both components use `import * as THREE from 'three'`, a namespace import.
`optimizePackageImports` rewrites *named* imports from barrel files into deep paths; with
a namespace import there is nothing for it to rewrite, so all it contributed was slightly
different module wrapping.

**Reverted.** `apps/web/next.config.mjs` is byte-identical to its previous state
(`git diff` reports no change to it), which also means the ops agent's conditional Sentry
wrapper is untouched.

---

## Deliberately NOT done

- **Anything to the shared chunk.** It is 87.4 kB compressed (react-dom plus the webpack
  runtime) and did not change. Splitting react-dom is not a thing you do.
- **Hoisting typed-array allocations out of the PDE.** Measured: there are none to hoist.
  See finding 4.
- **Memoising the simulator page.** Measured: already fully memoised. See finding 5.
- **Font/image work.** Measured: there are no fonts and no images. See finding 6.
- **Service worker changes.** Measured: the precache list is 4 correct entries. See
  finding 7.
- ~~**Gating the other five visualizations** (`DoubleSlit`, `EntanglementLab`, `GroverLab`,
  `QFTLab`, `SuperpositionLab`).~~ **Done, since this doc was written.** All five now have
  the same `IntersectionObserver` + `visibilitychange` gate as `BlochSphere.tsx`,
  `DecoherenceLab.tsx` and `TunnelingLab.tsx` — verified by grepping for
  `visibilitychange`/`IntersectionObserver` in each of the eight `components/viz/*.tsx`
  files with an `requestAnimationFrame` loop; all eight now match. The frame-count numbers
  in the table above were only ever measured for the original three, and were **not**
  re-measured for the other five as part of this correction — if you need them, rerun the
  Playwright harness described under "How to re-measure" rather than trusting extrapolated
  numbers here.
- **Lowering `SUBSTEPS` or the lattice size** to make the PDE cheaper. That would change
  the physics the page teaches, and correctness beats speed. At 0.157 ms/frame it is not
  the bottleneck anyway.
- **Reducing `setPixelRatio` from 2** on the WebGL renderers. Plausibly a win on retina
  displays, but it visibly softens the sphere wireframe, and this environment's software
  rasteriser cannot produce a trustworthy measurement of the gain. Not worth changing a
  visible design detail on an unmeasurable guess.

---

## After — First Load JS, every route

| Route | before | after | delta |
|---|---|---|---|
| **`/visualizations/decoherence`** | 235 kB | **103 kB** | **−132 kB** |
| **`/visualizations/bloch-sphere`** | 239 kB | **108 kB** | **−131 kB** |
| `/account` | 136 kB | 136 kB | — |
| `/admin` | 194 kB | 194 kB | — |
| `/certify/[examId]` | 181 kB | 181 kB | — |
| `/challenges` | 107 kB | 107 kB | — |
| `/circuits` | 139 kB | 139 kB | — |
| `/coach` | 213 kB | 213 kB | — |
| `/hardware` | 147 kB | 147 kB | — |
| `/insights` | 136 kB | 136 kB | — |
| `/instructor` | 147 kB | 147 kB | — |
| `/learn/certificate` | 156 kB | 156 kB | — |
| `/offline` | 152 kB | 152 kB | — |
| `/pricing` | 138 kB | 138 kB | — |
| `/visualizations/double-slit` | 105 kB | 105 kB | — |
| `/visualizations/qft` | 108 kB | 108 kB | — |
| `/` | 96.2 kB | 96.3 kB | +0.1 |
| `/_not-found` | 88.2 kB | 88.3 kB | +0.1 |
| `/tutor` | 97.3 kB | 97.4 kB | +0.1 |
| `/visualizations` | 96.2 kB | 96.3 kB | +0.1 |
| `/certify` | 204 kB | 205 kB | +1 |
| `/learn` | 153 kB | 154 kB | +1 |
| `/learn/[slug]` | 156 kB | 157 kB | +1 |
| `/visualizations/entanglement` | 109 kB | 110 kB | +1 |
| `/visualizations/grover` | 109 kB | 110 kB | +1 |
| `/visualizations/superposition` | 110 kB | 111 kB | +1 |
| `/visualizations/tunneling` | 104 kB | 105 kB | +1 |
| `/challenges/[id]` | 164 kB | 166 kB | +2 |
| `/simulator` | 149 kB | 151 kB | +2 |
| `/welcome` | 111 kB | 113 kB | +2 |
| _shared by all_ | 87.3 kB | 87.4 kB | +0.1 |

**About the +1 to +2 kB drift on unrelated routes:** it is not from this work. Other
agents were editing `app/layout.tsx`, `app/globals.css`, `components/ui/**` and adding
`middleware.ts` concurrently with this audit, and the "after" build includes their
changes (a theme toggle, a skip link, accessibility helpers, security headers). The
baseline and final builds are therefore not perfectly isolated for routes this work did
not touch. The two routes that *were* touched moved by −131 kB and −132 kB, which is two
orders of magnitude clear of that noise floor.

Analyzer output after, in full:

```
30 routes · median 462.1 kB · flag threshold 1.5x = 693.1 kB

/coach                           684.4 kB
/certify                         658.5 kB
/admin                           632.9 kB
...
/visualizations/bloch-sphere     350.1 kB     (was 864.0)
/visualizations/decoherence      338.4 kB     (was 853.1)
/                                320.1 kB

Flagged (> 1.5x median): 0

Shared by all 30 routes: 294.5 kB across 4 chunks
```

---

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit --project apps/web/tsconfig.json` | clean, 0 errors |
| `npx vitest run` | **66 passed** (66), 1 file — unchanged *(as measured for this audit; the suite has since grown to 88 tests across 3 files as unrelated security work added `lib/orgs/access.test.ts` and `lib/authFetch.test.ts` — see `docs/SECURITY.md`)* |
| `npm run build` | succeeds, 58 pages generated |
| Bloch sphere renders after lazy-load | **yes** — screenshotted and inspected |
| Tunneling renders | **yes** — screenshotted and inspected |
| Decoherence renders after lazy-load | **yes** — screenshotted and inspected |
| Console/page errors on all three | **none** |
| rAF stops off screen / when hidden | **yes**, 0 frames — see tables above |
| rAF resumes on scroll back | **yes**, full rate |

A lazy-loaded three.js scene that silently fails to mount is the obvious way to break
this and would not show up in a build log, so the two WebGL routes were loaded in a real
browser, screenshotted, and the screenshots looked at. Both show the wireframe sphere,
the |0⟩/|1⟩/|+⟩/|i⟩ labels, the equator ring and the violet Bloch arrow, with the stat
readouts agreeing with the slider values (bloch-sphere at θ=0.33π, φ=0.25π reports
P(0) = 75.0%, Bloch z = 0.500 — correct). Tunneling shows the Gaussian packet, the amber
barrier, the dashed energy line and the teal Re ψ trace.

Reproduce with:

```bash
cd apps/web && npx next start -p 3991     # any spare port
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node /tmp/perf/verify.mjs
```

The whole browser suite was run twice — once mid-audit and once against the final build —
to make sure the numbers were not an artifact of one run:

| final-build re-run | canvas | on screen | off screen | resumed | hidden | unhidden | errors |
|---|---|---|---|---|---|---|---|
| bloch-sphere | 766x420 | 30 | **0** | 30 | **0** | 23 | none |
| tunneling | 766x420 | 108 | **0** | 102 | **0** | 108 | none |
| decoherence | 766x420 | 25 | **0** | 24 | **0** | 39 | none |

The on-screen counts move a few frames between runs because headless software
rasterisation is not frame-rate stable. The zeros do not move, and they are the claim.

### A note on build flakiness seen during this audit

Several `npm run build` runs failed with `Cannot find module
'.next/server/middleware-manifest.json'` or `Cannot find module
'.next/server/app/api/.../route'`. This was **not** caused by any change here — it
reproduces on a pristine checkout and is a race between two `next build` processes
writing the same `.next` directory, which happened because other agents were building
concurrently. Retrying the build succeeds. If you hit it, retry before debugging.

A related trap cost time here and is worth writing down: a `next start` process left
running from a *previous* build keeps serving HTML that references the old chunk hashes,
so every `/_next/static/chunks/*.js` request 400s and the page renders the LazyViz
skeleton forever with `canvas count: 0`. That looks exactly like "lazy loading broke the
visualization" and is not. Always restart the server after rebuilding — and confirm the
restart actually took the port, because `EADDRINUSE` from the old process is silent if
you background it.

---
---

# Part 2 — budgets (2026-08-17)

Part 1 was a cleanup. This part is the enforcement, because a one-off cleanup with
nothing behind it decays, and it already had: between the audit above and today, six
routes grew by 30-65 kB each and the bytes every visitor pays grew by 8.2 kB. Nobody
did anything wrong; there was simply no number to fail.

## The measurement

```bash
node scripts/bundle-size.mjs            # table + budget check (this is what CI runs)
node scripts/bundle-size.mjs --report   # table only, never fails
node scripts/bundle-size.mjs --json     # machine-readable
node scripts/bundle-size.mjs --update   # rewrite budgets from the current build
```

It reads a build that already exists on disk and **never runs `next build`** — several
agents share this checkout and a second concurrent build corrupts `.next` (Part 1's
closing note documents that failure mode).

**Units, and why they are not `analyze-bundle.mjs`'s.** `scripts/analyze-bundle.mjs`
reports raw bytes and flags routes above 1.5x the *median of the same build*. That is
good attribution and useless as a gate: if every route grows 30 kB, the median grows
with them and nothing is flagged. `bundle-size.mjs` instead reproduces exactly what
`next build` prints — gzip at zlib's default level, kB = 1000 bytes, polyfills excluded
— so its numbers are directly comparable with Part 1's tables and with any future build
log. Both scripts are kept; they answer different questions.

That claim is calibrated, not asserted. Against the seven `/visualizations/*` routes and
`/` that Part 1 recorded from a real `next build` and that nothing has touched since:

| route | Part 1, `next build` | `bundle-size.mjs` today |
|---|---|---|
| `/visualizations/qft` | 108 kB | 108.5 kB |
| `/visualizations/superposition` | 111 kB | 110.9 kB |
| `/visualizations/grover` | 110 kB | 110.0 kB |
| `/visualizations/entanglement` | 110 kB | 110.1 kB |
| `/visualizations/bloch-sphere` | 108 kB | 107.5 kB |
| `/visualizations/tunneling` | 105 kB | 104.6 kB |
| `/visualizations/decoherence` | 103 kB | 102.9 kB |
| `/` | 96.3 kB | 95.9 kB |

Worst disagreement 0.5 kB, and `next build` rounds to three significant figures. Do not
"improve" the script to gzip level 9 (shifts everything ~0.2 kB low) or to kB = 1024
(~2.4% low) — `scripts/bundle-budgets.json` is written in these units.

## Today's numbers, and what drifted

Measured from `apps/web/.next`, build id `S6E0WnghUlX0J4Tg_hZDf`. **Caveat, stated
plainly:** this is a build another agent produced at 08:35 today, and app files have
been edited since. It is the freshest build that exists and I may not make another. Any
route whose source changed after 08:35 will read slightly stale here; re-run
`--update` after the next clean build.

| Route | Part 1 "after" | today | delta |
|---|---|---|---|
| `/insights` | 136 | **200.7** | **+64.7** |
| `/pricing` | 138 | **194.3** | **+56.3** |
| `/welcome` | 113 | **168.6** | **+55.6** |
| `/certify/[examId]` | 181 | **233.9** | **+52.9** |
| `/learn/[slug]` | 157 | **190.9** | **+33.9** |
| `/coach` | 213 | 229.2 | +16.2 |
| `/certify` | 205 | 220.9 | +15.9 |
| `/admin` | 194 | 204.3 | +10.3 |
| `/tutor` | 97.4 | 106.0 | +8.6 |
| `/instructor` | 147 | 155.2 | +8.2 |
| `/_not-found` | 88.3 | 95.8 | +7.5 |
| `/challenges` | 107 | 114.4 | +7.4 |
| `/hardware` | 147 | 149.1 | +2.1 |
| `/simulator` | 151 | 152.3 | +1.3 |
| `/challenges/[id]` | 166 | 166.5 | +0.5 |
| `/account` | 136 | 136.5 | +0.5 |
| `/offline` | 152 | 152.0 | 0 |
| `/circuits` | 139 | 138.7 | −0.3 |
| `/learn` | 154 | 153.5 | −0.5 |
| `/learn/certificate` | 156 | 155.5 | −0.5 |
| `/` | 96.3 | 95.9 | −0.4 |
| `/visualizations` | 96.3 | 95.9 | −0.4 |
| `/visualizations/*` (7) | — | 102.9–110.9 | ±0.5 |
| **shared by all routes** | **87.4** | **95.6** | **+8.2** |

Two things to read out of that:

- **+8.2 kB on the shared chunks is the largest single line here**, because every route
  and every visitor pays it. `/_not-found` is a page with no features; its +7.5 kB is
  almost exactly the shared growth, which is a clean control for the rest of the column.
  The 8.2 kB is not attributed to a specific import: the four shared chunks are
  minified past the point where grepping for symbols works, and bisecting it needs a
  series of builds. Written down as unattributed rather than guessed at.
- The five routes that grew 30-65 kB are real feature work (server-graded exam attempts,
  billing UI, analytics) landing since the audit. None of it is obviously wrong. The
  point is that all of it was invisible.

## The gate

`scripts/bundle-budgets.json` holds one number per route plus one for the shared
chunks. Each is **today's measurement + 10%, rounded up to 0.5 kB**.

The 10% is chosen against measured quantities, not vibes:

- Build-to-build noise with no source change on the route is +1 to +2 kB on 96-166 kB
  routes (Part 1's final table, the drift it attributes to other agents' concurrent
  edits) — call it 1-2%. 10% is five times that floor, so the check does not cry wolf.
- The two regressions this repo has actually had both trip it comfortably: three.js on a
  route is +130.5 kB gz (+120%); the Supabase client arriving on a route is +33.9 kB,
  which is +35% of the smallest budgeted route and +25% of `/circuits`.

Behaviour on failure — it names the route and the overage, because "bundle too big" with
no subject is a message people learn to ignore:

```
bundle-size: FAIL — 1 route(s) over budget.

    /simulator
        152.3 kB  vs budget 120.0 kB  — OVER BY 32.3 kB (+26.9%)

  Find what grew:  node scripts/bundle-size.mjs --report
  Attribute it:    node scripts/analyze-bundle.mjs   (raw bytes, per-chunk)
```

A route with **no** budget entry also fails, listing the route and a suggested number. A
new route is the cheapest possible moment to set a budget, and an unbudgeted route is
exactly how the next regression would arrive unseen. A budget for a route that no longer
exists prints a removal notice but does not fail.

Verified by breaking it on purpose: setting `/simulator`'s budget to 120, deleting
`/tutor`'s entry and adding a `/gone-route` entry produced the over-budget block above,
the no-budget failure and the removal notice, and exit code 1. Restoring the file
returned exit 0.

Wired into `.github/workflows/ci.yml` in the `Web` job as **Bundle budgets**, immediately
after **Build**, plus an artifact upload of `--json` output on `always()` so a failing
run still carries the numbers that explain it.

**What the budgets do not cover:** CI builds with no `NEXT_PUBLIC_SENTRY_DSN`, so
`next.config.mjs` never applies `withSentryConfig` and no Sentry client code is bundled.
These budgets describe a DSN-less build. A production build *with* a DSN ships more than
this, by an amount nobody here has measured. See the next section.

---

## Third-party weight — where each heavy dependency is actually loaded

Measured from the build manifests, by resolving every chunk each route loads and
grepping the chunk *contents* for library-specific symbols, not by reading import
statements. The distinction matters: Part 1's finding 2 was a hypothesis about imports
that turned out to be false when checked against chunks.

### three.js — 130.5 kB gz (524.5 kB raw), 0 routes pay it up front ✅

`static/chunks/9d78c252.*.js`. It appears in **no** route's entry list in
`app-build-manifest.json`. It appears only in `react-loadable-manifest.json`, under:

```
app/visualizations/bloch-sphere/page.tsx -> @/components/viz/BlochSphere
app/visualizations/decoherence/page.tsx  -> @/components/viz/DecoherenceLab
```

i.e. it is fetched after hydration, on exactly the two routes that draw a 3D sphere, and
by nothing else. This is Fix 1 from Part 1 still holding, and the 130.5 kB matches the
−131 kB it claimed. **Correct as is. Nothing to do.**

### Supabase — 33.9 kB gz (126.7 kB raw), 11 routes pay it up front ⚠️

`static/chunks/2733-*.js`. Confirmed by content (`GoTrueClient`, `PostgrestClient`,
`RealtimeClient` all present), not by name. It is in the initial payload of:

`/admin` · `/account` · `/pricing` · `/certify` · `/certify/[examId]` · `/learn/[slug]` ·
`/circuits` · `/simulator` · `/hardware` · `/coach` · `/insights`

Should they pay it?

- **Yes, clearly:** `/account`, `/admin`, `/pricing` — they render `AuthPanel` /
  `useEntitlement` and cannot work without a client.
- **Defensible:** `/circuits`, `/simulator` (`SaveLoadPanel` syncs saved circuits),
  `/hardware`, `/certify`, `/certify/[examId]`, `/learn/[slug]` (`UpgradeGate`).
- **No — this is the bug the accounting was for:** **`/coach` and `/insights`.** Neither
  renders an auth panel or an upgrade gate. Both import `@/lib/circuit-store`, which at
  line 15 does a static `import { getSupabase } from '@/lib/supabase'`, and that pulls
  the whole client in. `/insights` is the page STATUS.md describes as "a
  privacy-preserving insights page that never sends anything anywhere" — and it ships a
  Postgres client, an auth client and a realtime websocket client to render local
  histograms. `/coach` reads local progress and does the same.

  33.9 kB gz on two routes that never authenticate. **The fix is a dynamic
  `import('@/lib/supabase')` inside the remote branch of `circuit-store`'s functions, so
  the local-storage path never touches it.** That is `apps/web/lib/circuit-store.ts`,
  recorded here as a follow-up.

  A second, larger cut sits behind it: nothing in the app uses Supabase Realtime.
  `grep -rn "\.channel(" apps/web/{lib,components,app}` returns nothing, and the only
  `subscribe(` is `onAuthStateChange`'s. `supabase-js`'s top-level `createClient` pulls
  realtime in unconditionally, so all 11 routes carry a websocket client they never open.
  Cutting it means dropping to `@supabase/auth-js` + `@supabase/postgrest-js` directly in
  `lib/supabase.ts` — a bigger change whose saving has not been measured,
  so it is recorded as a lead and not as a recommendation.

### Stripe — 0 bytes client-side ✅

The `stripe` package is imported only by `app/api/billing/webhook/route.ts`,
`lib/billing/stripe.ts`, `lib/billing/subscription.ts` and `lib/billing/reconcile.ts` —
all server-only. Neither `@stripe/stripe-js` nor a `js.stripe.com` script tag exists
anywhere in the app; checkout is a server-issued redirect. Grepping every chunk in every
route's entry list for `js.stripe.com`, `loadStripe` and `Stripe(` returns nothing.
**Zero client cost. Correct as is.**

### Sentry — 0 bytes in this build, and that is the caveat, not the finding ⚠️

Grepping all route chunks for `@sentry`, `captureException` and `sentry-javascript`
returns nothing, and `lib/observability/report.ts` deliberately avoids importing
`@sentry/nextjs` so `@sentry/node` cannot enter the webpack graph.

But that is a property of **this build**, not of the code: `next.config.mjs` only applies
`withSentryConfig` when `NEXT_PUBLIC_SENTRY_DSN` is set, and neither this build nor CI
sets one. `apps/web/sentry.client.config.ts` exists and would be bundled into every route
on a build that does. **How much every route grows when a DSN is present is unmeasured,
and has not been measured.** It is a per-route, all-routes cost
and it is the single most likely way these budgets get blown by a configuration change
rather than a code change. Whoever first deploys with a DSN should run
`node scripts/bundle-size.mjs --report` on that build and either raise the budgets with a
note or move Sentry's browser client behind a lazy import.

---

## Fonts, images, CLS

Part 1's finding 6 (no `next/font`, no `next/image`, no raster assets) re-checked today
and still true: `grep -rn "next/font\|next/image" apps/web/{app,components,lib}` returns
nothing, and `apps/web/public/` holds one SVG, the manifest and `sw.js`. The only `<img>`
is `components/pwa/InstallPrompt.tsx` pointing at that SVG, with a comment saying why.
System font stacks throughout, so there is no font swap and no FOUT.

**The landing page's largest contentful element does not wait on hydration** — verified
against the prerendered HTML rather than reasoned about. `apps/web/.next/server/app/index.html`
is 55.3 kB and contains, as static markup:

```html
<h1 class="mt-6 …text-4xl font-extrabold…md:text-6xl">Learn quantum mechanics by playing with it</h1>
```

`app/page.tsx` and `components/ui/Hero.tsx` are both server components (no `'use client'`
in either), so the h1 and the whole feature grid are in the first byte of HTML. Nothing
above the fold is client-rendered.

**Remaining CLS risk, in someone else's files.** The eight canvas visualizations mount
after hydration. Part 1 fixed this for the two lazy ones — `components/viz/LazyViz.tsx`
reserves `min-height: 420px` matching the real component's `min-h-[420px]`, measured at
`766 x 420` in a browser. I re-checked that coupling is still documented in that file.
The other six mount their canvas directly; whether each reserves its height before the
canvas sizes itself is a `components/viz/**` question and that directory belongs to
another agent. **Not measured here, because measuring it needs a browser against a
server I am not allowed to start.** Flagged, not claimed.

---

## Deliberately NOT done in Part 2

- **No new build.** House rule, and Part 1 documents the exact corruption two concurrent
  `next build` runs cause. Every number here is read off the build that existed at 08:35.
  The cost is that routes edited after 08:35 are measured slightly stale, and that is why
  the budget file records the build id it was generated against.
- **No browser measurements** — no LCP, INP, CLS or rAF numbers. They need `next start`,
  which is also forbidden. Part 1's rAF numbers stand; the CLS question above is left
  open rather than answered from reading code.
- **No fix for the `/coach` and `/insights` Supabase cost**, and none for the unused
  realtime client. Both live in `apps/web/lib/`; reported above with the exact line
  to change.
- **No change to `analyze-bundle.mjs`.** It answers a different question and Part 1's
  numbers refer to it.
- **No Lighthouse or `@next/bundle-analyzer` dependency.** Both need a browser or a build
  flag; the two scripts here are dependency-free and read files that already exist,
  which is what makes them runnable in CI without adding install time.
