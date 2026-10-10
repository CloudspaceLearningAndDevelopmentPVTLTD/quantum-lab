/**
 * permalink.test.ts — the three ways a run permalink could quietly betray its owner.
 *
 * This module turns a private hardware run into a world-readable, immutable
 * object. Every failure it can have is silent:
 *
 *  1. AN IDENTIFIER SURVIVES INTO THE SNAPSHOT. The vendor job id is the worst
 *     of them — it is a live handle into the owner's IBM/Braket/Azure console —
 *     and nothing about a page that renders it looks wrong. The first block
 *     asserts that every field in `REDACTED_FIELDS` is absent from the
 *     serialised snapshot, driven off that constant so a field added to it
 *     without being removed from the snapshot fails here.
 *
 *  2. THE PUBLIC ID STOPS BEING STABLE. If the same row can yield two ids, a
 *     second publish mints a second permalink instead of colliding, and one
 *     experiment ends up behind two URLs that can diverge. The row is immutable
 *     afterwards, so this is not recoverable by editing.
 *
 *  3. AN UN-OPTED-IN RUN PRODUCES SOMETHING. Anything at all — an object a
 *     caller might insert, a derived id, a digest — is a publish waiting for a
 *     careless `if`. The refusal has to come before the snapshot is assembled.
 */

import { describe, expect, it } from 'vitest'
import {
  buildPublishedRun,
  MAX_PUBLISHED_ERROR_CHARS,
  METADATA_LIMITS,
  PUBLIC_ID_LENGTH,
  publicRunId,
  publishedRunInsert,
  REDACTED_FIELDS,
  runBibtex,
  runPermalinkUrl,
  scrubVendorText,
  SNAPSHOT_SCHEMA_VERSION,
  snapshotDigest,
  toPublishedRunSnapshot,
  verifyPublishedRow,
  type OwnedHardwareRun,
} from '@/lib/hardware/permalink'
import type { CalibrationSummary } from '@/lib/hardware/fitEstimate'

/** The identifiers under test. Distinctive strings, so a leak is unmistakable. */
const SOURCE_ID = '11111111-2222-4333-8444-555555555555'
const USER_ID = '99999999-8888-4777-8666-555555555550'
const JOB_ID = 'cz9k2mv7xq3nfhd8p1r4'
const OWNER_TAG = 'lab-of-a-particular-professor'

function run(overrides: Partial<OwnedHardwareRun> = {}): OwnedHardwareRun {
  return {
    id: SOURCE_ID,
    userId: USER_ID,
    provider: 'ibm',
    jobId: JOB_ID,
    ownerTag: OWNER_TAG,
    backend: 'ibm_brisbane',
    shots: 1024,
    submittedAt: '2026-09-01T10:00:00.000Z',
    status: 'done',
    counts: { '00': 500, '11': 524 },
    qasm: 'OPENQASM 3.0;\nqubit[2] q;\nh q[0];\ncx q[0], q[1];\n',
    error: null,
    qpuSeconds: 1.25,
    optimizationLevel: 3,
    transpiledDepth: 12,
    transpiledTwoQubitGates: 4,
    completedAt: '2026-09-01T10:45:00.000Z',
    ...overrides,
  }
}

const CALIBRATION: CalibrationSummary = {
  source: 'live',
  qubits: 127,
  median_1q_error: 0.0002,
  median_2q_error: 0.0081,
  median_t1_us: 210.4,
  median_t2_us: 130.9,
  queue_depth: 7,
  note: 'Read from the IBM backend properties at submission.',
}

async function published(overrides: Partial<OwnedHardwareRun> = {}) {
  const outcome = await buildPublishedRun(run(overrides), { optIn: true })
  if (!outcome.ok) throw new Error(`expected a snapshot, got refusal: ${outcome.refusal.reason}`)
  return outcome
}

// ── 1. Redaction ────────────────────────────────────────────────────────────

describe('redaction', () => {
  it('leaves no value of any REDACTED_FIELDS field anywhere in the snapshot', async () => {
    // Driven off the constant rather than a hand-written list: adding a field
    // to REDACTED_FIELDS without also keeping it out of the snapshot must fail
    // here, not in production.
    const source = run()
    const { snapshot } = await published()
    const serialised = JSON.stringify(snapshot)

    for (const field of REDACTED_FIELDS) {
      const value = source[field]
      expect(typeof value, `${field} must be set in the fixture or this test proves nothing`).toBe(
        'string'
      )
      expect(serialised, `${field} leaked into the published snapshot`).not.toContain(
        String(value)
      )
    }
  })

  it('does not carry the account id or the vendor job id as a key, under any name', async () => {
    // The check above catches the values; this one catches a field that was
    // added with an innocuous name and a null value today, which would start
    // leaking the moment somebody populated it.
    const { snapshot } = await published()
    const keys = Object.keys(snapshot)
    expect(keys).not.toContain('userId')
    expect(keys).not.toContain('jobId')
    expect(keys).not.toContain('ownerTag')
    expect(keys).not.toContain('id')
    // The public id is the only identifier that may appear.
    expect(keys).toContain('publicId')
  })

  it('keeps the circuit and the counts — redacting those would defeat the feature', async () => {
    const { snapshot } = await published()
    expect(snapshot.qasm).toContain('cx q[0], q[1];')
    expect(snapshot.counts).toEqual({ '00': 500, '11': 524 })
  })

  it('strips the vendor job id out of the vendor error text', async () => {
    // IBM and Braket both quote the job handle back inside failure messages, so
    // dropping the `jobId` column and publishing `error` verbatim would publish
    // the handle anyway — the leak the column-level check would not catch.
    const { snapshot } = await published({
      status: 'error',
      counts: null,
      error: `Job ${JOB_ID} failed on instance crn:v1:bluemix:public:quantum-computing:us-east:a/${USER_ID}:abc::`,
    })
    expect(snapshot.error).not.toContain(JOB_ID)
    expect(snapshot.error).not.toContain(USER_ID)
    expect(snapshot.error).not.toContain('crn:v1')
    expect(snapshot.error).toContain('failed on instance')
  })

  it('publishes an identifier the OWNER typed into their own circuit — a known limit', async () => {
    // Pinned deliberately. The circuit is published verbatim because a scrubber
    // that rewrote OpenQASM would produce a citation that does not run. So a
    // comment in the circuit goes out exactly as written, and the publishing UI
    // is what has to say so. If this test ever starts failing because somebody
    // added a QASM scrubber, read the module header before "fixing" it.
    const { snapshot } = await published({
      qasm: `// submitted by ${OWNER_TAG}\nOPENQASM 3.0;\nqubit[1] q;\nh q[0];\n`,
    })
    expect(snapshot.qasm).toContain(OWNER_TAG)
  })

  it('keeps source_id and owner_id off the snapshot but on the insert row', async () => {
    // They are two arguments rather than one object precisely so the private
    // columns cannot ride along on the thing that gets serialised to a reader.
    const { snapshot, digest } = await published()
    const row = publishedRunInsert(snapshot, digest, {
      sourceId: SOURCE_ID,
      ownerId: USER_ID,
    })
    expect(row.source_id).toBe(SOURCE_ID)
    expect(row.owner_id).toBe(USER_ID)
    expect(JSON.stringify(snapshot)).not.toContain(SOURCE_ID)
    expect(JSON.stringify(snapshot)).not.toContain(USER_ID)
    // The consent is recorded on the row rather than implied by its existence.
    expect(row.public_opt_in).toBe(true)
  })
})

describe('scrubVendorText', () => {
  it('removes an AWS ARN, which carries the account id in its fifth field', () => {
    const scrubbed = scrubVendorText(
      'Task arn:aws:braket:us-east-1:012345678901:quantum-task/abc failed.'
    )
    expect(scrubbed).not.toContain('012345678901')
    expect(scrubbed).toContain('[redacted-arn]')
  })

  it('removes an email address and one of our own API keys', () => {
    const scrubbed = scrubVendorText(
      'auth failed for pi@university.edu using qb16_sk_AbC123-_xyz while polling'
    )
    expect(scrubbed).not.toContain('pi@university.edu')
    expect(scrubbed).not.toContain('qb16_sk_AbC123-_xyz')
  })

  it('removes a supplied secret even when it matches none of the patterns', () => {
    // The pattern list cannot recognise a vendor handle format that did not
    // exist when it was written; the verbatim pass is what actually protects
    // this run's own identifiers.
    expect(scrubVendorText('handle XYZ-not-a-known-shape-42 died', ['XYZ-not-a-known-shape-42']))
      .toBe('handle [redacted] died')
  })

  it('ignores empty secrets instead of replacing every character', () => {
    // `split('').join('[redacted]')` on an empty needle would shred the string.
    expect(scrubVendorText('device offline', ['', null as unknown as string])).toBe(
      'device offline'
    )
  })

  it('eats a WHOLE CRN even when one of the secrets sits inside it', () => {
    // The ordering bug this pins: the verbatim replacement token contains `]`,
    // and `]` terminates the CRN pattern. Run verbatim-first and the pattern
    // stops at the token it just inserted, leaving `]:<instance-guid>::` — the
    // instance handle the CRN pattern existed to remove — in the published
    // text. Patterns must run first.
    const account = '99999999-8888-4777-8666-555555555550'
    const scrubbed = scrubVendorText(
      `instance crn:v1:bluemix:public:quantum-computing:us-east:a/${account}:INSTANCEGUIDHERE::`,
      [account]
    )
    expect(scrubbed).not.toContain('INSTANCEGUIDHERE')
    expect(scrubbed).not.toContain(account)
    expect(scrubbed).toBe('instance [redacted-crn]')
  })
})

// ── 2. Stable ids ───────────────────────────────────────────────────────────

describe('publicRunId', () => {
  it('gives the same row the same id every time, so a second publish collides', async () => {
    // A fresh random id per publish would mint a second permalink for one
    // experiment; both would then be citable and could disagree, and neither
    // could be edited to fix it.
    const first = await publicRunId(SOURCE_ID)
    const second = await publicRunId(SOURCE_ID)
    expect(first).toBe(second)
  })

  it('gives two different rows different ids', async () => {
    expect(await publicRunId(SOURCE_ID)).not.toBe(
      await publicRunId('11111111-2222-4333-8444-555555555556')
    )
  })

  it('is exactly PUBLIC_ID_LENGTH characters of the transcription-safe alphabet', async () => {
    // Pinned because the derivation is a promise: changing the length or the
    // alphabet silently makes every existing permalink unverifiable against its
    // source row.
    const id = await publicRunId(SOURCE_ID)
    expect(id).toHaveLength(PUBLIC_ID_LENGTH)
    // Crockford base32: no i, l, o or u, no uppercase.
    expect(id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]+$/)
  })

  it('does not contain the source id it was derived from', async () => {
    // A derivation that leaked any run of the uuid into the id would put the
    // owner's private history key in the URL. Checked as substrings of the id
    // rather than the other way round: asserting that the 36-char fixture does
    // not contain the 16-char id is a statement about the fixture, and would
    // pass even if `publicRunId` returned its argument unchanged.
    const id = await publicRunId(SOURCE_ID)
    const stripped = SOURCE_ID.replace(/-/g, '')
    for (let i = 0; i + 6 <= stripped.length; i++) {
      expect(id, `the id echoes part of the source uuid`).not.toContain(stripped.slice(i, i + 6))
    }
  })

  it('refuses an empty source id rather than giving every such row one id', async () => {
    await expect(publicRunId('   ')).rejects.toThrow(/source row id/)
  })

  it('builds the permalink without doubling the slash after the origin', async () => {
    const id = await publicRunId(SOURCE_ID)
    expect(runPermalinkUrl('https://qubit16.ai/', id)).toBe(`https://qubit16.ai/runs/${id}`)
    expect(runPermalinkUrl('https://qubit16.ai', id)).toBe(`https://qubit16.ai/runs/${id}`)
  })
})

// ── 3. Consent ──────────────────────────────────────────────────────────────

describe('buildPublishedRun consent and eligibility', () => {
  it('produces NOTHING for a run that was not opted in', async () => {
    const outcome = await buildPublishedRun(run(), { optIn: false })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.refusal.reason).toBe('not-opted-in')
    // No snapshot, no digest, no id — nothing a caller could insert by
    // mistaking a falsy check for a truthy one.
    expect(Object.keys(outcome)).toEqual(['ok', 'refusal'])
  })

  it('refuses even a perfectly valid run when optIn is false', async () => {
    // The consent check must come FIRST. A version that validated the row and
    // only then looked at the opt-in would still be correct today and would
    // start publishing the moment someone reordered the refusals.
    const outcome = await buildPublishedRun(
      run({ status: 'queued', qasm: null, counts: null }),
      { optIn: false }
    )
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.refusal.reason).toBe('not-opted-in')
  })

  it('refuses a run that has not reached a terminal state', async () => {
    // The row is immutable, so a queued run would be frozen before it has a
    // result and could never be corrected.
    for (const status of ['queued', 'running', null]) {
      const outcome = await buildPublishedRun(run({ status }), { optIn: true })
      if (outcome.ok) throw new Error(`published a ${status} run`)
      expect(outcome.refusal.reason).toBe('not-terminal')
    }
  })

  it('refuses a run whose circuit was not loaded', async () => {
    // GET /api/hardware/jobs omits `qasm` unless include_qasm=1, so this is the
    // refusal a caller that forgot the flag will actually hit — and publishing
    // the histogram alone would be an unreproducible permalink.
    const outcome = await buildPublishedRun(run({ qasm: null }), { optIn: true })
    if (outcome.ok) throw new Error('published a run with no circuit')
    expect(outcome.refusal.reason).toBe('no-circuit')
    expect(outcome.refusal.detail).toContain('include_qasm')
  })

  it('publishes an errored run, because a device failing is a citable result', async () => {
    const outcome = await buildPublishedRun(
      run({ status: 'error', counts: null, error: 'device offline' }),
      { optIn: true }
    )
    expect(outcome.ok).toBe(true)
  })

  it('refuses a run loaded without its account id, rather than half-scrubbing it', async () => {
    // The verbatim pass is the only part of the redaction that is more than
    // best-effort, and the account id is its most important needle. A route
    // that selected the history row without `user_id` would otherwise publish
    // a snapshot that LOOKS fine, with the scrub silently degraded to its
    // pattern list — the failure nobody would ever notice.
    // Destructured away rather than deleted, so this is the shape a route that
    // simply did not select `user_id` would actually hand us.
    const { userId: _notSelected, ...incomplete } = run({
      status: 'error',
      counts: null,
      error: 'account rejected the job',
    })
    const outcome = await buildPublishedRun(incomplete as OwnedHardwareRun, { optIn: true })
    if (outcome.ok) throw new Error('published a run whose account id was not loaded')
    expect(outcome.refusal.reason).toBe('no-account-id')
  })

  it('clamps a vendor error to the column width, and says that it did', async () => {
    // `published_runs.error` is capped at 4000 characters. Without a matching
    // clamp here a 9 kB vendor stack trace turns a consented publish into an
    // opaque Postgres check-constraint violation after the fact.
    const outcome = await buildPublishedRun(
      run({ status: 'error', counts: null, error: 'x'.repeat(9000) }),
      { optIn: true }
    )
    if (!outcome.ok) throw new Error('unreachable')
    expect(outcome.snapshot.error!.length).toBeLessThanOrEqual(MAX_PUBLISHED_ERROR_CHARS)
    // Silently cutting a third party's message and presenting the remainder as
    // the whole message is the dishonest half of truncating.
    expect(outcome.snapshot.error).toContain('truncated')
  })

  it('clamps AFTER scrubbing, because scrubbing can make the text LONGER', async () => {
    // `qb16_sk_a` (9 chars) becomes `[redacted-key]` (14). This input is under
    // the cap before scrubbing and half again over it after, so a clamp applied
    // first is a no-op and the row still violates the column check. The order
    // is what makes the bound real.
    const raw = 'qb16_sk_a '.repeat(399) // 3990 chars in, ~5985 out
    expect(raw.length).toBeLessThan(MAX_PUBLISHED_ERROR_CHARS)
    const outcome = await buildPublishedRun(
      run({ status: 'error', counts: null, error: raw }),
      { optIn: true }
    )
    if (!outcome.ok) throw new Error('unreachable')
    expect(outcome.snapshot.error).not.toContain('qb16_sk_')
    expect(outcome.snapshot.error!.length).toBeLessThanOrEqual(MAX_PUBLISHED_ERROR_CHARS)
  })

  it('refuses over-long metadata rather than truncating a citation title', async () => {
    const outcome = await buildPublishedRun(run(), {
      optIn: true,
      title: 'x'.repeat(METADATA_LIMITS.title + 1),
    })
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.refusal.reason).toBe('metadata-too-long')
  })
})

// ── The snapshot itself ─────────────────────────────────────────────────────

describe('the snapshot', () => {
  it('carries a null calibration rather than omitting it, when none was captured', async () => {
    // Nothing captures calibration against a job yet. A snapshot that dropped
    // the key would let a renderer skip the section, and a missing section
    // reads as "nothing to report" rather than "we do not know".
    const { snapshot } = await published()
    expect(snapshot).toHaveProperty('calibration')
    expect(snapshot.calibration).toBeNull()
    expect(snapshot.calibrationCapturedAt).toBeNull()
  })

  it('keeps the calibration source marker when a snapshot was captured', async () => {
    const outcome = await buildPublishedRun(run(), {
      optIn: true,
      calibration: { ...CALIBRATION, source: 'static' },
      calibrationCapturedAt: '2026-09-01T09:58:00.000Z',
    })
    if (!outcome.ok) throw new Error('unreachable')
    const row = publishedRunInsert(outcome.snapshot, outcome.digest, {
      sourceId: SOURCE_ID,
      ownerId: USER_ID,
    })
    // 'static' means the vendor's published TYPICAL values. Losing the marker
    // would let the page present a catalogue entry as a measurement.
    expect(row.calibration_source).toBe('static')
  })

  it('refuses a calibration whose provenance marker it cannot label', async () => {
    // `published_runs.calibration_source` allows exactly live/static/
    // unavailable, and the API types the field as a bare `str`. Without this
    // mirror an unrecognised marker reaches the database and comes back as a
    // check-constraint name — and the tempting "fix" is to store null, which
    // publishes noise figures a reader will assume were measured.
    const outcome = await buildPublishedRun(run(), {
      optIn: true,
      calibration: { ...CALIBRATION, source: 'cached' },
    })
    if (outcome.ok) throw new Error('published a calibration with an unlabellable source')
    expect(outcome.refusal.reason).toBe('unknown-calibration-source')
    expect(outcome.refusal.detail).toContain('cached')
  })

  it('reports an unrecorded decoupling setting as null, never as false', async () => {
    // null is "not recorded" and false is "we turned it off". A snapshot that
    // conflated them would assert something about the run that nobody checked.
    const { snapshot } = await published()
    expect(snapshot.compilation.dynamicalDecoupling).toBeNull()
    expect(snapshot.compilation.measurementTwirling).toBeNull()
  })
})

describe('snapshotDigest', () => {
  it('is stable across two builds of the same run', async () => {
    const a = await published()
    const b = await published()
    expect(a.digest).toBe(b.digest)
    expect(a.digest).toHaveLength(64)
  })

  it('changes when a single count changes', async () => {
    // The digest's only job is letting a third party notice that a published
    // row is not the row they archived. A digest that ignored `counts` would
    // pass every test that only checked its shape.
    const a = await published()
    const b = await published({ counts: { '00': 501, '11': 523 } })
    expect(a.digest).not.toBe(b.digest)
  })

  it('does not depend on the key order of the counts object', async () => {
    // Otherwise re-serialising an unchanged row could produce a different
    // digest and make an honest row look tampered with.
    const a = await published({ counts: { '00': 500, '11': 524 } })
    const b = await published({ counts: { '11': 524, '00': 500 } })
    expect(a.digest).toBe(b.digest)
  })

  it('recomputes from the row AS POSTGRES SERVES IT, not just as we wrote it', async () => {
    // THE failure this whole mechanism can have. Postgres does not hand back
    // what we sent: `timestamptz` comes out as `…+00:00` rather than `…Z`, and
    // `numeric` comes out as a string. Digest the round-tripped row without
    // canonicalising those and it disagrees with the stored digest on EVERY
    // row — which means the integrity check the schema comment promises a
    // reader cannot be performed by anyone, including us, and nobody finds out
    // because the digest still looks like a digest.
    const { snapshot, digest } = await published()
    const row = publishedRunInsert(snapshot, digest, { sourceId: SOURCE_ID, ownerId: USER_ID })
    const asPostgrestServesIt = {
      ...row,
      submitted_at: '2026-09-01T10:00:00+00:00',
      completed_at: '2026-09-01T10:45:00+00:00',
      qpu_seconds: '1.25',
      shots: 1024,
    }
    expect(await snapshotDigest(toPublishedRunSnapshot(asPostgrestServesIt))).toBe(digest)
    expect(await verifyPublishedRow(asPostgrestServesIt)).toBe(true)
  })

  it('reports a row whose counts were edited after publication as unverified', async () => {
    const { snapshot, digest } = await published()
    const row = publishedRunInsert(snapshot, digest, { sourceId: SOURCE_ID, ownerId: USER_ID })
    expect(await verifyPublishedRow({ ...row, counts: { '00': 1024 } })).toBe(false)
  })

  it('reports a row with no digest at all as unverified, not as verified', async () => {
    // Fail closed: an absent digest is the shape a partial write leaves behind,
    // and "we could not check" must never render as "checked".
    const { snapshot, digest } = await published()
    const row = publishedRunInsert(snapshot, digest, { sourceId: SOURCE_ID, ownerId: USER_ID })
    expect(await verifyPublishedRow({ ...row, snapshot_sha256: null })).toBe(false)
  })
})

describe('reading a row back', () => {
  it('survives a row missing every column added after schema_version 1', () => {
    // A published row is never rewritten, so an old row has to stay readable.
    const snapshot = toPublishedRunSnapshot({ public_id: 'abc', backend: 'ionq_aria' })
    expect(snapshot.publicId).toBe('abc')
    expect(snapshot.qpuSeconds).toBeNull()
    expect(snapshot.compilation.optimizationLevel).toBeNull()
  })

  it('reads PostgREST numeric-as-string, so qpu_seconds is not silently null', () => {
    const snapshot = toPublishedRunSnapshot({ public_id: 'abc', qpu_seconds: '1.25' })
    expect(snapshot.qpuSeconds).toBe(1.25)
  })

  it('reports an unrecognised status as error, not as a completed measurement', () => {
    const snapshot = toPublishedRunSnapshot({ public_id: 'abc', status: 'weird' })
    expect(snapshot.status).toBe('error')
  })

  it('reads a blank numeric as "not recorded", never as a depth of zero', () => {
    // `Number('')` is 0, so the obvious `typeof v === 'string' ? Number(v) : v`
    // turns an unset transpiled depth into the claim that the circuit compiled
    // to depth 0 — a number a reader would compare against another run's.
    const snapshot = toPublishedRunSnapshot({
      public_id: 'abc',
      qpu_seconds: '',
      transpiled_depth: '   ',
      transpiled_two_qubit_gates: 'n/a',
    })
    expect(snapshot.qpuSeconds).toBeNull()
    expect(snapshot.compilation.transpiledDepth).toBeNull()
    expect(snapshot.compilation.transpiledTwoQubitGates).toBeNull()
  })

  it('keeps a later schema_version instead of relabelling the row as v1', () => {
    // Published rows are never rewritten, so a v2 row will outlive this build.
    // Reporting it as v1 would both mislabel it and break its own digest, since
    // schema_version is one of the fields the digest covers.
    expect(toPublishedRunSnapshot({ public_id: 'abc', schema_version: 2 }).schemaVersion).toBe(2)
    expect(toPublishedRunSnapshot({ public_id: 'abc' }).schemaVersion).toBe(
      SNAPSHOT_SCHEMA_VERSION
    )
  })

  it('normalises the timestamp spelling Postgres uses back to the digest form', () => {
    expect(
      toPublishedRunSnapshot({ public_id: 'abc', submitted_at: '2026-09-01T10:00:00+00:00' })
        .submittedAt
    ).toBe('2026-09-01T10:00:00.000Z')
  })
})

describe('runBibtex', () => {
  it('omits the author field rather than inventing one from the account', async () => {
    // The account holder is not necessarily who should be credited, and they
    // never consented to their identity being published.
    const { snapshot } = await published()
    const entry = runBibtex(snapshot, runPermalinkUrl('https://qubit16.ai', snapshot.publicId))
    expect(entry).not.toContain('author')
    expect(entry).toContain(snapshot.publicId)
    expect(entry).toContain('howpublished')
  })

  it('uses the publisher-typed attribution when there is one', async () => {
    const outcome = await buildPublishedRun(run(), { optIn: true, attribution: 'A Researcher' })
    if (!outcome.ok) throw new Error('unreachable')
    const entry = runBibtex(outcome.snapshot, 'https://qubit16.ai/runs/x')
    expect(entry).toContain('author = {A Researcher}')
  })

  it('escapes the underscore in an IBM backend name, which is in EVERY entry', () => {
    // Every IBM device is `ibm_<something>`, and the backend goes into the note
    // of every entry and into the default title. An unescaped `_` is a LaTeX
    // maths shift in text mode: before this, every IBM citation we emitted made
    // the reader's document fail to build with "Missing $ inserted", in
    // somebody else's log, with our name on it.
    const entry = runBibtex(
      toPublishedRunSnapshot({
        public_id: 'abc',
        backend: 'ibm_brisbane',
        shots: 1024,
        submitted_at: '2026-09-01T10:00:00.000Z',
      }),
      'https://qubit16.ai/runs/abc'
    )
    expect(entry).not.toMatch(/[^\\]_/)
    expect(entry).toContain('ibm\\_brisbane')
    // The URL macro is ours and must survive escaping intact.
    expect(entry).toContain('howpublished = {\\url{https://qubit16.ai/runs/abc}}')
  })

  it('escapes the other LaTeX specials a publisher can type into a title', () => {
    const entry = runBibtex(
      toPublishedRunSnapshot({ public_id: 'abc', title: '50% & $5 #1 x^2 ~ y' }),
      'https://qubit16.ai/runs/abc'
    )
    expect(entry).toContain('title = {50\\% \\& \\$5 \\#1 x2  y}')
  })

  it('strips braces from a title so the entry still parses', () => {
    const snapshot = toPublishedRunSnapshot({
      public_id: 'abc',
      title: 'GHZ {with} braces',
      submitted_at: '2026-09-01T10:00:00.000Z',
      backend: 'ibm_brisbane',
    })
    const entry = runBibtex(snapshot, 'https://qubit16.ai/runs/abc')
    expect(entry).toContain('title = {GHZ with braces}')
  })
})
