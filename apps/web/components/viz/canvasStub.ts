/**
 * canvasStub.ts — a recording stand-in for CanvasRenderingContext2D.
 *
 * The two labs added alongside this file (spin precession, uncertainty) do all
 * their work in plain functions that take a context, so their render paths can
 * be exercised in node. That matters more than it sounds: a canvas render that
 * throws produces a blank rectangle and an error nobody sees — no failed
 * request, no red screen, no layout shift. Without a test like this, "the
 * physics is right but the picture is empty" ships.
 *
 * The stub records the ops it was given so a test can assert something was
 * actually drawn, and it validates colours, because assigning an invalid string
 * to `fillStyle` in a real browser is a SILENT no-op that keeps the previous
 * fill — the exact failure mode components/viz/theme.ts warns about.
 */

export type StubOp = { name: string; args: unknown[] }

export type StubContext = {
  ctx: CanvasRenderingContext2D
  ops: StubOp[]
  /** Every distinct value assigned to fillStyle or strokeStyle. */
  styles: string[]
  count(name: string): number
}

const METHODS = [
  'clearRect',
  'fillRect',
  'strokeRect',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'arc',
  'ellipse',
  'rect',
  'fill',
  'stroke',
  'save',
  'restore',
  'translate',
  'rotate',
  'scale',
  'setTransform',
  'setLineDash',
  'fillText',
  'strokeText',
  'clip',
  'quadraticCurveTo',
  'bezierCurveTo',
] as const

/** Colours the labs are allowed to hand a real canvas. */
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i

export function createStubContext(): StubContext {
  const ops: StubOp[] = []
  const styles: string[] = []

  const target: Record<string, unknown> = {
    canvas: { width: 800, height: 440 },
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    measureText: () => ({ width: 20 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  }
  for (const name of METHODS) {
    target[name] = (...args: unknown[]) => {
      ops.push({ name, args })
    }
  }

  const handler: ProxyHandler<Record<string, unknown>> = {
    set(obj, prop, value) {
      if (prop === 'fillStyle' || prop === 'strokeStyle') {
        if (typeof value === 'string') {
          if (!COLOR_RE.test(value)) {
            throw new Error(`invalid canvas colour assigned to ${String(prop)}: ${value}`)
          }
          styles.push(value)
        }
      }
      if (
        (prop === 'lineWidth' || prop === 'globalAlpha') &&
        (typeof value !== 'number' || !Number.isFinite(value))
      ) {
        throw new Error(`non-finite ${String(prop)}: ${String(value)}`)
      }
      obj[prop as string] = value
      return true
    },
  }

  const ctx = new Proxy(target, handler) as unknown as CanvasRenderingContext2D

  return {
    ctx,
    ops,
    styles,
    count: (name: string) => ops.filter((o) => o.name === name).length,
  }
}

/**
 * Assert every coordinate the render path passed to the canvas is a finite
 * number. NaN coordinates are the other silent canvas failure: the path is
 * abandoned from that point on, and part of the picture just stops existing.
 */
export function assertFiniteCoordinates(ops: StubOp[]): void {
  for (const op of ops) {
    for (const arg of op.args) {
      if (typeof arg === 'number' && !Number.isFinite(arg)) {
        throw new Error(`non-finite argument to ctx.${op.name}: ${String(arg)}`)
      }
    }
  }
}

/** The dark-theme token values, matching the fallbacks in ./theme.ts. */
export const STUB_COLORS = {
  ink: '#eef2ff',
  inkSecondary: '#8fa3c8',
  inkMuted: '#7d8cb0',
  line: 'rgba(255, 255, 255, 0.08)',
  lineStrong: 'rgba(255, 255, 255, 0.13)',
  surface2: '#141a2c',
  violet: '#a99dff',
  teal: '#4edbca',
  amber: '#f2a96a',
  rose: '#ef4a6b',
  sky: '#6283c8',
  violetText: '#c1bbfe',
  tealText: '#8ae8da',
  amberText: '#fac294',
  roseText: '#f5a193',
  skyText: '#8faae0',
} as const
