/**
 * lib/qec/worker.ts — the Decoder Lab's Web Worker.
 *
 * Everything that takes longer than a frame happens here: training the learned
 * decoders, sweeping p for the threshold chart, and decoding the single shots
 * the page's inspector asks for. The main thread only ever draws.
 *
 * The worker yields with setTimeout(0) between chunks (session.ts calls
 * `yieldNow`), which is what lets a 'stop' message arrive mid-training. Without
 * that the stop button would be decorative.
 */

import { mulberry32 } from '@/lib/quantum'
import { failed, sampleShot, type DecoderName, type Prediction } from './model'
import { MwpmDecoder } from './matching'
import {
  defaultSweep,
  runSweep,
  trainDecoders,
  type LabConfig,
  type SweepPoint,
  type TrainBudget,
  type TrainProgress,
  type TrainedDecoders,
} from './session'
import { DEFAULT_MLP } from './mlp'
import { DEFAULT_TRANSFORMER } from './transformer'

export type WorkerRequest =
  | {
      type: 'run'
      config: LabConfig
      decoders: DecoderName[]
      budget: TrainBudget
      seed: number
      sweep: { shots: number; ps?: number[] }
    }
  | { type: 'sweep'; shots: number; seed: number; ps?: number[] }
  | { type: 'shot'; seed: number }
  | { type: 'stop' }

export type TrainedSummary = {
  config: LabConfig
  samples: TrainedDecoders['samples']
  elapsedMs: TrainedDecoders['elapsedMs']
  stoppedBy: TrainedDecoders['stoppedBy']
  paramCounts: TrainedDecoders['paramCounts']
  lookupKeys?: number
}

export type ShotReport = {
  d: number
  layers: number
  errX: Uint8Array
  errZ: Uint8Array
  /** Final-layer-equivalent syndrome per channel (XOR over layers). */
  syndromeX: Uint8Array
  syndromeZ: Uint8Array
  detectorCount: number
  truth: Prediction
  predictions: Partial<Record<DecoderName, Prediction>>
  correct: Partial<Record<DecoderName, boolean>>
}

export type WorkerResponse =
  | { type: 'phase'; phase: 'training' | 'sweeping' | 'idle' }
  | { type: 'train-progress'; progress: TrainProgress }
  | { type: 'trained'; summary: TrainedSummary }
  | { type: 'sweep-point'; point: SweepPoint; index: number; total: number }
  | { type: 'sweep-done'; stopped: boolean }
  | { type: 'shot-result'; report: ShotReport }
  | { type: 'error'; message: string }

const post = (msg: WorkerResponse): void => {
  ;(self as unknown as { postMessage(m: unknown): void }).postMessage(msg)
}

let stopRequested = false
let trained: TrainedDecoders | null = null
let busy = false

const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function summarise(t: TrainedDecoders): TrainedSummary {
  return {
    config: t.config,
    samples: t.samples,
    elapsedMs: t.elapsedMs,
    stoppedBy: t.stoppedBy,
    paramCounts: t.paramCounts,
    lookupKeys: t.lookup?.keys,
  }
}

async function sweep(shots: number, seed: number, ps?: number[]): Promise<void> {
  if (!trained) return
  post({ type: 'phase', phase: 'sweeping' })
  const grid = ps ?? defaultSweep(trained.config.q)
  await runSweep(
    trained,
    { ps: grid, shots, seed },
    {
      onPoint: (point, index, total) => post({ type: 'sweep-point', point, index, total }),
      shouldStop: () => stopRequested,
      yieldNow,
    }
  )
  post({ type: 'sweep-done', stopped: stopRequested })
}

function inspect(seed: number): void {
  if (!trained) return
  const { layout, config } = trained
  const rand = mulberry32(seed >>> 0)
  const shot = sampleShot(layout, config.p, config.q, rand)
  const mwpm = new MwpmDecoder(layout, config.p, config.q)
  const predictions: ShotReport['predictions'] = { mwpm: mwpm.predict(shot.detX, shot.detZ) }
  if (trained.lookup) predictions.lookup = trained.lookup.predict(shot.detX, shot.detZ)
  if (trained.mlp) predictions.mlp = trained.mlp.predict(shot.detX, shot.detZ)
  if (trained.transformer) predictions.transformer = trained.transformer.predict(shot.detX, shot.detZ)
  const correct: ShotReport['correct'] = {}
  for (const [name, pred] of Object.entries(predictions)) {
    correct[name as DecoderName] = !failed(pred, shot)
  }
  const nX = layout.stabsX.length
  const nZ = layout.stabsZ.length
  const syndromeX = new Uint8Array(nX)
  const syndromeZ = new Uint8Array(nZ)
  let detectorCount = 0
  for (let t = 0; t < layout.layers; t++) {
    for (let s = 0; s < nX; s++) {
      syndromeX[s] ^= shot.detX[t * nX + s]
      detectorCount += shot.detX[t * nX + s]
    }
    for (let s = 0; s < nZ; s++) {
      syndromeZ[s] ^= shot.detZ[t * nZ + s]
      detectorCount += shot.detZ[t * nZ + s]
    }
  }
  post({
    type: 'shot-result',
    report: {
      d: config.d,
      layers: layout.layers,
      errX: shot.errX,
      errZ: shot.errZ,
      syndromeX,
      syndromeZ,
      detectorCount,
      truth: { flipX: shot.flipX, flipZ: shot.flipZ },
      predictions,
      correct,
    },
  })
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  try {
    if (msg.type === 'stop') {
      stopRequested = true
      return
    }
    if (msg.type === 'shot') {
      inspect(msg.seed)
      return
    }
    if (busy) return
    busy = true
    stopRequested = false
    if (msg.type === 'run') {
      post({ type: 'phase', phase: 'training' })
      trained = await trainDecoders(
        msg.config,
        msg.decoders,
        msg.budget,
        msg.seed,
        {
          onProgress: (progress) => post({ type: 'train-progress', progress }),
          shouldStop: () => stopRequested,
          yieldNow,
          now: () => performance.now(),
        },
        { mlp: DEFAULT_MLP, transformer: DEFAULT_TRANSFORMER }
      )
      post({ type: 'trained', summary: summarise(trained) })
      if (!stopRequested) await sweep(msg.sweep.shots, msg.seed ^ 0x5bd1e995, msg.sweep.ps)
      else post({ type: 'sweep-done', stopped: true })
    } else if (msg.type === 'sweep') {
      await sweep(msg.shots, msg.seed, msg.ps)
    }
    post({ type: 'phase', phase: 'idle' })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    post({ type: 'phase', phase: 'idle' })
  } finally {
    busy = false
  }
}
