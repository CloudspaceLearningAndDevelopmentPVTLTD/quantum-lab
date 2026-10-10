'use client'

/**
 * /admin/platform — the operator's console for the AI tutor.
 *
 * Three cards, top to bottom in the order an operator actually thinks:
 *   1. Providers — one key per provider, model override, on/off, "Test".
 *   2. Routing — cheapest-first order and the emergency "force" switch.
 *   3. Access by tier — what signed-out visitors, free accounts, the launch
 *      trial and paid plans get: live / offline / off, a pinned provider,
 *      a daily allowance, and whether the circuit-running agent is offered.
 * plus a live "what each tier gets right now" strip, computed server-side
 * from the same resolver the tutor uses, so the admin sees the effect of a
 * change before a learner does.
 *
 * Keys never come back from the server: the UI shows "set · …ab12 · from
 * settings/env" and a blank password field. Typing a new one replaces it;
 * "Remove" sends CLEAR_KEY. Saving sends only what changed (a patch) plus the
 * version loaded, so two admins cannot silently overwrite each other.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '@/components/auth/useSession'
import AuthPanel from '@/components/auth/AuthPanel'
import { authFetch } from '@/lib/authFetch'
import {
  CLEAR_KEY,
  PROVIDER_IDS,
  PROVIDER_LABEL,
  PROVIDER_DEFAULT_MODEL,
  TIER_IDS,
  TIER_LABEL,
  type LlmSettingsPatch,
  type ProviderId,
  type RedactedLlmSettings,
  type TierAccess,
  type TierId,
  type TierPolicy,
} from '@/lib/platform/llmConfig'

interface LoadResponse {
  settings: RedactedLlmSettings
  stored: { version: number; updatedAt: string | null; updatedBy: string | null } | null
  unreadable: ProviderId[]
  effective: Record<TierId, { access: string; provider: string | null; messagesPerDay: number | null; tools: boolean }>
  anyProviderReady: boolean
  canStore: boolean
  canStoreSecrets: boolean
}

type KeyDraft = { value: string; clear: boolean }

const PROVIDER_HELP: Record<ProviderId, { where: string; url: string }> = {
  gemini: { where: 'Google AI Studio — free tier', url: 'https://aistudio.google.com/apikey' },
  groq: { where: 'Groq console — cheap open-weight models', url: 'https://console.groq.com/keys' },
  anthropic: { where: 'Anthropic console — premium', url: 'https://console.anthropic.com/settings/keys' },
  azure: { where: 'Azure OpenAI resource → Keys and Endpoint', url: 'https://portal.azure.com' },
}

const ACCESS_HELP: Record<TierAccess, string> = {
  live: 'A real model answers',
  offline: 'Built-in FAQ only — costs nothing',
  off: 'Tutor refuses with a sign-in / upgrade nudge',
}

const INPUT =
  'focus-ring w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted'
const SELECT = 'focus-ring rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink'

export default function PlatformAdminPage() {
  const { user, loading: sessionLoading } = useSession()
  const [me, setMe] = useState<{ admin: boolean; configured: boolean } | null>(null)
  const [data, setData] = useState<LoadResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Drafts — what the admin is editing; diffed against `data.settings` on save.
  const [providers, setProviders] = useState<RedactedLlmSettings['providers'] | null>(null)
  const [keys, setKeys] = useState<Record<ProviderId, KeyDraft>>({
    gemini: { value: '', clear: false },
    groq: { value: '', clear: false },
    anthropic: { value: '', clear: false },
    azure: { value: '', clear: false },
  })
  const [order, setOrder] = useState<ProviderId[]>([])
  const [force, setForce] = useState<ProviderId | ''>('')
  const [tiers, setTiers] = useState<Record<TierId, TierPolicy> | null>(null)
  const [note, setNote] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState<ProviderId | null>(null)
  const [testMsg, setTestMsg] = useState<Partial<Record<ProviderId, { ok: boolean; text: string }>>>({})

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await authFetch('/api/platform/llm', { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setLoadError(body.error ?? `Could not load settings (${res.status}).`)
        return
      }
      const body = (await res.json()) as LoadResponse
      setData(body)
      setProviders(body.settings.providers)
      setOrder(body.settings.order)
      setForce(body.settings.forceProvider ?? '')
      setTiers(body.settings.tiers)
      setNote(body.settings.note)
      setKeys({
        gemini: { value: '', clear: false },
        groq: { value: '', clear: false },
        anthropic: { value: '', clear: false },
        azure: { value: '', clear: false },
      })
    } catch {
      setLoadError('Could not reach the server.')
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setMe(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await authFetch('/api/platform/me')
        const body = (await res.json()) as { admin: boolean; configured: boolean }
        if (cancelled) return
        setMe(body)
        if (body.admin) void load()
      } catch {
        if (!cancelled) setMe({ admin: false, configured: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, load])

  const patch = useMemo<LlmSettingsPatch>(() => {
    if (!data || !providers || !tiers) return {}
    const out: LlmSettingsPatch = {}
    const base = data.settings
    for (const id of PROVIDER_IDS) {
      const p: Partial<Record<'apiKey' | 'model' | 'baseUrl' | 'apiVersion', string>> & { enabled?: boolean } = {}
      const cur = providers[id]
      const was = base.providers[id]
      if (keys[id].clear) p.apiKey = CLEAR_KEY
      else if (keys[id].value.trim()) p.apiKey = keys[id].value.trim()
      if (cur.model !== was.model) p.model = cur.model
      if (cur.baseUrl !== was.baseUrl) p.baseUrl = cur.baseUrl
      if (cur.apiVersion !== was.apiVersion) p.apiVersion = cur.apiVersion
      if (cur.enabled !== was.enabled) p.enabled = cur.enabled
      if (Object.keys(p).length) (out.providers ??= {})[id] = p
    }
    if (order.join() !== base.order.join()) out.order = order
    if ((force || null) !== base.forceProvider) out.forceProvider = force || null
    for (const t of TIER_IDS) {
      const a = tiers[t]
      const b = base.tiers[t]
      if (a.access !== b.access || a.provider !== b.provider || a.messagesPerDay !== b.messagesPerDay || a.tools !== b.tools) {
        ;(out.tiers ??= {})[t] = a
      }
    }
    if (note !== base.note) out.note = note
    return out
  }, [data, providers, keys, order, force, tiers, note])

  const dirty = Object.keys(patch).length > 0

  const save = useCallback(async () => {
    if (!data || !dirty) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await authFetch('/api/platform/llm', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch, version: data.stored?.version ?? null }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; version?: number }
      if (!res.ok) {
        setSaveMsg({ ok: false, text: body.error ?? `Save failed (${res.status}).` })
        if (res.status === 409) await load()
        return
      }
      setSaveMsg({ ok: true, text: `Saved (version ${body.version}). The tutor picks it up within 30 seconds on every instance.` })
      await load()
    } catch {
      setSaveMsg({ ok: false, text: 'Could not reach the server.' })
    } finally {
      setSaving(false)
    }
  }, [data, dirty, patch, load])

  const test = useCallback(
    async (id: ProviderId) => {
      if (!providers) return
      setTesting(id)
      setTestMsg((m) => ({ ...m, [id]: undefined }))
      try {
        const res = await authFetch('/api/platform/llm/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider: id,
            ...(keys[id].value.trim() ? { apiKey: keys[id].value.trim() } : {}),
            model: providers[id].model,
            baseUrl: providers[id].baseUrl,
            apiVersion: providers[id].apiVersion,
          }),
        })
        const body = (await res.json()) as { ok: boolean; message?: string; ms?: number; model?: string; sample?: string; error?: string }
        setTestMsg((m) => ({
          ...m,
          [id]: body.ok
            ? { ok: true, text: `OK — ${body.model} answered in ${body.ms} ms${body.sample ? ` ("${body.sample}")` : ''}` }
            : { ok: false, text: body.message ?? body.error ?? 'Failed' },
        }))
      } catch {
        setTestMsg((m) => ({ ...m, [id]: { ok: false, text: 'Could not reach the server.' } }))
      } finally {
        setTesting(null)
      }
    },
    [keys, providers],
  )

  const move = (id: ProviderId, dir: -1 | 1) => {
    setOrder((o) => {
      const i = o.indexOf(id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= o.length) return o
      const next = [...o]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // ── Gates ──────────────────────────────────────────────────────────────
  if (!sessionLoading && !user) {
    return (
      <Shell>
        <p className="section-desc">Sign in with a platform-admin email to open the console.</p>
        <AuthPanel className="mt-4 max-w-lg" />
      </Shell>
    )
  }
  if (me && !me.admin) {
    return (
      <Shell>
        <div className="card p-6">
          <h2 className="text-lg font-bold text-ink">{me.configured ? 'Not a platform admin' : 'No platform admins configured'}</h2>
          <p className="mt-2 text-sm text-ink-secondary">
            {me.configured
              ? 'Your account is signed in, but its email is not in this deployment’s PLATFORM_ADMIN_EMAILS list.'
              : 'Set PLATFORM_ADMIN_EMAILS (comma-separated) in infra/azure/.env.production and redeploy — the addresses listed there can open this console.'}
          </p>
          <Link href="/account" className="btn-ghost focus-ring mt-4 inline-flex">
            Back to your account
          </Link>
        </div>
      </Shell>
    )
  }
  if (loadError) {
    return (
      <Shell>
        <div className="card border-q-amber/40 p-6" role="alert">
          <p className="text-sm text-ink">{loadError}</p>
          <button type="button" className="btn-ghost focus-ring mt-4" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </Shell>
    )
  }
  if (!data || !providers || !tiers) {
    return (
      <Shell>
        <p className="text-sm text-ink-muted" role="status">
          Loading…
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      {/* ── Live status strip ─────────────────────────────────────────── */}
      <section className="card p-5" aria-label="What each tier gets right now">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="section-label">Right now</p>
          <p className="text-xs text-ink-muted">
            {data.stored
              ? `Saved v${data.stored.version}${data.stored.updatedBy ? ` by ${data.stored.updatedBy}` : ''}${data.stored.updatedAt ? ` · ${new Date(data.stored.updatedAt).toLocaleString('en-US')}` : ''}`
              : 'Nothing saved yet — running on deploy-time env vars'}
          </p>
        </div>
        {!data.anyProviderReady ? (
          <p className="mt-3 rounded-lg border border-q-amber/40 bg-q-amber/10 px-3 py-2 text-sm text-ink" role="alert">
            No provider is ready: every tier is answered by the offline FAQ. Add a key below (Gemini has a free tier) and Save.
          </p>
        ) : null}
        {data.unreadable.length ? (
          <p className="mt-3 rounded-lg border border-q-amber/40 bg-q-amber/10 px-3 py-2 text-sm text-ink" role="alert">
            Stored keys for {data.unreadable.map((id) => PROVIDER_LABEL[id]).join(', ')} cannot be decrypted — SETTINGS_ENCRYPTION_KEY has changed.
            Re-enter them below.
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TIER_IDS.map((t) => {
            const e = data.effective[t]
            return (
              <div key={t} className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs font-semibold text-ink-secondary">{TIER_LABEL[t]}</p>
                <p className="mt-1 text-sm font-bold text-ink">
                  {e.provider ? `Live · ${e.provider}` : e.access}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {e.messagesPerDay === null ? 'Unlimited' : `${e.messagesPerDay} / day`}
                  {e.provider ? (e.tools ? ' · runs circuits' : ' · no tools') : ''}
                </p>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── 1. Providers ──────────────────────────────────────────────── */}
      <section className="card mt-6 p-5">
        <p className="section-label">1 · Providers</p>
        <h2 className="mt-1 text-lg font-bold text-ink">API keys and models</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Keys are encrypted before they are stored and never shown again. A key here replaces the one from the deploy env; Remove
          falls back to env.
          {!data.canStoreSecrets ? (
            <span className="text-q-amber-text">
              {' '}
              {data.canStore
                ? 'Storing keys needs SETTINGS_ENCRYPTION_KEY (or the service-role key) on the web app.'
                : 'This deployment has no SUPABASE_SERVICE_ROLE_KEY, so settings cannot be saved — env vars only.'}
            </span>
          ) : null}
        </p>

        <div className="mt-4 space-y-4">
          {PROVIDER_IDS.map((id) => {
            const p = providers[id]
            const k = keys[id]
            const t = testMsg[id]
            return (
              <div key={id} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <input
                        type="checkbox"
                        className="focus-ring h-4 w-4"
                        checked={p.enabled}
                        onChange={(e) => setProviders({ ...providers, [id]: { ...p, enabled: e.target.checked } })}
                      />
                      {PROVIDER_LABEL[id]}
                    </label>
                    <span
                      className={`pill ${
                        k.clear
                          ? 'border-q-amber/30 bg-q-amber/15 text-q-amber-text'
                          : p.apiKeySet
                            ? 'border-q-teal/30 bg-q-teal/15 text-q-teal-text'
                            : 'border-line bg-surface-2 text-ink-muted'
                      }`}
                    >
                      {k.clear ? 'will remove' : p.apiKeySet ? `key set ${p.apiKeyHint} · from ${p.keySource}` : 'no key'}
                    </span>
                  </div>
                  <a href={PROVIDER_HELP[id].url} target="_blank" rel="noreferrer" className="text-xs text-q-violet-text underline">
                    {PROVIDER_HELP[id].where} ↗
                  </a>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
                  <div>
                    <label className="block text-xs text-ink-muted" htmlFor={`key-${id}`}>
                      {p.apiKeySet ? 'Replace key' : 'API key'}
                    </label>
                    <input
                      id={`key-${id}`}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      className={`${INPUT} mt-1 font-mono`}
                      placeholder={p.apiKeySet ? '•••••••• (leave blank to keep)' : 'paste key'}
                      value={k.value}
                      disabled={k.clear}
                      onChange={(e) => setKeys({ ...keys, [id]: { value: e.target.value, clear: false } })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted" htmlFor={`model-${id}`}>
                      {id === 'azure' ? 'Deployment name' : 'Model'}
                    </label>
                    <input
                      id={`model-${id}`}
                      type="text"
                      className={`${INPUT} mt-1 font-mono`}
                      placeholder={PROVIDER_DEFAULT_MODEL[id] || 'my-gpt-deployment'}
                      value={p.model}
                      onChange={(e) => setProviders({ ...providers, [id]: { ...p, model: e.target.value } })}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      className="btn-ghost focus-ring"
                      disabled={testing !== null || (!p.apiKeySet && !k.value.trim())}
                      onClick={() => void test(id)}
                    >
                      {testing === id ? 'Testing…' : 'Test'}
                    </button>
                    {p.apiKeySet && p.keySource === 'settings' ? (
                      <button
                        type="button"
                        className="btn-ghost focus-ring"
                        onClick={() => setKeys({ ...keys, [id]: { value: '', clear: !k.clear } })}
                      >
                        {k.clear ? 'Keep' : 'Remove'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {id === 'azure' ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label className="block text-xs text-ink-muted" htmlFor="azure-base">
                        Endpoint
                      </label>
                      <input
                        id="azure-base"
                        type="url"
                        className={`${INPUT} mt-1 font-mono`}
                        placeholder="https://my-resource.openai.azure.com"
                        value={p.baseUrl}
                        onChange={(e) => setProviders({ ...providers, azure: { ...p, baseUrl: e.target.value } })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-muted" htmlFor="azure-version">
                        API version
                      </label>
                      <input
                        id="azure-version"
                        type="text"
                        className={`${INPUT} mt-1 font-mono`}
                        placeholder="2024-10-21"
                        value={p.apiVersion}
                        onChange={(e) => setProviders({ ...providers, azure: { ...p, apiVersion: e.target.value } })}
                      />
                    </div>
                  </div>
                ) : null}

                {t ? (
                  <p className={`mt-2 text-xs ${t.ok ? 'text-q-teal-text' : 'text-q-amber-text'}`} role="status">
                    {t.text}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── 2. Routing ────────────────────────────────────────────────── */}
      <section className="card mt-6 p-5">
        <p className="section-label">2 · Routing</p>
        <h2 className="mt-1 text-lg font-bold text-ink">Order and emergency override</h2>
        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="text-sm text-ink-secondary">
              First ready provider wins, top to bottom. Cheapest-first by default.
            </p>
            <ol className="mt-3 space-y-2">
              {order.map((id, i) => (
                <li key={id} className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <span className="text-sm text-ink">
                    <span className="mr-2 font-mono text-ink-muted">{i + 1}.</span>
                    {PROVIDER_LABEL[id]}
                    {!providers[id].enabled ? <span className="ml-2 text-xs text-ink-muted">(off)</span> : null}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" className="btn-ghost focus-ring px-2 py-1 text-xs" aria-label={`Move ${PROVIDER_LABEL[id]} up`} disabled={i === 0} onClick={() => move(id, -1)}>
                      ↑
                    </button>
                    <button type="button" className="btn-ghost focus-ring px-2 py-1 text-xs" aria-label={`Move ${PROVIDER_LABEL[id]} down`} disabled={i === order.length - 1} onClick={() => move(id, 1)}>
                      ↓
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <label className="block text-sm text-ink-secondary" htmlFor="force">
              Force one provider for everyone
            </label>
            <select id="force" className={`${SELECT} mt-2 w-full`} value={force} onChange={(e) => setForce(e.target.value as ProviderId | '')}>
              <option value="">Off — follow the order and tier pins</option>
              {PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABEL[id]}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-ink-muted">
              For a demo, or to route around a rate-limited key for a day. If the forced provider has no key it is ignored rather
              than taking the tutor offline.
            </p>
            <label className="mt-5 block text-sm text-ink-secondary" htmlFor="note">
              Operator note
            </label>
            <input id="note" type="text" className={`${INPUT} mt-2`} placeholder="e.g. Gemini key rotated 3 Sep" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </section>

      {/* ── 3. Tiers ──────────────────────────────────────────────────── */}
      <section className="card mt-6 p-5">
        <p className="section-label">3 · Access by tier</p>
        <h2 className="mt-1 text-lg font-bold text-ink">What each kind of learner gets</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          The tier is decided server-side from the caller’s verified session and plan. Allowances are per caller per rolling 24 h.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                <th className="py-2 pr-3 font-medium">Tier</th>
                <th className="py-2 pr-3 font-medium">Access</th>
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 font-medium">Messages / day</th>
                <th className="py-2 pr-3 font-medium">Runs circuits</th>
              </tr>
            </thead>
            <tbody>
              {TIER_IDS.map((t) => {
                const pol = tiers[t]
                const set = (next: Partial<TierPolicy>) => setTiers({ ...tiers, [t]: { ...pol, ...next } })
                return (
                  <tr key={t} className="border-t border-line align-top">
                    <td className="py-3 pr-3">
                      <p className="font-semibold text-ink">{TIER_LABEL[t]}</p>
                      <p className="text-xs text-ink-muted">{ACCESS_HELP[pol.access]}</p>
                    </td>
                    <td className="py-3 pr-3">
                      <select className={SELECT} aria-label={`${TIER_LABEL[t]} access`} value={pol.access} onChange={(e) => set({ access: e.target.value as TierAccess })}>
                        <option value="live">Live model</option>
                        <option value="offline">Offline FAQ</option>
                        <option value="off">Off</option>
                      </select>
                    </td>
                    <td className="py-3 pr-3">
                      <select className={SELECT} aria-label={`${TIER_LABEL[t]} provider`} value={pol.provider} disabled={pol.access !== 'live'} onChange={(e) => set({ provider: e.target.value as ProviderId | 'auto' })}>
                        <option value="auto">Auto (order)</option>
                        {PROVIDER_IDS.map((id) => (
                          <option key={id} value={id}>
                            {PROVIDER_LABEL[id]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={100000}
                          className={`${INPUT} w-24`}
                          aria-label={`${TIER_LABEL[t]} messages per day`}
                          disabled={pol.access !== 'live' || pol.messagesPerDay === null}
                          value={pol.messagesPerDay ?? ''}
                          onChange={(e) => set({ messagesPerDay: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                        />
                        <label className="flex items-center gap-1 text-xs text-ink-muted">
                          <input type="checkbox" className="focus-ring" disabled={pol.access !== 'live'} checked={pol.messagesPerDay === null} onChange={(e) => set({ messagesPerDay: e.target.checked ? null : 20 })} />
                          unlimited
                        </label>
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <input type="checkbox" className="focus-ring h-4 w-4" aria-label={`${TIER_LABEL[t]} may use the circuit-running agent`} disabled={pol.access !== 'live'} checked={pol.tools} onChange={(e) => set({ tools: e.target.checked })} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Save bar ──────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface/95 p-4 backdrop-blur">
        <p className={`text-sm ${saveMsg ? (saveMsg.ok ? 'text-q-teal-text' : 'text-q-amber-text') : 'text-ink-muted'}`} role="status">
          {saveMsg ? saveMsg.text : dirty ? 'Unsaved changes' : 'No changes'}
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost focus-ring" disabled={!dirty || saving} onClick={() => void load()}>
            Discard
          </button>
          <button type="button" className="btn-primary focus-ring" disabled={!dirty || saving || !data.canStore} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <p className="section-label">Platform console</p>
      <h1 className="section-title mt-2">AI tutor — providers, routing and access</h1>
      <p className="section-desc mt-2 max-w-2xl">
        Change which model answers, what it costs you, and what signed-out, free, trial and paid learners get — live, without a
        redeploy.
      </p>
      <div className="mt-6">{children}</div>
    </div>
  )
}
