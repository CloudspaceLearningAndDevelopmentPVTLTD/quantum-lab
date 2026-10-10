import { describe, it, expect } from 'vitest'
import {
  KERNELS,
  KERNEL_HAS_OUTPUT,
  KERNEL_READS_ONLY,
  PARAMS_SIZE,
  PARAMS_STRIDE,
  PARAMS_WORDS,
  writeParams,
} from './kernels'
import { WORKGROUP_SIZE } from './indexing'
import { matrixWords } from './WebGpuBackend'
import { c } from '@/lib/quantum'

/**
 * The shaders cannot run here, but their text is generated, so what CAN be
 * pinned is that each one carries the exact index formula the reference
 * implements — the same insertBit body, the same linearisation, the same mask
 * test — and that the Params record the host writes lines up with the WGSL
 * struct the shader reads.
 */
describe('WGSL kernels', () => {
  it('every kernel declares the shared Params struct, the workgroup size and the 2-D linearisation', () => {
    for (const [name, src] of Object.entries(KERNELS)) {
      expect(src, name).toContain('struct Params')
      expect(src, name).toContain(`@workgroup_size(${WORKGROUP_SIZE})`)
      expect(src, name).toContain(`let k = gid.x + wid.y * p.xGroups * ${WORKGROUP_SIZE}u;`)
      expect(src, name).toContain('fn main(')
    }
  })

  it('the gate kernel uses insertBit for the pair and the control-mask test from indexing.ts', () => {
    const src = KERNELS.gate
    expect(src).toContain('return ((k & ~low) << 1u) | (v << pos) | (k & low);')
    expect(src).toContain('let i = insertBit(k, p.a, 0u);')
    expect(src).toContain('if ((i & p.b) != p.b) { return; }')
    expect(src).toContain('let j = i | (1u << p.a);')
    // Row 0 of the matrix updates amps[i], row 1 updates amps[j].
    expect(src).toContain('amps[i] = cmul(p.m0.xy, x) + cmul(p.m0.zw, y);')
    expect(src).toContain('amps[j] = cmul(p.m1.xy, x) + cmul(p.m1.zw, y);')
  })

  it('the swap kernel builds i from the lower position first, then the higher, and flips both bits', () => {
    const src = KERNELS.swap
    expect(src).toContain('let withLo = insertBit(k, lo, select(0u, 1u, lo == p.b));')
    expect(src).toContain('let i = insertBit(withLo, hi, select(0u, 1u, hi == p.b));')
    expect(src).toContain('let j = i ^ (1u << p.a) ^ (1u << p.b);')
  })

  it('reductions write one value per workgroup at the 2-D workgroup index', () => {
    expect(KERNELS.marginal).toContain('partials[wid.x + wid.y * p.xGroups] = acc[0];')
    expect(KERNELS.blockMax).toContain('blocks[wid.x + wid.y * p.xGroups] = BlockMax(bestP[0], bestI[0]);')
    expect(KERNELS.marginal).toContain('((k >> p.a) & 1u) == 1u')
  })

  it('output-buffer and read-only tables agree with the bindings each kernel declares', () => {
    for (const [name, src] of Object.entries(KERNELS)) {
      const hasOutput = src.includes('@binding(2)')
      expect(KERNEL_HAS_OUTPUT[name as keyof typeof KERNELS], name).toBe(hasOutput)
      const readsOnly = src.includes('var<storage, read> amps')
      expect(KERNEL_READS_ONLY[name as keyof typeof KERNELS], name).toBe(readsOnly)
    }
  })
})

describe('Params record layout', () => {
  it('fits the 256-byte dynamic-offset stride and the 64-byte struct', () => {
    expect(PARAMS_WORDS * 4).toBeLessThanOrEqual(PARAMS_SIZE)
    expect(PARAMS_SIZE % 16).toBe(0)
    expect(PARAMS_SIZE).toBeLessThanOrEqual(PARAMS_STRIDE)
    expect(PARAMS_STRIDE % 256).toBe(0)
  })

  it('writeParams puts u32 fields at words 0-3, m0 at 4-7, m1 at 8-11 and scale at 12, per slot', () => {
    const bytes = new ArrayBuffer(2 * PARAMS_STRIDE)
    const words = new Uint32Array(bytes)
    const floats = new Float32Array(bytes)
    const m = matrixWords([c(1, 2), c(3, 4), c(5, 6), c(7, 8)])
    writeParams(words, floats, 1, { a: 3, b: 0b101, items: 512, xGroups: 2, ...m, scale: 0.5 })
    const base = PARAMS_STRIDE / 4
    expect(Array.from(words.subarray(base, base + 4))).toEqual([3, 5, 512, 2])
    expect(Array.from(floats.subarray(base + 4, base + 12))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(floats[base + 12]).toBe(0.5)
    // Slot 0 untouched.
    expect(Array.from(words.subarray(0, 4))).toEqual([0, 0, 0, 0])
  })

  it('defaults the matrix to the identity and scale to 1', () => {
    const bytes = new ArrayBuffer(PARAMS_STRIDE)
    const words = new Uint32Array(bytes)
    const floats = new Float32Array(bytes)
    writeParams(words, floats, 0, { a: 0, b: 0, items: 4, xGroups: 1 })
    expect(Array.from(floats.subarray(4, 12))).toEqual([1, 0, 0, 0, 0, 0, 1, 0])
    expect(floats[12]).toBe(1)
  })
})
