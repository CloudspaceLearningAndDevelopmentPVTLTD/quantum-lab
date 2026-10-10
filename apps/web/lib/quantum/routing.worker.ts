/**
 * routing.worker.ts — trains the learned router off the main thread.
 *
 * Protocol (all messages are plain structured-clone data):
 *   main → worker  { type: 'start', circuit, topology, numQubits, seed,
 *                    maxEpisodes, maxSeconds }
 *   main → worker  { type: 'stop' }
 *   worker → main  { type: 'progress', ... }   every CHUNK episodes
 *   worker → main  { type: 'done', ... }       with the final result
 *   worker → main  { type: 'error', message }
 *
 * The trainer runs one episode at a time, so the loop yields to the event
 * loop every CHUNK episodes (via setTimeout 0) to pick up a 'stop'. Either
 * budget — episodes or seconds — ends the run, and 'stop' ends it early with
 * whatever the policy has learned so far. The result of a stopped run is a
 * complete, valid routing: the trainer's result() is a greedy rollout, not a
 * half-finished episode.
 */

import type { Circuit } from '@/lib/quantum'
import { createRouterTrainer, type LearnedRouting, type RouterTrainer } from './routing'
import { buildTopology, type TopologyKind } from './topology'

export interface TrainerStartMessage {
  type: 'start'
  circuit: Circuit
  topology: TopologyKind
  numQubits: number
  seed: number
  maxEpisodes: number
  maxSeconds: number
}

export interface TrainerStopMessage {
  type: 'stop'
}

export type TrainerInbound = TrainerStartMessage | TrainerStopMessage

export interface TrainerProgressMessage {
  type: 'progress'
  episode: number
  maxEpisodes: number
  secondsUsed: number
  maxSeconds: number
  /** Every episode's reward so far (−1 = heuristic parity). */
  rewards: number[]
  bestSampledSwaps: number
  heuristicSwaps: number
}

export interface TrainerDoneMessage {
  type: 'done'
  result: LearnedRouting
  secondsUsed: number
  stoppedBy: 'episodes' | 'seconds' | 'user'
}

export interface TrainerErrorMessage {
  type: 'error'
  message: string
}

export type TrainerOutbound = TrainerProgressMessage | TrainerDoneMessage | TrainerErrorMessage

const CHUNK = 10

const post = (message: TrainerOutbound): void => {
  ;(self as unknown as { postMessage(m: TrainerOutbound): void }).postMessage(message)
}

let trainer: RouterTrainer | null = null
let stopRequested = false
let timer: ReturnType<typeof setTimeout> | null = null

function finish(stoppedBy: TrainerDoneMessage['stoppedBy'], startedAt: number): void {
  if (!trainer) return
  const result = trainer.result()
  post({ type: 'done', result, secondsUsed: (Date.now() - startedAt) / 1000, stoppedBy })
  trainer = null
}

function run(msg: TrainerStartMessage): void {
  stopRequested = false
  const map = buildTopology(msg.topology, msg.numQubits)
  trainer = createRouterTrainer(msg.circuit, map, { seed: msg.seed })
  const startedAt = Date.now()
  const rewards: number[] = []
  const heuristicSwaps = trainer.heuristic.swapsAdded

  const tick = (): void => {
    timer = null
    if (!trainer) return
    if (stopRequested) { finish('user', startedAt); return }
    let bestSampledSwaps = Infinity
    for (let i = 0; i < CHUNK && trainer.episodes < msg.maxEpisodes; i++) {
      const p = trainer.episode()
      rewards.push(p.reward)
      bestSampledSwaps = p.bestSampledSwaps
    }
    const secondsUsed = (Date.now() - startedAt) / 1000
    post({
      type: 'progress',
      episode: trainer.episodes,
      maxEpisodes: msg.maxEpisodes,
      secondsUsed,
      maxSeconds: msg.maxSeconds,
      rewards: rewards.slice(),
      bestSampledSwaps: Number.isFinite(bestSampledSwaps) ? bestSampledSwaps : heuristicSwaps,
      heuristicSwaps,
    })
    if (trainer.episodes >= msg.maxEpisodes) { finish('episodes', startedAt); return }
    if (secondsUsed >= msg.maxSeconds) { finish('seconds', startedAt); return }
    timer = setTimeout(tick, 0)
  }
  tick()
}

self.onmessage = (event: MessageEvent<TrainerInbound>) => {
  const msg = event.data
  try {
    if (msg.type === 'start') {
      if (timer !== null) { clearTimeout(timer); timer = null }
      run(msg)
    } else if (msg.type === 'stop') {
      stopRequested = true
    }
  } catch (cause) {
    trainer = null
    post({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) })
  }
}
