/**
 * POST /api/circuits/resources — server-side proxy for the fault-tolerant
 * resource estimator in `services/api/app/quantum/resources.py`.
 *
 * Only THIS path under `/api/circuits` is proxied. Its sibling
 * `/api/circuits/run` executes arbitrary QASM and stays unexposed; see the
 * allowlist comment at the top of lib/hardware/proxy.ts.
 *
 * ── Gate chain: IP rate limit only. ─────────────────────────────────────────
 *
 * Pure arithmetic upstream (plus one QASM parse when a circuit is supplied),
 * no vendor, no user data. The bounds below mirror the pydantic model on
 * `ResourceEstimateRequest` so a bad value is refused here with a readable
 * message instead of a 422 in FastAPI's shape.
 */

import {
  forward,
  badRequest,
  limitOrNull,
  readJsonObject,
  MAX_QASM_CHARS,
  READ_LIMIT,
} from '@/lib/hardware/proxy'
import { int } from '@/lib/security/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A finite number strictly inside (min, max). The estimator's rates are open intervals. */
function openInterval(
  v: unknown,
  min: number,
  max: number,
  label: string
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `${label} must be a finite number.` }
  if (v <= min || v >= max) return { ok: false, error: `${label} must be greater than ${min} and less than ${max}.` }
  return { ok: true, value: v }
}

/** Upper bounds for the optional counts. Large enough for Shor-scale what-ifs, finite so nothing overflows. */
const MAX_COUNT = 1e15

export async function POST(req: Request): Promise<Response> {
  const limited = await limitOrNull(req, 'circuits-resources', READ_LIMIT)
  if (limited) return limited

  const body = await readJsonObject(req)
  if (!body.ok) return body.response
  const v = body.value
  const out: Record<string, unknown> = {}

  if (v.qasm !== undefined && v.qasm !== null) {
    if (typeof v.qasm !== 'string') return badRequest('qasm must be a string.')
    if (v.qasm.length > MAX_QASM_CHARS) {
      return badRequest(`qasm must be at most ${MAX_QASM_CHARS} characters (got ${v.qasm.length}).`)
    }
    if (v.qasm.trim().length > 0) out.qasm = v.qasm
  }

  const counts: [string, number, number][] = [
    ['algorithm_qubits', 1, 1_000_000],
    ['t_count', 0, MAX_COUNT],
    ['logical_depth', 1, MAX_COUNT],
    ['factory_count', 1, 1_000],
  ]
  for (const [key, min, max] of counts) {
    if (v[key] === undefined || v[key] === null) continue
    const n = int(v[key], min, max, key)
    if (!n.ok) return badRequest(n.error)
    out[key] = n.value
  }

  const rates: [string, number, number][] = [
    ['physical_error_rate', 0, 1],
    ['target_total_error', 0, 1],
    ['code_cycle_seconds', 0, 3600],
  ]
  for (const [key, min, max] of rates) {
    if (v[key] === undefined || v[key] === null) continue
    const n = openInterval(v[key], min, max, key)
    if (!n.ok) return badRequest(n.error)
    out[key] = n.value
  }

  if (v.model_magic_states !== undefined) {
    if (typeof v.model_magic_states !== 'boolean') return badRequest('model_magic_states must be a boolean.')
    out.model_magic_states = v.model_magic_states
  }

  return forward('/api/circuits/resources', out)
}
