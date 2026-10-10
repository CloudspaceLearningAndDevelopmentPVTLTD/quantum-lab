'use client'

import { useEffect, useRef } from 'react'
import { readVizColors, withAlpha, type VizColors } from '@/components/viz/theme'
import { watchThemeChange } from '@/components/viz/frameLoop'
import type { ModelId, ModelReport, Split } from '@/lib/workbench/qml'
import { GRID_LIM, GRID_RES } from '@/lib/workbench/qmlSession'

/**
 * QmlSurfaces — three decision surfaces side by side, one per model, with the
 * training points painted over each and the held-out points drawn as rings.
 *
 * Painted on canvas, once per update: a 48×48 grid of cells whose hue is the
 * predicted class (teal for +1, violet for −1) and whose opacity is the
 * model's confidence in it. There is no animation loop and nothing moves on
 * its own, so prefers-reduced-motion has nothing to suppress here; the only
 * changes are the surfaces sharpening as the optimisers step, driven by the
 * worker's progress messages.
 *
 * Each canvas is an image with a spoken description that carries the same
 * numbers the table beneath prints; the canvases are not interactive.
 */

export const MODEL_LABEL: Record<ModelId, string> = {
  logreg: 'Logistic regression',
  mlp: 'Small MLP',
  vqc: 'Variational quantum classifier',
}

const SIZE = 236

function paint(
  canvas: HTMLCanvasElement,
  split: Split,
  grid: Float32Array | undefined,
  colors: VizColors,
) {
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
  if (canvas.width !== SIZE * dpr || canvas.height !== SIZE * dpr) {
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = colors.surface2
  ctx.fillRect(0, 0, SIZE, SIZE)

  const cell = SIZE / GRID_RES
  if (grid) {
    for (let j = 0; j < GRID_RES; j++) {
      for (let i = 0; i < GRID_RES; i++) {
        const s = grid[j * GRID_RES + i]
        if (!Number.isFinite(s)) continue
        const conf = Math.tanh(Math.abs(s))
        ctx.fillStyle = withAlpha(s >= 0 ? colors.teal : colors.violet, 0.08 + 0.42 * conf)
        // Canvas y grows downward; the grid's row 0 is the bottom of the square.
        ctx.fillRect(i * cell, SIZE - (j + 1) * cell, cell + 0.5, cell + 0.5)
      }
    }
  }

  // Axes through the standardised origin.
  ctx.strokeStyle = colors.lineStrong
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(SIZE / 2, 0)
  ctx.lineTo(SIZE / 2, SIZE)
  ctx.moveTo(0, SIZE / 2)
  ctx.lineTo(SIZE, SIZE / 2)
  ctx.stroke()

  const toPx = (v: number) => ((v + GRID_LIM) / (2 * GRID_LIM)) * SIZE
  const dot = (x0: number, x1: number, y: number, held: boolean) => {
    const px = toPx(x0)
    const py = SIZE - toPx(x1)
    if (px < -4 || px > SIZE + 4 || py < -4 || py > SIZE + 4) return
    ctx.beginPath()
    ctx.arc(px, py, held ? 3.4 : 2.6, 0, 2 * Math.PI)
    const hue = y > 0 ? colors.teal : colors.violet
    if (held) {
      ctx.strokeStyle = hue
      ctx.lineWidth = 1.6
      ctx.stroke()
    } else {
      ctx.fillStyle = hue
      ctx.fill()
      ctx.strokeStyle = withAlpha(colors.ink, 0.35)
      ctx.lineWidth = 0.6
      ctx.stroke()
    }
  }
  for (let i = 0; i < split.nTrain; i++) dot(split.trainX[2 * i], split.trainX[2 * i + 1], split.trainY[i], false)
  for (let i = 0; i < split.nTest; i++) dot(split.testX[2 * i], split.testX[2 * i + 1], split.testY[i], true)
}

function Surface({
  model,
  split,
  grid,
  report,
  active,
}: {
  model: ModelId
  split: Split
  grid: Float32Array | undefined
  report: ModelReport | undefined
  active: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = () => paint(canvas, split, grid, readVizColors(canvas))
    draw()
    return watchThemeChange(draw)
  }, [split, grid])

  const pct = (v: number | undefined) =>
    v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(0)}%`
  const stepLine = report
    ? `${report.step.toLocaleString('en-US')} / ${report.budgetSteps.toLocaleString('en-US')} steps`
    : 'not started'
  const description = `Decision surface of the ${MODEL_LABEL[model].toLowerCase()}${
    report ? `: held-out accuracy ${pct(report.testAcc)}, training accuracy ${pct(report.trainAcc)}, ${stepLine}` : ', not trained yet'
  }. Teal regions predict the positive class, violet the negative; filled dots are training points, rings are held-out points.`

  return (
    <figure className="min-w-[236px] flex-1">
      <canvas
        ref={ref}
        role="img"
        aria-label={description}
        className={`block h-[236px] w-[236px] rounded-lg border ${active ? 'border-q-teal/60' : 'border-line'}`}
        style={{ width: SIZE, height: SIZE }}
      />
      <figcaption className="mt-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-bold text-ink">{MODEL_LABEL[model]}</span>
          <span className="font-mono text-[12px] text-ink-muted" aria-hidden>
            {active ? 'training…' : stepLine}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-3 font-mono text-[12px]">
          <span className="text-q-teal-text">held-out {pct(report?.testAcc)}</span>
          <span className="text-ink-muted">train {pct(report?.trainAcc)}</span>
        </div>
      </figcaption>
    </figure>
  )
}

export default function QmlSurfaces({
  split,
  grids,
  reports,
  active,
}: {
  split: Split
  grids: Partial<Record<ModelId, Float32Array>>
  reports: Partial<Record<ModelId, ModelReport>>
  active: ModelId | null
}) {
  return (
    // Three fixed-size panels; on a narrow screen they scroll sideways inside this box.
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-5 p-4">
        {(['logreg', 'mlp', 'vqc'] as ModelId[]).map((m) => (
          <Surface
            key={m}
            model={m}
            split={split}
            grid={grids[m]}
            report={reports[m]}
            active={active === m}
          />
        ))}
      </div>
    </div>
  )
}
