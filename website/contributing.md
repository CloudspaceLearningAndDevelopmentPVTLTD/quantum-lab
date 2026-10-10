# Contributing

Qubit16 is MIT-licensed and developed in the open by Cloudspace Learning and Development Private Limited. Contributions are welcome, and the bar is the one described under [Engineering practices](practices.md).

## Running the suites

```bash
# Web: typecheck, lint, unit tests, build, bundle budgets
npm ci
npx tsc --noEmit -p apps/web/tsconfig.json
npm run lint --workspace=web
npm test --workspace=web
node scripts/check-sw-invalidation.mjs
npm run build --workspace=web && node scripts/bundle-size.mjs

# End-to-end (builds the production app, then runs Playwright)
npx playwright install --with-deps chromium
npm run test:e2e --workspace=web

# API service (includes the Qiskit cross-checks; needs Node and node_modules)
cd services/api && python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest tests -q

# Agent service
cd services/agent && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests -q
```

Run `pytest` through the virtual environment's interpreter, not a global one; the contributing guide lists this as the most common trap.

## A good change

- Comes with the test that would fail without it.
- Measures any number it introduces and says where the measurement came from.
- Keeps computation in a pure module and the page as a view.
- Enforces anything that matters on the server.
- Updates every document the change makes false, and marks what was not verified by execution.
- Adds a page, route or caller for anything it adds to `lib/`.

## Adding a visualization

Each visualization is a physics module in `lib/quantum/` or `lib/viz/` with a test against a closed form, a component in `components/viz/`, a page under `app/visualizations/` with its own social card, an entry in `lib/visualizations.ts` (which feeds the index, the sitemap, the structured data and the offline page), a bundle-budget entry, and a route in the end-to-end `pages` spec that asserts the canvas mounts. Three.js is loaded with `next/dynamic` and animation loops pause when offscreen.

## Regenerating the Qiskit fixture

After an intentional change to the engine's output:

```bash
cd apps/web && QUANTUM_FIXTURE_WRITE=1 npx vitest run lib/quantum.crosscheck.test.ts
```

A diff you did not intend is the simulator changing physics under you; the random cross-check in the API suite will say the same thing from the other side.

## Contact

- Questions, ideas and concerns: **hello@qubit16.ai** or **contact@cdandlc.com**
- Security reports: please email rather than opening a public issue, and include the route or module and a reproduction
- Source: [github.com/CloudspaceLearningAndDevelopmentPVTLTD/quantum-lab](https://github.com/CloudspaceLearningAndDevelopmentPVTLTD/quantum-lab)
