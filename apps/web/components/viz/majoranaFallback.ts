/**
 * majoranaFallback.ts — the 2-D canvas picture MajoranaSphere.tsx draws when the
 * browser refuses a WebGL context (or three.js fails to load).
 *
 * Same data, same geometry module, same colour tokens as the WebGL scene, drawn
 * orthographically: a sphere silhouette, the equator split into a bright front
 * half and a faint back half, the stars depth-sorted with the far side dimmed,
 * the hull edges, the trails and the ⟨J⟩ arrow. Drag still orbits it. Nobody
 * gets an error message where the physics should be.
 *
 * Pure function of (context, size, colours, frame) so it runs in node against
 * components/viz/canvasStub.ts — including at a 0 × 0 canvas, where it must
 * draw nothing rather than throw.
 */

import type { VizColors } from './theme'
import { withAlpha } from './theme'
import { fitRadius, greatCircleArc, projectOrtho, type Hull, type Vec3 } from '@/lib/viz/majoranaGeometry'

export interface FallbackFrame {
  stars: readonly Vec3[]
  trails: readonly (readonly Vec3[])[]
  hull: Hull
  /** ⟨J⟩/j, length ≤ 1, or null to draw no arrow. */
  meanSpin: Vec3 | null
  yaw: number
  pitch: number
}

export function drawMajoranaFallback(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colors: VizColors,
  frame: FallbackFrame
): void {
  if (!(width > 0) || !(height > 0)) return
  ctx.clearRect(0, 0, width, height)
  const R = fitRadius(width, height)
  if (!(R > 0)) return
  const cx = width / 2
  const cy = height / 2
  const P = (p: Vec3) => projectOrtho(p, frame.yaw, frame.pitch, cx, cy, R)

  // ── Silhouette ──
  ctx.lineWidth = 1
  ctx.strokeStyle = withAlpha(colors.inkMuted, 0.6)
  ctx.fillStyle = withAlpha(colors.surface2, 0.5)
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // ── Equator and two meridians: back half faint, front half bright ──
  const ring = (axisA: Vec3, axisB: Vec3, front: string, back: string) => {
    const N = 96
    for (const side of ['back', 'front'] as const) {
      ctx.strokeStyle = side === 'front' ? front : back
      ctx.beginPath()
      let pen = false
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * Math.PI * 2
        const p = P({
          x: axisA.x * Math.cos(t) + axisB.x * Math.sin(t),
          y: axisA.y * Math.cos(t) + axisB.y * Math.sin(t),
          z: axisA.z * Math.cos(t) + axisB.z * Math.sin(t),
        })
        const visible = side === 'front' ? p.depth >= 0 : p.depth < 0
        if (visible) {
          if (pen) ctx.lineTo(p.sx, p.sy)
          else ctx.moveTo(p.sx, p.sy)
          pen = true
        } else {
          pen = false
        }
      }
      ctx.stroke()
    }
  }
  ring({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, withAlpha(colors.sky, 0.8), withAlpha(colors.sky, 0.25))
  ring({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, withAlpha(colors.inkMuted, 0.5), withAlpha(colors.inkMuted, 0.15))
  ring({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, withAlpha(colors.inkMuted, 0.5), withAlpha(colors.inkMuted, 0.15))

  // ── Pole labels ──
  ctx.fillStyle = colors.ink
  ctx.font = `bold ${Math.max(10, Math.round(R * 0.11))}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const north = P({ x: 0, y: 0, z: 1.22 })
  const south = P({ x: 0, y: 0, z: -1.22 })
  ctx.fillText('|0⟩', north.sx, north.sy)
  ctx.fillText('|1⟩', south.sx, south.sy)
  ctx.fillStyle = colors.skyText
  const plus = P({ x: 1.22, y: 0, z: 0 })
  ctx.fillText('|+⟩', plus.sx, plus.sy)

  // ── Hull ──
  const projectedStars = frame.stars.map(P)
  ctx.lineWidth = 1
  for (const [a, b] of frame.hull.edges) {
    const pa = projectedStars[a]
    const pb = projectedStars[b]
    if (!pa || !pb) continue
    const frontness = (pa.depth + pb.depth) / 2 >= 0 ? 0.45 : 0.18
    ctx.strokeStyle = withAlpha(colors.sky, frontness)
    ctx.beginPath()
    ctx.moveTo(pa.sx, pa.sy)
    ctx.lineTo(pb.sx, pb.sy)
    ctx.stroke()
  }
  if (frame.hull.faces.length > 0) {
    ctx.fillStyle = withAlpha(colors.sky, 0.06)
    for (const [a, b, c] of frame.hull.faces) {
      const pa = projectedStars[a]
      const pb = projectedStars[b]
      const pc = projectedStars[c]
      if (!pa || !pb || !pc) continue
      ctx.beginPath()
      ctx.moveTo(pa.sx, pa.sy)
      ctx.lineTo(pb.sx, pb.sy)
      ctx.lineTo(pc.sx, pc.sy)
      ctx.closePath()
      ctx.fill()
    }
  }

  // ── Trails: great-circle arcs, fading with age ──
  ctx.lineWidth = 1.5
  frame.trails.forEach((trail) => {
    for (let i = 1; i < trail.length; i++) {
      const age = (trail.length - i) / trail.length
      const arc = greatCircleArc(trail[i - 1], trail[i], 4).map(P)
      const front = arc.reduce((s, p) => s + p.depth, 0) >= 0
      ctx.strokeStyle = withAlpha(colors.amber, (front ? 0.85 : 0.3) * (1 - age))
      ctx.beginPath()
      arc.forEach((p, k) => (k === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy)))
      ctx.stroke()
    }
  })

  // ── ⟨J⟩ arrow ──
  if (frame.meanSpin) {
    const tip = P(frame.meanSpin)
    ctx.strokeStyle = withAlpha(colors.violet, 0.9)
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(tip.sx, tip.sy)
    ctx.stroke()
    ctx.fillStyle = colors.violetText
    ctx.beginPath()
    ctx.arc(tip.sx, tip.sy, 3.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Stars, back to front ──
  const order = projectedStars.map((p, i) => ({ p, i })).sort((a, b) => a.p.depth - b.p.depth)
  const r = Math.max(3, R * 0.045)
  for (const { p } of order) {
    const front = p.depth >= 0
    ctx.fillStyle = front ? colors.amber : withAlpha(colors.amber, 0.35)
    ctx.beginPath()
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2)
    ctx.fill()
    if (front) {
      ctx.strokeStyle = withAlpha(colors.ink, 0.7)
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}
