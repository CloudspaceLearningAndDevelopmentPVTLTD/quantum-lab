/**
 * lib/qec/session.ts — the two long-running jobs the Decoder Lab worker performs:
 * training the learned decoders under a visible budget, and sweeping the physical
 * error rate to draw the threshold chart.
 *
 * Both are written against a `Hooks` object rather than the worker API so that
 * session.test.ts can run them synchronously in node with a no-op yield and a
 * scripted clock. The worker (worker.ts) supplies real `postMessage`, a
 * `setTimeout(0)` yield that lets a stop message through, and `performance.now`.
 */

import { mulberry32 } from '@/lib/quantum'
import {
  buildLayout,
  channelRate,
  failed,
  sampleShot,
  type DecoderName,
  type Distance,
  type Layout,
  type Shot,
} from './model'
import { LookupDecoder } from './lookup'
import { MlpDecoder, DEFAULT_MLP, type MlpConfig } from './mlp'
import { TransformerDecoder, DEFAULT_TRANSFORMER, type TransformerConfig } from './transformer'
import { MwpmDecoder } from './matching'
import { paramCount } from '@/lib/numerics/nn'

export type LabConfig = { d: Distance; p: number; q: number }

export type TrainBudget = {
  /** Stop after this many labelled samples per decoder. */
  samples: number
  /** Or after this many wall-clock seconds per decoder, whichever first. */
  seconds: number
  /** Minibatch size for the gradient decoders. */
  batch: number
}

export type TrainProgress = {
  decoder: DecoderName
  samples: number
  /** Running mean loss over the last progress window; NaN for the lookup table. */
  loss: number
  elapsedMs: number
  done: boolean
  /** Why training stopped, once it has. */
  stoppedBy?: StopReason
}

export type StopReason = 'samples' | 'seconds' | 'user'

export type Hooks = {
  onProgress(p: TrainProgress): void
  shouldStop(): boolean
  /** Let the host process a message (the stop button). */
  yieldNow(): Promise<void>
  now(): number
}

export type TrainedDecoders = {
  config: LabConfig
  layout: Layout
  lookup?: LookupDecoder
  mlp?: MlpDecoder
  transformer?: TransformerDecoder
  /** Samples each decoder actually saw. */
  samples: Partial<Record<DecoderName, number>>
  elapsedMs: Partial<Record<DecoderName, number>>
  stoppedBy: Partial<Record<DecoderName, TrainProgress['stoppedBy']>>
  paramCounts: Partial<Record<DecoderName, number>>
}

export type TrainOptions = {
  mlp?: MlpConfig
  transformer?: TransformerConfig
}

const PROGRESS_EVERY_MS = 150

/**
 * Train the requested decoders, one after another, each under the same budget.
 * Every sample is freshly drawn from the configured noise at the moment it is
 * used: there is no dataset, no epoch, and nothing is pre-baked.
 */
export async function trainDecoders(
  config: LabConfig,
  which: DecoderName[],
  budget: TrainBudget,
  seed: number,
  hooks: Hooks,
  opts: TrainOptions = {}
): Promise<TrainedDecoders> {
  const layout = buildLayout(config.d, config.q)
  const out: TrainedDecoders = {
    config,
    layout,
    samples: {},
    elapsedMs: {},
    stoppedBy: {},
    paramCounts: {},
  }
  const order: DecoderName[] = ['lookup', 'mlp', 'transformer']
  for (const name of order) {
    if (!which.includes(name)) continue
    if (name === 'lookup' && config.d !== 3) continue
    const rand = mulberry32((seed ^ (name.length * 0x9e3779b9)) >>> 0)
    const t0 = hooks.now()
    let samples = 0
    let lastEmit = t0
    let windowLoss = 0
    let windowCount = 0
    // Assigned inside `budgetLeft`, which TypeScript's narrowing cannot see
    // through — hence the annotation on a value that is otherwise a literal.
    let stoppedBy = 'samples' as StopReason

    const emit = (done: boolean): void => {
      hooks.onProgress({
        decoder: name,
        samples,
        loss: windowCount > 0 ? windowLoss / windowCount : NaN,
        elapsedMs: hooks.now() - t0,
        done,
        stoppedBy: done ? stoppedBy : undefined,
      })
      if (!done) {
        windowLoss = 0
        windowCount = 0
      }
    }

    const budgetLeft = (): boolean => {
      if (hooks.shouldStop()) {
        stoppedBy = 'user'
        return false
      }
      if (samples >= budget.samples) {
        stoppedBy = 'samples'
        return false
      }
      if (hooks.now() - t0 >= budget.seconds * 1000) {
        stoppedBy = 'seconds'
        return false
      }
      return true
    }

    if (name === 'lookup') {
      const table = new LookupDecoder()
      out.lookup = table
      while (budgetLeft()) {
        const chunk = Math.min(2000, budget.samples - samples)
        for (let i = 0; i < chunk; i++) table.observe(sampleShot(layout, config.p, config.q, rand))
        samples += chunk
        if (hooks.now() - lastEmit > PROGRESS_EVERY_MS) {
          lastEmit = hooks.now()
          emit(false)
          await hooks.yieldNow()
        }
      }
      out.paramCounts.lookup = table.keys
    } else {
      const net =
        name === 'mlp'
          ? new MlpDecoder(layout, opts.mlp ?? DEFAULT_MLP, rand)
          : new TransformerDecoder(layout, opts.transformer ?? DEFAULT_TRANSFORMER, rand)
      if (name === 'mlp') out.mlp = net as MlpDecoder
      else out.transformer = net as TransformerDecoder
      out.paramCounts[name] = paramCount(net.params)
      const batch: Shot[] = []
      while (budgetLeft()) {
        batch.length = 0
        const size = Math.min(budget.batch, budget.samples - samples)
        for (let i = 0; i < size; i++) batch.push(sampleShot(layout, config.p, config.q, rand))
        const loss = net.trainBatch(batch)
        samples += size
        windowLoss += loss
        windowCount++
        if (hooks.now() - lastEmit > PROGRESS_EVERY_MS) {
          lastEmit = hooks.now()
          emit(false)
          await hooks.yieldNow()
        }
      }
    }
    out.samples[name] = samples
    out.elapsedMs[name] = hooks.now() - t0
    out.stoppedBy[name] = stoppedBy
    emit(true)
    if (stoppedBy === 'user') break
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// The sweep
// ─────────────────────────────────────────────────────────────────────────────

/** Curve keys on the chart: MWPM at every distance, learned decoders at the trained one. */
export type CurveKey = 'mwpm-3' | 'mwpm-5' | 'mwpm-7' | 'lookup' | 'mlp' | 'transformer'

export type CurveSample = { failures: number; shots: number }

export type SweepPoint = {
  p: number
  curves: Partial<Record<CurveKey, CurveSample>>
  /** Fraction of MWPM shots at the trained distance decoded by the inexact fallback. */
  inexactFraction: number
}

export type SweepHooks = {
  onPoint(point: SweepPoint, index: number, total: number): void
  shouldStop(): boolean
  yieldNow(): Promise<void>
}

export type SweepOptions = {
  ps: number[]
  shots: number
  seed: number
  /** Distances to draw the MWPM reference curves at. */
  distances?: Distance[]
}

/** Logical error rate as a fraction, with the Wilson 95% interval for the chart's bands. */
export function rateWithInterval(s: CurveSample): { rate: number; lo: number; hi: number } {
  if (s.shots === 0) return { rate: 0, lo: 0, hi: 0 }
  const z = 1.96
  const n = s.shots
  const ph = s.failures / n
  const denom = 1 + (z * z) / n
  const centre = (ph + (z * z) / (2 * n)) / denom
  const half = (z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n))) / denom
  return { rate: ph, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) }
}

/**
 * Sweep p at the configured q. MWPM is rebuilt at every p (its edge weights are
 * the log-likelihoods of that p); the learned decoders are frozen at whatever
 * they learned at the training p — deliberately, because that is how a trained
 * decoder is deployed, and the copy on the page says so.
 */
export async function runSweep(
  trained: TrainedDecoders,
  options: SweepOptions,
  hooks: SweepHooks
): Promise<SweepPoint[]> {
  const distances = options.distances ?? [3, 5, 7]
  const q = trained.config.q
  const points: SweepPoint[] = []
  const layouts = new Map<Distance, Layout>()
  for (const d of distances) layouts.set(d, buildLayout(d, q))
  if (!layouts.has(trained.config.d)) layouts.set(trained.config.d, trained.layout)

  for (let idx = 0; idx < options.ps.length; idx++) {
    const p = options.ps[idx]
    const point: SweepPoint = { p, curves: {}, inexactFraction: 0 }
    for (const [d, layout] of layouts) {
      if (hooks.shouldStop()) return points
      const rand = mulberry32((options.seed ^ (d * 7919) ^ Math.round(p * 1e6)) >>> 0)
      const mwpm = new MwpmDecoder(layout, p, q)
      const key = `mwpm-${d}` as CurveKey
      const atTrained = d === trained.config.d
      const learned: { key: CurveKey; predict: (x: Uint8Array, z: Uint8Array) => { flipX: 0 | 1; flipZ: 0 | 1 } }[] = []
      if (atTrained) {
        if (trained.lookup) learned.push({ key: 'lookup', predict: (x, z) => trained.lookup!.predict(x, z) })
        if (trained.mlp) learned.push({ key: 'mlp', predict: (x, z) => trained.mlp!.predict(x, z) })
        if (trained.transformer)
          learned.push({ key: 'transformer', predict: (x, z) => trained.transformer!.predict(x, z) })
      }
      const tally: Record<string, CurveSample> = { [key]: { failures: 0, shots: 0 } }
      for (const l of learned) tally[l.key] = { failures: 0, shots: 0 }

      const CHUNK = 250
      for (let done = 0; done < options.shots; done += CHUNK) {
        const n = Math.min(CHUNK, options.shots - done)
        for (let i = 0; i < n; i++) {
          const shot = sampleShot(layout, p, q, rand)
          const pm = mwpm.predict(shot.detX, shot.detZ)
          tally[key].shots++
          if (failed(pm, shot)) tally[key].failures++
          for (const l of learned) {
            const pr = l.predict(shot.detX, shot.detZ)
            tally[l.key].shots++
            if (failed(pr, shot)) tally[l.key].failures++
          }
        }
        if (hooks.shouldStop()) break
        await hooks.yieldNow()
      }
      for (const k of Object.keys(tally)) point.curves[k as CurveKey] = tally[k]
      if (atTrained) point.inexactFraction = mwpm.shots > 0 ? mwpm.inexactShots / mwpm.shots : 0
    }
    points.push(point)
    hooks.onPoint(point, idx, options.ps.length)
  }
  return points
}

/** The default p grid: dense enough to show the crossing, sparse enough to run in seconds. */
export function defaultSweep(q: number): number[] {
  // With measurement noise the threshold sits near 3%; without it, near 15% for
  // depolarising p (10.3% per channel). Sweep where the curves actually cross.
  return q > 0
    ? [0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.07]
    : [0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.13, 0.16, 0.2, 0.25]
}

/** Textbook per-channel threshold, mapped to depolarising p for the chart's guide line. */
export function thresholdGuide(q: number): number {
  const perChannel = q > 0 ? 0.029 : 0.103
  // channelRate(p) = 2p/3, so p = 1.5 × per-channel rate. The phenomenological
  // figure assumes q equal to the per-channel rate; with q a free slider it is a
  // guide, not a prediction, and the page labels it that way.
  return perChannel / channelRate(1)
}
