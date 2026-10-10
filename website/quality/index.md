# Quality & testing

The repository's contributing guide puts it in one line: *a test that would pass with the feature deleted is worse than none.* The suites below are built to that standard, and several of them were written against the broken build first to prove they fail.

## The numbers

| Suite | Count | Runner |
| --- | --- | --- |
| Web unit and module tests | 3,672 tests in 202 files | Vitest, Node environment |
| Web end-to-end | 13 specs in two Playwright projects (desktop Chromium; 390×844 mobile) | Playwright + axe-core |
| API service | 447 tests (357 test functions) in 22 files | pytest |
| Agent service | 109 tests in 8 files | pytest |
| Python client | 6 test files | pytest |

All of them run on every push and pull request. None needs a network, an API key or a vendor SDK.

## What the suites prove

### Physics

The engine's unit tests assert analytic values (Bell, GHZ, Grover finds |11⟩ with probability 1, teleportation lands RY(π/3) on qubit 2 with P(1) = 0.25), properties over random circuits (norm stays 1, circuit-then-inverse is the identity, `simulateSteps` agrees with `simulate`), and exact QASM round-trips. The cross-checks against Qiskit and PennyLane are described in [Verification](../simulator/verification.md). Every physics module beside a visualization has a test against a closed form; every learned component trains with the one tested optimiser.

### Boundaries

Three tests walk import graphs rather than check behaviour: lesson bodies must be unreachable from client modules, exam questions must be unreachable from client modules, and a module marked `server-only` must not be imported by anything that ships. These are the tests that make the paywall structural.

### Security

Each audit finding has a regression test named in `docs/SECURITY.md`: the hardware gate chain (`submitGate.test.ts`), the shared-secret middleware including blank and trailing-comma entries, BYOK header parsing and isolation, rate-limit route coverage, webhook SSRF validation, agent injection clamps, the plan-copy-matches-plan-limits invariant, and the store-app detection script with look-alike referrers and parameters.

### End-to-end

| Spec | Proves |
| --- | --- |
| `routes` | Every route returns 200, has exactly one `h1`, a unique title and no console errors |
| `a11y` and `axe` | 21 hand-written structural checks plus axe-core at WCAG 2.1 AA tags |
| `mobile` and `responsive-matrix` | Phone journeys at 390×844; no horizontal overflow and nothing hidden under the tab bar at six widths across every route |
| `simulator`, `challenges`, `onboarding` | Presets load, gates place by keyboard and pointer, QASM exports, the Bell-pair challenge grades, the guided first circuit completes |
| `learning`, `exam` | Course progress survives a reload; the exam timer, resume-after-refresh and score review work |
| `billing` | The degraded paths: with no Stripe and no Supabase, pricing renders, checkout says so plainly, the account shows Free, all 16 qubits are selectable without an account |
| `search` | The ⌘K palette opens, filters, navigates and dismisses |

The Playwright web server builds the production app rather than running the dev server, so the end-to-end suite tests what ships. Service workers are blocked in tests so a cached page can never mask a regression.

### Performance

`scripts/bundle-size.mjs` enforces a per-route First Load JS budget (measured size + 10 %, rounded up to 0.5 kB) for 97 routes, and a route with no budget entry **fails** the check so a new page cannot ship unmeasured. The homepage is 239.5 kB; shared JavaScript is 144 kB. `docs/PERFORMANCE.md` records the work behind the numbers: dynamic imports took the Bloch-sphere page from 239 kB to 108 kB, and pausing animation loops offscreen took a visualization's frames-per-two-seconds from 117 to 0 when scrolled away. The simulator benchmark page times real `simulate()` calls and diffs against closed-form states; nothing is hardcoded.

## Static checks

TypeScript runs in `strict` mode with `tsc --noEmit` as a CI step. ESLint extends `next/core-web-vitals` and the TypeScript preset, with `react/no-danger` as an error (two reviewed exceptions, each with an inline reason), a `no-restricted-syntax` rule forbidding `toLocaleString()` with no arguments because it breaks hydration, and the React Compiler-era hooks rules as warnings. `scripts/preflight.mjs` validates the environment, lockfile, workspace linkage and configuration files with Node built-ins only, and a warning never fails the run because a zero-variable deployment is valid.

## Accessibility and responsiveness

Treated as correctness, with their own page: [Accessibility & responsive](accessibility.md).

## Where the gates run

[CI pipeline](ci.md) describes the five jobs, what each fails on, and how the deployment workflow is chained to a green run.
