import { FeatureCard } from '@/components/ui/FeatureCard'
import { VISUALIZATIONS } from '@/components/ui/Hero'

export default function VisualizationsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <header className="max-w-2xl">
        <p className="section-label">Visualizations</p>
        <h1 className="section-title mt-2 text-3xl md:text-4xl">
          {VISUALIZATIONS.length} experiments you can actually run
        </h1>
        <p className="section-desc mt-3">
          These are live simulations, not videos or canned animations. Every slider you
          drag genuinely re-solves the physics in your browser — the amplitudes, the
          interference pattern, and the measurement statistics are all computed from the
          state you built, on the spot.
        </p>
      </header>

      {/* This grid hangs straight off the <h1> — there is no intervening
          section heading — so each card title is one of the page's h2s.
          Leaving FeatureCard's default h3 would skip a level. */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {VISUALIZATIONS.map((viz) => (
          <FeatureCard
            key={viz.href}
            href={viz.href}
            icon={viz.icon}
            title={viz.title}
            description={viz.hook}
            tag={viz.level}
            accent={viz.accent}
            headingLevel={2}
          />
        ))}
      </div>
    </div>
  )
}
