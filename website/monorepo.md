# Monorepo layout

One repository holds every deployable and every document. The layout is flat and the boundaries are enforced by tests rather than by folder conventions alone.

```
quantum-lab/
├── apps/
│   ├── web/            Next.js 16 application — the product
│   ├── ios/            WKWebView shell (XcodeGen project.yml is the source)
│   └── android/        Trusted Web Activity + Glance home-screen widget
├── services/
│   ├── api/            FastAPI — Qiskit/Aer/PennyLane execution, real hardware
│   └── agent/          FastAPI — LangChain tutor with course retrieval
├── packages/
│   └── qubit16-python/ Qiskit-style provider/sampler/estimator over the public API
├── supabase/           schema*.sql (source of truth) → migrations/ (generated)
├── infra/
│   ├── azure/          deploy.sh, attach-domain.sh, email cron job, GitHub OIDC setup
│   └── aws/            App Runner alternative
├── scripts/            preflight, bundle budgets, SW invalidation check, benchmarks
├── docs/               44 operator documents + docs/adr/ (9 decision records)
├── website/            this documentation site (MkDocs)
├── launch/             go-to-market content (not code)
├── .github/workflows/  ci.yml · deploy.yml · ios.yml · pages.yml (docs → Cloudflare Pages)
├── docker-compose.yml  one-box deployment of all three services
├── cloudbuild.yaml     GCP Cloud Build alternative
└── vercel.json         Vercel alternative (headers mirror lib/security/headers.ts)
```

## apps/web

| Folder | Contents |
| --- | --- |
| `app/` | Route tree: 100 `page.tsx` files, 61 `route.ts` handlers, 53 `opengraph-image.tsx` social cards |
| `components/` | 175 components. `ui/` (design system + Radix primitives), `circuit/` (editor), `viz/` (40 visualizations), `lesson/`, `billing/`, `hardware/`, `workbench/`, `seo/` |
| `lib/` | Everything that is not React: `quantum.ts` and `quantum/` (the engine), `plans.ts`, `billing/`, `security/`, `lessons/`, `exams/`, `orgs/`, `workbench/`, `mcp/`, `email/`, `analytics/`, `observability/` |
| `public/` | `manifest.webmanifest`, `sw.js` (hand-written service worker), `llms.txt`, `.well-known/` for app links |
| `tests/e2e/` | 13 Playwright specs across two projects (desktop Chromium, 390×844 mobile) |
| `proxy.ts` | Next 16's middleware: attaches security headers to every response, nothing else |
| `instrumentation.ts` | Boot-time environment validation and conditional Sentry registration |

Module boundaries are tested, not assumed. `lib/lessons/bundle.test.ts` walks the client import graph and fails if a lesson body module (the paid course text) is reachable from any `'use client'` module. `lib/exams/boundary.test.ts` does the same for exam questions. The `server-only` package guards runtime; these tests guard the bundle.

## services/api and services/agent

Both are Python 3.11 FastAPI services with the same shape: a `core/` or top-level config module with a pydantic-settings class, an `env_check` validator that runs before uvicorn in the container `CMD`, a two-stage `python:3.11-slim` Dockerfile running as a non-root `quantum` user, and a `/api/.../health` endpoint that never performs vendor network calls. The API is about 12.9k lines; the agent about 8.3k.

## supabase/

The hand-edited `schema.sql` and fourteen `schema-*.sql` add-on files are the source of truth. `scripts/supabase-migrations.sh` generates the fifteen timestamped files in `migrations/`, each idempotent (`create … if not exists`, `drop policy if exists`). `verify-migrations.sql` checks a live database against the expected shape.

## Workspaces and tooling

The root `package.json` declares `apps/*` as npm workspaces with a single lockfile; only `apps/web` has a `package.json`, and the web Dockerfile's build context must be the repository root for that reason. Root scripts delegate to the web workspace (`dev`, `build`, `lint`) and start the API (`api`). Node ≥ 18.17 is required; CI and the containers use Node 20.
