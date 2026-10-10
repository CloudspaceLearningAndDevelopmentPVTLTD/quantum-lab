/**
 * sessionStore.ts — ownership records for IBM Runtime sessions.
 *
 * SERVER ONLY. Never import this from a client component: it reads the
 * service-role key.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * `DELETE /api/hardware/session/{id}` could not check ownership, because a
 * session was not recorded anywhere on our side. A session id is opaque and is
 * only ever returned to the account that opened it, so the exposure was narrow
 * — somebody holding one could close it early, an annoyance rather than a
 * disclosure — but it was real, and docs/COMPETITIVE-GAPS.md §3.4 names it.
 * (Nothing here measures how guessable an IBM session id is; "narrow" rests on
 * it not being handed out, not on an entropy claim we cannot support.)
 * `public.runtime_sessions` (supabase/schema-sessions.sql) is the record; this
 * module is the only thing that reads or writes it.
 *
 * ── The failure discipline, which is NOT uniform here ───────────────────────
 *
 * `lib/billing/usage.ts` fails closed everywhere, because every function in it
 * guards a billable submission and "the store did not answer" must never
 * authorise spend. This module cannot copy that rule wholesale, because its two
 * halves guard opposite directions of the same meter:
 *
 *   OPENING a session spends money. Recording one does not.
 *   CLOSING a session STOPS money. Refusing to close does not.
 *
 * So:
 *
 *   `ownsRuntimeSession`  THROWS `SessionStoreError` when the store cannot
 *                         answer. It is a security predicate, and a `false`
 *                         that means "the database is down" and a `false` that
 *                         means "this is not your session" are the same value
 *                         and opposite decisions — the same argument
 *                         `ownsHardwareJob` makes. A caller must NEVER catch
 *                         this and read it as "not yours".
 *
 *   `authorizeSessionClose`  NEVER throws. It is the one place in this module
 *                         where an outage is deliberately converted into
 *                         "proceed", and the whole reasoning is written out
 *                         above that function. Read it before changing it.
 *
 *   `recordRuntimeSession`   NEVER throws. By the time it runs, IBM has already
 *                         opened the session and the caller is owed its id. A
 *                         failed INSERT costs us the ownership record, not the
 *                         session — turning it into a 500 would leave the user
 *                         holding a reserved device whose id we refused to
 *                         hand them, which is strictly worse. Logged loudly.
 *
 *   `markRuntimeSessionClosed`  NEVER throws, for the same reason
 *                         `recordHardwareJob` does not: the close has already
 *                         happened at the vendor by the time we get here.
 *
 * ── The assumption the whole table rests on, and where it breaks ────────────
 *
 * `session_id` is the primary key, so this module assumes a session id names
 * exactly one session and therefore exactly one owner. That assumption is NOT
 * guaranteed by the vendor. `qiskit_ibm_runtime.Session.session_id` is
 * `str | None` — it is None for a simulator backend and for the local service —
 * and `services/api/app/quantum/hardware.py` stringifies it unconditionally, so
 * the id that reaches us can be the literal text `"None"`. Every account that
 * opened such a session would be claiming the SAME primary key: the first write
 * wins, and every other owner's close would then be positively identified as
 * `other-owner` and REFUSED. That is the one outcome this module's close policy
 * exists to avoid, so `isUsableSessionId` rejects those ids outright — they are
 * never recorded and never looked up, which puts them on the `unrecorded`
 * (allowed, logged) branch instead. The real fix is upstream: hardware.py
 * should refuse to report a session it did not get an id for. Until it does,
 * this is a guard, not a solution.
 *
 * ── What the row does and does not mean ─────────────────────────────────────
 *
 * `closedAt` is when WE asked IBM to close, not when IBM's meter stopped, and
 * nothing reaps sessions that expired at the vendor. So a row with
 * `closedAt === null` means "we never closed it", NOT "it is open". Do not
 * build a live-session display on it without saying which of the two it shows.
 * The schema header says the same thing at more length.
 *
 * ── No caching, on purpose ──────────────────────────────────────────────────
 *
 * Nothing is memoised in this process. A session may be opened by one instance
 * and closed by another, so a per-process map would answer "not yours" to a
 * legitimate owner who happened to land elsewhere — and under this module's
 * close policy that is the one answer that actually refuses. Postgres is the
 * only record.
 */

import { getServiceSupabase, isServiceRoleConfigured } from '@/lib/billing/entitlements'
import { isSupabaseConfigured } from '@/lib/supabase'

/**
 * The session store could not answer.
 *
 * Distinguished from "no such session" on purpose. Catching this and
 * continuing as though the answer were `false` is precisely the bug this class
 * exists to make impossible to write by accident.
 */
export class SessionStoreError extends Error {
  constructor(readonly why: string) {
    super('Session ownership cannot be verified right now.')
    this.name = 'SessionStoreError'
  }
}

/** One `runtime_sessions` row, in the shape this module hands out. */
export interface RuntimeSessionRecord {
  /** The vendor's session id. Primary key. */
  sessionId: string
  /** Supabase auth.users id of the account that opened it. */
  userId: string
  /** The device that was reserved. */
  backend: string
  /**
   * The window we REQUESTED, in seconds, or null when we do not know it.
   *
   * IBM may have granted less and never tells us what it granted, so even a
   * number here is a stated intent, not a measurement. Null is a real value:
   * it is what gets written when the requested window was out of the schema's
   * range or was not a finite number, because losing the OWNERSHIP row over a
   * documentation-only column would be the expensive mistake (see
   * `normaliseMaxTime`). Do not substitute a default for it — a made-up 3600
   * would be indistinguishable from a real one.
   */
  maxTimeSeconds: number | null
  /** When we recorded the open (shortly after IBM opened it). */
  openedAt: string
  /** When we asked IBM to close, or null if we never did. Not "still open". */
  closedAt: string | null
}

/**
 * The privileged client, or a `SessionStoreError` explaining why there is not
 * one.
 *
 * Deliberately throws rather than returning null: every read path in this
 * module must fail closed, and the one path that is allowed to proceed without
 * an answer (`authorizeSessionClose`) catches this explicitly and says so.
 *
 * @returns The service-role Supabase client.
 * @throws SessionStoreError If Supabase or the service-role key is not
 *   configured, or the client could not be constructed.
 */
function sessionClient() {
  if (!isSupabaseConfigured) {
    throw new SessionStoreError('Supabase is not configured, so sessions cannot be recorded.')
  }
  if (!isServiceRoleConfigured) {
    throw new SessionStoreError(
      'SUPABASE_SERVICE_ROLE_KEY is not set, so runtime_sessions cannot be read or written ' +
        '(RLS denies it to users).'
    )
  }
  const supabase = getServiceSupabase()
  if (!supabase) {
    throw new SessionStoreError('The service-role Supabase client could not be constructed.')
  }
  return supabase
}

/**
 * Ids that are not usable as an ownership key, whatever the vendor called them.
 *
 * `str(None)` in Python is `"None"`, and that is what
 * `services/api/app/quantum/hardware.py` sends when
 * `Session.session_id` is None (a simulator backend, or the local runtime
 * service). `"null"` and `"undefined"` are the same mistake made in JavaScript.
 * None of the three identifies a session, and all three would be recorded as a
 * primary key shared by every account that hit the same path — see the module
 * header for why that is worse than having no record at all.
 */
const NOT_AN_ID = new Set(['none', 'null', 'undefined'])

/**
 * Is this string usable as the primary key of an ownership record?
 *
 * This is NOT a validation of the vendor's id format — the route already bounds
 * the shape, and we deliberately do not assume anything about IBM's id space.
 * It rejects only the placeholder strings that provably do not identify a
 * session.
 *
 * @param sessionId The candidate id.
 * @returns True if the id may be recorded or looked up.
 */
function isUsableSessionId(sessionId: string): boolean {
  return sessionId.length > 0 && !NOT_AN_ID.has(sessionId.toLowerCase())
}

/**
 * Coerce a requested session window into something the column will accept.
 *
 * The schema bounds `max_time_seconds` to [60, 28800], matching the route and
 * the upstream. A value outside that — or NaN, which is what
 * `Math.trunc(undefined)` produces — would be REJECTED BY THE CHECK CONSTRAINT,
 * and a rejected INSERT costs the whole ownership row, which silently reopens
 * §3.4 for that session. So an unusable window is written as null rather than
 * allowed to take the row down with it.
 *
 * REJECTED: clamping into range instead. It keeps the row too, but it writes a
 * number nobody asked for into a column documented as "what we requested", and
 * an operator reconciling a surprise invoice would read 28800 as a request that
 * was made. A null that says "we do not know" is the honest version of the same
 * rescue.
 *
 * @param maxTimeSeconds The window the caller says was requested, in seconds.
 * @param sessionId The session, for the log line only.
 * @returns The integer seconds, or null if it cannot be stored honestly.
 */
function normaliseMaxTime(maxTimeSeconds: number, sessionId: string): number | null {
  const whole = Math.trunc(maxTimeSeconds)
  if (!Number.isFinite(whole) || whole < 60 || whole > 28_800) {
    console.error(
      `[hardware/sessionStore] session ${sessionId} was reported with an unstorable ` +
        `max_time_seconds (${String(maxTimeSeconds)}); recording the ownership row with a null ` +
        'window rather than losing the row to a check-constraint failure.'
    )
    return null
  }
  return whole
}

/**
 * Record a session IBM has already opened.
 *
 * Call this AFTER the upstream returns a session id, never before: a row
 * written speculatively for a session that failed to open is an ownership
 * claim on an id that may later belong to somebody else.
 *
 * NEVER THROWS. The session exists and is billing by the time this runs, and
 * the caller is owed its id; a failed INSERT must not turn a successful open
 * into an error the user cannot act on. What it costs is the ownership record,
 * which downgrades the close path for this one session to its
 * unverified-but-allowed branch — that is logged, because it is the state in
 * which §3.4's original exposure is still present.
 *
 * @param userId The Supabase-verified account that opened the session.
 * @param sessionId The vendor's session id.
 * @param backend The device the session reserved.
 * @param maxTimeSeconds The window that was requested, in seconds.
 * @returns Whether the row was written. Callers may ignore it; the open
 *   succeeds either way. It is returned so a route can tell the user their
 *   session is not tracked, rather than only telling the log.
 */
export async function recordRuntimeSession(
  userId: string,
  sessionId: string,
  backend: string,
  maxTimeSeconds: number
): Promise<boolean> {
  if (!userId || !isUsableSessionId(sessionId)) {
    console.error(
      `[hardware/sessionStore] refusing to record a session with no owner or no usable id ` +
        `(owner=${userId ? 'set' : 'missing'}, id=${JSON.stringify(sessionId)}); the close path ` +
        'will treat it as unrecorded.'
    )
    return false
  }
  try {
    const supabase = sessionClient()
    const { error } = await supabase.from('runtime_sessions').insert({
      session_id: sessionId,
      user_id: userId,
      backend,
      max_time_seconds: normaliseMaxTime(maxTimeSeconds, sessionId),
    })
    if (error) {
      console.error(
        `[hardware/sessionStore] session ${sessionId} was opened on ${backend} for ${userId} ` +
          `but its ownership row could not be written (${error.message}); the close route will ` +
          'not be able to identify its owner.'
      )
      return false
    }
    return true
  } catch (err) {
    console.error(
      `[hardware/sessionStore] session ${sessionId} was opened on ${backend} for ${userId} ` +
        `but its ownership row could not be written (store unreachable): ${String(err)}`
    )
    return false
  }
}

/**
 * Look one session up by id, regardless of who owns it.
 *
 * Returns null ONLY when the store positively answered "no such row" — an
 * outage throws instead. That distinction is what lets `authorizeSessionClose`
 * treat an unrecorded session differently from an unreachable database.
 *
 * An id `isUsableSessionId` rejects also returns null WITHOUT a round trip: a
 * row under a placeholder key could only have been written by an older build,
 * and answering "owned by whoever wrote it first" from one would refuse a
 * legitimate owner. Null puts it on the allowed-and-logged branch instead.
 *
 * @param sessionId The vendor's session id.
 * @returns The row, or null if no session with that id is recorded.
 * @throws SessionStoreError If the store could not answer.
 */
export async function findRuntimeSession(
  sessionId: string
): Promise<RuntimeSessionRecord | null> {
  if (!isUsableSessionId(sessionId)) return null
  const supabase = sessionClient()
  try {
    const { data, error } = await supabase
      .from('runtime_sessions')
      .select('session_id, user_id, backend, max_time_seconds, opened_at, closed_at')
      .eq('session_id', sessionId)
      .limit(1)
    if (error) {
      throw new SessionStoreError(`runtime_sessions lookup was refused: ${error.message}`)
    }
    if (!Array.isArray(data) || data.length === 0) return null
    return toRuntimeSessionRecord(data[0])
  } catch (err) {
    if (err instanceof SessionStoreError) throw err
    throw new SessionStoreError(`runtime_sessions lookup threw: ${String(err)}`)
  }
}

/**
 * Did `userId` open this session?
 *
 * THROWS `SessionStoreError` when the store cannot answer. The caller must not
 * treat that as `false`: refusing to close a session leaves a QPU reserved and
 * billing, so a "no" that is really an outage costs the owner money. Routes
 * should call `authorizeSessionClose` instead of this, which encodes that
 * decision once; this function is exported for any future caller that genuinely
 * needs a strict answer (listing, auditing, or a future route that MODIFIES a
 * session rather than ending it, where failing closed is right).
 *
 * @param userId The Supabase-verified caller.
 * @param sessionId The vendor's session id.
 * @returns True only if a recorded session with that id belongs to `userId`.
 * @throws SessionStoreError If the store could not answer.
 */
export async function ownsRuntimeSession(userId: string, sessionId: string): Promise<boolean> {
  if (!userId) return false
  const record = await findRuntimeSession(sessionId)
  return record !== null && record.userId === userId
}

/** Why `authorizeSessionClose` decided what it decided. */
export type SessionCloseBasis =
  /** A recorded session, owned by this caller. The ordinary case. */
  | 'owner'
  /** The store answered, and the session belongs to a different account. */
  | 'other-owner'
  /** The store answered, and has no record of this session at all. */
  | 'unrecorded'
  /** The store could not answer. */
  | 'unverified'
  /**
   * No caller id or no session id reached this function. A programming error
   * rather than a user one — the route validates both before calling — and it
   * is its own basis so a log never reports it as an ownership conflict.
   */
  | 'malformed'

/** The close route's decision, with the reason it can log. */
export interface SessionCloseDecision {
  /** Whether the close should be forwarded upstream. */
  allow: boolean
  /** What the decision rests on. Never collapse this into `allow`. */
  basis: SessionCloseBasis
  /** Human-readable detail for the log. Empty for the ordinary case. */
  why: string
}

/**
 * Decide whether to forward a close for `sessionId` on behalf of `userId`.
 *
 * ── The decision, and why it is not "fail closed" ───────────────────────────
 *
 * Everywhere else on the hardware path, an unanswerable store means REFUSE:
 * `lib/billing/usage.ts` refuses a submission it cannot meter, and
 * `requireCaller` refuses an API key it cannot verify. Both of those refusals
 * prevent spending. This one would CAUSE it. A session holds a QPU and bills
 * for its window whether or not jobs are running, so refusing to close is not a
 * safe default — it is a decision to keep a device reserved, at the owner's
 * expense, because our database blinked. An outage on our side must not be able
 * to run up somebody's IBM invoice.
 *
 * Weigh that against what a wrong "allow" costs. The attack it admits is:
 * somebody who has obtained a vendor session id, which is only ever returned to
 * the account that opened it, closes it early. (Do not read the route's
 * 128-character bound as an entropy claim — that is the longest id we ACCEPT,
 * not how long IBM's are or how much randomness they carry. Nothing here
 * measures that, and the argument below does not depend on it.) They cannot
 * read its results, cannot submit into it, and cannot spend anything — jobs
 * already in the session drain rather than being cancelled. It is an annoyance,
 * and §3.4 has always said so.
 *
 * So the ONLY refusal here is a POSITIVE identification of a different owner:
 * the store answered, a row exists, and it names somebody else. That is the
 * case where we know we are being asked to close a stranger's session, and it
 * is the case §3.4 actually asks us to close. Everything else — store down, or
 * no row at all — is allowed and LOGGED, never silently.
 *
 * `unrecorded` is not a hypothetical branch: sessions opened before this table
 * existed have no row, and so do sessions whose `recordRuntimeSession` failed.
 * Refusing those would strand a live meter on the strength of our own missing
 * write, which is the worst possible reason to refuse.
 *
 * REJECTED: refusing on `unverified` and telling the user to close the session
 * from IBM's own console. It sounds rigorous and it is unworkable — most users
 * here have no IBM console of their own, since the platform submits under its
 * own credentials. The fallback would be no fallback.
 *
 * NEVER THROWS. A route cannot be left with no decision at all.
 *
 * @param userId The Supabase-verified caller.
 * @param sessionId The vendor's session id.
 * @returns The decision and the basis it rests on. Log the basis whenever it
 *   is not `'owner'`.
 */
export async function authorizeSessionClose(
  userId: string,
  sessionId: string
): Promise<SessionCloseDecision> {
  if (!userId || !sessionId) {
    return { allow: false, basis: 'malformed', why: 'no caller id or no session id' }
  }
  let record: RuntimeSessionRecord | null
  try {
    record = await findRuntimeSession(sessionId)
  } catch (err) {
    const why = err instanceof SessionStoreError ? err.why : String(err)
    return {
      allow: true,
      basis: 'unverified',
      why: `ownership could not be checked (${why}); allowed so the device is not left reserved`,
    }
  }
  if (!record) {
    return {
      allow: true,
      basis: 'unrecorded',
      why: 'no ownership row exists for this session (opened before it was recorded, or the record failed)',
    }
  }
  if (record.userId !== userId) {
    return { allow: false, basis: 'other-owner', why: 'the session belongs to another account' }
  }
  return { allow: true, basis: 'owner', why: '' }
}

/**
 * Stamp `closed_at` on a session we have just asked IBM to close.
 *
 * IDEMPOTENT: the update matches only rows whose `closed_at` is still null, so
 * closing twice leaves the FIRST close time in place and writes nothing the
 * second time. That ordering matters — the first close is the one that stopped
 * the meter, and overwriting it with a later retry would make the held-time
 * query in supabase/schema-sessions.sql report a window longer than the one
 * that was actually held.
 *
 * NOT scoped by user_id, deliberately. `session_id` is the primary key, so the
 * filter already identifies exactly one row, and the two allowed-but-unowned
 * branches of `authorizeSessionClose` (`unverified`, `unrecorded`) have no
 * owner to scope by — adding the filter would silently skip the stamp on
 * exactly the sessions whose records are already thinnest. Authorisation is
 * `authorizeSessionClose`'s job and this function must not be mistaken for a
 * second gate.
 *
 * CONCURRENT CLOSES are safe for the same reason, but by the database's rules
 * rather than this code's: under READ COMMITTED the second UPDATE blocks on the
 * first one's row lock, re-checks `closed_at is null` against the committed row
 * when it wakes, and skips it. There is no read-then-write window here to lose,
 * because the predicate is inside the UPDATE rather than in a prior SELECT.
 *
 * NEVER THROWS. The close has already happened at the vendor; failing to
 * record it costs an audit row, not money. It is logged.
 *
 * @param sessionId The vendor's session id.
 * @returns Nothing. Failures are logged, not raised.
 */
export async function markRuntimeSessionClosed(sessionId: string): Promise<void> {
  // Same guard as the write path: a placeholder id is not a key, and stamping
  // `closed_at` on whatever row happens to hold one would close a record this
  // close had nothing to do with.
  if (!isUsableSessionId(sessionId)) return
  try {
    const supabase = sessionClient()
    const { error } = await supabase
      .from('runtime_sessions')
      .update({ closed_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .is('closed_at', null)
    if (error) {
      console.error(
        `[hardware/sessionStore] session ${sessionId} was closed upstream but its row could not ` +
          `be stamped (${error.message}); it will keep reading as never-closed.`
      )
    }
  } catch (err) {
    console.error(
      `[hardware/sessionStore] session ${sessionId} was closed upstream but its row could not ` +
        `be stamped (store unreachable): ${String(err)}`
    )
  }
}

/**
 * One account's sessions, newest first.
 *
 * THROWS `SessionStoreError` rather than returning an empty list when the store
 * cannot answer, for the same reason `listHardwareJobs` does: an empty history
 * and an unreachable database look identical to a UI handed `[]`, and the
 * difference matters to somebody looking for a session they know they opened.
 *
 * @param userId The Supabase-verified caller.
 * @param limit How many rows at most.
 * @returns The rows, newest first.
 * @throws SessionStoreError If the store could not answer.
 */
export async function listRuntimeSessions(
  userId: string,
  limit = 50
): Promise<RuntimeSessionRecord[]> {
  if (!userId) return []
  const supabase = sessionClient()
  try {
    const { data, error } = await supabase
      .from('runtime_sessions')
      .select('session_id, user_id, backend, max_time_seconds, opened_at, closed_at')
      .eq('user_id', userId)
      .order('opened_at', { ascending: false })
      .limit(limit)
    if (error) {
      throw new SessionStoreError(`runtime_sessions listing was refused: ${error.message}`)
    }
    return (Array.isArray(data) ? data : []).map(toRuntimeSessionRecord)
  } catch (err) {
    if (err instanceof SessionStoreError) throw err
    throw new SessionStoreError(`runtime_sessions listing threw: ${String(err)}`)
  }
}

/**
 * Map one database row onto the wire shape.
 *
 * Defensive about types because PostgREST returns what the table holds, not
 * what this file expects: a row written by an older deployment may be missing a
 * column entirely, and `null` (or `''`) is the honest answer for those rather
 * than a crash on the close path.
 *
 * `maxTimeSeconds` maps a missing or unparseable value to NULL, not to 0. 0 is
 * outside the column's own [60, 28800] range, so it could only ever mean "we do
 * not know" — and a number that means "unknown" is exactly the kind of value
 * that gets summed into an operator's report as though it were measured.
 *
 * @param row A `runtime_sessions` row as PostgREST returned it.
 * @returns The normalised record.
 */
function toRuntimeSessionRecord(row: unknown): RuntimeSessionRecord {
  const r = (row ?? {}) as Record<string, unknown>
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  const parsedMax = typeof r.max_time_seconds === 'string'
    ? Number(r.max_time_seconds)
    : r.max_time_seconds
  return {
    sessionId: text(r.session_id) ?? '',
    userId: text(r.user_id) ?? '',
    backend: text(r.backend) ?? '',
    maxTimeSeconds:
      typeof parsedMax === 'number' && Number.isFinite(parsedMax) ? parsedMax : null,
    openedAt: text(r.opened_at) ?? '',
    closedAt: text(r.closed_at),
  }
}
