import Link from 'next/link'
import { VISUALIZATIONS } from '@/lib/visualizations'
import HeroQubit from '@/components/ui/HeroQubit'
import { PLAN_BY_ID } from '@/lib/plans'

/*
 * The catalogue itself lives in `lib/visualizations.ts` (pure data, importable
 * without this component), but a dozen modules already import it from here —
 * so the data and its types are re-exported for compatibility.
 */
export { VISUALIZATIONS } from '@/lib/visualizations'
export type { VizAccent, VizLevel, Visualization } from '@/lib/visualizations'

/**
 * CORRECTION: this used to say "simulator up to 16 qubits" — 16 is the
 * Team/University ceiling, not what a first-time visitor gets. Read from
 * `lib/plans.ts` the same way `app/simulator/layout.tsx` does, so the
 * homepage never promises more than the free tier actually delivers.
 */
const FREE_QUBITS = PLAN_BY_ID.free.limits.maxQubits

// Derived from VISUALIZATIONS.length — a hardcoded count here drifts the moment
// a visualization is added or removed.
const STATS: readonly string[] = [
  `${VISUALIZATIONS.length} visualizations`,
  `All ${FREE_QUBITS} qubits free, no account needed`,
  '0 dependencies to run',
]

/**
 * Landing-page hero. Server component shell around one client island
 * (HeroQubit): the copy and links render on the server; the qubit hydrates.
 *
 * Layout logic: on a wide screen the words sit left and the thing to play
 * with sits right, at eye level, so the promise in the headline and its proof
 * are in the same glance. On a phone the headline comes first — it is the
 * reason to scroll — and the qubit follows immediately, still above the
 * feature cards. See HeroQubit.tsx for why the qubit is there at all.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden py-14 md:py-20">
      {/* The wash itself is `.hero-aurora` in app/globals.css, not an inline
          style: it needs a different alpha per theme (the light palette's hues
          are far darker, so one shared alpha produced a flat lavender film on
          light and lost the teal completely), and an inline style has nowhere
          to put a theme variant. */}
      <div aria-hidden="true" className="hero-aurora pointer-events-none absolute inset-0" />

      {/* Grid with explicit placement so the reading order differs by width:
          phone = headline → qubit → buttons (the 3D object is inside the first
          screen, right under the promise it proves); desktop = words left,
          qubit right, buttons under the words. */}
      <div className="relative mx-auto grid grid-cols-1 max-w-6xl items-center gap-8 px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-x-8 lg:gap-y-0">
        {/*
          NOT animate-fade-up: that class starts at opacity:0 (fill-mode both)
          for 0.4s, and this block holds the h1 — the page's Largest
          Contentful Paint candidate on almost every viewport. An element
          that paints transparent and only becomes opaque a few hundred ms
          later pushes LCP back by that much for no visual benefit anyone
          would notice on a hero. The qubit and button blocks below still get
          the entrance animation; the headline paints solid immediately.
        */}
        <div className="text-center lg:col-start-1 lg:row-start-1 lg:text-left">
          <span className="pill border-q-violet/30 bg-q-violet/15 text-q-violet-text">
            Open source · Runs in your browser
          </span>

          <h1 className="mt-6 bg-gradient-to-br from-q-violet-text via-q-violet to-q-teal bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-6xl">
            Learn quantum mechanics by playing with it
          </h1>

          <p className="mt-5 text-lg text-ink-secondary">
            That is a real qubit beside this text — or just below it on a phone. Spin it, hit it
            with a gate, measure it.{' '}
            <span className="hidden sm:inline">
              Then keep going: {VISUALIZATIONS.length} interactive visualizations, a real circuit
              simulator, and an AI tutor that runs your circuits to check its own answers — no
              install, no API key, no maths degree.
            </span>
          </p>
        </div>

        <div className="animate-fade-up flex justify-center lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:justify-end">
          <div className="glass w-full max-w-[440px] rounded-card p-5 md:p-6">
            <p className="section-label mb-5 text-center">Try it — this is the first lesson</p>
            <HeroQubit />
          </div>
        </div>

        <div className="animate-fade-up text-center lg:col-start-1 lg:row-start-2 lg:text-left">
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
            <Link href="/welcome" className="btn-primary focus-ring w-full sm:w-auto">
              Build your first circuit →
            </Link>
            <Link href="/visualizations" className="btn-ghost focus-ring w-full sm:w-auto">
              Explore the visualizations
            </Link>
          </div>

          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-ink-muted lg:justify-start">
            {STATS.map((stat, i) => (
              <li key={stat} className="flex items-center gap-3">
                {i > 0 ? <span aria-hidden="true">·</span> : null}
                <span>{stat}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
