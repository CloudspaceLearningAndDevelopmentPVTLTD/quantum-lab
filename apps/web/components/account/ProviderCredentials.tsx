'use client'

/**
 * ProviderCredentials — BYOK: attach your own quantum hardware account.
 *
 * ── What this panel is actually asking for ──────────────────────────────────
 *
 * A vendor credential is not a preference. It is the ability to spend the
 * holder's allowance and to see every job run under it. A UI that collects one
 * behind a placeholder that says "optional" has mis-stated what it is doing.
 *
 * So this panel is built around the disclosure rather than around the input:
 *
 *   · it says what is stored and that the secret half is encrypted;
 *   · it says which fields are NOT secret and are shown back in full, because
 *     somebody who pastes an AWS access key id deserves to know it is stored
 *     in the clear rather than discover it later;
 *   · it says the secret is never shown again;
 *   · it says jobs will appear in the user's OWN console and bill their own
 *     account;
 *   · it says removing it here is NOT revocation, and where the real
 *     revocation lives — which differs per vendor;
 *   · and it says what happens if the platform's encryption key is rotated,
 *     because the failure is otherwise invisible.
 *
 * ── And it tells you how to get one ─────────────────────────────────────────
 *
 * The instructions are in the panel, not behind a documentation link, and they
 * are per-provider because the three errands are nothing alike: IBM is a
 * two-minute copy of a token from a dashboard, AWS is an IAM user plus an S3
 * bucket, and Azure needs an app registration and a role assignment. Telling
 * somebody "add your Azure credentials" without saying that is how you get a
 * support ticket instead of a credential.
 *
 * ── Provider-agnostic rendering ─────────────────────────────────────────────
 *
 * The FIELDS are not hardcoded here. `/api/credentials` serves the catalogue
 * from `PROVIDER_FIELDS`, so a vendor added on the server appears here with
 * its inputs, its secret/plain treatment and its help text, with no edit to
 * this file. Only the prose — the errand instructions and the revocation
 * pointer — is per-provider in this component, because prose is the one thing
 * a field table cannot carry.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { useSession } from '@/components/auth/useSession'

/** Mirrors `CredentialField` in lib/security/providerCredentials.ts. */
interface FieldSpec {
  name: string
  label: string
  secret: boolean
  required: boolean
  placeholder?: string
  help?: string
}

interface ProviderOption {
  id: string
  label: string
  fields: FieldSpec[]
}

/** Mirrors `ProviderCredentialRecord`. Never carries a secret. */
interface CredentialRecord {
  provider: string
  hint: string
  publicConfig: Record<string, string>
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  readable: boolean
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; credentials: CredentialRecord[]; providers: ProviderOption[] }
  | { kind: 'signed-out' }
  | { kind: 'unavailable'; message: string }

/** Where each credential comes from, and where it is really revoked. */
const CONSOLE: Record<string, { url: string; name: string; revokeAt: string }> = {
  ibm: { url: 'https://quantum.ibm.com', name: 'quantum.ibm.com', revokeAt: 'your IBM Quantum dashboard' },
  braket: {
    url: 'https://console.aws.amazon.com/iam/',
    name: 'the AWS IAM console',
    revokeAt: 'AWS IAM → your user → Security credentials',
  },
  azure: {
    url: 'https://portal.azure.com',
    name: 'the Azure portal',
    revokeAt: 'Azure portal → App registrations → your app → Certificates & secrets',
  },
}

/** The per-provider errand, written out. */
const HOW_TO: Record<string, { minutes: string; cost: string; steps: string[] }> = {
  ibm: {
    minutes: 'about two minutes',
    cost: 'Free — the Open plan needs no card.',
    steps: [
      'Sign in at quantum.ibm.com, or create an account. The Open plan is free and gives you a monthly allowance on IBM’s real 127-qubit machines.',
      'On the dashboard, find "API token" and copy it.',
      'Paste it below and save.',
      'Only if your account has more than one instance: copy that instance’s CRN from the instances list into the second field. An Open-plan account has one, so leave it empty.',
    ],
  },
  braket: {
    minutes: 'about ten minutes',
    cost: 'Paid per shot plus a task fee. There is no free tier — a run costs real money from the first shot.',
    steps: [
      'In AWS IAM, create a user (or role) and attach the AmazonBraketFullAccess policy.',
      'Create an access key for it. You get an access key ID and a secret access key; the secret is shown once.',
      'Create an S3 bucket in the same account. Braket writes every result there and refuses a task without one — it must be a bucket you own, because our bucket is not writable by your keys.',
      'Pick the region your device lives in: IonQ is us-east-1, Rigetti is us-west-1.',
      'Paste all four below. If you can, use temporary STS credentials instead of a permanent key — they expire on their own.',
    ],
  },
  azure: {
    minutes: 'the longest of the three — budget half an hour the first time',
    cost: 'Paid. Quantinuum bills in H-System Credits, which cannot be converted to dollars, so nothing here can price it for you.',
    steps: [
      'In the Azure portal, open your Quantum Workspace and copy its resource ID (Properties) and region.',
      'Register an application: Microsoft Entra ID → App registrations → New registration. Copy the Directory (tenant) ID and Application (client) ID.',
      'Under Certificates & secrets, create a client secret and copy its value. It is shown once.',
      'Give that app access to the workspace: Workspace → Access control (IAM) → Add role assignment → Contributor → your app.',
      'Paste all five below. Without the role assignment in step 4 the credential authenticates and then cannot see the workspace.',
    ],
  },
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

export function ProviderCredentials() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [selected, setSelected] = useState<string>('ibm')
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await authFetch('/api/credentials')
      if (response.status === 401) {
        setState({ kind: 'signed-out' })
        return
      }
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const detail =
          body && typeof body === 'object' && 'detail' in body
            ? String((body as { detail: unknown }).detail)
            : 'Saved provider credentials are unavailable on this deployment.'
        setState({ kind: 'unavailable', message: detail })
        return
      }
      const parsed = body as {
        configured?: boolean
        reason?: string
        credentials?: CredentialRecord[]
        providers?: ProviderOption[]
      } | null
      if (parsed?.configured === false) {
        // Not an error state. A deployment that cannot store credentials is a
        // perfectly working deployment; it just runs everything on its own.
        setState({
          kind: 'unavailable',
          message: parsed.reason ?? 'Not available on this deployment.',
        })
        return
      }
      setState({
        kind: 'ready',
        credentials: Array.isArray(parsed?.credentials) ? parsed.credentials : [],
        providers: Array.isArray(parsed?.providers) ? parsed.providers : [],
      })
    } catch {
      setState({ kind: 'unavailable', message: 'Your saved credentials could not be loaded.' })
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

  const providers = state.kind === 'ready' ? state.providers : []
  const active = useMemo(
    () => providers.find((p) => p.id === selected) ?? providers[0],
    [providers, selected]
  )
  const stored = state.kind === 'ready' ? state.credentials : []

  const save = useCallback(async () => {
    if (!active) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await authFetch('/api/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: active.id, fields: values }),
      })
      const body: unknown = await response.json().catch(() => null)
      const record = (body ?? {}) as Record<string, unknown>
      if (!response.ok) {
        setError(String(record.detail ?? record.error ?? 'The credential could not be saved.'))
        return
      }
      // Cleared immediately on success. There is no reason for a live vendor
      // secret to sit in a form field (or in React state, or in the DOM) one
      // moment longer than the request that carried it.
      setValues({})
      setNotice(typeof record.notice === 'string' ? record.notice : 'Saved.')
      await load()
    } catch {
      setError('The credential could not be saved.')
    } finally {
      setSaving(false)
    }
  }, [active, values, load])

  const remove = useCallback(
    async (provider: string) => {
      setError(null)
      setNotice(null)
      try {
        const response = await authFetch(
          `/api/credentials?provider=${encodeURIComponent(provider)}`,
          { method: 'DELETE' }
        )
        const body: unknown = await response.json().catch(() => null)
        const record = (body ?? {}) as Record<string, unknown>
        if (!response.ok) {
          setError(String(record.detail ?? record.error ?? 'The credential could not be removed.'))
          return
        }
        setNotice(typeof record.notice === 'string' ? record.notice : 'Removed.')
        await load()
      } catch {
        setError('The credential could not be removed.')
      }
    },
    [load]
  )

  // Same rule as the API keys panel: a credential is account-scoped and there
  // is nothing useful to say about one to a visitor with no account.
  if (state.kind === 'signed-out' || (configured && !sessionLoading && !userId)) return null

  const activeId = active?.id ?? 'ibm'
  const console_ = CONSOLE[activeId] ?? CONSOLE.ibm
  const howTo = HOW_TO[activeId] ?? HOW_TO.ibm
  const existing = stored.find((c) => c.provider === activeId)

  return (
    <section className="card mt-4 p-5" aria-labelledby="byok-heading">
      <h2 id="byok-heading" className="text-[13px] font-semibold text-ink-secondary">
        Run on your own hardware account
      </h2>
      <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-secondary">
        Add your own IBM Quantum, Amazon Braket or Azure Quantum credentials and your hardware
        jobs run on <em>your</em> account instead of ours. They stop counting against your monthly
        allowance here, they queue under your own plan, and they appear in your own vendor console
        beside everything else you run.
      </p>

      {state.kind === 'unavailable' ? (
        <p className="mt-3 text-[12px] leading-relaxed text-q-amber-text">{state.message}</p>
      ) : null}

      {/* ── Which vendor ──────────────────────────────────────────────────── */}
      {providers.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Hardware provider">
          {providers.map((provider) => {
            const attached = stored.some((c) => c.provider === provider.id)
            const isActive = provider.id === activeId
            return (
              <button
                key={provider.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setSelected(provider.id)
                  // Values are per-provider; carrying a half-typed AWS key over
                  // to the Azure form would be nonsense at best.
                  setValues({})
                  setError(null)
                  setNotice(null)
                }}
                className={`focus-ring rounded-lg border px-3 py-1.5 text-[12px] ${
                  isActive
                    ? 'border-q-teal/50 bg-surface-2 font-semibold text-ink'
                    : 'border-line text-ink-secondary'
                }`}
              >
                {provider.label}
                {attached ? <span className="ml-1.5 text-q-teal-text">•</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {/* ── How to get one, per vendor. In the panel, not behind a link. ─── */}
      <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
        <button
          type="button"
          className="focus-ring text-[12px] font-semibold text-ink underline underline-offset-2"
          aria-expanded={showHelp}
          aria-controls="byok-help"
          onClick={() => setShowHelp((open) => !open)}
        >
          {showHelp ? 'Hide' : `How do I get ${active?.label ?? 'IBM Quantum'} credentials?`}
        </button>

        <div id="byok-help" hidden={!showHelp}>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">
            Takes {howTo.minutes}. <strong>{howTo.cost}</strong>
          </p>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-[12px] leading-relaxed text-ink-secondary">
            {howTo.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
            Everything starts at{' '}
            <a
              href={console_.url}
              target="_blank"
              rel="noreferrer noopener"
              className="focus-ring underline underline-offset-2"
            >
              {console_.name}
            </a>
            . Queues belong to the vendor, not to us — the same queue whether you come through this
            site or theirs.
          </p>
        </div>
      </div>

      {/* ── What you are handing over. Said before the input, not after. ── */}
      <div className="mt-4 rounded-lg border border-hairline px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-secondary">
          Before you paste it
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[12px] leading-relaxed text-ink-secondary">
          <li>
            These credentials let whoever holds them spend your allowance at that vendor and see
            the jobs run with them. That is true of us as much as anyone.
          </li>
          <li>
            The <strong>secret</strong> fields are stored <strong>encrypted</strong>
            {' '}(AES-256-GCM) and decrypted server-side for exactly one call per job. They are
            never sent back to your browser, never shown again, and never written to a log.
          </li>
          <li>
            The fields marked as identifiers — an AWS access key ID, an Azure tenant or client ID,
            an IBM CRN — are <strong>stored in the clear</strong> and shown back to you in full, so
            you can tell which account is attached. They authorise nothing on their own.
          </li>
          <li>
            Jobs run this way bill <strong>your</strong> account and appear in{' '}
            <strong>your</strong> console.
          </li>
          <li>
            <strong>Removing it here is not revocation.</strong> It stops us using it; the
            credential stays valid at the vendor. To truly kill it, delete it at{' '}
            <strong>{console_.revokeAt}</strong>. Do that first if you think it has leaked.
          </li>
        </ul>
      </div>

      {notice ? (
        <p className="mt-3 text-[12px] leading-relaxed text-q-teal-text" role="status">
          {notice}
        </p>
      ) : null}

      {/* ── The stored credential for this vendor ─────────────────────────── */}
      {existing ? (
        <div className="mt-4 rounded-lg border border-line px-3 py-2">
          <p className="text-[13px] font-semibold text-ink">
            {active?.label}
            <span className="ml-2 font-mono text-[11px] font-normal text-ink-muted">
              {existing.hint}
            </span>
          </p>
          {Object.keys(existing.publicConfig).length > 0 ? (
            <dl className="mt-1 space-y-0.5">
              {Object.entries(existing.publicConfig).map(([key, value]) => (
                <div key={key} className="flex flex-wrap gap-2 text-[11px] text-ink-muted">
                  <dt className="font-medium">{key}</dt>
                  <dd className="break-all font-mono">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="text-[11px] text-ink-muted">
            added {formatDate(existing.createdAt)} · last used {formatDate(existing.lastUsedAt)}
          </p>
          {existing.readable ? null : (
            <p className="mt-2 text-[12px] leading-relaxed text-q-amber-text">
              This credential can no longer be decrypted — the encryption key on this deployment
              has changed since you saved it. Your jobs are running on the platform&rsquo;s own
              credentials and allowance again. Enter it below to fix it.
            </p>
          )}
          <button
            type="button"
            onClick={() => void remove(activeId)}
            className="focus-ring mt-2 text-[11px] text-ink-muted hover:text-q-rose-text"
          >
            Remove from this site
          </button>
        </div>
      ) : null}

      {/* ── The form, generated from the server's field catalogue ─────────── */}
      {state.kind === 'ready' && active ? (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
          <p className="text-[12px] font-semibold text-ink">
            {existing ? `Replace your ${active.label} credentials` : `${active.label} credentials`}
          </p>

          {active.fields.map((field) => {
            const id = `byok-${active.id}-${field.name}`
            return (
              <div key={field.name} className="mt-3">
                <label htmlFor={id} className="block text-[12px] font-semibold text-ink">
                  {field.label}
                  {field.required ? null : (
                    <span className="font-normal text-ink-muted"> — optional</span>
                  )}
                  {field.secret ? (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-q-teal-text">
                      encrypted
                    </span>
                  ) : null}
                </label>
                <input
                  id={id}
                  // `password` for secrets keeps the value out of shoulder-view
                  // and out of a screen share, and asks the browser not to
                  // treat a live vendor credential as an ordinary autofillable
                  // string. Identifiers stay readable: hiding a value that is
                  // stored in the clear would imply a protection it does not
                  // have.
                  type={field.secret ? 'password' : 'text'}
                  autoComplete="off"
                  spellCheck={false}
                  value={values[field.name] ?? ''}
                  maxLength={4096}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                  placeholder={field.placeholder ?? ''}
                  className="focus-ring mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 font-mono text-[12px] text-ink"
                />
                {field.help ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{field.help}</p>
                ) : null}
              </div>
            )
          })}

          <button
            type="button"
            onClick={() => void save()}
            disabled={
              saving ||
              // Enabled only once every REQUIRED field has something in it, so
              // the failure mode is a disabled button rather than a round trip
              // that comes back naming a field the user has not reached yet.
              !active.fields
                .filter((f) => f.required)
                .every((f) => (values[f.name] ?? '').trim().length > 0)
            }
            className="btn-primary focus-ring mt-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : existing ? 'Replace credentials' : 'Save credentials'}
          </button>

          {error ? (
            <p className="mt-2 text-[12px] leading-relaxed text-q-rose-text">{error}</p>
          ) : null}
        </div>
      ) : null}

      {state.kind === 'ready' && stored.length === 0 ? (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          Nothing saved. Hardware jobs run on this platform&rsquo;s credentials and count against
          your monthly allowance — which is the right default, and free until 2027-01-01.
        </p>
      ) : null}
    </section>
  )
}
