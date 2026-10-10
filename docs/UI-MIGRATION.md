# shadcn/ui migration — status

Started per an explicit decision to fully migrate to shadcn's component
conventions (not just add missing primitives), covering every route
systematically. This doc tracks real state so "migrated" never gets claimed
loosely — check here before assuming a page uses the new primitives.

## Why manual install, not the CLI

`npx shadcn@latest init`/`add` calls `ui.shadcn.com`, which this build
environment's egress policy blocks (`connect_rejected`). npm itself is
reachable, so the real packages (`@radix-ui/react-*`, `class-variance-authority`,
`clsx`, `tailwind-merge`, `lucide-react`, `sonner`, `tailwindcss-animate`) were
installed directly, and `components/ui/*.tsx` hand-written against shadcn's
stable, well-known "new-york" style source — the same files the CLI would have
generated, just typed out rather than fetched. If a future environment can
reach `ui.shadcn.com`, `npx shadcn@latest add <component>` should work
normally against the `components.json` already in place — worth diffing its
output against the hand-written version once that's possible.

## Done, verified (tsc clean, full 1333-test vitest suite passing)

- **Foundation**: `components.json`, `lib/utils.ts` (`cn()`), shadcn's semantic
  CSS variables (`--background`, `--primary`, etc.) added to `app/globals.css`
  as **aliases onto the existing token set** — not a second palette. `--primary`
  intentionally points at `--q-violet-strong` (the pre-existing `.btn-primary`
  color), not a new brand color.
- **Tailwind config**: shadcn's expected color keys, `--radius`-driven border
  radius scale, `tailwindcss-animate` plugin.
- **Typography**: Inter, self-hosted via `next/font/google`, exposed as
  `--font-sans`. **Not build-verified end-to-end** in the environment that
  wrote this — `fonts.googleapis.com` is also blocked by this sandbox's
  egress policy, so `next build` gets past all type-checking and config
  parsing and fails only at the font fetch itself (confirms the setup is
  correct; a normal cloud build environment with standard internet egress,
  which both the AWS and Azure deploy scripts' build steps have, should not
  hit this). If it ever does fail there too, switch to `next/font/local`
  with a font file committed to the repo instead — that removes the
  build-time network dependency entirely.
- **11 primitives**: `button`, `card`, `badge`, `input`, `label`, `separator`,
  `skeleton`, `dialog`, `tabs`, `tooltip`, `avatar`, `dropdown-menu`, `select`.
- **`welcome` and `pricing` pages**: `app/welcome/page.tsx`,
  `app/pricing/page.tsx`, and the presentational components only they use
  (`components/onboarding/WelcomeFlow.tsx`, `FirstCircuit.tsx`,
  `PathPicker.tsx`, `components/billing/PricingTable.tsx`) now use `Button`
  and `Card` from `components/ui/*` in place of the `.btn-primary`/
  `.btn-ghost`/`.card` utility classes. `.card` maps onto `Card` unchanged;
  `.btn-ghost` maps onto `Button`'s `secondary` variant (byte-for-byte the
  same Tailwind classes — check `button.tsx`'s `variants.variant.secondary`
  against `.btn-ghost` in `globals.css` before assuming otherwise), and
  `.btn-primary` onto the `default` variant. Left alone, deliberately: the
  `PeriodToggle` control in `PricingTable.tsx` (a bespoke `role="group"`
  toggle with `aria-pressed` and a dynamic inline background, not a
  `.btn-primary`/`.btn-ghost` button) and the FAQ `<details>`/`<summary>`
  markup and the closing "Not sure yet?" `<section className="card ...">`
  on the pricing page — swapping either changes the element's semantics
  (`<details>`/`<section>` → `<div>`) or its interaction, both restructuring
  rather than a 1:1 component swap, and this environment cannot render the
  page to verify a restructure. `app/learn/` was explicitly out of scope for
  this pass and is untouched.

## Deliberately NOT touched

`components/ui/SiteNav.tsx` and `components/ui/ThemeToggle.tsx` — both render
on every single page (via `app/layout.tsx`), and both are already carefully
built with documented accessibility reasoning (layout-stable theme toggle,
`role="group"` not `radiogroup` on purpose) and real e2e test dependencies
(`data-nav-ready`, the `site-nav-drawer` / `site-nav-drawer-more` IDs
`tests/e2e/mobile.spec.ts` reads). Forcing these onto shadcn's Dialog/Sheet/
DropdownMenu without being able to actually render and click through the
result — this environment has no way to view rendered pages, only run
`tsc`/`vitest`, which wouldn't catch a visual or interaction regression —
would risk breaking real, working, tested UX for the sake of using shadcn.
That is not "the best," it is change for its own sake.

## Not started (the large remaining scope)

Nothing in `app/` (20+ routes) or the other ~70 files across
`components/{admin,analytics,auth,billing,challenge,circuit,coach,email,exam,
hardware,instructor,lesson,onboarding,pwa,search,seo,tutor,viz}/` has been
touched yet. This is genuinely a large, multi-session undertaking — realistic
next steps, roughly in leverage order:

1. Add a `sheet` primitive (needed before SiteNav's mobile drawer could be
   safely rebuilt on shadcn, if that's ever wanted — see above on why it
   wasn't done blind).
2. Migrate the marketing/first-impression pages first (`welcome`, `pricing`,
   `learn`) — highest visual impact, lowest testing risk (less interactive
   state than the simulator/tutor). `welcome` and `pricing` are done (see
   above); `learn` is not started.
3. Migrate core product UI (`simulator`, `circuits`, `tutor`, `coach`,
   `visualizations`) — needs care around the canvas/WebGL-heavy viz
   components, which are unrelated to shadcn and should not be touched.
4. Sweep the rest (`account`, `admin`, `billing`, `instructor`, `hardware`,
   `exam`, `challenges`, `compete`, `benchmark`, `insights`, `review`,
   `certify`, `verify`, `embed`, `offline`).

Each step should end with `npx tsc --noEmit -p .` and `npm test` passing,
same bar as this one did — that's the actual quality gate here, not a
mechanical file count.
