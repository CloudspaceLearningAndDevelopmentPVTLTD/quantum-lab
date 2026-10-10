/**
 * webllm.ts — the tutor running ON the learner's own device.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every other tutor tier costs money per question and needs a key someone has
 * to hold: Gemini, Groq, Anthropic and Azure are all a server call. That has
 * three consequences this platform feels acutely.
 *
 *   1. The home page promises "no install, no API key, no maths degree" and
 *      "0 dependencies to run", and then the single most expensive feature
 *      quietly needs a key and a budget.
 *   2. An anonymous visitor is the one most likely to ask the first question
 *      and the one we most want to answer, and they are the ones metered
 *      (messagesPerDay) precisely because each answer is billed.
 *   3. Classrooms — the /educators audience — frequently cannot send student
 *      text to a third-party API at all. For them a hosted tutor is not a
 *      budget problem, it is a policy blocker.
 *
 * WebGPU removes all three at once: the weights are downloaded once, cached by
 * the browser, and every answer after that is free, private (no question ever
 * leaves the device) and works with the network off — which this app already
 * supports everywhere else, since it ships a service worker and an offline
 * answer set.
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * It is not a replacement for the hosted tiers. A 360 MB model is not Claude:
 * it is worse at multi-step reasoning and it cannot call the circuit tools the
 * agent tier uses. It is an ADDITIONAL tier the learner opts into, and the UI
 * says plainly what it is.
 *
 * COST DISCIPLINE
 * ---------------
 * `@mlc-ai/web-llm` is roughly a megabyte of JavaScript before it fetches a
 * single weight. Nothing here imports it at module scope: every entry point
 * below uses a dynamic `import()`, so a visitor who never turns this on pays
 * ZERO bytes for it and it never enters the tutor route's First Load JS. Keep
 * it that way — a static `import ... from '@mlc-ai/web-llm'` at the top of
 * this file would silently put a megabyte on the critical path of the page
 * whose LCP matters most after the home route.
 */

/** What a curated model costs and what it is for. */
export interface DeviceModel {
  /** MLC model id, passed verbatim to CreateMLCEngine. */
  id: string
  /** What the learner sees. */
  label: string
  /**
   * Approximate download, in megabytes, taken from prebuiltAppConfig's
   * vram_required_MB. Shown BEFORE the download starts: a learner on a phone
   * plan must be able to decline a 2 GB transfer they did not expect.
   */
  sizeMb: number
  /** One line on the trade-off this size makes. */
  blurb: string
}

/**
 * THREE options, not 163.
 *
 * `prebuiltAppConfig.model_list` ships 163 models. Showing them all would be a
 * research tool, not a feature: a learner has no way to tell
 * `Qwen2.5-1.5B-Instruct-q4f32_1-MLC` from the `-q4f16_1-` build, and the only
 * difference that actually matters to them is "how big is the download and how
 * good is the answer". So the choice is reduced to one axis, smallest first,
 * with the middle option as the default because it is the smallest one that
 * answers a physics question in full sentences.
 *
 * All three are q4f16_1 (4-bit weights, fp16 activations), the quantisation
 * WebLLM's own documentation treats as the browser default. Sizes are the
 * figures reported by prebuiltAppConfig at @mlc-ai/web-llm 0.2.84; re-read
 * them from that list rather than editing by hand if a model is swapped.
 */
export const DEVICE_MODELS: readonly DeviceModel[] = [
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    label: 'Small',
    sizeMb: 376,
    blurb: 'Fastest to download and runs on almost anything. Best for short definitions.',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Balanced',
    sizeMb: 879,
    blurb: 'The default. Explains a concept in a paragraph and follows a short conversation.',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Best quality',
    sizeMb: 2264,
    blurb: 'Noticeably better reasoning. Wants a desktop GPU and patience on the first load.',
  },
] as const

export const DEFAULT_DEVICE_MODEL = DEVICE_MODELS[1].id

/** localStorage key holding the id the learner last used, so it reloads silently. */
export const DEVICE_MODEL_KEY = 'quantum-lab.tutor.deviceModel'

/**
 * Why the device tutor is unavailable, in words a learner can act on.
 * `null` means it IS available.
 */
export type DeviceBlocker =
  | { reason: 'no-webgpu'; detail: string }
  | { reason: 'disabled'; detail: string }

/**
 * Is WebGPU actually usable here?
 *
 * `'gpu' in navigator` is necessary and NOT sufficient: browsers expose the
 * object on platforms where `requestAdapter()` then resolves to null — no
 * compatible adapter, a blocklisted driver, a virtual machine with no GPU.
 * Testing only for the property is how you ship a button that downloads
 * 879 MB and then fails at the last step, so this asks for an adapter and
 * awaits the answer.
 */
export async function deviceTutorBlocker(enabled: boolean): Promise<DeviceBlocker | null> {
  if (!enabled) {
    return {
      reason: 'disabled',
      detail: 'The on-device tutor is switched off for this deployment.',
    }
  }
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) {
    return {
      reason: 'no-webgpu',
      detail:
        'This browser has no WebGPU. Chrome, Edge and Safari 17+ on a recent machine support it; Firefox needs it switched on in about:config.',
    }
  }
  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) {
      return {
        reason: 'no-webgpu',
        detail:
          'WebGPU is present but no compatible graphics adapter was offered — common in virtual machines and on older drivers.',
      }
    }
  } catch {
    return { reason: 'no-webgpu', detail: 'WebGPU could not start on this device.' }
  }
  return null
}

/** Progress while weights download and compile. `ratio` is 0..1 when known. */
export interface DeviceLoadProgress {
  ratio: number
  text: string
}

/** The subset of the MLC engine this app uses. Keeps the dynamic import typed. */
export interface DeviceEngine {
  chat: {
    completions: {
      create(req: {
        messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
        stream: true
        temperature?: number
        max_tokens?: number
      }): Promise<AsyncIterable<{ choices: { delta: { content?: string } }[] }>>
    }
  }
  interruptGenerate?: () => void
  unload?: () => Promise<void>
}

/**
 * THE LIVE ENGINE, held at module scope rather than in a component.
 *
 * A learner who waits out an 879 MB download has bought a resource, and it
 * must not evaporate because they clicked a link. React state cannot hold it:
 * the tutor panel unmounts on every navigation, so a component-scoped engine
 * is unloaded from VRAM the moment they visit a lesson, and coming back pays a
 * fresh 10-30s WebGPU recompile even though the weights are still cached.
 * Worse, two mounts could race and build two engines, i.e. two copies of the
 * weights resident on a GPU that has room for about one.
 *
 * Module scope is exactly one engine per tab, surviving navigation, which is
 * what "running on this device" should mean. `inFlight` deduplicates
 * concurrent callers so a second request during a load awaits the first rather
 * than starting a second download.
 */
let liveEngine: DeviceEngine | null = null
let liveModelId: string | null = null
let inFlight: Promise<DeviceEngine> | null = null

/** The engine if one is loaded, else null. Never triggers a download. */
export function currentDeviceEngine(): { engine: DeviceEngine; modelId: string } | null {
  return liveEngine && liveModelId ? { engine: liveEngine, modelId: liveModelId } : null
}

/** Release the GPU memory and forget the engine. The weights stay cached. */
export async function releaseDeviceEngine(): Promise<void> {
  const engine = liveEngine
  liveEngine = null
  liveModelId = null
  inFlight = null
  await engine?.unload?.()
}

/**
 * Download (or reuse from cache) the weights and return a ready engine.
 *
 * The browser's Cache Storage holds the weights between visits, so this is
 * slow exactly once per model per device. `onProgress` is called continuously
 * during that first load; the UI needs it, because a silent 879 MB download is
 * indistinguishable from a hang.
 */
export async function createDeviceEngine(
  modelId: string,
  onProgress: (p: DeviceLoadProgress) => void,
): Promise<DeviceEngine> {
  // Already loaded, same model: hand back the running one. This is the case
  // that makes navigating away and back free.
  if (liveEngine && liveModelId === modelId) return liveEngine
  // A load of the SAME model is already running: join it instead of starting a
  // second download of the same weights.
  if (inFlight && liveModelId === modelId) return inFlight
  // A different size was asked for: free the old weights before allocating new
  // ones, or the GPU holds both and a 3B model will fail to allocate at all.
  if (liveEngine) await releaseDeviceEngine()

  liveModelId = modelId
  inFlight = (async () => {
    // Dynamic: see the header. This is the only place the package is pulled in.
    const webllm = await import('@mlc-ai/web-llm')
    const engine = (await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report: { progress: number; text: string }) => {
        onProgress({
          // WebLLM reports 0 during compile steps with no measurable total;
          // clamping stops a progress bar jumping backwards to zero.
          ratio: Number.isFinite(report.progress) ? Math.max(0, Math.min(1, report.progress)) : 0,
          text: report.text,
        })
      },
    })) as unknown as DeviceEngine
    liveEngine = engine
    return engine
  })()

  try {
    return await inFlight
  } catch (err) {
    // Leave no half-initialised state behind for the next attempt to trip on.
    liveEngine = null
    liveModelId = null
    throw err
  } finally {
    inFlight = null
  }
}

/**
 * The system prompt for the on-device tier.
 *
 * Deliberately shorter than the hosted tiers'. A 360M model handed a long,
 * clause-heavy instruction block spends its small attention budget on the
 * instructions instead of the question, and then ignores most of them anyway.
 * Short, concrete, and it states the rule that matters most here: a small
 * model must be readier than a large one to admit it does not know.
 */
export const DEVICE_SYSTEM_PROMPT =
  'You are a quantum mechanics tutor for a beginner. Answer in 2-4 short sentences, ' +
  'in plain language, and prefer a concrete example over a formula. ' +
  'If you are not sure, say so plainly rather than guessing.'

/**
 * Stream an answer, calling `onToken` with the text so far.
 *
 * Streaming is not a flourish here. A 1B model on an integrated GPU produces
 * maybe 10-20 tokens a second, so a four-sentence answer takes several seconds
 * and waiting for all of it in silence reads as broken. Tokens as they arrive
 * make the same latency read as thinking.
 */
export async function streamDeviceReply(
  engine: DeviceEngine,
  history: { role: 'user' | 'assistant'; content: string }[],
  onToken: (full: string) => void,
): Promise<string> {
  const chunks = await engine.chat.completions.create({
    messages: [{ role: 'system', content: DEVICE_SYSTEM_PROMPT }, ...history],
    stream: true,
    temperature: 0.7,
    // A small model allowed to ramble will: it has no strong sense of when an
    // answer is finished. This is the stop the prompt alone cannot enforce.
    max_tokens: 512,
  })
  let full = ''
  for await (const chunk of chunks) {
    full += chunk.choices[0]?.delta?.content ?? ''
    onToken(full)
  }
  return full
}

/** Human-readable download size. 879 becomes "879 MB", 2264 becomes "2.2 GB". */
export function formatSize(sizeMb: number): string {
  return sizeMb >= 1024 ? `${(sizeMb / 1024).toFixed(1)} GB` : `${Math.round(sizeMb)} MB`
}
