/**
 * WebGpuBackend.ts — a StatevectorBackend whose amplitudes live on the GPU.
 *
 * float32 complex amplitudes in one storage buffer; every gate is one compute
 * dispatch (kernels.ts). Gates are batched: applyGate() only records a Params
 * record into a uniform ring and a dispatch into an open command encoder, and
 * the batch is submitted when the ring fills or when anything needs the state
 * (flush, readback, measure). That keeps the per-gate cost at one
 * setBindGroup + dispatchWorkgroups rather than one queue submit.
 *
 * Construction is async and can fail for three separate reasons the caller
 * should be able to tell apart — see webgpu/index.ts createBackend(), which
 * turns all of them into a CpuBackend fallback with a stated reason.
 *
 * Readback paths:
 *   amplitudes()     copies the whole state to a MAP_READ staging buffer.
 *                    2^N × 8 bytes — fine to 2^24, deliberate above.
 *   probabilities()  probability kernel → a 2^N × 4 byte buffer → readback.
 *   marginal()       reduction kernel → one f32 per workgroup → host float64 sum.
 *   topStates(k)     blockMax kernel → (max, argmax) per 256-state block → host
 *                    picks the top-k blocks by max → copies only those blocks'
 *                    amplitudes back → exact top-k over their union. This is
 *                    exact: every block holding one of the true top-k states
 *                    has a block max ≥ p(k-th state) > the max of any block
 *                    holding none, so those ≤ k blocks are the top-k blocks.
 *
 * Not testable in Node — there is no GPU. Everything with a formula in it is
 * in indexing.ts / reference.ts, which are. What remains here is plumbing.
 */

import type { Matrix2x2 } from '@/lib/quantum'
import type { StatevectorBackend } from '../backend'
import {
  WORKGROUP_SIZE,
  assertQubit,
  controlMask,
  dimension,
  dispatchFor,
  workItems,
  type Dispatch,
} from './indexing'
import {
  KERNELS,
  KERNEL_HAS_OUTPUT,
  KERNEL_READS_ONLY,
  PARAMS_SIZE,
  PARAMS_STRIDE,
  writeParams,
  type KernelName,
  type ParamsRecord,
} from './kernels'
import type { BasisState } from './reference'

/** Dispatches per submitted batch; also the uniform ring length. */
export const BATCH_SIZE = 512

/** Hard ceiling; 2^30 × 8 bytes is 8 GB, past any device limit today. */
const ABSOLUTE_MAX_QUBITS = 30

export interface WebGpuInfo {
  vendor: string
  architecture: string
  device: string
  description: string
  /** Largest storage buffer the device will bind, in bytes. */
  maxStorageBufferBindingSize: number
  maxBufferSize: number
}

export class WebGpuBackend implements StatevectorBackend {
  readonly kind = 'webgpu' as const
  readonly precision = 'float32' as const
  readonly maxQubits: number
  readonly info: WebGpuInfo

  private readonly device: GPUDevice
  private readonly pipelines: Record<KernelName, GPUComputePipeline>
  private readonly layouts: Record<KernelName, GPUBindGroupLayout>
  private readonly uniformRing: GPUBuffer
  private readonly ringBytes = new ArrayBuffer(BATCH_SIZE * PARAMS_STRIDE)
  private readonly ringWords = new Uint32Array(this.ringBytes)
  private readonly ringFloats = new Float32Array(this.ringBytes)

  private n = 0
  private dim = 0
  private amps: GPUBuffer | null = null
  private probs: GPUBuffer | null = null
  private partials: GPUBuffer | null = null
  private bindGroups: Partial<Record<KernelName, GPUBindGroup>> = {}

  private encoder: GPUCommandEncoder | null = null
  private pass: GPUComputePassEncoder | null = null
  private slot = 0
  private lostReason: string | null = null
  private disposed = false

  private constructor(
    device: GPUDevice,
    info: WebGpuInfo,
    pipelines: Record<KernelName, GPUComputePipeline>,
    layouts: Record<KernelName, GPUBindGroupLayout>,
  ) {
    this.device = device
    this.info = info
    this.pipelines = pipelines
    this.layouts = layouts
    const byBuffer = Math.floor(Math.log2(Math.min(info.maxStorageBufferBindingSize, info.maxBufferSize) / 8))
    this.maxQubits = Math.max(1, Math.min(ABSOLUTE_MAX_QUBITS, byBuffer))
    this.uniformRing = device.createBuffer({
      label: 'params ring',
      size: BATCH_SIZE * PARAMS_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.lost.then((info) => {
      this.lostReason = `${info.reason}: ${info.message}`
    })
  }

  /**
   * Request an adapter and device, compile every kernel. Throws with a
   * human-readable message when WebGPU is absent or the device refuses.
   */
  static async create(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<WebGpuBackend> {
    const gpu = nav?.gpu
    if (!gpu) throw new Error('WebGPU is not available in this browser (navigator.gpu is undefined)')
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('WebGPU is present but no adapter was offered — the GPU may be blocklisted')

    const limits = adapter.limits
    const device = await adapter.requestDevice({
      label: 'qubit16 statevector',
      // Ask for the adapter's real ceilings; the defaults are 128 MB (2^24 states).
      requiredLimits: {
        maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
        maxBufferSize: limits.maxBufferSize,
      },
    })

    const adapterInfo = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : undefined)
    const info: WebGpuInfo = {
      vendor: adapterInfo?.vendor ?? '',
      architecture: adapterInfo?.architecture ?? '',
      device: adapterInfo?.device ?? '',
      description: adapterInfo?.description ?? '',
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxBufferSize: device.limits.maxBufferSize,
    }

    device.pushErrorScope('validation')
    const layouts = {} as Record<KernelName, GPUBindGroupLayout>
    const pipelines = {} as Record<KernelName, GPUComputePipeline>
    try {
      await WebGpuBackend.compileKernels(device, layouts, pipelines)
    } catch (err) {
      // createComputePipelineAsync rejects (rather than raising a scoped
      // error) when a kernel fails to compile; release the device either way.
      device.destroy()
      throw new Error(`WebGPU kernel compilation failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    const error = await device.popErrorScope()
    if (error) {
      device.destroy()
      throw new Error(`WebGPU kernel compilation failed: ${error.message}`)
    }
    return new WebGpuBackend(device, info, pipelines, layouts)
  }

  /** Build one bind-group layout and one pipeline per kernel, in place. */
  private static async compileKernels(
    device: GPUDevice,
    layouts: Record<KernelName, GPUBindGroupLayout>,
    pipelines: Record<KernelName, GPUComputePipeline>,
  ): Promise<void> {
    for (const name of Object.keys(KERNELS) as KernelName[]) {
      const entries: GPUBindGroupLayoutEntry[] = [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: KERNEL_READS_ONLY[name] ? 'read-only-storage' : 'storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PARAMS_SIZE },
        },
      ]
      if (KERNEL_HAS_OUTPUT[name]) {
        entries.push({ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } })
      }
      const layout = device.createBindGroupLayout({ label: `${name} layout`, entries })
      layouts[name] = layout
      // Named `shaderModule`, not `module`: a binding called `module` shadows
      // the CommonJS `module` that bundlers inject into every module scope,
      // which Next flags because it can break the bundle in ways that surface
      // far from here. WebGPU's own field name is preserved at the call site.
      const shaderModule = device.createShaderModule({ label: `${name} kernel`, code: KERNELS[name] })
      pipelines[name] = await device.createComputePipelineAsync({
        label: `${name} pipeline`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module: shaderModule, entryPoint: 'main' },
      })
    }
  }

  get numQubits(): number { return this.n }

  allocate(n: number): void {
    this.assertLive()
    dimension(n)
    if (n > this.maxQubits) {
      throw new Error(`this GPU binds at most 2^${this.maxQubits} amplitudes (${this.info.maxStorageBufferBindingSize} bytes); ${n} qubits needs 2^${n}`)
    }
    this.releaseState()
    this.n = n
    this.dim = dimension(n)
    // The initial |0…0⟩ is written through mappedAtCreation, which needs no
    // staging buffer and no queue round trip.
    this.amps = this.device.createBuffer({
      label: `amplitudes ${n}q`,
      size: this.dim * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    })
    new Float32Array(this.amps.getMappedRange())[0] = 1
    this.amps.unmap()
    this.bindGroups = {}
  }

  // ── Gates ──

  applyGate(matrix: Matrix2x2, target: number): void {
    this.assertAllocated()
    assertQubit(target, this.n, 'target qubit')
    this.enqueue('gate', {
      a: target,
      b: 0,
      items: workItems.gate(this.dim),
      xGroups: 0,
      ...matrixWords(matrix),
    })
  }

  applyControlled(matrix: Matrix2x2, controls: readonly number[], target: number): void {
    this.assertAllocated()
    assertQubit(target, this.n, 'target qubit')
    const mask = controlMask(controls, target, this.n)
    this.enqueue('gate', {
      a: target,
      b: mask,
      items: workItems.gate(this.dim),
      xGroups: 0,
      ...matrixWords(matrix),
    })
  }

  applySwap(a: number, b: number): void {
    this.assertAllocated()
    assertQubit(a, this.n)
    assertQubit(b, this.n)
    if (a === b) return
    this.enqueue('swap', { a, b, items: workItems.swap(this.dim), xGroups: 0 })
  }

  // ── Readback ──

  async flush(): Promise<void> {
    this.assertLive()
    this.submit()
    await this.device.queue.onSubmittedWorkDone()
    this.assertLive()
  }

  async amplitudes(): Promise<Float32Array> {
    this.assertAllocated()
    this.submit()
    const bytes = await this.readBack(this.amps!, 0, this.dim * 8)
    return new Float32Array(bytes)
  }

  async probabilities(): Promise<Float64Array> {
    this.assertAllocated()
    this.probs ??= this.device.createBuffer({
      label: 'probabilities',
      size: this.dim * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    this.enqueue('probability', { a: 0, b: 0, items: this.dim, xGroups: 0 })
    this.submit()
    const bytes = await this.readBack(this.probs, 0, this.dim * 4)
    return Float64Array.from(new Float32Array(bytes))
  }

  async marginal(target: number): Promise<number> {
    this.assertAllocated()
    assertQubit(target, this.n)
    const d = this.ensurePartials()
    this.enqueue('marginal', { a: target, b: 0, items: this.dim, xGroups: 0 })
    this.submit()
    const bytes = await this.readBack(this.partials!, 0, d.groups * 4)
    const parts = new Float32Array(bytes)
    // Sum in float64: 2^18 float32 partials would lose ~1e-5 summed in f32.
    let p = 0
    for (let i = 0; i < parts.length; i++) p += parts[i]
    return Math.min(1, Math.max(0, p))
  }

  async measure(target: number, rng: () => number = Math.random): Promise<0 | 1> {
    const p1 = await this.marginal(target)
    const outcome: 0 | 1 = rng() < p1 ? 1 : 0
    const p = outcome === 1 ? p1 : 1 - p1
    if (!(p > 1e-7)) {
      // float32's honest resolution; StateVector uses 1e-12 for float64.
      throw new Error(`qubit ${target} cannot collapse to ${outcome}: that outcome has probability ${p.toExponential(2)}`)
    }
    this.enqueue('collapse', { a: target, b: outcome, items: this.dim, xGroups: 0, scale: 1 / Math.sqrt(p) })
    return outcome
  }

  async topStates(k: number): Promise<BasisState[]> {
    this.assertAllocated()
    const want = Math.max(0, Math.min(k, this.dim))
    if (want === 0) return []
    const d = this.ensurePartials()
    this.enqueue('blockMax', { a: 0, b: 0, items: this.dim, xGroups: 0 })
    this.submit()
    const bytes = await this.readBack(this.partials!, 0, d.groups * 8)
    const words = new Uint32Array(bytes)
    const floats = new Float32Array(bytes)
    const blocks: { p: number; block: number }[] = []
    for (let g = 0; g < d.groups; g++) {
      const p = floats[2 * g]
      if (p < 0) continue // a workgroup entirely past `items`
      blocks.push({ p, block: Math.floor(words[2 * g + 1] / WORKGROUP_SIZE) })
    }
    blocks.sort((x, y) => y.p - x.p || x.block - y.block)
    const chosen = blocks.slice(0, want).map((b) => b.block)

    // Copy only the chosen blocks back and rank their states exactly.
    const blockBytes = WORKGROUP_SIZE * 8
    const staging = this.device.createBuffer({
      label: 'top-k staging',
      size: chosen.length * blockBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    const enc = this.device.createCommandEncoder()
    chosen.forEach((block, i) => {
      const start = block * blockBytes
      const size = Math.min(blockBytes, this.dim * 8 - start)
      enc.copyBufferToBuffer(this.amps!, start, staging, i * blockBytes, size)
    })
    this.device.queue.submit([enc.finish()])
    await staging.mapAsync(GPUMapMode.READ)
    const amps = new Float32Array(staging.getMappedRange().slice(0))
    staging.unmap()
    staging.destroy()

    const candidates: BasisState[] = []
    chosen.forEach((block, i) => {
      const base = block * WORKGROUP_SIZE
      for (let j = 0; j < WORKGROUP_SIZE && base + j < this.dim; j++) {
        const re = amps[i * WORKGROUP_SIZE * 2 + 2 * j]
        const im = amps[i * WORKGROUP_SIZE * 2 + 2 * j + 1]
        candidates.push({ index: base + j, probability: re * re + im * im })
      }
    })
    candidates.sort((x, y) => y.probability - x.probability || x.index - y.index)
    return candidates.slice(0, want)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.pass?.end()
    this.pass = null
    this.encoder = null
    this.releaseState()
    this.uniformRing.destroy()
    this.device.destroy()
  }

  // ── Internals ──

  /** Record one dispatch into the open batch, submitting first if the ring is full. */
  private enqueue(kernel: KernelName, record: ParamsRecord): void {
    if (this.slot >= BATCH_SIZE) this.submit()
    const d: Dispatch = dispatchFor(record.items)
    writeParams(this.ringWords, this.ringFloats, this.slot, { ...record, xGroups: d.x })
    if (!this.encoder || !this.pass) {
      this.encoder = this.device.createCommandEncoder({ label: 'gate batch' })
      this.pass = this.encoder.beginComputePass()
    }
    this.pass.setPipeline(this.pipelines[kernel])
    this.pass.setBindGroup(0, this.bindGroup(kernel), [this.slot * PARAMS_STRIDE])
    this.pass.dispatchWorkgroups(d.x, d.y)
    this.slot++
  }

  /** Close the open batch: upload its Params records and submit. No-op when empty. */
  private submit(): void {
    if (!this.encoder || !this.pass) return
    this.pass.end()
    // writeBuffer is a queue operation ordered BEFORE the submit that follows
    // it and AFTER every earlier submit, so reusing one ring across batches is
    // safe: the previous batch has consumed its records by the time this write
    // lands.
    this.device.queue.writeBuffer(this.uniformRing, 0, this.ringBytes, 0, this.slot * PARAMS_STRIDE)
    this.device.queue.submit([this.encoder.finish()])
    this.encoder = null
    this.pass = null
    this.slot = 0
  }

  private bindGroup(kernel: KernelName): GPUBindGroup {
    const cached = this.bindGroups[kernel]
    if (cached) return cached
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: this.amps! } },
      { binding: 1, resource: { buffer: this.uniformRing, offset: 0, size: PARAMS_SIZE } },
    ]
    if (KERNEL_HAS_OUTPUT[kernel]) {
      const out = kernel === 'probability' ? this.probs : this.partials
      if (!out) throw new Error(`${kernel} needs its output buffer allocated first`)
      entries.push({ binding: 2, resource: { buffer: out } })
    }
    const bg = this.device.createBindGroup({ label: `${kernel} bind group`, layout: this.layouts[kernel], entries })
    this.bindGroups[kernel] = bg
    return bg
  }

  /** One (max, argmax) or one f32 per workgroup of an elementwise dispatch. */
  private ensurePartials(): Dispatch {
    const d = dispatchFor(this.dim)
    this.partials ??= this.device.createBuffer({
      label: 'reduction partials',
      size: d.groups * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    return d
  }

  private async readBack(src: GPUBuffer, offset: number, size: number): Promise<ArrayBuffer> {
    const staging = this.device.createBuffer({
      label: 'readback staging',
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    const enc = this.device.createCommandEncoder({ label: 'readback' })
    enc.copyBufferToBuffer(src, offset, staging, 0, size)
    this.device.queue.submit([enc.finish()])
    await staging.mapAsync(GPUMapMode.READ)
    const copy = staging.getMappedRange().slice(0)
    staging.unmap()
    staging.destroy()
    this.assertLive()
    return copy
  }

  private releaseState(): void {
    this.submit()
    this.amps?.destroy()
    this.probs?.destroy()
    this.partials?.destroy()
    this.amps = null
    this.probs = null
    this.partials = null
    this.bindGroups = {}
    this.n = 0
    this.dim = 0
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('WebGpuBackend has been disposed')
    if (this.lostReason) throw new Error(`the GPU device was lost (${this.lostReason})`)
  }

  private assertAllocated(): void {
    this.assertLive()
    if (!this.amps) throw new Error('call allocate(n) before applying gates')
  }
}

/** Pack a Matrix2x2 into the two vec4<f32> rows the gate kernel reads. */
export function matrixWords(m: Matrix2x2): Pick<ParamsRecord, 'm0' | 'm1'> {
  return {
    m0: [m[0].re, m[0].im, m[1].re, m[1].im],
    m1: [m[2].re, m[2].im, m[3].re, m[3].im],
  }
}
