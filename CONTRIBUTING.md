# Contributing to Quantum Lab

The bar here is a specific one: everything on the site should be a **live simulation a reader can
poke at**, and the whole set should feel like one product rather than a folder of demos. These
rules exist to keep both of those true.

Before you change anything, read [`STATUS.md`](STATUS.md) (what runs, what is knowingly open) and
[`docs/adr/`](docs/adr/) (the decisions a newcomer would otherwise undo).

---

## Running every suite

All commands are from the **repository root** unless stated. `npm install` must have been run from
the root too — this is an npm workspace and the only lockfile is at the top.

```bash
# Types — the fastest signal, run it first
npx tsc --noEmit -p apps/web/tsconfig.json

# Web unit tests (vitest)
cd apps/web && npx vitest run

# Python — see the trap below, the interpreter matters
cd services/api   && .venv/bin/python -m pytest -q
cd services/agent && .venv/bin/python -m pytest -q

# Deploy preflight: env + lockfile + manifests, no install, no build
node scripts/preflight.mjs

# End-to-end (Playwright) — see the traps below
cd apps/web && npx playwright test
```

Measured on this tree on 2026-10-09: types clean, **3,672** web unit tests in 202 files, **90**
Playwright end-to-end tests in 13 specs, **447** API tests (22 files, including the Qiskit
cross-checks), **109** agent test functions, preflight 0 fail. Re-measure before you quote any
of those; they move every week.

Run `./scripts/setup.sh` (bash) or `.\scripts\setup.ps1` (PowerShell) first if the venvs do not
exist.

### The traps

Each of these cost someone an afternoon. None of them is obvious.

**1. `pytest` must be invoked through the venv's own interpreter.**

```bash
cd services/api && .venv/bin/python -m pytest -q     # correct
cd services/api && python -m pytest -q               # ModuleNotFoundError: No module named 'qiskit'
cd services/api && pytest -q                         # same
```

`pip install -r requirements.txt` populated `.venv`, not your system Python. A bare `python`
resolves to whatever is on `PATH`, which does not have qiskit. On Windows the path is
`.\.venv\Scripts\python.exe`, not `.venv/bin/`. This is the single most common stumble in the
repository.

**2. Playwright needs a server on `:3000`, and in a container it needs `PW_CHROMIUM`.**

`playwright.config.ts` owns its own `webServer` (`npm run build && npm run start`) and reuses an
existing server unless `CI` is set — so if something is already listening on 3000, that is what the
tests run against, including a stale build. Check before you blame a test.

In a container with no Playwright download, point the config at a Chromium already on disk:

```bash
PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test
```

**CI must not set `PW_CHROMIUM` at all.** The config reads it as
`process.env.PW_CHROMIUM ?? undefined`, and `??` does not fall through an empty string — an empty
value is passed to Playwright as a literal executable path and every test fails to launch. CI
installs its own chromium and caches it.

There are two projects: `chromium` (desktop, with `testIgnore: '**/mobile.spec.ts'`) and `mobile`
(390x844, `hasTouch: true`). `hasTouch` is the point of the second one, not the width — it makes
`.tap()` dispatch real touch events, which is how a control that only responds to hover gets
caught.

**3. `pkill -9 -f next-server` kills the shell that ran it.**

The pattern matches your own command line, because that command line contains the string
`next-server`. Use a bracket so the pattern does not match itself:

```bash
pkill -9 -f 'next-serve[r]'
```

**4. Do not run `npm run build`, `next build`, `next dev` or `next start` while anyone else is
working in the tree.** Concurrent builds corrupt `apps/web/.next` and take down a running server.
If you need to check something that normally needs a build — a social card, the sitemap, the
JSON-LD — bundle the route with esbuild instead; `docs/SEO.md` § "Rendering a card without running
a build" has the exact invocation.

**5. `node scripts/analyze-bundle.mjs` reads the last build on disk, it does not build.** Same for
`scripts/bundle-size.mjs`. If `.next` is stale, so is the answer.

### The light-theme screenshot script

Not part of `npx playwright test`, and it asserts nothing:

```bash
npm run dev                                   # or next start, in another window — needs :3000
node apps/web/tests/manual/light-shots.mjs    # honours PW_CHROMIUM and BASE
```

It pins the light theme, loads twelve routes that paint to canvas or SVG, and writes a screenshot
of each to `apps/web/tests/manual/shots/` so a human can look for what a structural check cannot
see — white-on-white wires, an unreadable axis. That failure mode is why the script exists; see
[ADR-0007](docs/adr/0007-canvas-colours-are-read-at-runtime.md).

---

## What a good change looks like here

Four rules, learned from an adversarial review that found a money-spending route with no auth, an
entitlement layer whose helpers had zero callers, 366 lines of env validation that never executed,
and a challenge that could not be solved by following its own hints but whose test passed anyway.
All four were green in CI.

1. **Wire what you build.** Grep every new export and confirm something imports it. An exported
   helper with no callers is not a feature, it is a comment with a type signature.
2. **A check that runs only in a client component is decoration, not a gate.** See
   [ADR-0005](docs/adr/0005-entitlements-are-enforced-server-side-only.md).
3. **A test that would still pass if the feature were deleted is worse than no test.** Revert your
   fix, watch the test go red, then put the fix back. `docs/RESPONSIVE.md` § 4 records doing
   exactly that for the mobile suite, and names which three tests failed.
4. **If you state a number in a comment or a doc, measure it.** Every number in this repository's
   documentation is supposed to have been produced by running something.

---

## How we build

We use AI coding assistants as part of everyday development, the same way we
use linters, type checkers and test generators. What that does not change: an
engineer at Cloudspace reviews every change, every change has to pass the full
CI gate (type check, lint, unit, end-to-end, both Python suites and the
Qiskit cross-checks), and the team owns the result. If a claim in the code or
the docs is wrong, the responsibility is ours, not the tool's. The git history
reflects this; commits carry a co-author trailer when an assistant drafted the
change, and the reviewer's name is the author.

## Adding a visualization

**1. Write the component: `apps/web/components/viz/YourViz.tsx`.** Mark it `'use client'` — it owns
a canvas, animation state and event handlers. Keep it self-contained: it renders its own canvas and
takes its parameters as props.

**2. Write the page: `apps/web/app/visualizations/your-viz/page.tsx`.** Use `VizFrame` and
`Explainer` from `components/ui/VizFrame` — the standard shell of canvas, controls rail and
explanation — and `Controls` from `components/ui/Controls` for sliders and toggles. Do not
hand-roll a layout; the shared frame is what makes the pages read as a set.

**3. Pull the physics from `lib/quantum.ts` — do not reimplement it.** Amplitudes, probabilities,
Bloch vectors, entanglement entropy, measurement collapse and shot sampling all live there, and
that module's results are verified against Qiskit and PennyLane. A second, slightly different copy
of the same physics is how a site like this quietly starts lying to people. If you need something
it does not have, add it there, with the same conventions —
[ADR-0003](docs/adr/0003-qubit-0-is-the-lsb-with-msb-first-labels.md).

**4. Register it in `VISUALIZATIONS` in `apps/web/components/ui/Hero.tsx`.** Entry:
`href`, `icon`, `title`, `level`, `accent`, `hook`. The array is ordered easiest → hardest and
drives the home page, `/visualizations`, the sitemap and the social cards, so an unregistered
visualization is invisible — three of them are unregistered today (`shor`, `surface-code`, `vqe`)
and are reachable only by typing the URL. Take the next hue in the fixed order below; do not reuse
one.

**5. Bump `CONTENT_UPDATED` in `apps/web/components/seo/content-version.ts`.** That is the sitemap
and feed `lastmod`. Bump it for a new lesson, visualization, challenge or exam — **not** for CSS, a
typo or a refactor. See `docs/SEO.md`.

**6. The canvas checklist — every item, every time.**

- [ ] **devicePixelRatio capped at 2.** `Math.min(window.devicePixelRatio || 1, 2)`. Uncapped DPR
      on a 3x display quadruples the pixel count for no visible gain.
- [ ] **Size with a `ResizeObserver`**, not `window.onresize` and not CSS alone. Backing store =
      `clientWidth * dpr`, then scale the context by `dpr`.
- [ ] **Read every colour from CSS custom properties at runtime** and repaint on theme change. No
      hex literals except the dark-theme fallbacks. [ADR-0007](docs/adr/0007-canvas-colours-are-read-at-runtime.md).
- [ ] **`prefers-reduced-motion` static path.** Render one meaningful static frame instead of
      starting the loop. The still frame must still teach the concept.
- [ ] **Pause the rAF loop when the tab is hidden or the element is off-screen.** Use
      `components/viz/frameLoop.ts`. Before it existed, every visualization animated forever, in
      background tabs, on any route that mounted it.
- [ ] **Clean up in the effect's return:** `cancelAnimationFrame`, `observer.disconnect()`.
- [ ] **An `aria-label` on the canvas** describing what is shown, and the key numbers exposed as
      text somewhere too.
- [ ] **A touch path for anything that needs a pointer.** Keep the hover behaviour, add a
      `pointerdown` path — `Histogram` is the pattern. Controls need a 44px hit box; see
      `docs/RESPONSIVE.md` § 5.

---

## Design rules

Not preferences. Breaking them makes the set look incoherent.

- **Five categorical hues, fixed order, never cycled:** violet → teal → sky → amber → rose
  (`ACCENT_ORDER` in `components/viz/theme.ts`). A sixth series does not get violet again — it
  means the chart is doing too much, so split it or aggregate.
- **Never a dual-axis chart.** Two y-scales invite the reader to see a correlation the data does
  not support. Two stacked charts sharing an x-axis instead.
- **One hue for a single series.** Colour carries meaning only when it encodes a category.
- **A legend only for two or more series.** Prefer direct labels wherever there is room.
- **Read `docs/THEMING.md` before touching a colour.** The token rules are not negotiable and
  [ADR-0001](docs/adr/0001-no-light-dark-for-design-tokens.md) explains the one that looks
  arbitrary.

---

## Code style

- **TypeScript strict.** `strict: true`; keep `npx tsc --noEmit` clean.
- **No `any`.** Use `unknown` and narrow. Third-party shapes get an explicit interface.
- **`'use client'` only where genuinely needed** — a canvas, state, an effect, an event handler.
  Every unnecessary one grows the bundle every visitor downloads, and one of them once shipped the
  paid course to everybody ([ADR-0006](docs/adr/0006-lesson-bodies-are-server-only-modules.md)).
- **Prefer named exports.** Keep components under ~300 lines; move physics into `lib/`.
- **Comments explain WHY.** A measured number, a named failure mode, or what a future editor must
  not undo. No marketing language. When something stays broken, say so plainly in the code — this
  codebase is full of headers that do exactly that, and they are the most valuable thing in it.

## Documentation

If your change makes a statement in a doc false, fix the doc in the same change. The docs here were
each written by a different pass, and the cost of not doing this is a set of documents that
contradict each other and quietly stop being read.

Where a doc has to state something unverified, mark it. `docs/DEPLOYMENT.md` uses **[RUN]**,
**[READ]** and **[UNVERIFIED]**, and that convention is worth copying.
