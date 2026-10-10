'use client'

interface ProgressRingProps {
  /** 0..1 — values outside the range are clamped. */
  ratio: number
  size?: number
  label?: string
}

export function ProgressRing({ ratio, size = 96, label }: ProgressRingProps) {
  const safeRatio = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0))
  const stroke = Math.max(4, Math.round(size / 12))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - safeRatio)
  const percent = Math.round(safeRatio * 100)

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${label ? `${label}: ` : ''}${percent} percent complete`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#1b2338"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#a99dff"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        </svg>
        <div
          className="absolute inset-0 flex items-center justify-center font-bold text-ink"
          style={{ fontSize: Math.max(12, Math.round(size / 4.5)) }}
          aria-hidden="true"
        >
          {percent}%
        </div>
      </div>
      {label ? (
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
          {label}
        </span>
      ) : null}
    </div>
  )
}
