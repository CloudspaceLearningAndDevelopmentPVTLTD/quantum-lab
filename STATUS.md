# Qubit16 — where the build stands

Last updated 2026-10-09. Every number below was measured on this tree on that
date; re-measure before quoting it. The previous version of this file was a
Phase 9 snapshot and almost every line in it had gone stale.

## What runs today

```
npx tsc --noEmit -p apps/web/tsconfig.json     clean
npm run lint --workspace=web                   0 errors (ESLint flat config)
npx next build                                 clean, 100 pages, 61 route handlers
cd apps/web && npx vitest run                  3,672 passed, 202 files
cd apps/web && npx playwright test             90 tests, 13 specs, desktop + 390x844 mobile
cd services/api && .venv/bin/python -m pytest  447 passed (incl. JS-vs-Qiskit cross-checks)
cd services/agent && .venv/bin/python -m pytest 109 test functions, all offline
npm audit --omit=dev                           0 vulnerabilities
```

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript 5.6 strict,
Tailwind 3.4, three 0.169; FastAPI + Qiskit/Aer + PennyLane; LangChain + LiteLLM.

## Deployed

- **qubit16.ai** runs on Azure Container Apps (eastus) behind Cloudflare:
  `quantum-lab-web`, `quantum-lab-api`, `quantum-lab-agent`, plus the hourly
  `quantum-lab-email-cron` job. Images are built by `az acr build`, tagged with
  the commit SHA, and rolled out by `.github/workflows/deploy.yml` (OIDC) after a
  green CI run on `main`.
- The engineering documentation site (docs.qubit16.ai) is built from `website/`
  and published to Cloudflare Pages by `.github/workflows/pages.yml`.
- The Android app (Trusted Web Activity, `ai.qubit16.app`) is on Google Play
  internal testing at version 1; version 2 (adds the `?app=android` launch
  marker) is built from this tree but needs the upload signing key.
- The iOS shell builds unsigned in CI and in the Simulator; it has not been
  submitted to the App Store (needs a Team ID and the `.well-known` placeholder
  replaced).

## The product

- **Learn** — 15 lessons (8 Foundations, free; 7 Advanced, Pro), 30 circuit
  challenges, 6 learning paths, ~67 glossary terms, 2 server-graded
  certification exams with public verification, spaced review, a skill-map
  coach.
- **Simulate** — a 16-qubit zero-dependency statevector engine
  (`apps/web/lib/quantum.ts`, ~2,300 lines), free on every plan with no account.
  Full gate set incl. custom matrices, basis-aware controls, QFT and modular
  arithmetic blocks, classical feed-forward with exact branch enumeration,
  OpenQASM 3 round-trip with exact π fractions, research tools (exact Pauli
  expectation values, statevector download). Verified against Qiskit to 1e-9 on
  random circuits up to 16 qubits in CI.
- **Visualize** — 40 interactive visualizations, each computing its physics live.
- **Workbench** — 18 research tools (GPU simulator to 22 qubits, 4,096-qubit
  stabilizer tableau, SABRE and learned routing, noise and mitigation, QML,
  decoders, verified circuit generation, experiment notebook).
- **Tutor** — three visible tiers (agent with 13 tools and course retrieval,
  direct model call, offline FAQ) plus an optional on-device WebLLM tier.
- **Hardware** — IBM Quantum, Amazon Braket (IonQ, Rigetti) and Azure Quantum
  (Quantinuum, IonQ) through an authenticated, entitlement-checked,
  quota-reserving proxy; bring-your-own credentials sealed with AES-256-GCM.
- **Operate** — Stripe billing with server-only entitlements, org seats and
  classrooms, admin and platform consoles, MCP server (17 tools), scoped API
  keys, signed webhooks, local-first analytics, PWA with offline page, two
  store apps that hide every purchase entry point.

## Closed since the Phase 9 snapshot

- Entitlements enforced server-side everywhere (ADR-0005); the advanced course
  text is in a server-only module and a test proves it is not in the client
  bundle (ADR-0006).
- Exams are graded server-side; certificates are minted only after a verified
  pass.
- The hardware quota race is closed: `reserve_hardware_job` is a `security
  definer` function that counts and inserts under a per-user advisory lock.
- The Supabase schema (15 migrations, 29 tables, RLS on all) runs against the
  live project.
- The environment validator runs on every boot (Next 16 loads
  `instrumentation.ts` unconditionally).
- The JS-vs-Qiskit cross-checks run in CI (the API job has Node) and fail the
  job if they cannot run; an extended suite covers every gate to 16 qubits. It
  found a controlled custom-matrix export that dropped the global phase, now
  fixed.
- Next.js upgraded past the image-optimiser / `next/og` RCE advisories; rate
  limiters key on `cf-connecting-ip`.
- 16 qubits free on every plan; donation asks replaced by a "talk to us" block;
  purchase UI hidden inside the store apps.

## Open, known, and written down

- **Cloudflare/Azure hardening** (dashboard work, not code): Full (strict) TLS,
  WAF rules for scanner paths, and restricting the `*.azurecontainerapps.io`
  origins to Cloudflare's ranges — which is what makes `cf-connecting-ip`
  trustworthy. Listed in docs/SECURITY.md.
- **End-to-end tests run in Chromium only** (desktop and mobile emulation); no
  WebKit or Firefox project. No screen-reader session has been run; the
  accessibility audit lists the untested criteria and routes.
- **`services/agent` has no auth of its own** and relies on network placement
  plus the web route's clamps; its `run_quantum_circuit` call does not send the
  API shared secret and silently falls back to local Aer when the gate is on.
- **No CodeQL or secret-scanning job in CI**; `npm audit` is run by hand on a
  schedule.
- **iOS App Store submission** and **Android version 2 upload** are blocked on
  the Apple Team ID and the Play upload key respectively.
- **`hello@qubit16.ai`** is shown across the site and needs inbound forwarding
  configured on the domain.
