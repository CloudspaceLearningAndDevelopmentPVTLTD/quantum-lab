/**
 * POST /api/hardware/recommend — server-side proxy for the same path on
 * `services/api`: rank every device we reach for one circuit.
 *
 * The backend (`services/api/app/quantum/recommend.py`) existed for weeks with
 * no caller. This route is what lets `/workbench/device-advisor` reach it.
 *
 * ── Gate chain: IP rate limit only. Deliberately. ───────────────────────────
 *
 * Same reasoning as `transpile`: it spends nothing at a vendor, returns no user
 * data, and is the thing a visitor uses to decide where to spend BEFORE
 * committing money. The exposure is upstream CPU — one transpile per candidate
 * device, so heavier than a single `transpile` call — bounded by READ_LIMIT per
 * IP and by the same QASM size cap every circuit route applies.
 *
 * No credential is forwarded: the ranking uses the operator's device listing
 * (live where the operator has credentials, the shipped static tables where it
 * does not) and every row says which.
 */

import {
  forward,
  badRequest,
  limitOrNull,
  readJsonObject,
  MAX_BACKEND_CHARS,
  MAX_QASM_CHARS,
  MAX_SHOTS,
  READ_LIMIT,
} from '@/lib/hardware/proxy'
import { arr, int, oneOf, str } from '@/lib/security/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Mirrors `OBJECTIVES` in services/api/app/quantum/recommend.py. */
const RECOMMEND_OBJECTIVES = ['min_cost_per_successful_shot', 'max_success_probability'] as const

/** More than every device we reach, fewer than would make one call expensive. */
const MAX_BACKENDS = 32

export async function POST(req: Request): Promise<Response> {
  const limited = await limitOrNull(req, 'hw-recommend', READ_LIMIT)
  if (limited) return limited

  const body = await readJsonObject(req)
  if (!body.ok) return body.response
  const v = body.value

  if (typeof v.qasm !== 'string') return badRequest('qasm must be a string.')
  if (v.qasm.trim().length === 0) return badRequest('qasm must not be empty.')
  if (v.qasm.length > MAX_QASM_CHARS) {
    return badRequest(`qasm must be at most ${MAX_QASM_CHARS} characters (got ${v.qasm.length}).`)
  }

  const shots = int(v.shots ?? 1024, 1, MAX_SHOTS, 'shots')
  if (!shots.ok) return badRequest(shots.error)

  const level = int(v.optimization_level ?? 1, 0, 3, 'optimization_level')
  if (!level.ok) return badRequest(level.error)

  const objective = oneOf(v.objective ?? RECOMMEND_OBJECTIVES[0], RECOMMEND_OBJECTIVES, 'objective')
  if (!objective.ok) return badRequest(objective.error)

  const decoherence = v.include_decoherence ?? true
  if (typeof decoherence !== 'boolean') return badRequest('include_decoherence must be a boolean.')

  let backends: string[] | null = null
  if (v.backends !== undefined && v.backends !== null) {
    const list = arr(v.backends, MAX_BACKENDS, 'backends')
    if (!list.ok) return badRequest(list.error)
    backends = []
    for (const item of list.value) {
      const id = str(item, MAX_BACKEND_CHARS, 'backends[]')
      if (!id.ok) return badRequest(id.error)
      backends.push(id.value)
    }
  }

  return forward('/api/hardware/recommend', {
    qasm: v.qasm,
    shots: shots.value,
    optimization_level: level.value,
    objective: objective.value,
    include_decoherence: decoherence,
    backends,
  })
}
