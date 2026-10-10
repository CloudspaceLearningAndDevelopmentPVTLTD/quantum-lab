'use client'

/**
 * ApiKeys — issue, review and revoke the credentials a script uses.
 *
 * ── The one interaction that matters ────────────────────────────────────────
 *
 * A key is returned by the server exactly once and only its hash is stored, so
 * the moment after creation is the only moment it exists anywhere the user can
 * reach. This component therefore:
 *
 *   · shows the new key in its own panel, not in a toast that can be missed,
 *   · says plainly that it will not be shown again,
 *   · keeps it on screen until the user dismisses it, and
 *   · never puts it back in the list afterwards, because it cannot.
 *
 * Losing a key is not a disaster — you revoke it and issue another — but a UI
 * that lets somebody navigate away without noticing has wasted their time for
 * no reason.
 *
 * ── Revoked keys stay visible ───────────────────────────────────────────────
 *
 * A revoked key's absence would be the same signal as "never existed". An
 * owner auditing what they have issued needs to see that a key was revoked
 * rather than wonder whether they imagined creating it.
 */

import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { useSession } from '@/components/auth/useSession'

/** Mirrors `ApiKeyRecord` in lib/security/apiKeys.ts. Never carries the key. */
interface KeyRecord {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

/** The creation response, which is the only one that carries the key. */
interface MintedKey extends KeyRecord {
  key: string
}

/**
 * Scope descriptions, restated here rather than imported.
 *
 * `lib/security/apiKeys.ts` reads the service-role key, so a client component
 * cannot import from it. Two short strings duplicated is cheaper than the
 * indirection, and the scope IDENTIFIERS still come from the server (the
 * listing response carries them) so the set cannot drift.
 */
const SCOPE_HELP: Record<string, string> = {
  'hardware:read': 'Read devices, cost estimates, transpiled circuits and your own job history.',
  'hardware:submit': 'Submit jobs to real hardware. Spends your monthly allowance.',
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; keys: KeyRecord[]; scopes: string[] }
  | { kind: 'signed-out' }
  | { kind: 'unavailable'; message: string }

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

export function ApiKeys() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<string[]>(['hardware:read'])
  const [creating, setCreating] = useState(false)
  const [minted, setMinted] = useState<MintedKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await authFetch('/api/keys')
      if (response.status === 401) {
        setState({ kind: 'signed-out' })
        return
      }
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const detail =
          body && typeof body === 'object' && 'detail' in body
            ? String((body as { detail: unknown }).detail)
            : 'API keys are unavailable on this deployment.'
        setState({ kind: 'unavailable', message: detail })
        return
      }
      const parsed = body as { keys?: KeyRecord[]; scopes?: string[] } | null
      setState({
        kind: 'ready',
        keys: Array.isArray(parsed?.keys) ? parsed.keys : [],
        scopes: Array.isArray(parsed?.scopes) ? parsed.scopes : Object.keys(SCOPE_HELP),
      })
    } catch {
      setState({ kind: 'unavailable', message: 'Your API keys could not be loaded.' })
    }
  }, [])

  // Re-load whenever the signed-in account changes. This used to run once on
  // mount, so signing in on /account (by code, or in another tab) left the
  // panel hidden until a manual refresh. Signed out, there is nothing to ask
  // the server — it would only answer 401.
  const { user, loading: sessionLoading, configured } = useSession()
  const userId = user?.id ?? null
  useEffect(() => {
    if (sessionLoading || (configured && !userId)) return
    void load()
  }, [load, userId, sessionLoading, configured])

  const create = useCallback(async () => {
    setCreating(true)
    setError(null)
    try {
      const response = await authFetch('/api/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes: chosen }),
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const record = (body ?? {}) as Record<string, unknown>
        setError(String(record.detail ?? record.error ?? 'The key could not be created.'))
        return
      }
      setMinted(body as MintedKey)
      setName('')
      setCopied(false)
      await load()
    } catch {
      setError('The key could not be created.')
    } finally {
      setCreating(false)
    }
  }, [name, chosen, load])

  const revoke = useCallback(
    async (keyId: string) => {
      setError(null)
      try {
        const response = await authFetch(`/api/keys/${keyId}`, { method: 'DELETE' })
        if (!response.ok) {
          setError('That key could not be revoked.')
          return
        }
        await load()
      } catch {
        setError('That key could not be revoked.')
      }
    },
    [load]
  )

  const toggleScope = useCallback((scope: string) => {
    setChosen((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]
    )
  }, [])

  if (state.kind === 'signed-out' || (configured && !sessionLoading && !userId)) return null

  return (
    <section className="card mt-4 p-5" aria-labelledby="api-keys-heading">
      <h2 id="api-keys-heading" className="text-[13px] font-semibold text-ink-secondary">
        API keys
      </h2>
      <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-secondary">
        Use a key to reach the hardware API from a script, a notebook or a CI job — the same
        devices, cost estimates, submissions and job history you get here, without a browser.
        Send it as <code className="font-mono text-[12px]">Authorization: Bearer qb16_sk_…</code>.
      </p>

      {state.kind === 'unavailable' ? (
        <p className="mt-3 text-[12px] leading-relaxed text-q-amber-text">{state.message}</p>
      ) : null}

      {/* The new key. Its own panel, and it stays until dismissed. */}
      {minted ? (
        <div className="mt-4 rounded-lg border border-q-teal/40 bg-surface-2 p-4">
          <p className="text-[12px] font-bold uppercase tracking-wider text-q-teal-text">
            Copy this now — it will not be shown again
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
            Only a hash of this key is stored, so nobody — including us — can show it to you a
            second time. If you lose it, revoke it and issue another.
          </p>
          <pre className="code-block mt-3 overflow-x-auto text-[12px]">{minted.key}</pre>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-ghost focus-ring text-[12px]"
              onClick={() => {
                void navigator.clipboard?.writeText(minted.key).then(
                  () => setCopied(true),
                  () => setCopied(false)
                )
              }}
            >
              {copied ? 'Copied' : 'Copy key'}
            </button>
            <button
              type="button"
              className="btn-ghost focus-ring text-[12px]"
              onClick={() => setMinted(null)}
            >
              I have saved it
            </button>
          </div>
        </div>
      ) : null}

      {/* Create */}
      {state.kind === 'ready' ? (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
          <label htmlFor="api-key-name" className="block text-[12px] font-semibold text-ink">
            New key
          </label>
          <input
            id="api-key-name"
            type="text"
            value={name}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            placeholder="laptop, ci, thesis-sweep"
            className="focus-ring mt-2 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink"
          />
          <p className="mt-1 text-[11px] text-ink-muted">
            A name you will recognise later, so you can revoke the right one.
          </p>

          <fieldset className="mt-3">
            <legend className="text-[12px] font-semibold text-ink">What it may do</legend>
            {state.scopes.map((scope) => (
              <label key={scope} className="mt-2 flex items-start gap-2 text-[12px] text-ink">
                <input
                  type="checkbox"
                  id={`api-scope-${scope.replace(/[^a-z]/gi, '-')}`}
                  checked={chosen.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  className="focus-ring mt-0.5"
                />
                <span>
                  <span className="font-mono">{scope}</span>
                  <span className="block text-ink-secondary">{SCOPE_HELP[scope] ?? ''}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <button
            type="button"
            onClick={() => void create()}
            disabled={creating || name.trim().length === 0 || chosen.length === 0}
            className="btn-primary focus-ring mt-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create key'}
          </button>

          {error ? (
            <p className="mt-2 text-[12px] leading-relaxed text-q-rose-text">{error}</p>
          ) : null}
        </div>
      ) : null}

      {/* List */}
      {state.kind === 'ready' && state.keys.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {state.keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">
                  {key.name}
                  {key.revokedAt ? (
                    <span className="ml-2 text-[11px] font-normal text-ink-muted">revoked</span>
                  ) : null}
                </p>
                <p className="break-all font-mono text-[11px] text-ink-muted">{key.keyPrefix}…</p>
                <p className="text-[11px] text-ink-muted">
                  {key.scopes.join(', ') || 'no scopes'} · created {formatDate(key.createdAt)} ·
                  last used {formatDate(key.lastUsedAt)}
                </p>
              </div>
              {key.revokedAt ? null : (
                <button
                  type="button"
                  onClick={() => void revoke(key.id)}
                  className="focus-ring text-[11px] text-ink-muted hover:text-q-rose-text"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {state.kind === 'ready' && state.keys.length === 0 ? (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          No keys yet. Everything the hardware page does is available over the API — see{' '}
          <code className="font-mono">docs/API.md</code>.
        </p>
      ) : null}
    </section>
  )
}
