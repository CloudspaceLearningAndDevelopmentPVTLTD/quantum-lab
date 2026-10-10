/**
 * permalink.ts — turning one private hardware run into a public, citable object.
 *
 * PURE module: no fetch, no Supabase client, no DOM, no environment access. It
 * decides what a permalink is called, what goes into it, and — the part that
 * matters most — what is stripped out of it. The route that reads
 * `hardware_usage` and writes `published_runs` is wiring around this file; the
 * table itself is `supabase/schema-runs.sql`, which should be read alongside
 * this one.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A paper that used this platform has nothing to cite. The run is here —
 * circuit, device, counts, compilation settings — but it sits in one account's
 * private history, and the way authors currently ship it is a CSV in a GitHub
 * gist. A gist is not a reproducibility artefact: the author can edit it after
 * review, and it says nothing about the state the machine was in. The
 * calibration snapshot is the piece nobody else keeps, and it is the whole
 * difference between a result that is reproducible (you know the machine you
 * would have to match) and one that is merely repeatable (you can press the
 * button again on a device that has since been recalibrated).
 * docs/PLAN-BEST-IN-CLASS.md §C1.
 *
 * ── What is published, and what is emphatically not ─────────────────────────
 *
 * PUBLISHED, because they are the point:
 *   the circuit (verbatim OpenQASM), the counts, the device, the shots, the
 *   compilation settings, the calibration snapshot, the dates.
 *
 * NEVER PUBLISHED — `REDACTED_FIELDS` names them and a test asserts none of
 * them survives into a snapshot:
 *   * `userId` — the account. Publishing a run is not publishing an identity.
 *   * `id` — the `hardware_usage` row id. It is the owner's handle into their
 *     own history and the preimage of the public id; both are reasons to keep
 *     it off the page.
 *   * `jobId` — the VENDOR's job handle. This one is the easiest to publish by
 *     accident and the worst to publish: it is a live key into the owner's IBM
 *     / Braket / Azure console, it is how a support ticket identifies their
 *     account, and it is useless to a reader who cannot authenticate as them
 *     anyway.
 *   * `ownerTag` — the free-text tag attached at the vendor so a job can be
 *     found in their console. It is frequently a person's name or an internal
 *     project code.
 *
 * SCRUBBED rather than dropped: the vendor's error text. It is worth
 * publishing — "this device could not complete this circuit" is a citable
 * result — but vendor messages routinely quote the account CRN, the ARN or the
 * job handle back at you. `scrubVendorText` is a best-effort filter over text
 * we do not control; see its docstring for what it cannot promise. Because the
 * verbatim half of that filter is the only half worth trusting, a run loaded
 * without its owning account id is REFUSED rather than published with the
 * filter quietly degraded — see the `no-account-id` refusal.
 *
 * ── The digest ──────────────────────────────────────────────────────────────
 *
 * Every snapshot carries a sha256 of its own canonical JSON. Recomputing it
 * from a published row REQUIRES `verifyPublishedRow` / `toPublishedRunSnapshot`
 * and not a hash of the JSON PostgREST hands you, because Postgres reformats
 * timestamps and numerics on the way back out. `snapshotDigest` says what that
 * does and does not prove.
 *
 * NOT scrubbed, deliberately: the circuit. A scrubber that rewrote OpenQASM
 * would publish a citation that does not run, which is worse than publishing
 * nothing. The consequence — a comment in the circuit goes out exactly as
 * written — is what the opt-in is consent for, and the publishing UI has to
 * say so in those words.
 */

import type { CalibrationSummary } from '@/lib/hardware/fitEstimate'
import type { HardwareJobHistoryEntry } from '@/lib/hardware/types'

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * Domain separator for the public-id hash.
 *
 * Versioned because the id derivation is a promise: if the alphabet or the
 * length ever changes, the namespace changes with it, so an old row's id can
 * still be recomputed from its `source_id` and checked. Without it, a change
 * to the derivation would silently make every existing permalink unverifiable.
 */
export const PUBLIC_ID_NAMESPACE = 'qubit16/published-run/v1'

/** Bytes of digest kept. 10 bytes = 80 bits = exactly 16 base32 characters. */
const PUBLIC_ID_BYTES = 10

/** Length of every public id, in characters. Pinned by a test. */
export const PUBLIC_ID_LENGTH = 16

/**
 * Crockford base32, lowercase.
 *
 * Not hex (a 20-character id for the same entropy) and not base64url (`-`, `_`
 * and mixed case, all of which get mangled by a line break in a PDF). Crockford
 * drops i, l, o and u: the first three because they are transcribed as 1 and 0
 * by anyone typing an id out of a printed paper, and u so that no id can
 * accidentally spell something unfortunate.
 */
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz'

/**
 * The public id for one `hardware_usage` row.
 *
 * DETERMINISTIC, and that is the design rather than a convenience. Publishing
 * the same run twice must not mint a second permalink: two URLs for one
 * experiment, diverging the moment either is corrected, is exactly the failure
 * a citation cannot tolerate. Deriving the id from the row means the second
 * publish collides on the primary key and is refused by the database.
 *
 * A random id would also have worked and was rejected: it would have needed a
 * uniqueness lookup on the source row before every insert, and the "already
 * published" check would have lived in application code, which is where the
 * bug would then live.
 *
 * 80 bits is not a secret and is not access control — the row is world-readable
 * by design — but it is far past guessing, so a mistyped URL lands on nothing
 * rather than on somebody else's experiment.
 *
 * The digest is one-way: a reader cannot recover the `hardware_usage` uuid (or
 * therefore anything about the owner) from the id in the URL.
 *
 * @param sourceId The `hardware_usage` row id (a uuid).
 * @returns 16 lowercase Crockford-base32 characters.
 * @throws Error When `sourceId` is empty — a public id derived from nothing
 *   would be the same id for every such row, silently collapsing them onto one
 *   permalink.
 */
export async function publicRunId(sourceId: string): Promise<string> {
  const id = sourceId.trim()
  if (!id) throw new Error('publicRunId: a source row id is required.')
  const digest = await sha256Bytes(`${PUBLIC_ID_NAMESPACE}:${id}`)
  return base32Crockford(digest.slice(0, PUBLIC_ID_BYTES))
}

/** Path prefix of a permalink. One place, so the page and the citation agree. */
export const RUN_PATH_PREFIX = '/runs/'

/**
 * The site-relative path of a permalink.
 *
 * @param publicId As returned by `publicRunId`.
 * @returns e.g. `/runs/7q2m9x0kd4bhj3pz`.
 */
export function runPermalinkPath(publicId: string): string {
  return `${RUN_PATH_PREFIX}${publicId}`
}

/**
 * The absolute permalink — the string that goes in a paper.
 *
 * @param origin Site origin, with or without a trailing slash.
 * @param publicId As returned by `publicRunId`.
 * @returns e.g. `https://qubit16.ai/runs/7q2m9x0kd4bhj3pz`.
 */
export function runPermalinkUrl(origin: string, publicId: string): string {
  return `${origin.replace(/\/+$/, '')}${runPermalinkPath(publicId)}`
}

// ── The row we start from ───────────────────────────────────────────────────

/**
 * One hardware run as its OWNER sees it: the public history entry plus the
 * columns that never leave the server.
 *
 * The private fields are on this interface rather than passed separately on
 * purpose — they are what the redaction step exists to remove, and a type that
 * pretended they were not there would make the removal untestable.
 */
export interface OwnedHardwareRun extends HardwareJobHistoryEntry {
  /** PRIVATE. The Supabase account that owns the run. Never published. */
  userId: string
  /**
   * PRIVATE. The free-text tag attached at the vendor so the owner can find
   * the job in their console — often a name or an internal project code.
   * Optional because `hardware_usage` has no column for it today; a publisher
   * that has it must pass it so it can be removed rather than forgotten.
   */
  ownerTag?: string | null
  /**
   * Whether idle-time dynamical decoupling was applied. NOT a `hardware_usage`
   * column today: supply it from the submission record when you still have it.
   * `null`/absent means "not recorded", never "off" — see the schema comment.
   */
  dynamicalDecoupling?: boolean | null
  /** Whether readout twirling was applied. Same "not recorded" caveat. */
  measurementTwirling?: boolean | null
}

/** Every field of `OwnedHardwareRun` that must not reach a published snapshot. */
export const REDACTED_FIELDS = ['id', 'userId', 'jobId', 'ownerTag'] as const

/**
 * One instant, in the single spelling the digest is defined over.
 *
 * Postgres serves a `timestamptz` as `2026-09-01T10:00:00+00:00`; the submit
 * path writes `2026-09-01T10:00:00.000Z`. Both name the same moment and both
 * are valid ISO 8601, so a digest taken over whichever spelling happened to be
 * in hand is a digest nobody else can reproduce — which defeats the only thing
 * the digest is for. Every instant is put through here at BUILD time and again
 * on the way back OUT of the database, so both sides agree.
 *
 * An unparseable value is returned trimmed rather than dropped: it is what the
 * row actually says, and blanking a date on a citation is a worse answer than
 * an odd-looking one.
 *
 * @param value An ISO-8601-ish timestamp, or null.
 * @returns `YYYY-MM-DDTHH:MM:SS.mmmZ`, the input trimmed if it does not parse,
 *   or null when there was nothing there.
 */
function canonicalInstant(value: string | null | undefined): string | null {
  const raw = trimOrNull(value)
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : raw
}

export type RedactedField = (typeof REDACTED_FIELDS)[number]

// ── What gets published ─────────────────────────────────────────────────────

/** The compilation settings, grouped because they are only meaningful together. */
export interface PublishedCompilation {
  /** Qiskit preset pass-manager level the circuit was compiled at. */
  optimizationLevel: number | null
  /** Depth of the circuit as actually sent to the device. */
  transpiledDepth: number | null
  /** Two-qubit gate count as sent — the best single predictor of noise. */
  transpiledTwoQubitGates: number | null
  /** Null means NOT RECORDED, not "off". */
  dynamicalDecoupling: boolean | null
  /** Null means NOT RECORDED, not "off". */
  measurementTwirling: boolean | null
}

/**
 * The immutable, world-readable record of one run.
 *
 * This object is the citation. Everything in it is either the experiment or a
 * label on the experiment; there is no field here that identifies the account,
 * and `publishedRunInsert` is structured so the private columns cannot be
 * folded back in by accident.
 */
export interface PublishedRunSnapshot {
  /**
   * The shape this snapshot was written under. `SNAPSHOT_SCHEMA_VERSION` for
   * anything built today; a NUMBER rather than the literal 1, because a reader
   * has to be able to hold a row written under a later version without
   * relabelling it — and because the digest covers this field, so claiming 1
   * for a v2 row would make an honest row fail its own integrity check.
   */
  schemaVersion: number
  publicId: string
  /** Publisher-typed, public, unscrubbed, bounded. Null when not given. */
  title: string | null
  /**
   * The citation's author line, typed by the publisher.
   *
   * NEVER derived from the account. An auto-filled name would publish an
   * identity that the opt-in did not ask about, and the person publishing a
   * group's run is often not the person who should be credited for it.
   */
  attribution: string | null
  notes: string | null

  backend: string
  provider: string | null
  shots: number
  /** OpenQASM as submitted, verbatim. */
  qasm: string
  counts: Record<string, number> | null
  status: PublishableStatus
  /** Vendor error text, after `scrubVendorText`. */
  error: string | null
  qpuSeconds: number | null
  compilation: PublishedCompilation

  /**
   * The device's calibration as of submission, or null.
   *
   * NULL IS CURRENTLY THE ONLY ANSWER: nothing in the pipeline captures
   * calibration against a job yet (see the wiring note in the C1 report), so
   * every snapshot built today carries null here and is honestly a repeatable
   * record rather than a reproducible one. The renderer must say "calibration
   * not recorded" rather than omit the section, because a missing section reads
   * as "nothing to report".
   *
   * When it is present, `source` inside it is load-bearing: 'static' means the
   * vendor's published TYPICAL values — a catalogue entry, not a measurement of
   * this device on this day — and showing that as if it were measured would be
   * the exact dishonesty this feature exists to remove.
   */
  calibration: CalibrationSummary | null
  /** When that snapshot was taken. May predate `submittedAt` by minutes. */
  calibrationCapturedAt: string | null

  /** When WE accepted the submission. */
  submittedAt: string
  /** When we OBSERVED a terminal state — not the vendor's completion time. */
  completedAt: string | null
}

/** The snapshot shape every row built by this build is written under. */
export const SNAPSHOT_SCHEMA_VERSION = 1

/** The states a run may be published in: terminal ones only. */
export type PublishableStatus = 'done' | 'error' | 'cancelled'

const PUBLISHABLE_STATUSES: readonly string[] = ['done', 'error', 'cancelled']

// ── Building one ────────────────────────────────────────────────────────────

/** Bounds on the publisher-typed metadata. Mirrored by checks in schema-runs.sql. */
export const METADATA_LIMITS = { title: 200, attribution: 200, notes: 2000 } as const

/** Largest circuit we will publish. Mirrors the check on `published_runs.qasm`. */
export const MAX_PUBLISHED_QASM_CHARS = 200_000

/**
 * Longest vendor error we will publish. Mirrors the check on
 * `published_runs.error`, and the mirroring is the point: without a bound on
 * this side, a vendor that returns a 40 kB stack trace turns a publish the
 * owner already consented to into an opaque `check constraint` violation from
 * Postgres, after the fact and with nothing useful to show them.
 */
export const MAX_PUBLISHED_ERROR_CHARS = 4_000

/**
 * The provenance markers a calibration snapshot may carry. Mirrors the check on
 * `published_runs.calibration_source`, and mirrors the API's own contract
 * (services/api/app/routers/hardware.py::CalibrationSummary), where the field is
 * typed as a bare `str` and so is not enforced anywhere else on the wire.
 *
 * 'static' is the load-bearing one: it means the vendor's published TYPICAL
 * values — a catalogue entry, not a measurement of this device on this day.
 */
export const CALIBRATION_SOURCES: readonly string[] = ['live', 'static', 'unavailable']

/** Said in the published text itself, so a reader knows the message is partial. */
const VENDOR_ERROR_TRUNCATION_MARKER = ' […vendor message truncated by qubit16]'

/**
 * Clamp a vendor message to the published column's width.
 *
 * MUST run AFTER `scrubVendorText`, not before, and for two independent
 * reasons. Scrubbing changes the length in both directions (a CRN shrinks to
 * `[redacted-crn]`, a short API key grows), so a clamp applied first does not
 * guarantee the final string fits. And a clamp applied first can cut an
 * identifier in half, leaving a fragment that neither the verbatim pass nor a
 * pattern recognises — a redaction failure created by the truncation.
 *
 * Truncated rather than refused, unlike an over-long title: the title is the
 * publisher's own words and silently shortening it would be a wrong citation,
 * whereas this is a third party's stack trace and the marker says plainly that
 * it was cut.
 *
 * @param text Already-scrubbed vendor text.
 * @returns The text, clamped and marked, or null when there was nothing left.
 */
function clampVendorError(text: string): string | null {
  if (!text) return null
  if (text.length <= MAX_PUBLISHED_ERROR_CHARS) return text
  const keep = MAX_PUBLISHED_ERROR_CHARS - VENDOR_ERROR_TRUNCATION_MARKER.length
  return text.slice(0, keep) + VENDOR_ERROR_TRUNCATION_MARKER
}

/** What the publisher asks for. `optIn` is consent and has no default. */
export interface PublishRequest {
  /**
   * The opt-in, stated explicitly by the owner for THIS run.
   *
   * No default, anywhere in this module or in the table: a default of false
   * lets a backfill insert dead rows silently, a default of true lets one
   * publish somebody's data silently, and a required field simply fails —
   * which is the only one of the three that anybody notices.
   */
  optIn: boolean
  title?: string | null
  attribution?: string | null
  notes?: string | null
  /** The device's calibration as of submission, if the caller has it. */
  calibration?: CalibrationSummary | null
  /** When that calibration was read. ISO 8601. */
  calibrationCapturedAt?: string | null
}

/** Why a run was not published. Each one is a refusal, never a silent skip. */
export type PublishRefusalReason =
  | 'not-opted-in'
  | 'not-terminal'
  | 'no-circuit'
  | 'circuit-too-large'
  | 'metadata-too-long'
  | 'no-source-id'
  | 'no-account-id'
  | 'unknown-calibration-source'

export interface PublishRefusal {
  reason: PublishRefusalReason
  /** A sentence fit to show the person who pressed Publish. */
  detail: string
}

export type PublishOutcome =
  | { ok: true; snapshot: PublishedRunSnapshot; digest: string }
  | { ok: false; refusal: PublishRefusal }

/**
 * Build the public snapshot of one run, or refuse with a reason.
 *
 * Every refusal here is a rule about what a permalink promises, not a
 * validation nicety:
 *
 *   * `not-opted-in` — no consent, no row. This is the first check and it
 *     short-circuits before anything is assembled, so an un-opted-in run never
 *     even produces an object that could be inserted by mistake.
 *   * `not-terminal` — publishing a queued or running job would freeze a row
 *     that never learns its own result, and the row is immutable so it could
 *     never be corrected. Wait for the job.
 *   * `no-circuit` — a permalink without its circuit is a histogram, and a
 *     histogram is not reproducible by anyone. `listHardwareJobs` only selects
 *     `qasm` when asked (`include_qasm=1`), so this refusal will most often
 *     mean "you fetched the row without the circuit", not "the circuit is
 *     gone"; the detail says so.
 *   * `no-account-id` — the account id is the most important entry in the
 *     verbatim pass of `scrubVendorText`, which is the only part of the
 *     redaction that is more than best-effort. A caller that fetched the
 *     history row without `user_id` would otherwise produce a
 *     perfectly valid-looking snapshot with the scrub quietly degraded to its
 *     pattern list — a silent failure on the one path that exposes data.
 *
 * The refusals are returned rather than thrown because all of them are things
 * the person pressing Publish should read, not exceptional conditions.
 *
 * @param run The owner's row, private columns included.
 * @param request The opt-in and the publisher-typed metadata.
 * @returns The snapshot and its digest, or a refusal.
 */
export async function buildPublishedRun(
  run: OwnedHardwareRun,
  request: PublishRequest
): Promise<PublishOutcome> {
  if (!request.optIn) {
    return refuse(
      'not-opted-in',
      'This run has not been opted in to publishing. Nothing was written.'
    )
  }

  const sourceId = (run.id ?? '').trim()
  if (!sourceId) {
    return refuse(
      'no-source-id',
      'This run has no stored id, so no stable permalink can be derived for it.'
    )
  }

  // Checked even though `buildPublishedRun` never publishes it: it is what the
  // scrubber removes verbatim, and a scrub that silently lost its most
  // important needle is exactly the failure nobody would notice. Fail closed.
  if (!(run.userId ?? '').trim()) {
    return refuse(
      'no-account-id',
      'This run was loaded without its owning account id, so vendor text cannot be reliably scrubbed of it. Nothing was published.'
    )
  }

  const status = run.status ?? ''
  if (!PUBLISHABLE_STATUSES.includes(status)) {
    return refuse(
      'not-terminal',
      `This run is ${status ? `still ${status}` : 'not known to have finished'}. A permalink is immutable, so it can only be created once the run has a result.`
    )
  }

  const qasm = run.qasm ?? ''
  if (!qasm.trim()) {
    return refuse(
      'no-circuit',
      'The circuit for this run was not loaded (the history endpoint omits it unless asked for with include_qasm=1). A permalink without the circuit is not reproducible, so it is not published.'
    )
  }
  if (qasm.length > MAX_PUBLISHED_QASM_CHARS) {
    return refuse(
      'circuit-too-large',
      `The circuit is ${qasm.length} characters; the published limit is ${MAX_PUBLISHED_QASM_CHARS}.`
    )
  }

  const title = trimOrNull(request.title)
  const attribution = trimOrNull(request.attribution)
  const notes = trimOrNull(request.notes)
  const tooLong = firstOverLimit([
    ['title', title, METADATA_LIMITS.title],
    ['attribution', attribution, METADATA_LIMITS.attribution],
    ['notes', notes, METADATA_LIMITS.notes],
  ])
  if (tooLong) {
    // Refused rather than truncated: a silently shortened citation title is a
    // wrong citation, and the row cannot be edited afterwards to fix it.
    return refuse(
      'metadata-too-long',
      `The ${tooLong.field} is longer than the ${tooLong.limit}-character limit.`
    )
  }

  const calibration = request.calibration ?? null
  if (calibration && !CALIBRATION_SOURCES.includes(calibration.source)) {
    // Refused rather than stored with a null marker. The marker is the whole
    // reason we publish calibration at all: a snapshot whose provenance we
    // cannot state is a set of noise figures a reader will assume were
    // measured. The DB check would reject this row anyway — mirrored here so
    // the publisher gets a sentence instead of a Postgres constraint name.
    return refuse(
      'unknown-calibration-source',
      `The calibration snapshot is marked '${calibration.source}', which is not one of ${CALIBRATION_SOURCES.join(', ')}. Its provenance cannot be labelled honestly, so it was not published.`
    )
  }

  const publicId = await publicRunId(sourceId)

  // The identifiers that must never appear in published text, handed to the
  // scrubber so it can remove them verbatim rather than relying on its
  // patterns to recognise the shape of a vendor handle.
  const secrets = [run.id, run.userId, run.jobId, run.ownerTag].filter(
    (s): s is string => typeof s === 'string' && s.length > 0
  )

  const snapshot: PublishedRunSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    publicId,
    title,
    attribution,
    notes,
    backend: run.backend,
    provider: run.provider,
    shots: run.shots,
    qasm,
    counts: run.counts,
    status: status as PublishableStatus,
    error: run.error ? clampVendorError(scrubVendorText(run.error, secrets)) : null,
    qpuSeconds: run.qpuSeconds,
    compilation: {
      optimizationLevel: run.optimizationLevel,
      transpiledDepth: run.transpiledDepth,
      transpiledTwoQubitGates: run.transpiledTwoQubitGates,
      dynamicalDecoupling: run.dynamicalDecoupling ?? null,
      measurementTwirling: run.measurementTwirling ?? null,
    },
    calibration,
    calibrationCapturedAt: canonicalInstant(request.calibrationCapturedAt),
    submittedAt: canonicalInstant(run.submittedAt) ?? '',
    completedAt: canonicalInstant(run.completedAt),
  }

  return { ok: true, snapshot, digest: await snapshotDigest(snapshot) }
}

// ── Redaction ───────────────────────────────────────────────────────────────

/**
 * Patterns of identifier that turn up inside vendor-authored text.
 *
 * Ordered most-specific first: a CRN contains segments that also look like
 * other things, so it has to be consumed whole before the narrower patterns
 * run.
 */
const SCRUB_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // IBM Cloud resource name — names the owner's account and instance.
  [/crn:[^\s"'<>,)\]]+/gi, '[redacted-crn]'],
  // AWS ARN — names the owner's account id in its fifth field.
  [/arn:aws[^\s"'<>,)\]]+/gi, '[redacted-arn]'],
  // Any uuid: our row ids, Azure workspace and job ids.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[redacted-id]'],
  // One of our own API keys, echoed back by something that logged a header.
  [/qb16_sk_[A-Za-z0-9_-]+/g, '[redacted-key]'],
  // An address, which is an identity even when it is a service account.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]'],
]

/**
 * Remove identifiers from text we did not write, before publishing it.
 *
 * Two mechanisms, and the first is the one to trust: `secrets` are the exact
 * strings we KNOW are identifiers for this run (the account id, the vendor job
 * handle, the owner tag), removed verbatim. `SCRUB_PATTERNS` is the second
 * line, for identifiers that belong to neither us nor this row — an account
 * CRN quoted back inside an IBM error, an ARN, an address.
 *
 * BE CLEAR ABOUT WHAT THIS IS NOT. It is a filter over arbitrary text from a
 * third party, so it cannot prove that no identifier survived: a vendor is free
 * to invent a handle format tomorrow that matches none of these patterns. It
 * reduces the chance of a leak; it does not eliminate it. Two consequences the
 * calling code must honour — the publishing UI shows the scrubbed text back to
 * the owner before the insert, and the page labels it as vendor text rather
 * than presenting it as ours.
 *
 * ORDER MATTERS, and it is patterns first. The replacement tokens contain `]`,
 * and `]` terminates the CRN and ARN patterns — so running the verbatim pass
 * first fragments any structured identifier that HAPPENS to contain one of this
 * run's secrets, and the tail of it survives. Worked example, verbatim-first:
 *
 *   `crn:v1:…:a/<account-uuid>:<instance-guid>::`
 *     → `crn:v1:…:a/[redacted]:<instance-guid>::`   (verbatim pass)
 *     → `[redacted-crn]]:<instance-guid>::`          (CRN pattern stops at `]`)
 *
 * — the instance guid, which the CRN pattern existed to eat, is published.
 * Patterns first consumes the whole CRN in one go, and the verbatim pass then
 * runs over what is left, so nothing is skipped either way.
 *
 * @param text The vendor's message.
 * @param secrets Exact strings to remove verbatim. Empty entries are ignored.
 * @returns The scrubbed text, whitespace-collapsed at the edges.
 */
export function scrubVendorText(text: string, secrets: readonly string[] = []): string {
  let out = text
  for (const [pattern, replacement] of SCRUB_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  for (const secret of secrets) {
    if (!secret) continue
    out = out.split(secret).join('[redacted]')
  }
  return out.trim()
}

// ── Integrity ───────────────────────────────────────────────────────────────

/**
 * sha256 (hex) over the canonical JSON of a snapshot.
 *
 * Canonical means every object's keys are sorted, at every depth, so the digest
 * depends on the DATA and not on the order JavaScript happened to build the
 * object in — otherwise re-serialising an unchanged row could produce a
 * different digest and make an honest row look tampered with.
 *
 * WHAT IT DEFENDS AGAINST: accidental drift. A bad migration, a partial write,
 * a well-meaning "fix" to a published row — all of them change the digest, and
 * a reader who saved it can tell.
 *
 * WHAT IT DOES NOT: us. We compute the digest, so we could recompute it after
 * an edit. It is not a signature and the page must not describe it as proof of
 * anything the operator could not undo. Its real value is that a third-party
 * archive of this row is checkable against the live one.
 *
 * TO RECOMPUTE IT from a published row you MUST go through
 * `toPublishedRunSnapshot` (or `verifyPublishedRow`) rather than hashing the
 * JSON PostgREST hands you. Postgres does not return what we sent: a
 * `timestamptz` comes back as `…+00:00` rather than `…Z` and a `numeric` comes
 * back as a string, so a naive re-serialisation disagrees with the stored
 * digest on every single row. This is a real trap — before it was fixed, the
 * digest was unverifiable by anyone, including us — and it is why every instant
 * goes through `canonicalInstant` on both sides. THE RESIDUAL LIMIT: the
 * `calibration` payload is opaque jsonb, and Postgres normalises numbers inside
 * jsonb (`1e-4` is stored as `0.0001`). A vendor payload written with an
 * exponent-form float can therefore still round-trip to a different digest. No
 * row today has a calibration at all, so this is untested rather than handled.
 *
 * @param snapshot The snapshot to digest.
 * @returns 64 lowercase hex characters.
 */
export async function snapshotDigest(snapshot: PublishedRunSnapshot): Promise<string> {
  const bytes = await sha256Bytes(canonicalJson(snapshot))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── The insert ──────────────────────────────────────────────────────────────

/** The private columns, supplied separately from the snapshot. See below. */
export interface PublishedRunOwnership {
  /** `hardware_usage.id`. Stored, never served publicly. */
  sourceId: string
  /** Who published it, for takedown. Not the citation's author line. */
  ownerId: string
}

/**
 * The `published_runs` row for one snapshot.
 *
 * The private columns arrive through a SECOND argument rather than off the
 * snapshot, and that is a structural choice, not a stylistic one: the snapshot
 * is the object that gets serialised, digested, rendered and handed to a
 * reader, so nothing that must stay private is ever allowed to live on it. The
 * alternative — one wide object with a delete-list applied on the way out —
 * fails open the moment somebody adds a field and forgets the list.
 *
 * @param snapshot A snapshot from `buildPublishedRun`.
 * @param digest Its digest, from the same call.
 * @param ownership The private columns.
 * @returns A plain object for `.from('published_runs').insert(...)`.
 */
export function publishedRunInsert(
  snapshot: PublishedRunSnapshot,
  digest: string,
  ownership: PublishedRunOwnership
): Record<string, unknown> {
  return {
    public_id: snapshot.publicId,
    source_id: ownership.sourceId,
    owner_id: ownership.ownerId,
    // Always true: a snapshot only exists because `buildPublishedRun` was
    // given consent. The column is written anyway because it has no default,
    // so the row records the consent rather than implying it.
    public_opt_in: true,
    withdrawn_at: null,
    title: snapshot.title,
    attribution: snapshot.attribution,
    notes: snapshot.notes,
    backend: snapshot.backend,
    provider: snapshot.provider,
    shots: snapshot.shots,
    qasm: snapshot.qasm,
    counts: snapshot.counts,
    status: snapshot.status,
    error: snapshot.error,
    qpu_seconds: snapshot.qpuSeconds,
    optimization_level: snapshot.compilation.optimizationLevel,
    transpiled_depth: snapshot.compilation.transpiledDepth,
    transpiled_two_qubit_gates: snapshot.compilation.transpiledTwoQubitGates,
    dynamical_decoupling: snapshot.compilation.dynamicalDecoupling,
    measurement_twirling: snapshot.compilation.measurementTwirling,
    calibration: snapshot.calibration,
    calibration_source: snapshot.calibration?.source ?? null,
    calibration_captured_at: snapshot.calibrationCapturedAt,
    submitted_at: snapshot.submittedAt,
    completed_at: snapshot.completedAt,
    snapshot_sha256: digest,
    schema_version: snapshot.schemaVersion,
  }
}

// ── Reading one back ────────────────────────────────────────────────────────

/**
 * Map a `published_runs_public` row onto the snapshot shape.
 *
 * Defensive about types for the same reason `toHardwareJobRecord` is: PostgREST
 * returns `numeric` as a STRING, and a row written under an earlier
 * `schema_version` may be missing columns this build expects. A missing field
 * reads as null, which is the honest answer, rather than as a zero.
 *
 * Instants are put back through `canonicalInstant` and `schema_version` is
 * READ rather than assumed, because this function is half of the digest
 * guarantee: `snapshotDigest(toPublishedRunSnapshot(row))` has to reproduce
 * `row.snapshot_sha256` or the digest is decoration. See `snapshotDigest`.
 *
 * @param row A row as PostgREST returned it.
 * @returns The snapshot.
 */
export function toPublishedRunSnapshot(row: unknown): PublishedRunSnapshot {
  const r = (row ?? {}) as Record<string, unknown>
  const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  const num = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v !== 'string') return null
    // An empty or blank string is "the column is not set", and `Number('')` is
    // 0 — so the obvious one-liner reports an unrecorded transpiled depth as a
    // depth of zero, which is a claim about the circuit that nobody made.
    const trimmed = v.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
  const obj = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

  const status = text(r.status)
  return {
    schemaVersion: num(r.schema_version) ?? SNAPSHOT_SCHEMA_VERSION,
    publicId: text(r.public_id) ?? '',
    title: text(r.title),
    attribution: text(r.attribution),
    notes: text(r.notes),
    backend: text(r.backend) ?? '',
    provider: text(r.provider),
    shots: num(r.shots) ?? 0,
    qasm: text(r.qasm) ?? '',
    counts: obj(r.counts) as Record<string, number> | null,
    // A row whose status is unreadable is reported as 'error' rather than
    // 'done': the failure mode of guessing wrong in the other direction is a
    // page that presents an unknown state as a completed measurement.
    status: (PUBLISHABLE_STATUSES.includes(status ?? '') ? status : 'error') as PublishableStatus,
    error: text(r.error),
    qpuSeconds: num(r.qpu_seconds),
    compilation: {
      optimizationLevel: num(r.optimization_level),
      transpiledDepth: num(r.transpiled_depth),
      transpiledTwoQubitGates: num(r.transpiled_two_qubit_gates),
      dynamicalDecoupling: bool(r.dynamical_decoupling),
      measurementTwirling: bool(r.measurement_twirling),
    },
    calibration: obj(r.calibration) as unknown as CalibrationSummary | null,
    calibrationCapturedAt: canonicalInstant(text(r.calibration_captured_at)),
    submittedAt: canonicalInstant(text(r.submitted_at)) ?? '',
    completedAt: canonicalInstant(text(r.completed_at)),
  }
}

/**
 * Does a published row still hash to the digest it was published with?
 *
 * This is the check the SQL comment on `published_runs.snapshot_sha256`
 * promises a reader can run, made into one call so nobody has to re-derive the
 * canonicalisation rules and get them subtly wrong. It answers "these bytes are
 * the bytes that were published", and NOTHING more: we compute both sides, so a
 * false here means drift — a bad migration, a partial write, an edit — and a
 * true here is not evidence against the operator. See `snapshotDigest`.
 *
 * @param row A row from `published_runs_public`, as PostgREST returned it,
 *   including `snapshot_sha256`.
 * @returns True when the row's own digest matches a recomputation of it. False
 *   when it does not, and when the row carries no digest at all — an
 *   unverifiable row is not a verified one.
 */
export async function verifyPublishedRow(row: unknown): Promise<boolean> {
  const stored = (row ?? {}) as Record<string, unknown>
  const claimed = typeof stored.snapshot_sha256 === 'string' ? stored.snapshot_sha256 : ''
  if (!claimed) return false
  return (await snapshotDigest(toPublishedRunSnapshot(row))) === claimed
}

// ── The citation ────────────────────────────────────────────────────────────

/**
 * One sentence that must travel with every rendered permalink whose
 * `calibration` is null.
 *
 * The whole claim of this feature is the calibration snapshot. A page that
 * quietly omits the section when there is nothing to show would let a reader
 * assume the machine state was captured, which is the projection-as-measurement
 * failure this codebase does not commit.
 */
export const NO_CALIBRATION_NOTICE =
  'Device calibration was not recorded for this run, so the machine state at submission is unknown. ' +
  'This record is repeatable — the circuit and settings are exact — but not fully reproducible.'

/**
 * A BibTeX `@misc` entry for one published run.
 *
 * Deliberately plain: the value of C1 is the URL being stable and the data
 * behind it being frozen, so the entry's job is to make pasting that URL into
 * a bibliography a two-second job rather than to be clever.
 *
 * `author` is `attribution` and nothing else. When the publisher did not type
 * one, the field is omitted rather than filled from the account — see
 * `PublishedRunSnapshot.attribution`.
 *
 * @param snapshot The published run.
 * @param url Its absolute permalink, from `runPermalinkUrl`.
 * @returns A BibTeX entry, newline-terminated.
 */
export function runBibtex(snapshot: PublishedRunSnapshot, url: string): string {
  const year = snapshot.submittedAt.slice(0, 4) || String(new Date().getUTCFullYear())
  const fields: Array<[string, string]> = [
    [
      'title',
      snapshot.title ?? `Quantum hardware run on ${snapshot.backend} (${snapshot.shots} shots)`,
    ],
  ]
  if (snapshot.attribution) fields.push(['author', snapshot.attribution])
  fields.push(['year', year])
  fields.push(['note', `qubit16 published run ${snapshot.publicId}, ${snapshot.backend}`])

  const body = fields.map(([key, value]) => `  ${key} = {${escapeBibtex(value)}},`)
  // `howpublished` is assembled here rather than escaped: its value is a LaTeX
  // macro we wrote (`\url{…}`) wrapped around a URL we minted, so running it
  // through the escaper would escape our own backslash and print the macro.
  body.push(`  howpublished = {\\url{${url}}}`)
  return `@misc{qubit16:${snapshot.publicId},\n${body.join('\n')}\n}\n`
}

/**
 * Make one field value safe to put in a .bib file AND to typeset.
 *
 * Two separate hazards, and only the first is about BibTeX:
 *
 *   * `{` and `}` delimit the field, so a stray one breaks BibTeX's own parser.
 *     Dropped, because there is no way to represent an unbalanced brace.
 *   * `& % $ # _` are LaTeX-special. They parse fine as BibTeX and then break
 *     the READER's document build, which is worse: the error surfaces in
 *     somebody else's log with our citation named in it. This is not
 *     hypothetical — every IBM backend name contains an underscore
 *     (`ibm_brisbane`), and the backend goes into the note of every entry and
 *     into the default title, so before this escaping EVERY IBM citation we
 *     emitted failed to compile with "Missing $ inserted".
 *   * `\`, `^` and `~` are dropped rather than escaped. Their text-mode escapes
 *     (`\textbackslash{}` and friends) are fragile and a value that needed one
 *     is a value we cannot render faithfully anyway.
 *
 * NOT HANDLED: a publisher who wanted maths typeset. `$\langle Z_0 Z_1\rangle$`
 * in a title comes out as literal, escaped text, because we cannot tell it from
 * a dollar sign someone meant literally — and guessing wrong would corrupt the
 * rest of the entry rather than just look plain.
 *
 * @param value Publisher-typed or machine-generated field text.
 * @returns The value, safe to drop between the braces of a BibTeX field.
 */
function escapeBibtex(value: string): string {
  return value.replace(/[{}\\^~]/g, '').replace(/([&%$#_])/g, '\\$1')
}

// ── Internals ───────────────────────────────────────────────────────────────

/**
 * sha256 of a UTF-8 string, as bytes.
 *
 * Web Crypto rather than `node:crypto`, matching `lib/security/apiKeys.ts`, so
 * this module keeps working if a route that uses it is moved to the edge
 * runtime.
 */
async function sha256Bytes(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return new Uint8Array(digest)
}

/** Encode bytes as lowercase Crockford base32, big-endian, no padding. */
function base32Crockford(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31]
  return out
}

/**
 * JSON with every object's keys sorted, at every depth.
 *
 * Arrays keep their order — in a snapshot an array is data (a list of
 * observables, say), and sorting it would change the meaning.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
  return `{${entries.join(',')}}`
}

/** Trim, and treat empty as absent — an empty title is not a title. */
function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** The first metadata field over its limit, or null. */
function firstOverLimit(
  fields: ReadonlyArray<[string, string | null, number]>
): { field: string; limit: number } | null {
  for (const [field, value, limit] of fields) {
    if (value && value.length > limit) return { field, limit }
  }
  return null
}

/** Build a refusal. One place, so every refusal carries a readable sentence. */
function refuse(reason: PublishRefusalReason, detail: string): PublishOutcome {
  return { ok: false, refusal: { reason, detail } }
}
