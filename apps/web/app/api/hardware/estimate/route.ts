/**
 * POST /api/hardware/estimate — server-side proxy for the same path on
 * `services/api`.
 *
 * Estimating is read-only and spends nothing at a vendor, but it does parse
 * user QASM with Qiskit upstream, so the shape check here is the cheap way to
 * refuse a body that would cost a network hop and a parse.
 *
 * ── Gate chain: IP rate limit only. Deliberately. ───────────────────────────
 *
 * NO identity, NO entitlement, NO quota. The reasoning:
 *
 *  · Nothing is charged by a provider. This is arithmetic over a published
 *    price table plus a Qiskit parse on a machine we own.
 *  · Telling someone what a run WOULD cost is how they decide whether to buy
 *    Pro. Gating the price tag behind the purchase is the wrong way round.
 *  · The page re-estimates on every shots-slider change (debounced), so a
 *    Supabase round trip per estimate would be felt.
 *
 * RESIDUAL, stated rather than hidden: an anonymous caller can burn upstream
 * CPU and memory here at 60/minute per IP. That is a denial-of-service concern,
 * not a billing one, and it is bounded by READ_LIMIT plus `guard_qasm()`
 * upstream (audit finding PY-1). If upstream CPU ever becomes the scarce
 * resource, this is the route to put behind `requireCaller` first.
 */

import {
  circuitFields,
  forward,
  badRequest,
  limitOrNull,
  readJsonObject,
  MAX_SHOTS,
  READ_LIMIT,
} from '@/lib/hardware/proxy'
import { int } from '@/lib/security/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const limited = await limitOrNull(req, 'hw-estimate', READ_LIMIT)
  if (limited) return limited

  const body = await readJsonObject(req)
  if (!body.ok) return body.response

  const circuit = circuitFields(body.value)
  if (!circuit.ok) return circuit.response

  const shots = int(body.value.shots, 1, MAX_SHOTS, 'shots')
  if (!shots.ok) return badRequest(shots.error)

  return forward('/api/hardware/estimate', {
    backend: circuit.backend,
    shots: shots.value,
    qasm: circuit.qasm,
  })
}
