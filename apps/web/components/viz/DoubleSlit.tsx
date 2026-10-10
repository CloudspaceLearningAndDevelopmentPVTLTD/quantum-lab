'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'

export type DoubleSlitProps = {
  /** Centre-to-centre distance between the two slits, arbitrary units (~10..120). */
  slitSeparation: number
  /** Width of each slit opening, arbitrary units (~2..40). */
  slitWidth: number
  /** Wavelength of the incoming quanta, arbitrary units (~4..40). */
  wavelength: number
  /** When true, a which-path detector sits at each slit and the fringes wash out. */
  observing: boolean
  /** When true, quanta arrive one at a time and the pattern accumulates from dots. */
  particleMode: boolean
  /** Particles emitted per second in particle mode (1..120). */
  speed: number
  /** Change this value to clear the accumulated hits. */
  resetKey: number
  /** Called (throttled to ~4Hz) with the number of accumulated hits. */
  onStats?: (hits: number) => void
  className?: string
}

/** Distance from the barrier to the detector screen, in the same arbitrary units as y. */
const SCREEN_DISTANCE = 900

/** Number of rows the intensity profile / CDF is sampled at. */
const PROFILE_ROWS = 360

/** Upper bound on stored impacts so a long-running session stays bounded. */
const MAX_HITS = 6000

/** How many wavefront rings to keep alive on the right of the barrier. */
const RING_COUNT = 14

/** Pixels per second the wavefronts travel outwards. */
const WAVE_SPEED = 90

const FALLBACK_COLORS = {
  violet: '#a99dff',
  violetLight: '#c1bbfe',
  amber: '#f2a96a',
  amberLight: '#fac294',
  teal: '#4edbca',
  sky: '#6283c8',
  ink: '#eef2ff',
  inkSecondary: '#8fa3c8',
  inkMuted: '#7d8cb0',
  surface: '#0d1120',
  surface2: '#141a2c',
  surface3: '#1b2338',
  line: 'rgba(255, 255, 255, 0.13)',
} as const

type Colors = { [K in keyof typeof FALLBACK_COLORS]: string }

/** `#a99dff` -> `124, 106, 249`. Returns null for non-hex input. */
function hexToRgbTriple(hex: string): string | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const n = Number.parseInt(match[1], 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

/** Build an `rgba()` string from a resolved hex colour custom property. */
function withAlpha(hex: string, alpha: number): string {
  const triple = hexToRgbTriple(hex)
  return triple ? `rgba(${triple}, ${alpha})` : hex
}

/** Resolve every colour this component needs from the current theme's CSS custom properties. */
function readColors(el: HTMLElement): Colors {
  const css = window.getComputedStyle(el)
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    violet: read('--q-violet', FALLBACK_COLORS.violet),
    violetLight: read('--q-violet-text', FALLBACK_COLORS.violetLight),
    amber: read('--q-amber', FALLBACK_COLORS.amber),
    amberLight: read('--q-amber-text', FALLBACK_COLORS.amberLight),
    teal: read('--q-teal', FALLBACK_COLORS.teal),
    sky: read('--q-sky', FALLBACK_COLORS.sky),
    ink: read('--ink', FALLBACK_COLORS.ink),
    inkSecondary: read('--ink-secondary', FALLBACK_COLORS.inkSecondary),
    inkMuted: read('--ink-muted', FALLBACK_COLORS.inkMuted),
    surface: read('--surface', FALLBACK_COLORS.surface),
    surface2: read('--surface-2', FALLBACK_COLORS.surface2),
    surface3: read('--surface-3', FALLBACK_COLORS.surface3),
    line: read('--line-strong', FALLBACK_COLORS.line),
  }
}

function sinc(x: number): number {
  return x === 0 ? 1 : Math.sin(x) / x
}

/**
 * Normalised intensity profile across `PROFILE_ROWS` sample rows.
 * Index 0 is the top of the screen, the middle index is the optical axis.
 */
function buildProfile(
  slitSeparation: number,
  slitWidth: number,
  wavelength: number,
  observing: boolean,
  halfSpan: number,
): Float64Array {
  const out = new Float64Array(PROFILE_ROWS)
  const L = SCREEN_DISTANCE
  let max = 0
  for (let i = 0; i < PROFILE_ROWS; i++) {
    // Map row index to a signed offset y from the optical axis.
    const y = ((i + 0.5) / PROFILE_ROWS) * 2 * halfSpan - halfSpan
    const alpha = (Math.PI * slitWidth * y) / (wavelength * L)
    const beta = (Math.PI * slitSeparation * y) / (wavelength * L)
    const s = sinc(alpha)
    const envelope = s * s
    const c = Math.cos(beta)
    const value = observing ? envelope : envelope * c * c
    out[i] = value
    if (value > max) max = value
  }
  if (max > 0) {
    for (let i = 0; i < PROFILE_ROWS; i++) out[i] /= max
  }
  return out
}

/** Cumulative distribution over the profile rows, normalised to end at 1. */
function buildCdf(profile: Float64Array): Float64Array {
  const cdf = new Float64Array(profile.length)
  let acc = 0
  for (let i = 0; i < profile.length; i++) {
    acc += profile[i]
    cdf[i] = acc
  }
  if (acc > 0) {
    for (let i = 0; i < cdf.length; i++) cdf[i] /= acc
  }
  return cdf
}

/** Inverse-transform sample: returns a fractional row index in [0, PROFILE_ROWS). */
function sampleCdf(cdf: Float64Array): number {
  const u = Math.random()
  let lo = 0
  let hi = cdf.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cdf[mid] < u) lo = mid + 1
    else hi = mid
  }
  // Jitter within the chosen bucket so impacts are not quantised to rows.
  return lo + Math.random()
}

type Particle = {
  progress: number
  /** Which slit this quantum went through: -1 above the axis, +1 below. */
  slit: -1 | 1
  /** Landing offset from the optical axis, in canvas pixels. */
  landing: number
  /** Slight per-particle speed variation so the stream does not look like a metronome. */
  rate: number
}

export default function DoubleSlit({
  slitSeparation,
  slitWidth,
  wavelength,
  observing,
  particleMode,
  speed,
  resetKey,
  onStats,
  className,
}: DoubleSlitProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const particlesRef = useRef<Particle[]>([])
  const hitsRef = useRef<Float32Array>(new Float32Array(MAX_HITS))
  const hitCountRef = useRef(0)
  const hitHeadRef = useRef(0)
  const emitAccRef = useRef(0)
  const lastStatRef = useRef(0)

  const onStatsRef = useRef(onStats)
  useEffect(() => {
    onStatsRef.current = onStats
  }, [onStats])

  // Live prop mirror so the animation loop reads current values without restarting.
  const propsRef = useRef({
    slitSeparation,
    slitWidth,
    wavelength,
    observing,
    particleMode,
    speed,
  })
  propsRef.current = { slitSeparation, slitWidth, wavelength, observing, particleMode, speed }

  /**
   * Half of the vertical span the screen covers, in the intensity model's units.
   * Chosen so the central fringes stay comfortably on screen for any parameter set.
   */
  const halfSpan = useMemo(() => {
    const fringe = (wavelength * SCREEN_DISTANCE) / Math.max(slitSeparation, 1)
    // Show roughly five fringes on each side, clamped to a sane range.
    return Math.max(200, Math.min(4000, fringe * 5))
  }, [wavelength, slitSeparation])

  const profile = useMemo(
    () => buildProfile(slitSeparation, slitWidth, wavelength, observing, halfSpan),
    [slitSeparation, slitWidth, wavelength, observing, halfSpan],
  )
  const cdf = useMemo(() => buildCdf(profile), [profile])

  const profileRef = useRef(profile)
  profileRef.current = profile
  const cdfRef = useRef(cdf)
  cdfRef.current = cdf

  const clear = useCallback(() => {
    hitCountRef.current = 0
    hitHeadRef.current = 0
    particlesRef.current = []
    emitAccRef.current = 0
    onStatsRef.current?.(0)
  }, [])

  // Clearing the screen on demand, and whenever the physics changes underneath it.
  useEffect(() => {
    clear()
  }, [clear, resetKey, slitSeparation, slitWidth, wavelength, observing])

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    let raf = 0
    let start = performance.now()
    let last = start

    const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reduced = reduceQuery.matches

    // Canvas cannot read CSS custom properties directly, so resolve them here and
    // again whenever the theme class on <html> changes.
    let colors = readColors(container)

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const rect = container.getBoundingClientRect()
      width = Math.max(320, Math.round(rect.width))
      height = Math.max(420, Math.round(rect.height))
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    /** Pixels per unit of the model's y axis, so the profile fills the screen strip. */
    const pixelsPerUnit = () => (height * 0.9) / (2 * halfSpan)

    const draw = (now: number) => {
      const p = propsRef.current
      const prof = profileRef.current
      const t = (now - start) / 1000
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now

      const emitterX = width * 0.08
      const barrierX = width * 0.42
      const screenX = width * 0.88
      const cy = height / 2
      const ppu = pixelsPerUnit()
      const slitHalf = Math.max(1.5, (p.slitWidth * ppu) / 2)
      const slitOffset = (p.slitSeparation * ppu) / 2
      const slitTopY = cy - slitOffset
      const slitBotY = cy + slitOffset

      const accent = p.observing ? colors.amber : colors.violet
      const accentLight = p.observing ? colors.amberLight : colors.violetLight

      // ---- background ----------------------------------------------------
      ctx.fillStyle = colors.surface
      ctx.fillRect(0, 0, width, height)

      const bg = ctx.createLinearGradient(emitterX, 0, screenX, 0)
      bg.addColorStop(0, withAlpha(colors.violet, 0.05))
      bg.addColorStop(1, withAlpha(colors.violet, 0))
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, width, height)

      // Optical axis.
      ctx.strokeStyle = withAlpha(colors.inkMuted, 0.4)
      ctx.setLineDash([4, 6])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(emitterX, cy)
      ctx.lineTo(screenX, cy)
      ctx.stroke()
      ctx.setLineDash([])

      // ---- wave mode: travelling wavefronts -------------------------------
      if (!p.particleMode) {
        const ringSpacing = Math.max(6, p.wavelength * ppu)
        const phase = reduced ? ringSpacing * 0.5 : (t * WAVE_SPEED) % ringSpacing

        // Incoming plane waves from the emitter towards the barrier.
        ctx.save()
        ctx.beginPath()
        ctx.rect(emitterX, 0, barrierX - emitterX, height)
        ctx.clip()
        ctx.strokeStyle = withAlpha(colors.sky, 0.16)
        ctx.lineWidth = 1.5
        for (let n = 0; n < RING_COUNT; n++) {
          const x = emitterX + phase + n * ringSpacing
          if (x > barrierX) break
          ctx.beginPath()
          ctx.moveTo(x, cy - height * 0.34)
          ctx.lineTo(x, cy + height * 0.34)
          ctx.stroke()
        }
        ctx.restore()

        // Circular wavefronts from each open slit, clipped to the right of the barrier.
        ctx.save()
        ctx.beginPath()
        ctx.rect(barrierX, 0, screenX - barrierX, height)
        ctx.clip()
        if (p.observing) {
          // Decohered: each slit radiates independently, drawn without additive tinting.
          ctx.globalCompositeOperation = 'source-over'
        } else {
          // Coherent: overlapping crests brighten where they meet.
          ctx.globalCompositeOperation = 'lighter'
        }
        ctx.lineWidth = 1.5
        for (const sy of [slitTopY, slitBotY]) {
          for (let n = 0; n < RING_COUNT; n++) {
            const r = phase + n * ringSpacing
            if (r <= 0) continue
            const fade = 1 - r / (screenX - barrierX + ringSpacing)
            if (fade <= 0) continue
            ctx.strokeStyle = p.observing
              ? withAlpha(colors.amber, +(0.28 * fade).toFixed(3))
              : withAlpha(colors.violet, +(0.3 * fade).toFixed(3))
            ctx.beginPath()
            ctx.arc(barrierX, sy, r, -Math.PI / 2, Math.PI / 2)
            ctx.stroke()
          }
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.restore()

        // Intensity curve, filled leftward from the screen.
        const depth = (screenX - barrierX) * 0.55
        ctx.beginPath()
        ctx.moveTo(screenX, cy - halfSpan * ppu)
        for (let i = 0; i < PROFILE_ROWS; i++) {
          const y = cy + (((i + 0.5) / PROFILE_ROWS) * 2 - 1) * halfSpan * ppu
          ctx.lineTo(screenX - prof[i] * depth, y)
        }
        ctx.lineTo(screenX, cy + halfSpan * ppu)
        ctx.closePath()
        const fill = ctx.createLinearGradient(screenX - depth, 0, screenX, 0)
        fill.addColorStop(0, p.observing ? withAlpha(colors.amber, 0.05) : withAlpha(colors.violet, 0.05))
        fill.addColorStop(1, p.observing ? withAlpha(colors.amber, 0.34) : withAlpha(colors.violet, 0.34))
        ctx.fillStyle = fill
        ctx.fill()
        ctx.strokeStyle = accentLight
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // ---- particle mode ---------------------------------------------------
      if (p.particleMode) {
        const table = cdfRef.current
        if (!reduced) {
          emitAccRef.current += (p.speed * dt)
          let toEmit = Math.floor(emitAccRef.current)
          emitAccRef.current -= toEmit
          // Guard against a huge dt after a tab regains focus.
          toEmit = Math.min(toEmit, 40)
          for (let i = 0; i < toEmit; i++) {
            const row = sampleCdf(table)
            const landing = ((row / PROFILE_ROWS) * 2 - 1) * halfSpan * ppu
            particlesRef.current.push({
              progress: 0,
              slit: Math.random() < 0.5 ? -1 : 1,
              landing,
              rate: 0.55 + Math.random() * 0.5,
            })
          }
        } else if (hitCountRef.current === 0) {
          // Reduced motion: fill the screen in one shot so the pattern is still visible.
          for (let i = 0; i < 2500; i++) {
            const row = sampleCdf(table)
            pushHit(((row / PROFILE_ROWS) * 2 - 1) * halfSpan * ppu)
          }
        }

        // Advance in-flight particles.
        const next: Particle[] = []
        for (const particle of particlesRef.current) {
          particle.progress += dt * particle.rate
          if (particle.progress >= 1) {
            pushHit(particle.landing)
          } else {
            next.push(particle)
          }
        }
        particlesRef.current = next

        // Draw in-flight particles: emitter -> slit -> landing point.
        ctx.fillStyle = accentLight
        for (const particle of particlesRef.current) {
          const sy = particle.slit < 0 ? slitTopY : slitBotY
          let x: number
          let y: number
          if (particle.progress < 0.5) {
            const k = particle.progress / 0.5
            x = emitterX + (barrierX - emitterX) * k
            y = cy + (sy - cy) * k
          } else {
            const k = (particle.progress - 0.5) / 0.5
            x = barrierX + (screenX - barrierX) * k
            y = sy + (cy + particle.landing - sy) * k
          }
          ctx.globalAlpha = 0.9
          ctx.beginPath()
          ctx.arc(x, y, 2, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      // ---- detector screen -------------------------------------------------
      const stripW = 14
      ctx.fillStyle = colors.surface2
      ctx.fillRect(screenX, height * 0.03, stripW, height * 0.94)
      ctx.strokeStyle = colors.line
      ctx.lineWidth = 1
      ctx.strokeRect(screenX + 0.5, height * 0.03, stripW - 1, height * 0.94)

      if (!p.particleMode) {
        // Paint the strip as a brightness gradient straight from I(y).
        const top = cy - halfSpan * ppu
        const rowH = (2 * halfSpan * ppu) / PROFILE_ROWS
        for (let i = 0; i < PROFILE_ROWS; i++) {
          const a = prof[i]
          if (a <= 0.002) continue
          ctx.fillStyle = p.observing
            ? withAlpha(colors.amberLight, +(a * 0.95).toFixed(3))
            : withAlpha(colors.violetLight, +(a * 0.95).toFixed(3))
          ctx.fillRect(screenX + 1, top + i * rowH, stripW - 2, rowH + 0.8)
        }
      } else {
        // Accumulated single impacts.
        ctx.fillStyle = p.observing ? withAlpha(colors.amberLight, 0.75) : withAlpha(colors.violetLight, 0.75)
        const count = hitCountRef.current
        for (let i = 0; i < count; i++) {
          const y = cy + hitsRef.current[i]
          // Deterministic per-hit horizontal jitter so dots do not shimmer between frames.
          const jitter = ((i * 2654435761) % 997) / 997
          ctx.fillRect(screenX + 1.5 + jitter * (stripW - 4), y, 1.4, 1.4)
        }
      }

      // ---- barrier ---------------------------------------------------------
      const barrierW = 12
      const bx = barrierX - barrierW / 2
      ctx.fillStyle = colors.surface3
      ctx.strokeStyle = colors.line
      const blocks: [number, number][] = [
        [0, Math.max(0, slitTopY - slitHalf)],
        [slitTopY + slitHalf, Math.max(0, slitBotY - slitHalf - (slitTopY + slitHalf))],
        [slitBotY + slitHalf, Math.max(0, height - (slitBotY + slitHalf))],
      ]
      for (const [by, bh] of blocks) {
        if (bh <= 0) continue
        ctx.fillRect(bx, by, barrierW, bh)
        ctx.strokeRect(bx + 0.5, by + 0.5, barrierW - 1, bh - 1)
      }

      // ---- emitter ---------------------------------------------------------
      const glow = ctx.createRadialGradient(emitterX, cy, 0, emitterX, cy, 34)
      glow.addColorStop(0, p.observing ? withAlpha(colors.amber, 0.5) : withAlpha(colors.violet, 0.5))
      glow.addColorStop(1, withAlpha(colors.violet, 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(emitterX, cy, 34, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(emitterX, cy, 6, 0, Math.PI * 2)
      ctx.fill()

      // ---- which-path detectors -------------------------------------------
      if (p.observing) {
        for (const sy of [slitTopY, slitBotY]) {
          const dx = barrierX + 18
          ctx.beginPath()
          ctx.arc(dx, sy, 9, 0, Math.PI * 2)
          ctx.fillStyle = withAlpha(colors.amber, 0.18)
          ctx.fill()
          ctx.strokeStyle = colors.amber
          ctx.lineWidth = 1.5
          ctx.stroke()
          // Eye glyph.
          ctx.beginPath()
          ctx.moveTo(dx - 6, sy)
          ctx.quadraticCurveTo(dx, sy - 5, dx + 6, sy)
          ctx.quadraticCurveTo(dx, sy + 5, dx - 6, sy)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(dx, sy, 1.8, 0, Math.PI * 2)
          ctx.fillStyle = colors.amberLight
          ctx.fill()
        }
      }

      // ---- labels ----------------------------------------------------------
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = colors.inkMuted
      ctx.fillText('source', emitterX, height - 14)
      ctx.fillText('barrier', barrierX, height - 14)
      ctx.fillText('screen', screenX + stripW / 2, height - 14)

      ctx.textAlign = 'right'
      if (p.observing) {
        ctx.fillStyle = colors.amberLight
        ctx.fillText('which-path known — no interference', screenX - 8, 22)
      } else {
        ctx.fillStyle = colors.violetLight
        ctx.fillText(
          p.particleMode ? 'single quanta building a fringe pattern' : 'interference pattern',
          screenX - 8,
          22,
        )
      }

      ctx.textAlign = 'left'
      ctx.fillStyle = colors.inkSecondary
      ctx.fillText(p.particleMode ? 'particle mode' : 'wave mode', 12, 22)

      // ---- stats throttle ---------------------------------------------------
      if (now - lastStatRef.current > 250) {
        lastStatRef.current = now
        onStatsRef.current?.(hitCountRef.current)
      }
    }

    function pushHit(offset: number) {
      const arr = hitsRef.current
      if (hitCountRef.current < MAX_HITS) {
        arr[hitCountRef.current] = offset
        hitCountRef.current += 1
      } else {
        // Ring buffer: overwrite the oldest impact.
        arr[hitHeadRef.current] = offset
        hitHeadRef.current = (hitHeadRef.current + 1) % MAX_HITS
      }
    }

    const loop = (now: number) => {
      draw(now)
      raf = requestAnimationFrame(loop)
    }

    // ── Frame-loop gating: pause while off-screen or the page/tab is hidden ──
    let pageVisible = typeof document === 'undefined' || !document.hidden
    let onScreen = true
    const shouldRun = () => pageVisible && onScreen

    const startLoop = (): void => {
      if (raf === 0 && !reduced && shouldRun()) {
        raf = requestAnimationFrame(loop)
      }
    }
    const stopLoop = (): void => {
      if (raf !== 0) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    const onVisibilityChange = (): void => {
      pageVisible = !document.hidden
      if (pageVisible) startLoop()
      else stopLoop()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const visibilityObserver =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              onScreen = entries.some((e) => e.isIntersecting)
              if (onScreen) startLoop()
              else stopLoop()
            },
            { rootMargin: '128px' }
          )
        : null
    visibilityObserver?.observe(container)

    // Re-read the theme's colours whenever <html>'s class changes, and repaint
    // once immediately so a toggle is reflected even while paused or hidden.
    const themeObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            colors = readColors(container)
            if (shouldRun()) draw(performance.now())
          })
        : null
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const observer = new ResizeObserver(() => {
      resize()
      if (reduced) draw(performance.now())
    })
    observer.observe(container)

    const onMotionChange = () => {
      reduced = reduceQuery.matches
      stopLoop()
      start = performance.now()
      last = start
      if (reduced) {
        draw(performance.now())
      } else {
        startLoop()
      }
    }
    reduceQuery.addEventListener('change', onMotionChange)

    resize()
    if (reduced) {
      draw(performance.now())
    } else {
      startLoop()
    }

    return () => {
      stopLoop()
      observer.disconnect()
      reduceQuery.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      visibilityObserver?.disconnect()
      themeObserver?.disconnect()
    }
  }, [halfSpan])

  const ariaLabel = particleMode
    ? `Double-slit experiment, particle mode. Individual quanta land one at a time on the detector screen, ${
        observing
          ? 'and with which-path detectors active they pile up into one smooth blob, the single-slit envelope with the fringes washed out.'
          : 'gradually building an interference pattern of bright and dark fringes.'
      }`
    : `Double-slit experiment, wave mode. ${
        observing
          ? 'Which-path detectors are watching the slits, so the screen shows a single broad blob with no fringes.'
          : 'Waves from both slits overlap and form alternating bright and dark interference fringes on the screen.'
      } Slit separation ${slitSeparation}, slit width ${slitWidth}, wavelength ${wavelength}.`

  return (
    <div ref={containerRef} className={`relative min-h-[420px] w-full ${className ?? ''}`}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} className="block h-full w-full" />
    </div>
  )
}
