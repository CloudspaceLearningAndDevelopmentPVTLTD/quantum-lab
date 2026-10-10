# Dependencies & supply chain

The platform keeps its dependency surface small on purpose, pins what matters, and verifies the things it depends on rather than trusting them.

## The engine has no dependencies

`lib/quantum.ts` and everything in `lib/quantum/` import nothing from `node_modules`. The statevector engine, the OpenQASM exporter and importer, the stabilizer tableau, the noise model, routing, tomography and the physics modules are all first-party TypeScript. A supply-chain compromise of a numerics package cannot change a simulation result, and a learner on a slow connection pays for no library they do not use. The 3-D visualizations use `three`, and it is loaded with `next/dynamic` only on routes that render a scene, which is why no route pays its 130 kB up front.

## Web runtime dependencies

The web application has 31 runtime dependencies, and every one has a job:

| Purpose | Packages |
| --- | --- |
| Framework | `next`, `react`, `react-dom`, `server-only` |
| UI primitives | nine `@radix-ui/*` packages, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner` |
| 3-D | `three` |
| Accounts, billing, email, errors | `@supabase/supabase-js`, `stripe`, `resend`, `@sentry/nextjs` |
| Language models | `ai`, `@ai-sdk/anthropic`, `@ai-sdk/azure`, `@ai-sdk/google`, `@ai-sdk/groq`, `@mlc-ai/web-llm` |

Notably absent: a Redis client (the limiter uses REST over `fetch`), an MCP SDK (the stateless transport is about 150 lines), a schema library for JSON-LD, and any state-management or form library. The services pin floors (`>=`) in `requirements.txt` and the hardware SDKs are isolated in `requirements-hardware.txt` so a simulator-only image can omit roughly 120 MB with one build argument.

## Pinning and upgrades

Packages whose behaviour affects money or security are pinned exactly: `stripe`, `@sentry/nextjs`, `react`, `three`, `typescript`, `vitest`. The framework floats on a caret within its major so security patches arrive with `npm audit fix`. A single root lockfile covers the workspace and CI installs with `npm ci`, so the build is reproducible from the lockfile alone.

In October 2026 a security review found the deployed Next.js at a version with published remote-code-execution advisories in the image optimiser and `next/og`, which the site uses for social cards. The upgrade to a patched release, together with `@supabase/supabase-js` and transitive packages, took `npm audit` from eleven findings (one critical, seven high) to zero, and the build and the full test suite passed unchanged. The lesson recorded from it: run `npm audit` on a schedule, not on suspicion.

## Verifying what is depended on

Trust in a dependency is checked where it matters:

- **Qiskit and PennyLane** are the references the engine is verified against, and the test suite also verifies *them* against each other: the random cross-check compares all three implementations, so a regression in any one shows up as disagreement.
- **`qiskit-qasm3-import`** is required rather than optional, and a test fails if it is missing, because without it the service silently cannot parse the π fractions the site exports.
- **The service worker** is exercised in a Node `vm` on every CI run to prove a new build rotates the cache.
- **The three Dockerfiles** run as non-root users, copy only the runtime files, strip test tooling, and declare health checks.

## Build provenance

Production images are built by Azure Container Registry from a git checkout, tagged with the commit SHA (`gh-<12 chars>`), and deployed by a GitHub Actions workflow that authenticates to Azure with OIDC federation scoped to one repository, one environment and one resource group; there is no long-lived cloud credential anywhere. The deploy script, when run by hand, re-executes itself from a clean `git worktree` of `HEAD`, so uncommitted edits can never reach production.

## Licences

The platform is MIT-licensed. Its runtime dependencies are MIT, Apache-2.0 or BSD. The quantum SDKs are Apache-2.0.
