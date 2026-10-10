/**
 * webgpu/index.ts — pick a backend, and fall back honestly.
 *
 *   const { backend, fallbackReason } = await createBackend({ prefer: 'webgpu' })
 *
 * Three things can stop the GPU path, and the caller should be able to say
 * which one it was: the API is absent (Firefox without the flag, an old
 * Safari, any server render), the API is present but no adapter is offered
 * (blocklisted GPU, headless Chrome), or the device/kernels fail to come up.
 * All three land in a CpuBackend with `fallbackReason` set to the message.
 *
 * selectBackend() is the pure decision — it takes a support report rather
 * than reading navigator — so the choice is testable in Node where there is no
 * GPU and never will be. createBackend() is the thin async wrapper around it.
 */

import { CpuBackend, type BackendKind, type StatevectorBackend } from '../backend'

export type BackendPreference = 'auto' | 'cpu' | 'webgpu'

export interface WebGpuSupport {
  /** navigator.gpu exists. Says nothing about whether an adapter will be offered. */
  available: boolean
  /** Human-readable reason when `available` is false. */
  reason: string
}

/** Feature detection only — never awaits, never asks for an adapter. */
export function detectWebGpu(
  nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): WebGpuSupport {
  if (!nav) return { available: false, reason: 'no navigator — not running in a browser' }
  if (!nav.gpu) {
    return {
      available: false,
      reason:
        'this browser exposes no WebGPU (navigator.gpu). Chrome 113+, Edge 113+ and Safari 17+ ship it; Firefox needs dom.webgpu.enabled in about:config',
    }
  }
  return { available: true, reason: '' }
}

/**
 * Which backend to TRY for a preference and a support report. 'webgpu' here
 * means "attempt the GPU" — the attempt itself can still fail and fall back.
 */
export function selectBackend(prefer: BackendPreference, support: WebGpuSupport): BackendKind {
  if (prefer === 'cpu') return 'cpu'
  return support.available ? 'webgpu' : 'cpu'
}

export interface BackendSelection {
  backend: StatevectorBackend
  /** What the caller asked for. */
  requested: BackendPreference
  /** Set when the GPU was wanted (or auto-selected) and a CpuBackend came back instead. */
  fallbackReason?: string
}

export interface CreateBackendOptions {
  prefer?: BackendPreference
  navigator?: Navigator
  /**
   * How to build the GPU backend. Defaults to WebGpuBackend.create, loaded
   * lazily so a CPU-only caller never pulls the shader strings in. Tests
   * inject a factory that throws to exercise the fallback.
   */
  webgpuFactory?: (nav: Navigator | undefined) => Promise<StatevectorBackend>
}

export async function createBackend(options: CreateBackendOptions = {}): Promise<BackendSelection> {
  const prefer = options.prefer ?? 'auto'
  const nav = options.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator)
  const support = detectWebGpu(nav)
  const choice = selectBackend(prefer, support)

  if (choice === 'cpu') {
    return {
      backend: new CpuBackend(),
      requested: prefer,
      fallbackReason: prefer === 'cpu' ? undefined : support.reason,
    }
  }

  const factory =
    options.webgpuFactory ??
    (async (n: Navigator | undefined) => {
      const { WebGpuBackend } = await import('./WebGpuBackend')
      return WebGpuBackend.create(n)
    })

  try {
    const backend = await factory(nav)
    return { backend, requested: prefer }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { backend: new CpuBackend(), requested: prefer, fallbackReason: message }
  }
}
