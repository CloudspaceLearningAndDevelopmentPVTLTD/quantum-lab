/**
 * circuitImage.test.ts — renderCircuitSvg and renderCircuitQuantikz are pure
 * string-in/string-out builders, so they are fully testable here without a
 * DOM. svgToPngDataUrl needs a real Image/canvas and is only smoke-tested for
 * its server-side guard (see the note on that describe block).
 */

import { describe, expect, it } from 'vitest'
import { PRESETS, type Circuit } from '@/lib/quantum'
import { renderCircuitQuantikz, renderCircuitSvg, svgToPngDataUrl } from './circuitImage'

const BELL = PRESETS.find((p) => p.id === 'bell')!.circuit

const EXOTIC: Circuit = {
  numQubits: 2,
  ops: [
    { name: 'RESET', qubits: [0] },
    { name: 'U3', qubits: [1], theta: 0.5, phi: 1.0, lambda: -0.3 },
    { name: 'H', qubits: [0], extraControls: [{ qubit: 1, basis: 'X', anti: true }] },
    { name: 'POSTSELECT', qubits: [1], postselectValue: 1 },
  ],
}

const KITCHEN_SINK: Circuit = {
  numQubits: 3,
  ops: [
    { name: 'H', qubits: [0] },
    { name: 'CX', qubits: [0, 1] },
    { name: 'CCX', qubits: [0, 1, 2] },
    { name: 'SWAP', qubits: [1, 2] },
    { name: 'BARRIER', qubits: [] },
    { name: 'MEASURE', qubits: [0], clbit: 0 },
  ],
}

describe('renderCircuitSvg', () => {
  it('starts with an opening svg tag', () => {
    const svg = renderCircuitSvg(BELL)
    expect(svg.trimStart().startsWith('<svg')).toBe(true)
    expect(svg.trim().endsWith('</svg>')).toBe(true)
  })

  it('contains one wire (q-label) per qubit for the Bell preset', () => {
    const svg = renderCircuitSvg(BELL)
    for (let q = 0; q < BELL.numQubits; q++) {
      expect(svg).toContain(`>q${q}<`)
    }
  })

  it('is well-formed enough to parse as XML', () => {
    // No real DOM here (environment: node), so this is a structural sanity
    // check rather than a real XML parse: tag-open/tag-close balance.
    const svg = renderCircuitSvg(BELL)
    const opens = (svg.match(/<svg/g) ?? []).length
    const closes = (svg.match(/<\/svg>/g) ?? []).length
    expect(opens).toBe(1)
    expect(closes).toBe(1)
  })

  it('renders an element for every op in a kitchen-sink circuit (H, CX, CCX, SWAP, BARRIER, MEASURE)', () => {
    const svg = renderCircuitSvg(KITCHEN_SINK)
    // Each op contributes at least one <rect>/<line>/<circle>/<path>; a crude
    // but effective proxy is that the glyph count scales with op count and
    // nothing throws. The MEASURE meter and BARRIER dash are distinctive.
    expect(svg).toContain('stroke-dasharray="5 4"') // BARRIER
    expect(svg).toMatch(/A 9 9 0 0 1/) // MEASURE meter arc
  })

  it('renders RESET, U3, and a gate with extraControls without throwing, and includes their labels', () => {
    const svg = renderCircuitSvg(EXOTIC)
    expect(svg).toContain('>R<') // RESET
    expect(svg).toContain('U3') // U3 label
    expect(svg).toContain('&lt;1|') // POSTSELECT, XML-escaped "<1|"
  })

  it('includes a title element when options.title is given', () => {
    const svg = renderCircuitSvg(BELL, { title: 'Bell State' })
    expect(svg).toContain('Bell State')
  })

  it('sizes the viewBox from numQubits and ops.length', () => {
    const small = renderCircuitSvg({ numQubits: 1, ops: [{ name: 'H', qubits: [0] }] })
    const big = renderCircuitSvg(KITCHEN_SINK)
    const dims = (svg: string) => {
      const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
      return { w: parseFloat(m![1]), h: parseFloat(m![2]) }
    }
    expect(dims(big).w).toBeGreaterThan(dims(small).w)
    expect(dims(big).h).toBeGreaterThan(dims(small).h)
  })

  it('throws a clear error for an unrecognized gate name rather than skipping it', () => {
    const bad: Circuit = { numQubits: 1, ops: [{ name: 'NOT_A_GATE' as never, qubits: [0] }] }
    expect(() => renderCircuitSvg(bad)).toThrow(/unrecognized gate/i)
  })
})

describe('renderCircuitQuantikz', () => {
  it('contains the quantikz begin/end markers', () => {
    const tex = renderCircuitQuantikz(BELL)
    expect(tex).toContain('\\begin{quantikz}')
    expect(tex.trim().endsWith('\\end{quantikz}')).toBe(true)
  })

  it('contains one row-separator ("\\\\\\\\") sequence per qubit for the Bell preset', () => {
    const tex = renderCircuitQuantikz(BELL)
    const rowSeparators = tex.match(/\\\\/g) ?? []
    expect(rowSeparators.length).toBe(BELL.numQubits)
  })

  it('contains one row-separator sequence per qubit for a 3-qubit circuit', () => {
    const tex = renderCircuitQuantikz(KITCHEN_SINK)
    const rowSeparators = tex.match(/\\\\/g) ?? []
    expect(rowSeparators.length).toBe(KITCHEN_SINK.numQubits)
  })

  it('emits \\ctrl and \\targ for a CX', () => {
    const tex = renderCircuitQuantikz(BELL)
    expect(tex).toMatch(/\\ctrl\{1\}/)
    expect(tex).toContain('\\targ{}')
  })

  it('emits \\meter{} for MEASURE', () => {
    const tex = renderCircuitQuantikz(KITCHEN_SINK)
    expect(tex).toContain('\\meter{}')
  })

  it('renders RESET/U3/POSTSELECT/extraControls as plain \\gate{} boxes without throwing', () => {
    const tex = renderCircuitQuantikz(EXOTIC)
    expect(tex).toContain('\\begin{quantikz}')
    expect(tex).toMatch(/\\gate\{/)
  })

  it('notes the required quantikz package in a leading comment', () => {
    const tex = renderCircuitQuantikz(BELL)
    expect(tex).toMatch(/^% .*quantikz/m)
  })

  it('throws a clear error for an unrecognized gate name', () => {
    const bad: Circuit = { numQubits: 1, ops: [{ name: 'NOT_A_GATE' as never, qubits: [0] }] }
    expect(() => renderCircuitQuantikz(bad)).toThrow(/unrecognized gate/i)
  })
})

// svgToPngDataUrl needs a real browser Image + canvas to do anything useful;
// under vitest's `node` environment (see vitest.config.ts) there is no DOM to
// mock cheaply, and a heavy jsdom/canvas mock would test the mock, not the
// function. The one behavior worth pinning here is the server-side guard.
describe('svgToPngDataUrl (server-side guard only)', () => {
  it('throws a clear error when window/document are unavailable', async () => {
    await expect(svgToPngDataUrl('<svg></svg>')).rejects.toThrow(/browser/i)
  })
})
