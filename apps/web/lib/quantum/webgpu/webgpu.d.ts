/**
 * webgpu.d.ts — the slice of the WebGPU API this backend touches.
 *
 * TypeScript 5.6's lib.dom has no WebGPU declarations and @webgpu/types is not
 * a dependency (adding one means an install, which this repo's parallel
 * agents cannot coordinate). These are hand-written from the W3C spec and
 * deliberately minimal: only the members WebGpuBackend.ts calls, with the
 * enums narrowed to the values it passes. If the real package is ever added,
 * delete this file — the names are the spec's, so nothing else changes.
 */

interface Navigator {
  readonly gpu?: GPU
}

interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>
}

interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance'
}

interface GPUSupportedLimits {
  readonly maxBufferSize: number
  readonly maxStorageBufferBindingSize: number
  readonly maxComputeWorkgroupsPerDimension: number
  readonly maxComputeWorkgroupSizeX: number
  readonly maxComputeInvocationsPerWorkgroup: number
  readonly minUniformBufferOffsetAlignment: number
}

interface GPUAdapterInfo {
  readonly vendor: string
  readonly architecture: string
  readonly device: string
  readonly description: string
}

interface GPUAdapter {
  readonly limits: GPUSupportedLimits
  readonly info?: GPUAdapterInfo
  readonly isFallbackAdapter?: boolean
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>
  requestAdapterInfo?(): Promise<GPUAdapterInfo>
}

interface GPUDeviceDescriptor {
  label?: string
  requiredLimits?: Record<string, number>
}

interface GPUDeviceLostInfo {
  readonly reason: 'unknown' | 'destroyed'
  readonly message: string
}

interface GPUError {
  readonly message: string
}

type GPUErrorFilter = 'validation' | 'out-of-memory' | 'internal'

interface GPUDevice {
  readonly queue: GPUQueue
  readonly limits: GPUSupportedLimits
  readonly lost: Promise<GPUDeviceLostInfo>
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer
  createShaderModule(descriptor: { code: string; label?: string }): GPUShaderModule
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout
  createPipelineLayout(descriptor: { bindGroupLayouts: GPUBindGroupLayout[]; label?: string }): GPUPipelineLayout
  createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline
  createComputePipelineAsync(descriptor: GPUComputePipelineDescriptor): Promise<GPUComputePipeline>
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup
  createCommandEncoder(descriptor?: { label?: string }): GPUCommandEncoder
  pushErrorScope(filter: GPUErrorFilter): void
  popErrorScope(): Promise<GPUError | null>
  destroy(): void
}

interface GPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void
  writeBuffer(
    buffer: GPUBuffer,
    bufferOffset: number,
    data: ArrayBufferView | ArrayBuffer,
    dataOffset?: number,
    size?: number,
  ): void
  onSubmittedWorkDone(): Promise<void>
}

interface GPUBufferDescriptor {
  label?: string
  size: number
  usage: number
  mappedAtCreation?: boolean
}

interface GPUBuffer {
  readonly size: number
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>
  getMappedRange(offset?: number, size?: number): ArrayBuffer
  unmap(): void
  destroy(): void
}

declare const GPUBufferUsage: {
  readonly MAP_READ: number
  readonly MAP_WRITE: number
  readonly COPY_SRC: number
  readonly COPY_DST: number
  readonly STORAGE: number
  readonly UNIFORM: number
}

declare const GPUMapMode: {
  readonly READ: number
  readonly WRITE: number
}

declare const GPUShaderStage: {
  readonly COMPUTE: number
}

interface GPUShaderModule {
  getCompilationInfo?(): Promise<{ messages: ReadonlyArray<{ type: string; message: string; lineNum: number }> }>
}

interface GPUBindGroupLayoutEntry {
  binding: number
  visibility: number
  buffer: { type: 'uniform' | 'storage' | 'read-only-storage'; hasDynamicOffset?: boolean; minBindingSize?: number }
}

interface GPUBindGroupLayoutDescriptor {
  label?: string
  entries: GPUBindGroupLayoutEntry[]
}

interface GPUBindGroupLayout { readonly __brand?: 'GPUBindGroupLayout' }
interface GPUPipelineLayout { readonly __brand?: 'GPUPipelineLayout' }

interface GPUComputePipelineDescriptor {
  label?: string
  layout: GPUPipelineLayout | 'auto'
  compute: { module: GPUShaderModule; entryPoint?: string }
}

interface GPUComputePipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout
}

interface GPUBindGroupEntry {
  binding: number
  resource: { buffer: GPUBuffer; offset?: number; size?: number }
}

interface GPUBindGroupDescriptor {
  label?: string
  layout: GPUBindGroupLayout
  entries: GPUBindGroupEntry[]
}

interface GPUBindGroup { readonly __brand?: 'GPUBindGroup' }

interface GPUCommandBuffer { readonly __brand?: 'GPUCommandBuffer' }

interface GPUCommandEncoder {
  beginComputePass(descriptor?: { label?: string }): GPUComputePassEncoder
  copyBufferToBuffer(
    source: GPUBuffer,
    sourceOffset: number,
    destination: GPUBuffer,
    destinationOffset: number,
    size: number,
  ): void
  finish(): GPUCommandBuffer
}

interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void
  setBindGroup(index: number, bindGroup: GPUBindGroup, dynamicOffsets?: number[]): void
  dispatchWorkgroups(x: number, y?: number, z?: number): void
  end(): void
}
