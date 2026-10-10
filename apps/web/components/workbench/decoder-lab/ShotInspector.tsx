'use client'

import { useEffect, useRef } from 'react'
import { readVizColors, withAlpha } from '@/components/viz/theme'
import { watchThemeChange } from '@/components/viz/frameLoop'
import { codeFor, type DecoderName, type Distance } from '@/lib/qec/model'
import type { ShotReport } from '@/lib/qec/worker'

/**
 * ShotInspector — one sampled shot, drawn on the lattice, with every decoder's
 * verdict beside it. Data qubits are the grid; X-type plaquettes are shaded
 * violet, Z-type teal; a plaquette that fired (in the final-round sense: XOR of
 * its detection events) is outlined. Errors sit on the qubits: X in rose, Z in
 * sky, Y in amber. With measurement noise the detection events are spread over
 * several rounds; the count is printed, the picture shows their sum.
 */

const NAMES: Record<DecoderName, string> = {
  lookup: 'lookup table',
  mwpm: 'MWPM',
  mlp: 'MLP',
  transformer: 'transformer',
}

export default function ShotInspector({ report }: { report: ShotReport }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const reportRef = useRef(report)
  reportRef.current = report

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const paint = (): void => {
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(ctx, reportRef.current, w, h, wrap)
    }
    const observer = new ResizeObserver(paint)
    observer.observe(wrap)
    paint()
    const stopTheme = watchThemeChange(paint)
    return () => {
      observer.disconnect()
      stopTheme()
    }
  }, [report])

  const flips = (p: { flipX: number; flipZ: number }): string =>
    p.flipX === 0 && p.flipZ === 0 ? 'no flip' : `${p.flipX ? 'Z̄ flipped' : ''}${p.flipX && p.flipZ ? ', ' : ''}${p.flipZ ? 'X̄ flipped' : ''}`

  const errCount = { x: 0, z: 0, y: 0 }
  for (let i = 0; i < report.errX.length; i++) {
    if (report.errX[i] && report.errZ[i]) errCount.y++
    else if (report.errX[i]) errCount.x++
    else if (report.errZ[i]) errCount.z++
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <div ref={wrapRef} className="relative w-full" style={{ height: 220 }}>
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          role="img"
          aria-label={`Distance-${report.d} lattice with ${errCount.x} X, ${errCount.z} Z and ${errCount.y} Y errors and ${report.detectorCount} detection events. The truth is ${flips(report.truth)}.`}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted">
              <th className="py-1 pr-3 font-bold">decoder</th>
              <th className="py-1 pr-3 font-bold">verdict</th>
              <th className="py-1 font-bold">result</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <td className="py-1.5 pr-3 font-semibold text-ink-secondary">truth</td>
              <td className="py-1.5 pr-3 font-mono text-ink">{flips(report.truth)}</td>
              <td className="py-1.5 text-ink-muted">
                {errCount.x + errCount.y} X-ish, {errCount.z + errCount.y} Z-ish errors; {report.detectorCount} events
              </td>
            </tr>
            {(Object.keys(report.predictions) as DecoderName[]).map((name) => {
              const pred = report.predictions[name]!
              const ok = report.correct[name]
              return (
                <tr key={name} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-semibold text-ink-secondary">{NAMES[name]}</td>
                  <td className="py-1.5 pr-3 font-mono text-ink">{flips(pred)}</td>
                  <td className={`py-1.5 font-semibold ${ok ? 'text-q-teal-text' : 'text-q-rose-text'}`}>
                    {ok ? 'correct' : 'logical error'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function draw(ctx: CanvasRenderingContext2D, report: ShotReport, w: number, h: number, el: HTMLElement): void {
  const colors = readVizColors(el)
  ctx.clearRect(0, 0, w, h)
  const d = report.d as Distance
  const code = codeFor(d)
  const pad = 22
  const cell = Math.min((w - 2 * pad) / (d - 1 + 1), (h - 2 * pad) / (d - 1 + 1))
  const ox = w / 2 - ((d - 1) * cell) / 2
  const oy = h / 2 - ((d - 1) * cell) / 2
  const px = (c: number) => ox + c * cell
  const py = (r: number) => oy + r * cell

  // Plaquettes.
  for (const s of code.stabilisers) {
    const fired = s.type === 'Z' ? report.syndromeX[s.typeIndex] === 1 : report.syndromeZ[s.typeIndex] === 1
    const base = s.type === 'X' ? colors.violet : colors.teal
    ctx.fillStyle = withAlpha(base, fired ? 0.45 : 0.12)
    const cx = px(s.col)
    const cy = py(s.row)
    if (s.qubits.length === 4) {
      ctx.fillRect(cx - cell / 2, cy - cell / 2, cell, cell)
    } else {
      ctx.beginPath()
      ctx.arc(cx, cy, cell * 0.36, 0, Math.PI * 2)
      ctx.fill()
    }
    if (fired) {
      ctx.strokeStyle = base
      ctx.lineWidth = 2
      if (s.qubits.length === 4) ctx.strokeRect(cx - cell / 2, cy - cell / 2, cell, cell)
      else {
        ctx.beginPath()
        ctx.arc(cx, cy, cell * 0.36, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }
  // Data qubits.
  for (let r = 0; r < d; r++) {
    for (let c = 0; c < d; c++) {
      const i = r * d + c
      const ex = report.errX[i] === 1
      const ez = report.errZ[i] === 1
      const color = ex && ez ? colors.amber : ex ? colors.rose : ez ? colors.sky : colors.inkMuted
      ctx.fillStyle = ex || ez ? color : withAlpha(colors.ink, 0.35)
      ctx.beginPath()
      ctx.arc(px(c), py(r), ex || ez ? 5 : 3, 0, Math.PI * 2)
      ctx.fill()
      if (ex || ez) {
        ctx.fillStyle = colors.ink
        ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(ex && ez ? 'Y' : ex ? 'X' : 'Z', px(c) + 8, py(r) - 7)
      }
    }
  }
}
