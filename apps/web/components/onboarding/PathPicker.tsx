'use client'

import { Button } from '@/components/ui/button'
import { PATHS, PATH_ORDER, totalMinutes } from '@/lib/onboarding/steps'
import { setPath, type OnboardingPath } from '@/lib/onboarding/state'

/** Fixed categorical hue order — one per path, never a sixth. */
const HUES: Record<OnboardingPath, { rgbVar: string; textVar: string }> = {
  curious: { rgbVar: '--q-violet-rgb', textVar: '--q-violet-text' },
  student: { rgbVar: '--q-teal-rgb', textVar: '--q-teal-text' },
  developer: { rgbVar: '--q-amber-rgb', textVar: '--q-amber-text' },
}

/** Themed hue at a given alpha, via the channel-triple custom property. */
function rgba(rgbVar: string, alpha: number): string {
  return `rgb(var(${rgbVar}) / ${alpha})`
}

export default function PathPicker({
  selected,
  onSelect,
  onSkip,
  onBack,
}: {
  selected: OnboardingPath | null
  /** Called after the choice is persisted, so the container can advance. */
  onSelect: (path: OnboardingPath) => void
  onSkip: () => void
  onBack?: () => void
}) {
  const choose = (path: OnboardingPath) => {
    setPath(path)
    onSelect(path)
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="section-label">Step 2 of 3</p>
        <h2 className="section-title mt-2">What brings you here?</h2>
        <p className="section-desc mt-2">
          Now that you have run one — pick the one that fits today. It only changes what we put
          in front of you next; everything on the site stays open either way, and you can change
          your mind whenever.
        </p>
      </div>

      <div className="space-y-3">
        {PATH_ORDER.map((id) => {
          const def = PATHS[id]
          const hue = HUES[id]
          const isOn = selected === id
          const preview = def.steps.slice(0, 2)
          return (
            <button
              key={id}
              type="button"
              aria-pressed={isOn}
              onClick={() => choose(id)}
              className="focus-ring block w-full rounded-card border p-4 text-left transition-colors duration-150"
              style={{
                background: isOn ? rgba(hue.rgbVar, 0.12) : 'var(--surface-2)',
                borderColor: isOn ? rgba(hue.rgbVar, 0.75) : 'var(--line)',
              }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-bold" style={{ color: `var(${hue.textVar})` }}>
                  {def.label}
                </span>
                <span className="pill shrink-0 text-[11px] text-ink-secondary">
                  {def.steps.length} steps · about {totalMinutes(id)} min
                </span>
              </div>

              <p className="mt-1.5 text-sm text-ink-secondary">{def.blurb}</p>

              <ol className="mt-3 space-y-1.5">
                {preview.map((step, i) => (
                  <li key={step.id} className="flex items-start gap-2 text-xs text-ink-muted">
                    <span aria-hidden="true" className="shrink-0 font-mono">
                      {i + 1}.
                    </span>
                    <span>
                      <span className="text-ink-secondary">{step.title}</span>{' '}
                      <span>· {step.estMinutes} min</span>
                    </span>
                  </li>
                ))}
                {def.steps.length > preview.length ? (
                  <li className="pl-5 text-xs text-ink-muted">
                    …and {def.steps.length - preview.length} more
                  </li>
                ) : null}
              </ol>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex items-center gap-3">
          {onBack ? (
            <Button type="button" variant="secondary" onClick={onBack}>
              Back
            </Button>
          ) : null}
          <p className="text-xs text-ink-muted">Not sure? Any of them is a fine guess.</p>
        </div>
        <Button type="button" variant="secondary" onClick={onSkip}>
          Skip this
        </Button>
      </div>
    </div>
  )
}
