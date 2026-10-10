/**
 * kernels.ts — the WGSL compute shaders, generated from the shared index maths.
 *
 * Each kernel enumerates its work with a dense counter k, linearised from a
 * 2-D dispatch exactly as indexing.ts's linearIndex() does, and maps k to an
 * amplitude index with the formulas indexing.ts exports (quoted beside each
 * line). reference.ts is the same code in TypeScript; the vitest suite proves
 * the reference against lib/quantum.ts, and the kernels are the reference
 * transcribed. Keep them small: every line here is one nobody can step through
 * in a debugger from a Node test.
 *
 * Storage layout: `amps` is array<vec2<f32>> — one vec2 per basis state,
 * (re, im). 2^N states × 8 bytes, which is the number the workbench page
 * quotes.
 *
 * All kernels share ONE uniform struct so the host writes one record per
 * dispatch into a ring of 256-byte slots (the WebGPU-guaranteed dynamic-offset
 * alignment) and binds it with a dynamic offset.
 */

import { WORKGROUP_SIZE } from './indexing'

/** Bytes per Params record in the uniform ring. WebGPU guarantees 256-byte dynamic-offset alignment. */
export const PARAMS_STRIDE = 256
/** u32 words the host writes per record: a, b, items, xGroups, m0[4], m1[4], scale. */
export const PARAMS_WORDS = 13
/** Bytes the shader's Params struct occupies (13 words → padded to a 16-byte multiple). */
export const PARAMS_SIZE = 64

const PARAMS_STRUCT = /* wgsl */ `
struct Params {
  a       : u32,        // target qubit; or qubit a for swap
  b       : u32,        // control mask for gate; qubit b for swap; outcome for collapse
  items   : u32,        // work items: pairs, quads or elements
  xGroups : u32,        // workgroups along x, for linearising a 2-D dispatch
  m0      : vec4<f32>,  // (m00.re, m00.im, m01.re, m01.im)
  m1      : vec4<f32>,  // (m10.re, m10.im, m11.re, m11.im)
  scale   : f32,        // 1/sqrt(p) for collapse
}
`

/** k = global_id.x + workgroup_id.y * (xGroups * WG)  — indexing.ts linearIndex(). */
const LINEAR_K = `let k = gid.x + wid.y * p.xGroups * ${WORKGROUP_SIZE}u;`

const CMUL = /* wgsl */ `
fn cmul(a : vec2<f32>, b : vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}
`

/** insertBit(k, pos, v) — indexing.ts. */
const INSERT_BIT = /* wgsl */ `
fn insertBit(k : u32, pos : u32, v : u32) -> u32 {
  let low = (1u << pos) - 1u;
  return ((k & ~low) << 1u) | (v << pos) | (k & low);
}
`

/**
 * Single-qubit and controlled gates. One invocation per amplitude pair; pairs
 * whose control bits are not all set return early (mask 0 passes everything).
 */
export const GATE_KERNEL = /* wgsl */ `
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read_write> amps : array<vec2<f32>>;
@group(0) @binding(1) var<uniform> p : Params;
${CMUL}
${INSERT_BIT}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  ${LINEAR_K}
  if (k >= p.items) { return; }
  let i = insertBit(k, p.a, 0u);            // pairLower(k, target)
  if ((i & p.b) != p.b) { return; }          // passesMask(i, controlMask)
  let j = i | (1u << p.a);
  let x = amps[i];
  let y = amps[j];
  amps[i] = cmul(p.m0.xy, x) + cmul(p.m0.zw, y);
  amps[j] = cmul(p.m1.xy, x) + cmul(p.m1.zw, y);
}
`

/** SWAP(a, b). One invocation per quad; touches the (a=0,b=1) ↔ (a=1,b=0) pair. */
export const SWAP_KERNEL = /* wgsl */ `
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read_write> amps : array<vec2<f32>>;
@group(0) @binding(1) var<uniform> p : Params;
${INSERT_BIT}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  ${LINEAR_K}
  if (k >= p.items) { return; }
  let lo = min(p.a, p.b);
  let hi = max(p.a, p.b);
  let withLo = insertBit(k, lo, select(0u, 1u, lo == p.b));   // swapLower(k, a, b) ...
  let i = insertBit(withLo, hi, select(0u, 1u, hi == p.b));   // ... bit a = 0, bit b = 1
  let j = i ^ (1u << p.a) ^ (1u << p.b);
  let t = amps[i];
  amps[i] = amps[j];
  amps[j] = t;
}
`

/** probs[i] = |amps[i]|². */
export const PROBABILITY_KERNEL = /* wgsl */ `
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read> amps : array<vec2<f32>>;
@group(0) @binding(1) var<uniform> p : Params;
@group(0) @binding(2) var<storage, read_write> probs : array<f32>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  ${LINEAR_K}
  if (k >= p.items) { return; }
  let v = amps[k];
  probs[k] = dot(v, v);
}
`

/**
 * Marginal probability that qubit `a` reads 1, reduced to one partial sum per
 * workgroup. The host sums the partials in float64.
 */
export const MARGINAL_KERNEL = /* wgsl */ `
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read> amps : array<vec2<f32>>;
@group(0) @binding(1) var<uniform> p : Params;
@group(0) @binding(2) var<storage, read_write> partials : array<f32>;
var<workgroup> acc : array<f32, ${WORKGROUP_SIZE}>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(
  @builtin(global_invocation_id) gid : vec3<u32>,
  @builtin(workgroup_id) wid : vec3<u32>,
  @builtin(local_invocation_id) lid : vec3<u32>,
) {
  ${LINEAR_K}
  var v = 0.0;
  if (k < p.items && ((k >> p.a) & 1u) == 1u) {
    let amp = amps[k];
    v = dot(amp, amp);
  }
  acc[lid.x] = v;
  workgroupBarrier();
  for (var s = ${WORKGROUP_SIZE / 2}u; s > 0u; s = s >> 1u) {
    if (lid.x < s) { acc[lid.x] = acc[lid.x] + acc[lid.x + s]; }
    workgroupBarrier();
  }
  if (lid.x == 0u) {
    partials[wid.x + wid.y * p.xGroups] = acc[0];
  }
}
`

/**
 * Per-workgroup argmax of |amps[k]|², ties to the lower index. Feeds the exact
 * top-k search in WebGpuBackend.topStates().
 */
export const BLOCK_MAX_KERNEL = /* wgsl */ `
${PARAMS_STRUCT}
struct BlockMax { p : f32, i : u32 }
@group(0) @binding(0) var<storage, read> amps : array<vec2<f32>>;
@group(0) @binding(1) var<uniform> p : Params;
@group(0) @binding(2) var<storage, read_write> blocks : array<BlockMax>;
var<workgroup> bestP : array<f32, ${WORKGROUP_SIZE}>;
var<workgroup> bestI : array<u32, ${WORKGROUP_SIZE}>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(
  @builtin(global_invocation_id) gid : vec3<u32>,
  @builtin(workgroup_id) wid : vec3<u32>,
  @builtin(local_invocation_id) lid : vec3<u32>,
) {
  ${LINEAR_K}
  var v = -1.0;
  if (k < p.items) {
    let amp = amps[k];
    v = dot(amp, amp);
  }
  bestP[lid.x] = v;
  bestI[lid.x] = k;
  workgroupBarrier();
  for (var s = ${WORKGROUP_SIZE / 2}u; s > 0u; s = s >> 1u) {
    if (lid.x < s) {
      let o = lid.x + s;
      if (bestP[o] > bestP[lid.x] || (bestP[o] == bestP[lid.x] && bestI[o] < bestI[lid.x])) {
        bestP[lid.x] = bestP[o];
        bestI[lid.x] = bestI[o];
      }
    }
    workgroupBarrier();
  }
  if (lid.x == 0u) {
    blocks[wid.x + wid.y * p.xGroups] = BlockMax(bestP[0], bestI[0]);
  }
}
`

/** Project qubit `a` onto outcome `b` and scale the survivors by `scale`. */
export const COLLAPSE_KERNEL = /* wgsl */ `
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read_write> amps : array<vec2<f32>>;
@group(0) @binding(1) var<uniform> p : Params;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  ${LINEAR_K}
  if (k >= p.items) { return; }
  let bit = (k >> p.a) & 1u;
  if (bit == p.b) {
    amps[k] = amps[k] * p.scale;
  } else {
    amps[k] = vec2<f32>(0.0, 0.0);
  }
}
`

export const KERNELS = {
  gate: GATE_KERNEL,
  swap: SWAP_KERNEL,
  probability: PROBABILITY_KERNEL,
  marginal: MARGINAL_KERNEL,
  blockMax: BLOCK_MAX_KERNEL,
  collapse: COLLAPSE_KERNEL,
} as const

export type KernelName = keyof typeof KERNELS

/** Which kernels bind a third (output) buffer at @binding(2). */
export const KERNEL_HAS_OUTPUT: Record<KernelName, boolean> = {
  gate: false,
  swap: false,
  probability: true,
  marginal: true,
  blockMax: true,
  collapse: false,
}

/** Which kernels only read `amps`. */
export const KERNEL_READS_ONLY: Record<KernelName, boolean> = {
  gate: false,
  swap: false,
  probability: true,
  marginal: true,
  blockMax: true,
  collapse: false,
}

/**
 * Encode one Params record. `words` is a Uint32Array view over the ring; the
 * f32 members are written through a Float32Array over the same bytes.
 */
export interface ParamsRecord {
  a: number
  b: number
  items: number
  xGroups: number
  m0?: [number, number, number, number]
  m1?: [number, number, number, number]
  scale?: number
}

export function writeParams(words: Uint32Array, floats: Float32Array, slot: number, r: ParamsRecord): void {
  const base = slot * (PARAMS_STRIDE / 4)
  words[base] = r.a >>> 0
  words[base + 1] = r.b >>> 0
  words[base + 2] = r.items >>> 0
  words[base + 3] = r.xGroups >>> 0
  const m0 = r.m0 ?? [1, 0, 0, 0]
  const m1 = r.m1 ?? [0, 0, 1, 0]
  for (let i = 0; i < 4; i++) {
    floats[base + 4 + i] = m0[i]
    floats[base + 8 + i] = m1[i]
  }
  floats[base + 12] = r.scale ?? 1
}
