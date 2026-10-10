/**
 * POST /api/hardware/transpile — server-side proxy for the same path on
 * `services/api`.
 *
 * `optimization_level` is bounded to Qiskit's 0–3. Anything outside that range
 * raises upstream and would come back as a 500 rather than a usable message.
 *
 * ── Gate chain: IP rate limit only. Deliberately. ───────────────────────────
 *
 * NO identity, NO entitlement, NO quota — same reasoning as `estimate`, and it
 * carries the same residual: transpiling is the most CPU-hungry of the three
 * free endpoints (a level-3 pass over a wide circuit is not cheap) and an
 * anonymous caller can drive it at READ_LIMIT per IP. It spends nothing at a
 * vendor, returns no user data, and it is what the "preview the transpiled
 * circuit" control on the hardware page calls before anyone commits money — so
 * it stays open, and the exposure is upstream CPU rather than a bill.
 */

import {
  circuitFields,
  forward,
  badRequest,
  limitOrNull,
  readJsonObject,
  READ_LIMIT,
} from '@/lib/hardware/proxy'
import { int } from '@/lib/security/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const limited = await limitOrNull(req, 'hw-transpile', READ_LIMIT)
  if (limited) return limited

  const body = await readJsonObject(req)
  if (!body.ok) return body.response

  const circuit = circuitFields(body.value)
  if (!circuit.ok) return circuit.response

  const level = int(body.value.optimization_level, 0, 3, 'optimization_level')
  if (!level.ok) return badRequest(level.error)

  return forward('/api/hardware/transpile', {
    qasm: circuit.qasm,
    backend: circuit.backend,
    optimization_level: level.value,
  })
}
