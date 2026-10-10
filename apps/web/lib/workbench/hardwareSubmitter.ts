/**
 * lib/workbench/hardwareSubmitter.ts — the real HardwareSubmitter.
 *
 * SERVER ONLY. Dispatches an internal Request to the /api/hardware/submit
 * route handler exactly as `submit_hardware_job` does, so every gate that
 * route enforces — IP and per-account rate limits, Supabase-verified identity,
 * the plan check, the atomic monthly quota — runs unchanged. The import is
 * dynamic so a process that never targets hardware never loads the billing
 * stack, and lib/workbench/targets.ts stays importable in the browser.
 */

import type { HardwareSubmitter } from '@/lib/workbench/targets'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export const routeHardwareSubmitter: HardwareSubmitter = async (submission) => {
  const { POST } = await import('@/app/api/hardware/submit/route')
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: submission.authorization,
  }
  if (submission.forwardedFor) headers['x-forwarded-for'] = submission.forwardedFor
  const body: Record<string, unknown> = {
    qasm: submission.qasm,
    backend: submission.backend,
    shots: submission.shots,
  }
  if (submission.provider) body.provider = submission.provider
  const response = await POST(
    new Request('http://localhost/api/hardware/submit', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
  let payload: Record<string, unknown> | null = null
  try {
    const parsed: unknown = await response.json()
    payload = isRecord(parsed) ? parsed : null
  } catch {
    payload = null
  }
  return { status: response.status, payload }
}
