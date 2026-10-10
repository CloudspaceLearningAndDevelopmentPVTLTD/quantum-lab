/**
 * drawLatticeFallback — the no-WebGL picture for SurfaceCodeLattice3D.
 *
 * Same instance lists as the WebGL scene (lib/qec3d/instances.ts), pushed through
 * the oblique projection in lib/qec3d/layout.ts onto a 2-D canvas. A stacked
 * syndrome volume still reads as a stack: time goes up the page, rows recede along
 * a half-length diagonal. It is a real drawing of the same data, not an apology.
 *
 * Painter's order: far rows (small z) first, then nearer ones, so a lit marker in
 * front covers one behind it. Edges go under the markers they join.
 */

import {
  fallbackScale,
  projectOblique,
  stackCentreY,
  type Lattice3D,
  type Vec3,
} from '@/lib/qec3d/layout'
import { layerCount, sliceOutline, type EdgeInstance, type Instance } from '@/lib/qec3d/instances'
import { withAlpha } from '../theme'

export type FallbackPalette = {
  /** Fill colour per instance style. */
  styleFill: (style: Instance['style']) => string
  /** Stroke colour for a matching edge of the given stabiliser type. */
  edgeStroke: (type: 'X' | 'Z') => string
  outline: string
  label: string
}

export type FallbackFrame = {
  lattice: Lattice3D
  data: Instance[]
  stabilisers: Instance[]
  edges: EdgeInstance[]
  rounds?: ReadonlyArray<ReadonlyArray<boolean>>
  roundSpacing: number
}

export function drawLatticeFallback(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: FallbackFrame,
  palette: FallbackPalette
): void {
  ctx.clearRect(0, 0, w, h)
  const layers = layerCount(frame.rounds)
  const s = fallbackScale(frame.lattice, layers, frame.roundSpacing, w, h)
  // A zero scale is the not-yet-laid-out container: nothing to draw, nothing to throw.
  if (!(s > 0)) return
  const cx = w / 2
  const cy = h / 2 + stackCentreY(layers, frame.roundSpacing) * s
  const P = (p: Vec3) => projectOblique(p, s, cx, cy)

  // ── Slice outlines, one per round ──
  ctx.lineWidth = 1
  ctx.strokeStyle = palette.outline
  for (let t = 0; t < layers; t++) {
    const o = sliceOutline(frame.lattice, t, frame.roundSpacing).map(P)
    ctx.beginPath()
    ctx.moveTo(o[0].x, o[0].y)
    for (let i = 1; i < o.length; i++) ctx.lineTo(o[i].x, o[i].y)
    ctx.closePath()
    ctx.stroke()
  }

  // ── Matching edges ──
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1.5, s * 0.07)
  for (const e of frame.edges) {
    const half = e.length / 2
    const a = P([e.mid[0] - e.dir[0] * half, e.mid[1] - e.dir[1] * half, e.mid[2] - e.dir[2] * half])
    const b = P([e.mid[0] + e.dir[0] * half, e.mid[1] + e.dir[1] * half, e.mid[2] + e.dir[2] * half])
    ctx.strokeStyle = palette.edgeStroke(e.type)
    ctx.setLineDash(e.toBoundary ? [4, 4] : [])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // ── Markers, far to near ──
  const markers = [...frame.stabilisers, ...frame.data].sort(
    (a, b) => a.position[2] - b.position[2] || a.position[1] - b.position[1]
  )
  for (const m of markers) {
    const q = P(m.position)
    const r = Math.max(1, m.scale * s)
    ctx.fillStyle = palette.styleFill(m.style)
    ctx.beginPath()
    if (m.stabiliser !== undefined) {
      // A diamond, like the 2-D lab's plaquettes.
      ctx.moveTo(q.x, q.y - r)
      ctx.lineTo(q.x + r, q.y)
      ctx.lineTo(q.x, q.y + r)
      ctx.lineTo(q.x - r, q.y)
      ctx.closePath()
    } else {
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  // ── Time-axis labels when stacked ──
  if (layers > 1) {
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillStyle = palette.label
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const hx = frame.lattice.halfExtent
    const base = P([hx, 0, hx])
    const top = P([hx, (layers - 1) * frame.roundSpacing, hx])
    ctx.fillText('round 0', base.x + 6, base.y)
    ctx.fillText(`round ${layers - 1}`, top.x + 6, top.y)
    ctx.strokeStyle = withAlpha(palette.label, 0.5)
    ctx.beginPath()
    ctx.moveTo(base.x, base.y)
    ctx.lineTo(top.x, top.y)
    ctx.stroke()
  }
}
