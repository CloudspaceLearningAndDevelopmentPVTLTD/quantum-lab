import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

/**
 * A render smoke test for the two optical-table pages and the canvas components behind
 * them.
 *
 * WHAT IT CATCHES that typecheck does not: a bad import specifier, a control given a
 * prop shape it does not accept, a hook called conditionally, or a crash in the initial
 * render path. Those are the failure modes that turn a visualization page into a blank
 * error boundary in production, and the labs mount inside `useEffect`, so nothing else
 * in this suite would notice.
 *
 * WHAT IT DOES NOT COVER: the canvas drawing itself. `renderToStaticMarkup` never runs
 * effects, so the frame loop, the solver calls inside it and every `ctx.*` call are
 * untouched here. The physics those draw from is covered directly, and far better, by
 * lib/quantum/optics.test.ts.
 *
 * VizFrame calls `usePathname()`, which needs a router this environment has no way to
 * provide, so next/navigation is stubbed with the route each page actually lives at.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/visualizations/mach-zehnder' }))

describe('the optical-table pages render', () => {
  it('mounts the Mach-Zehnder page with its tray, controls and canvas', async () => {
    const Page = (await import('@/app/visualizations/mach-zehnder/page')).default
    const html = renderToStaticMarkup(createElement(Page))
    expect(html).toContain('Mach-Zehnder')
    expect(html).toContain('Component tray')
    expect(html).toContain('<canvas')
    // Both arm slots exist and are real buttons, not canvas-only hit boxes.
    expect(html).toContain('Arm A component slot')
    expect(html).toContain('Arm B component slot')
  })

  it('mounts the quantum eraser page with its analyser controls and canvas', async () => {
    const Page = (await import('@/app/visualizations/quantum-eraser/page')).default
    const html = renderToStaticMarkup(createElement(Page))
    expect(html).toContain('Quantum Eraser')
    expect(html).toContain('Idler polariser')
    expect(html).toContain('<canvas')
    // The no-signalling claim is the page's central honesty commitment; if this line
    // ever disappears, the physics copy has been rewritten and needs re-reviewing.
    expect(html).toContain('none of this can send a message')
  })

  it('mounts each lab component on its own', async () => {
    const MachZehnderLab = (await import('./MachZehnderLab')).default
    const EraserLab = (await import('./EraserLab')).default
    expect(
      renderToStaticMarkup(
        createElement(MachZehnderLab, {
          phase: 1,
          phaseArm: 0 as const,
          blockedArm: null,
          markerAngle: null,
          analyserAngle: null,
          reflectivity: 0.5,
          running: true,
          resetKey: 0,
          selectedTool: 'phase' as const,
          onPlace: () => {},
        }),
      ),
    ).toContain('<canvas')
    expect(
      renderToStaticMarkup(
        createElement(EraserLab, {
          phase: 1,
          markerAngle: Math.PI / 4,
          idlerAngle: Math.PI / 4,
          scanning: true,
          resetKey: 0,
        }),
      ),
    ).toContain('<canvas')
  })
})
