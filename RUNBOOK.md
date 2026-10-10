# Running Quantum Lab — a complete walkthrough (Windows)

Written for `C:\Users\punit\Claude\Projects\quantum-lab`. Substitute your own
path if you moved it.

**The short version.** Three commands, no API key, no Python, no account:

```powershell
cd C:\Users\punit\Claude\Projects\quantum-lab
npm install
npm run dev
```

Then open <http://localhost:3000>.

Everything below is detail, troubleshooting, and the optional extras.

---

## 1. What you actually need

| Thing | Needed for | Get it |
|---|---|---|
| **Node.js 18+** | The whole web app | <https://nodejs.org> — take the LTS build |
| Python 3.10+ | *Optional.* Real quantum hardware, tool-using tutor | <https://python.org> |
| Anthropic API key | *Optional.* Live AI tutor instead of the offline FAQ | <https://console.anthropic.com> |
| Stripe / Supabase keys | *Optional.* Billing and cross-device sync | Not needed to run anything |

Only the first row is required. Everything else is genuinely optional — the app
is designed so the default path needs no configuration at all.

Check what you have:

```powershell
node -v      # want v18.x or higher
npm -v
python --version   # optional
```

If `node` is not recognised, install it and **open a new terminal** — PowerShell
caches PATH per session.

---

## 2. Install

```powershell
cd C:\Users\punit\Claude\Projects\quantum-lab
npm install
```

Run this **from the repo root**, not from `apps\web`. This is an npm workspace:
the root install is what links `apps/web` correctly. Installing inside
`apps\web` produces a subtly broken tree.

It fetches ~200 packages and takes a minute or two the first time.

There is a helper that also does the env files and the Python venvs:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

Use `-SkipPython` if you only want the web app.

> The repo also contains `scripts/setup.sh` and `scripts/dev.sh`. Those are bash
> and are for macOS/Linux — they will not run in PowerShell. The `.ps1` files are
> the Windows equivalents.

---

## 3. Run it

```powershell
npm run dev
```

Wait for `✓ Ready`, then open <http://localhost:3000>.

Stop it with **Ctrl+C**.

To also start the optional Python services, each in its own window:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1 -WithApi -WithAgent
```

---

## 4. What to look at first

The app has **34 page routes and 30 route handlers**. These are the ones worth seeing, in order:

| URL | What it is |
|---|---|
| `/` | Landing page |
| `/visualizations/double-slit` | Fire electrons one at a time; watch fringes build from single dots |
| `/visualizations/tunneling` | A live Schrödinger solve — the packet visibly leaks through the barrier |
| `/simulator` | Build a circuit, hit **Run**. Load the **Bell State** preset first |
| `/learn` | Fourteen lessons — eight free foundations, six paid advanced — from "what is a qubit" to QAOA |
| `/challenges` | 22 circuit-building puzzles with par scores and staged hints |
| `/certify/foundations-cert` | A timed 15-question exam, drawn from a pool of 58, graded server-side |
| `/insights` | Your own activity, computed locally — populates as you use the app |
| `/pricing` | The plan tiers (checkout is inert without Stripe keys) |
| `/hardware` | Real-hardware submission — needs the Python API running (§6) |

Three visualization routes exist but are **linked from nowhere**: `/visualizations/shor`,
`/visualizations/surface-code` and `/visualizations/vqe`. They render if you type the URL. They are
not in the `VISUALIZATIONS` catalogue, so they are absent from `/visualizations`, the sitemap and
the search palette.

**A good five-minute tour:** open `/simulator`, pick the Bell State preset, press
Run, and confirm you only ever get `00` and `11` — never `01` or `10`. That is
entanglement, and the whole simulator is ~700 lines of dependency-free
TypeScript doing real linear algebra in your browser.

---

## 5. Running the tests

```powershell
npm test --workspace=web
```

**860 unit tests across 43 files**, in about 22 seconds — measured on this tree, and growing.
The load-bearing ones: `lib/quantum.test.ts` and `lib/quantum.adversarial.test.ts` (every gate,
Bloch vectors, entanglement entropy, Grover, teleportation, QASM round-trips, edge cases),
`lib/quantum.crosscheck.test.ts` (pins the browser simulator against Qiskit and PennyLane through
a shared fixture), `lib/lessons/bundle.test.ts` (fails if the paid course becomes reachable from
client code), `lib/hardware/submitGate.test.ts` (fails if any link in the money-spending chain is
removed), and `lib/orgs/classroomRoutes.test.ts` (per-org role enforcement through the real
handlers).

Type checking:

```powershell
npm run typecheck --workspace=web
```

Production build (catches anything the dev server tolerates):

```powershell
npm run build
```

Browser end-to-end tests, if you want them:

```powershell
npx playwright install chromium
npm run test:e2e --workspace=web
```

Two things to know before you blame a failure. `apps\web\playwright.config.ts` owns its own web
server (`npm run build && npm run start`) and **reuses an existing server on :3000** unless `CI` is
set — so if something is already listening there, that is what the tests run against, stale build
and all. And there are two projects: `chromium` (desktop, which skips `mobile.spec.ts`) and
`mobile` (390x844 with `hasTouch: true`).

If you already have a Chromium build on disk (Playwright's own download is large, or
your network blocks it) and don't want a second copy, point the config at it instead of
installing:

```powershell
$env:PW_CHROMIUM = "C:\path\to\chrome.exe"
npm run test:e2e --workspace=web
```

`apps/web/playwright.config.ts` reads `PW_CHROMIUM` as the browser's `executablePath`;
unset, it falls back to Playwright's own managed install.

There is also a manual, non-gating light-theme screenshot script — not part of
`npx playwright test`, and it asserts nothing:

```powershell
npm run dev   # or next start, in another window — needs a server on :3000
node apps\web\tests\manual\light-shots.mjs
```

It pins the light theme, loads a fixed list of routes (`/`, `/simulator`,
`/visualizations/bloch-sphere`, and others that paint to canvas or SVG), and writes a
screenshot of each to `apps\web\tests\manual\shots\` so a human can look for anything the
structural a11y checks would not catch — white-on-white wires, that kind of thing. It also
honours `PW_CHROMIUM`, and `BASE` if your dev server is on a different port:

```powershell
$env:BASE = "http://localhost:3100"
node apps\web\tests\manual\light-shots.mjs
```

---

## 6. Optional: the Python quantum API

Only needed for `/hardware` — running circuits on real IBM or Amazon Braket
devices, vendor-specific transpilation, and the async job queue. The simulator
does not use it.

```powershell
cd services\api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Then <http://localhost:8000/docs> gives you interactive API documentation.

Its tests:

```powershell
.\.venv\Scripts\python.exe -m pytest -q     # 172 tests, measured
```

Note `.venv\Scripts\` — on macOS and Linux it is `.venv/bin/`. Getting this
wrong is the most common Windows stumble. It matters beyond style here: a bare
`python -m pytest tests\ -q` (using whatever `python` resolves to on `PATH`, rather than
the venv's own interpreter) fails with `ModuleNotFoundError: No module named 'qiskit'`
even after the `pip install -r requirements.txt` step above, because that install only
populated `.venv`, not your system Python. Always invoke pytest through
`.venv\Scripts\python.exe -m pytest`, never through a bare `pytest` or `python -m pytest`.

**Real hardware access** additionally needs an IBM Quantum token in `.env`
(`IBM_QUANTUM_TOKEN=...`) from <https://quantum.ibm.com>. Without it, `/hardware`
still shows the device catalogue — every device marked unavailable, with the
reason. That is the intended state, not an error.

Submissions also need `SUPABASE_SERVICE_ROLE_KEY` set wherever the **web** app runs. Without it
the quota store is unreachable and every submission is refused. That is deliberate fail-closed
behaviour on the one endpoint that spends money, not a bug.

> **Do not put this service on the public internet.** On its own port it is unauthenticated: it
> executes user-supplied circuits and can spend IBM/Braket credits with no credential. Locally,
> bound to `localhost`, that is fine. Deployed, it needs `API_SHARED_SECRET` and a matching
> `QUANTUM_API_SECRET` on the web app — `docs/SECURITY.md` § "Exposing services/api safely".

---

## 7. Optional: the AI tutor

`/tutor` works with no setup at all — it answers about 15 core topics from a
built-in FAQ. Two upgrades are available:

**Live model answers.** Put a key in `apps\web\.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Restart `npm run dev`. The status line above the chat box changes to
*"Direct model — no circuit execution"*.

**Tool-using tutor** — the version that can actually run a circuit to check its
own answer rather than asserting one:

```powershell
cd services\agent
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn agent.server:app --reload --port 8001
```

With a key set, the status line becomes *"Full tutor — can run circuits to check
its answers"*, and replies carry pills like **ran a circuit**.

Those three states are the whole design, and the status line is how you tell which one you are in:
see [ADR-0009](docs/adr/0009-the-tutor-degrades-in-three-visible-tiers.md). If the agent service is
running but the status line still says *Direct model*, the agent has no key of its own — it needs
`ANTHROPIC_API_KEY` in `services\agent\.env`, separately from the web app's.

Its tests:

```powershell
.\.venv\Scripts\python.exe -m pytest -q     # 82 tests, measured
```

There is also a terminal REPL:

```powershell
.\.venv\Scripts\python.exe -m agent.cli
```

---

## 8. Two files the file bridge used to block

Earlier versions of this runbook said `.github\workflows\ci.yml` and
`apps\web\.env.local.example` could not be copied to disk. **Both are present now** — check with
`dir .github\workflows` and `dir apps\web\.env.local.example` before you go looking for a zip.

Neither is needed to run the app. `ci.yml` only matters once you push to GitHub. `setup.ps1`
writes a working `.env.local` for you; if you skipped it, create `apps\web\.env.local` by hand:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
AGENT_SERVICE_URL=http://localhost:8001
ANTHROPIC_API_KEY=
```

None of those three is required. The app runs with the file absent entirely.

---

## 9. Troubleshooting

**`npm : cannot be loaded because running scripts is disabled`**
PowerShell's execution policy. Either use `powershell -ExecutionPolicy Bypass -File ...`
for the `.ps1` files, or unblock for the current session only:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

**`'node' is not recognized`**
Node is not installed, or the terminal predates the install. Close it, open a
new one, retry.

**Port 3000 already in use**
Next picks the next free port and tells you which. Or free it:
```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess
Stop-Process -Id <that-id>
```

**npm install fails with a long-path error**
Windows' 260-character limit:
```powershell
git config --system core.longpaths true
```
Or move the project somewhere shorter, like `C:\dev\quantum-lab`.

**`/hardware` says the API is not reachable**
Expected unless you did §6. The page shows the exact URL and command.

**`/insights` looks empty**
It only shows *your* activity, and starts at zero. Run a few circuits and open a
lesson — it fills in. There is a "Generate sample data" button to see the shape
of it immediately.

**A stale service worker serves old files**
The PWA service worker is disabled in development, so this should not happen.
If you built for production and see stale content: DevTools → Application →
Service Workers → **Unregister**, then hard-reload.

**Python: `.venv\Scripts\python.exe` not found**
The venv did not get created. Check `python --version` works, then re-run
`python -m venv .venv` from inside the service directory.

---

## 10. Putting it on GitHub

Check first — `git log --oneline -1` in the project folder. If it answers, the folder already has
history and you only need a remote:

```powershell
cd C:\Users\punit\Claude\Projects\quantum-lab
git remote add origin <your repo url>
git push -u origin main
```

`scripts\push-to-github.sh` wraps that on bash. If `git log` errors with "not a git repository",
the files were copied rather than cloned, and you start one:

```powershell
git init
git add -A
git commit -m "Quantum Lab"
gh repo create quantum-lab --public --source=. --push
```

Two things to fix before the first push:

- **`vercel.json` has a `/docs` redirect pointing at `github.com/punith-naga/quantum-lab`.** That
  is not your repository. Change it.
- **CI has never run.** `.github\workflows\ci.yml` exists and every command in it has been run by
  hand, but the workflow itself has never executed on a runner. Expect to fix something on the
  first push.

---

## 11. What is actually in here

```
quantum-lab/
├── apps/web/              Next.js 14 + TypeScript + Tailwind
│   ├── lib/quantum.ts     807 lines, zero dependencies — the real physics
│   ├── components/viz/    11 interactive lab components (8 of them listed in the UI)
│   ├── lib/lessons/       11 lessons; index.ts = metadata, bodies/ = server-only prose
│   ├── lib/exams/         103-question pool, two exams, server-graded attempts
│   ├── lib/challenges/    22 circuit-building challenges
│   ├── lib/billing/       plans, entitlements, hardware quota
│   └── lib/orgs/          seats, invites, classroom assignments, progress consent
├── services/api/          FastAPI + Qiskit + PennyLane — circuits, hardware, jobs, health
├── services/agent/        LangChain + Claude — nine tools, TF-IDF retrieval over the course
├── supabase/              SQL schemas (optional: circuits, billing, exams, orgs)
├── scripts/               setup/dev (.sh and .ps1), preflight, bundle analysis
└── docs/                  architecture, ADRs, deployment, operations, security, and the rest
```

The load-bearing claim: `apps/web/lib/quantum.ts` is verified, not asserted.
A Bell state gives entropy exactly 1.0, two-qubit Grover finds the marked state
with probability 1.0, teleportation moves an RY(π/3) state onto qubit 2 giving
P(1) = 0.25, and QASM export/import round-trips bit-exactly. Those are assertions
in `npm test --workspace=web`, not comments. `lib/quantum.crosscheck.test.ts` goes further and
pins the same outputs against Qiskit and PennyLane through a fixture the Python suite reads back.

---

## 12. What this runbook does not cover

- **Deploying.** `docs/DEPLOYMENT.md` — Vercel + Railway, or one box with Docker Compose. Nothing
  in this repository has ever been deployed and no container image has ever been built.
- **Accounts, billing and orgs.** Optional. `supabase/README.md` to set them up; the RLS policies
  in `supabase/*.sql` have **never been run against a live project**, so run them on a throwaway
  one first and test as an ordinary signed-in user.
- **Day-to-day operations.** `docs/OPERATIONS.md` — health endpoints, the API error shape, error
  tracking, CI.
- **Why anything is the way it is.** `docs/adr/` — nine decision records, each with the failure
  that motivated it.
