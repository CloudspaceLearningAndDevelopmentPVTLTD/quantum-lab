'use client'

/**
 * /compete — the weekly gate-golf competition page.
 *
 * Everything shown here comes from GET /api/compete: the puzzle is derived
 * server-side from the ISO week, the deadline is the SERVER'S timestamp, and
 * the leaderboard is the store's answer, so this page never has an opinion of
 * its own about who is winning or when the week ends.
 *
 * The countdown is anchored to `serverNow`: the drift between the server clock
 * and this device is measured once at fetch time and applied to every tick, so
 * a laptop whose clock is ten minutes fast still shows the real deadline. The
 * copy is a plain date and a remaining time — the deadline is a fact, not a
 * sales device, and it gets no pulsing, no red, no "hurry".
 *
 * Entries travel as OpenQASM, the same text the simulator's export produces
 * and the same format the share links carry. The flow is: build in the
 * simulator → copy the QASM (or the share link's payload) → paste here. When
 * the player already has an entry, their own best circuit links back into the
 * simulator via the existing share-link format — their circuit only; nobody
 * else's QASM ever reaches this page (see the route's trust-boundary note).
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { buildShareUrl } from '@/lib/share-link'
import { formatKet, fromQasm } from '@/lib/quantum'

interface CompetitionDto {
  id: string
  weekKey: string
  startsAt: string
  endsAt: string
  par: number
  title: string
  brief: string
  numQubits: number
  targetProbabilities?: number[]
  tolerance?: number
}

interface LeaderboardRowDto {
  rank: number
  displayName: string
  gates: number
  submittedAt: string
}

interface YouDto {
  displayName: string
  gates: number
  submittedAt: string
  rank: number | null
  qasm: string
}

interface CompeteDto {
  competition: CompetitionDto
  serverNow: string
  durable: boolean
  leaderboard: LeaderboardRowDto[]
  you: YouDto | null
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'closing now — the next puzzle starts immediately'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${String(sec).padStart(2, '0')}s`
  return `${m}m ${String(sec).padStart(2, '0')}s`
}

export default function CompetePage() {
  const [data, setData] = useState<CompeteDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** serverNow − Date.now() at fetch time; applied to every countdown tick. */
  const [clockOffset, setClockOffset] = useState(0)
  const [nowTick, setNowTick] = useState(() => Date.now())

  const [qasm, setQasm] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitNote, setSubmitNote] = useState<{ ok: boolean; text: string } | null>(null)
  /** True right after a share falls back to the clipboard — see `share` below. */
  const [shareCopied, setShareCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/compete', { cache: 'no-store' })
      const body: unknown = await res.json()
      if (!res.ok) {
        const msg =
          typeof (body as { error?: unknown }).error === 'string'
            ? ((body as { error: string }).error)
            : 'The competition could not be loaded.'
        setLoadError(msg)
        return
      }
      const dto = body as CompeteDto
      setData(dto)
      setClockOffset(new Date(dto.serverNow).getTime() - Date.now())
      if (dto.you) setDisplayName(dto.you.displayName)
      setLoadError(null)
    } catch {
      setLoadError('The competition could not be loaded. Check your connection and reload.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const remainingMs = data
    ? new Date(data.competition.endsAt).getTime() - (nowTick + clockOffset)
    : 0

  /** The player's own best circuit as a simulator permalink, or null. */
  const yourCircuitUrl = useMemo(() => {
    if (!data?.you?.qasm) return null
    const circuit = fromQasm(data.you.qasm)
    return circuit.ops.length ? buildShareUrl(circuit) : null
  }, [data?.you?.qasm])

  /**
   * The player's own result, stated plainly — a rank and a gate count are
   * already the honest pitch, so there is nothing to dress up here the way
   * "hype" copy would.
   */
  const shareText = useMemo(() => {
    if (!data?.you) return null
    const rank = data.you.rank ? `rank ${data.you.rank}, ` : ''
    return `I solved this week's gate golf in ${data.you.gates} gates (${rank}qubit16.ai/compete).`
  }, [data?.you])

  /**
   * Web Share API first — it hands the OS the same text a paste would, and on
   * a phone that is a share sheet instead of a manual copy. `navigator.share`
   * is unavailable on desktop Safari/Firefox and can also throw when the user
   * just cancels the sheet, so either path falls back to the clipboard
   * silently rather than surfacing a cancel as an error.
   */
  const share = useCallback(async () => {
    if (!shareText) return
    const url = `${window.location.origin}/compete`
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: shareText, url })
        return
      } catch {
        // Cancelled, or unsupported despite the feature check — fall through.
      }
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${url}`)
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 1500)
    } catch {
      // Clipboard unavailable — nothing more to do without a paid dependency.
    }
  }, [shareText])

  const submit = useCallback(async () => {
    if (!qasm.trim() || submitting) return
    setSubmitting(true)
    setSubmitNote(null)
    try {
      const res = await authFetch('/api/compete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qasm, displayName: displayName || undefined }),
      })
      const body: unknown = await res.json()
      if (!res.ok) {
        const msg =
          typeof (body as { error?: unknown }).error === 'string'
            ? ((body as { error: string }).error)
            : 'The entry was not accepted.'
        setSubmitNote({
          ok: false,
          text: res.status === 401 ? 'Sign in to enter the competition — use Sign in at the top of the page, and you will come straight back here.' : msg,
        })
        return
      }
      const result = body as { improved: boolean; gates: number }
      setSubmitNote({
        ok: true,
        text: result.improved
          ? `Recorded: ${result.gates} gates by the server's count.`
          : `Solved in ${result.gates} gates — your existing entry is at least as good, so it stands.`,
      })
      setQasm('')
      await load()
    } catch {
      setSubmitNote({ ok: false, text: 'The entry could not be sent. Try again in a moment.' })
    } finally {
      setSubmitting(false)
    }
  }, [qasm, displayName, submitting, load])

  if (loadError) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-2xl font-bold text-ink">Weekly gate golf</h1>
        <p className="mt-4 rounded-card border border-line bg-surface p-4 text-sm text-ink-secondary">
          {loadError}
        </p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-2xl font-bold text-ink">Weekly gate golf</h1>
        <p className="mt-4 text-sm text-ink-secondary" aria-live="polite">
          Loading this week&apos;s puzzle…
        </p>
      </div>
    )
  }

  const { competition, leaderboard, you, durable } = data
  const target = competition.targetProbabilities ?? []
  const shownStates = target
    .map((p, i) => ({ i, p }))
    .filter(({ p }) => p > 0.0005)

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-[11px] font-bold uppercase tracking-wider text-q-violet-text">
        Community · resets Mondays 00:00 UTC
      </p>
      <h1 className="mt-1 text-2xl font-bold text-ink">{competition.title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-secondary">{competition.brief}</p>

      <p className="mt-3 text-sm text-ink-secondary">
        Closes{' '}
        <time dateTime={competition.endsAt} className="font-semibold text-ink">
          {new Date(competition.endsAt).toUTCString().replace(':00 GMT', ' UTC')}
        </time>{' '}
        — <span aria-live="off">{formatRemaining(remainingMs)}</span> remaining.
      </p>

      {!durable ? (
        <p className="mt-3 rounded-card border border-line bg-surface-2 p-3 text-[13px] text-ink-secondary">
          This deployment has no database configured, so the leaderboard lives in server memory
          and resets on redeploy. Scores are still graded server-side.
        </p>
      ) : null}

      {/* ── The target ── */}
      <section className="mt-8 rounded-card border border-line bg-surface p-5">
        <h2 className="text-base font-bold text-ink">The target</h2>
        <p className="mt-1 text-[13px] text-ink-secondary">
          {competition.numQubits} qubits, par {competition.par}. Reach this distribution (each bar
          within ±{Math.round((competition.tolerance ?? 0.02) * 100)}%); every basis state not
          listed must stay at zero.
        </p>
        <ul className="mt-3 space-y-1.5">
          {shownStates.map(({ i, p }) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 font-mono text-ink">
                {formatKet(i, competition.numQubits)}
              </span>
              <span
                className="h-3 rounded-sm bg-q-violet/60"
                style={{ width: `${Math.max(2, p * 240)}px` }}
                aria-hidden
              />
              <span className="text-ink-secondary">{(p * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/simulator" className="btn-primary focus-ring">
            Build it in the simulator
          </Link>
          {yourCircuitUrl ? (
            <a href={yourCircuitUrl} className="focus-ring rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2">
              Reopen your best circuit
            </a>
          ) : null}
        </div>
      </section>

      {/* ── Submit ── */}
      <section className="mt-6 rounded-card border border-line bg-surface p-5">
        <h2 className="text-base font-bold text-ink">Enter</h2>
        <p className="mt-1 text-[13px] text-ink-secondary">
          Export your circuit from the simulator as OpenQASM and paste it below. The server
          re-runs it through the grader and counts the gates itself — only your best entry for the
          week is kept. Signing in is required so your entry has a single row on the board.
        </p>
        <label className="mt-3 block text-[13px] font-semibold text-ink" htmlFor="compete-name">
          Display name (public, on the leaderboard)
        </label>
        <input
          id="compete-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={40}
          className="focus-ring mt-1 w-full max-w-sm rounded-lg border border-line-strong bg-bg px-3 py-2 text-sm text-ink"
          placeholder="How you appear on the board"
        />
        <label className="mt-3 block text-[13px] font-semibold text-ink" htmlFor="compete-qasm">
          Your circuit, as OpenQASM
        </label>
        <textarea
          id="compete-qasm"
          value={qasm}
          onChange={(e) => setQasm(e.target.value)}
          rows={8}
          spellCheck={false}
          className="focus-ring mt-1 w-full rounded-lg border border-line-strong bg-bg px-3 py-2 font-mono text-[13px] text-ink"
          placeholder={'OPENQASM 3.0;\ninclude "stdgates.inc";\n…'}
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !qasm.trim()}
            className="btn-primary focus-ring disabled:opacity-50"
          >
            {submitting ? 'Grading…' : 'Submit entry'}
          </button>
          {submitNote ? (
            <p
              role="status"
              className={`text-[13px] ${submitNote.ok ? 'text-ink' : 'text-ink-secondary'}`}
            >
              {submitNote.text}
            </p>
          ) : null}
        </div>
      </section>

      {/* ── Leaderboard ── */}
      <section className="mt-6 rounded-card border border-line bg-surface p-5">
        <h2 className="text-base font-bold text-ink">Leaderboard — top {Math.max(leaderboard.length, 20)}</h2>
        {you ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-[13px] text-ink-secondary">
              You: <span className="font-semibold text-ink">{you.gates} gates</span>
              {you.rank ? ` — rank ${you.rank}` : ''} as {you.displayName}.
            </p>
            <button type="button" onClick={() => void share()} className="btn-ghost focus-ring !px-2.5 !py-1 !text-xs">
              Share
            </button>
            {shareCopied ? (
              <span className="text-[11px] text-ink-muted" role="status">
                Copied — paste it anywhere.
              </span>
            ) : null}
          </div>
        ) : (
          <p className="mt-1 text-[13px] text-ink-secondary">
            No entry from you this week yet.
          </p>
        )}
        {leaderboard.length === 0 ? (
          <p className="mt-3 text-sm text-ink-secondary">
            Nobody has entered this week&apos;s puzzle yet. The first valid circuit takes first
            place.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="py-1.5 pr-3">#</th>
                  <th scope="col" className="py-1.5 pr-3">Player</th>
                  <th scope="col" className="py-1.5 pr-3">Gates</th>
                  <th scope="col" className="py-1.5">Submitted (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row) => (
                  <tr key={`${row.rank}-${row.displayName}`} className="border-b border-line last:border-b-0">
                    <td className="py-1.5 pr-3 font-mono text-ink-secondary">{row.rank}</td>
                    <td className="py-1.5 pr-3 font-semibold text-ink">{row.displayName}</td>
                    <td className="py-1.5 pr-3 font-mono text-ink">{row.gates}</td>
                    <td className="py-1.5 text-ink-secondary">
                      {new Date(row.submittedAt).toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[12px] text-ink-muted">
          Ranked by gate count, ties by earliest submission. Every score is the server&apos;s own
          recount of the submitted circuit.
        </p>
      </section>
    </div>
  )
}
