# Engineering practices

These are the working rules the codebase is held to. Most are enforced by a lint rule, a test or a CI step; the rest are enforced in review.

## Four rules from the contributing guide

1. **Wire what you build.** A module with no caller is not a feature. Every export in `lib/` has a page, a route or another module that uses it.
2. **A client-only check is decoration, not a gate** (ADR-0005). Entitlement checks, quota checks and access checks happen in the route handler that touches the data. The browser may hide a button; only the server may refuse.
3. **A test that would pass with the feature deleted is worse than none.** Several suites were run against the broken build first to prove they fail. Boundary tests walk import graphs; security tests reproduce the finding before asserting the fix.
4. **If you state a number, measure it.** Breakpoints, contrast ratios, qubit limits, timings, bundle sizes and tolerances in comments and documentation come from a measurement that is named. Numbers that could go stale (lesson counts, visualization counts) are read from the catalogues, never typed.

## Code style

- **TypeScript strict, no `any`.** `any` is tolerated only in tests and scripts. The build runs `tsc --noEmit` before anything else.
- **`'use client'` only when needed.** Pages are server components by default; interactivity is pushed down to the smallest component that needs it.
- **Named exports; components under about 300 lines.** Long files are split by responsibility, and the exceptions (the circuit grid, the hardware module) are the ones whose cohesion justifies it.
- **Pure modules first.** Simulation, grading, export bundles, notebooks, plan logic and edit operations are pure functions with no DOM, no clock and no network. The page is a view over the module, and the module is what the tests exercise.
- **Server-only modules are marked and tested.** `server-only` guards the runtime; a test guards the bundle.
- **No `dangerouslySetInnerHTML`** (ESLint error) except the two inline scripts that must run before first paint, each with an inline disable and a reason.
- **No `toLocaleString()` without arguments** (ESLint error), because locale-dependent formatting breaks hydration; number formatting goes through pinned helpers.
- **Comments explain *why*.** A comment records the reasoning, the measurement and the audit finding that led to a line, so a reader can tell whether it is load-bearing without reverting it. Marketing language in code or comments is a review failure.

## Decisions are written down

Nine Architecture Decision Records in `docs/adr/` follow one template: context, the failure that motivated the decision, the decision, consequences, and **what must not be undone**. They cover the two theming decisions that canvas code depends on, the qubit ordering convention, exact π fractions in QASM, server-side-only entitlements, server-only lesson bodies, hashed invite tokens, and the tutor's three visible tiers.

## Documentation is part of the change

- Fix any document a change makes false; stale documentation is treated as a bug.
- Claims that have not been executed end-to-end carry a **[UNVERIFIED]** marker, and runbook steps are tagged **[RUN]** or **[READ]** according to what was actually done.
- Security findings reference their regression test by path.
- Every API error has a stable code and the codes are documented.

## Design rules

Five categorical hues in a fixed order (violet, teal, sky, amber, rose); one hue for a single series; legends only for two or more series; never a dual-axis chart. Colour tokens are resolved values, never `light-dark()`, because canvas and WebGL code reads them at runtime. Tap targets are 44 px where the input is a finger. Every interactive element has a visible focus ring and an accessible name.

## Degrade visibly

Every optional integration has a defined off state that the interface shows (accounts not configured, checkout not available, offline tutor, device unavailable with a reason, rate limiter in memory). A silent fallback is a bug: the dispatch endpoint refuses to send mail over a store that forgets opt-outs, and a cross-check that cannot run fails CI rather than skipping.

## How we build

The team uses AI coding assistants as part of everyday development, the same way we
use linters, type checkers and test generators. What that does not change: an
engineer at Cloudspace reviews every change, every change has to pass the full
CI gate (type check, lint, unit, end-to-end, both Python suites and the
Qiskit cross-checks), and the team owns the result. If a claim in the code or
the docs is wrong, the responsibility is the team's, not the tool's. The git history
reflects this; commits carry a co-author trailer when an assistant drafted the
change, and the reviewer's name is the author.

## Reviewing a change

A pull request is expected to carry: the test that proves the change, the measurement behind any number it introduces, the documentation it makes necessary, and nothing it does not wire up. The CI run is the first reviewer: type check, lint, unit tests, service-worker check, build, bundle budgets, end-to-end suite, and both Python suites with the Qiskit cross-checks.
