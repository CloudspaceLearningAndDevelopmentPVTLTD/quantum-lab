/**
 * chsh.ts — the numerics behind /visualizations/bell-test.
 *
 * ── What this module computes ───────────────────────────────────────────────────
 *
 * The CHSH form of Bell's inequality. Alice picks one of two analyzer angles
 * (a or a′), Bob picks one of two (b or b′), each records ±1, and the experiment
 * accumulates four correlators E(x, y) = ⟨A·B⟩. The CHSH statistic is
 *
 *     S = E(a,b) − E(a,b′) + E(a′,b) + E(a′,b′)
 *
 * Bell's theorem: for ANY local hidden-variable model, |S| ≤ 2. Quantum mechanics
 * reaches |S| = 2√2 ≈ 2.828 (Tsirelson's bound) on the singlet, and no further.
 *
 * ── Angles: analyzers vs the Bloch/Poincaré sphere ──────────────────────────────
 *
 * The primitive is the spin-½ singlet correlation for two measurement directions
 * separated by an angle in a plane of the Bloch sphere:
 *
 *     E(a, b) = −cos(a − b)                                [singletCorrelation]
 *
 * The page is framed as a polarization experiment, because that is where the
 * famous 0° / 45° / 22.5° / 67.5° settings come from. A polarizer rotated by θ in
 * the lab moves the state's vector by 2θ on the Poincaré sphere — H and V are
 * physically 90° apart but antipodal on the sphere — so an analyzer at α acts as a
 * Bloch-plane direction 2α, and the photon singlet |Ψ⁻⟩ = (|HV⟩ − |VH⟩)/√2 gives
 *
 *     E(α, β) = −cos(2(α − β))                             [analyzerCorrelation]
 *
 * That factor of two is the whole reason the optimal analyzer settings are spaced
 * 22.5° apart rather than 45°. Every public function below that takes an angle
 * takes an ANALYZER angle in DEGREES; `singletCorrelation` is the one exception
 * and takes Bloch-plane radians, because it is the underlying identity.
 *
 * ── The local hidden-variable models ────────────────────────────────────────────
 *
 * Both are real simulations. Each pair is created carrying a hidden variable λ —
 * a shared secret polarization angle, plus one private uniform draw per side — and
 * each side's outcome is a function of ITS OWN analyzer setting and λ alone.
 * Neither side can see the other's setting. That is locality, expressed as a type
 * signature: `lhvOutcome` is given one setting, never both.
 *
 *   'naive'      Each photon really does have a definite polarization, and passes
 *                its analyzer with the Malus-law probability cos²(α − λ). This is
 *                what a physicist who had never heard of Bell would write down.
 *                It yields E = −½cos(2(α−β)) — exactly half the quantum
 *                correlation — and tops out at |S| = √2 ≈ 1.414.
 *
 *   'conspiracy' The provably optimal deterministic strategy: A = sign cos(2(α−λ)),
 *                B = −sign cos(2(β−λ)). It gives a triangle-wave correlation
 *                E = −(1 − d/90°), the best straight-line-in-λ approximation to
 *                −cos, and it hits |S| = 2 exactly at the optimal settings. It
 *                does not creep past 2, and the reason is arithmetic, not a cap in
 *                this file: see `chshWitness`.
 *
 * ── Why the bound is not a coded-in ceiling ─────────────────────────────────────
 *
 * `chshWitness` evaluates the CHSH combination on a SINGLE λ, using all four
 * settings against that one hidden variable:
 *
 *     A(a)[B(b) − B(b′)] + A(a′)[B(b) + B(b′)]
 *
 * Since B(b) and B(b′) are each ±1, one bracket is 0 and the other is ±2, so the
 * witness is exactly ±2 for every λ, every strategy, every angle. S is the average
 * of that quantity, and an average of ±2 cannot leave [−2, 2]. chsh.test.ts checks
 * this over thousands of seeded λ. Nothing here clamps anything.
 */

import { mulberry32 } from '@/lib/quantum'

/** |S| ≤ 2 for every local hidden-variable model. Bell, 1964; CHSH, 1969. */
export const CLASSICAL_BOUND = 2

/** Tsirelson's bound: quantum mechanics reaches 2√2 and stops there too. */
export const TSIRELSON_BOUND = 2 * Math.SQRT2

const DEG = Math.PI / 180

/** The four analyzer settings of a CHSH run, in degrees. */
export type ChshSettings = {
  /** Alice's first setting. */
  a: number
  /** Alice's second setting. */
  aPrime: number
  /** Bob's first setting. */
  b: number
  /** Bob's second setting. */
  bPrime: number
}

/**
 * The settings that maximise |S| for the singlet: Alice at 0° and 45°, Bob at
 * 22.5° and 67.5°. Every adjacent Alice–Bob pair is 22.5° apart, which is 45°
 * on the Poincaré sphere, which is where |cos| × 4 terms peak at 2√2.
 */
export const OPTIMAL_SETTINGS: ChshSettings = { a: 0, aPrime: 45, b: 22.5, bPrime: 67.5 }

/** The four correlators, in the order the CHSH combination uses them. */
export type Correlators = {
  ab: number
  abPrime: number
  aPrimeB: number
  aPrimeBPrime: number
}

/** The four (Alice, Bob) setting combinations, indexed 0..3 the same way throughout. */
export const SETTING_PAIRS = ['ab', 'abPrime', 'aPrimeB', 'aPrimeBPrime'] as const
export type SettingPairKey = (typeof SETTING_PAIRS)[number]

/** Human labels for the four combinations, for chart axes and screen readers. */
export const PAIR_LABELS: Record<SettingPairKey, string> = {
  ab: 'E(a,b)',
  abPrime: "E(a,b′)",
  aPrimeB: "E(a′,b)",
  aPrimeBPrime: "E(a′,b′)",
}

/** The (Alice, Bob) analyzer angles for one of the four combinations. */
export function anglesFor(settings: ChshSettings, pair: SettingPairKey): [number, number] {
  switch (pair) {
    case 'ab':
      return [settings.a, settings.b]
    case 'abPrime':
      return [settings.a, settings.bPrime]
    case 'aPrimeB':
      return [settings.aPrime, settings.b]
    case 'aPrimeBPrime':
      return [settings.aPrime, settings.bPrime]
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Quantum
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The spin-½ singlet correlation: E(a, b) = −cos(a − b), for two measurement
 * directions at Bloch-plane angles a and b in RADIANS. Perfect anticorrelation
 * when the directions agree, perfect correlation when they are opposed.
 */
export function singletCorrelation(a: number, b: number): number {
  return -Math.cos(a - b)
}

/**
 * The polarization singlet correlation for two analyzers, in DEGREES. A polarizer
 * turned by α is a Bloch-plane direction at 2α, so this is `singletCorrelation`
 * at doubled angles.
 */
export function analyzerCorrelation(alphaDeg: number, betaDeg: number): number {
  return singletCorrelation(2 * alphaDeg * DEG, 2 * betaDeg * DEG)
}

/** S = E(a,b) − E(a,b′) + E(a′,b) + E(a′,b′). Signed; the bound applies to |S|. */
export function chshFromCorrelators(c: Correlators): number {
  return c.ab - c.abPrime + c.aPrimeB + c.aPrimeBPrime
}

/** The exact quantum correlators for these settings — no sampling. */
export function quantumCorrelators(settings: ChshSettings): Correlators {
  const e = (pair: SettingPairKey) => {
    const [alpha, beta] = anglesFor(settings, pair)
    return analyzerCorrelation(alpha, beta)
  }
  return {
    ab: e('ab'),
    abPrime: e('abPrime'),
    aPrimeB: e('aPrimeB'),
    aPrimeBPrime: e('aPrimeBPrime'),
  }
}

/** The exact quantum S for these settings. |quantumS(OPTIMAL_SETTINGS)| = 2√2. */
export function quantumS(settings: ChshSettings): number {
  return chshFromCorrelators(quantumCorrelators(settings))
}

/**
 * One measured pair from the singlet, at the given analyzer angles.
 *
 * Both marginals are exactly fair — that is the point of the singlet, and it is
 * why no message can be sent this way — so Alice's bit is a coin flip and Bob's
 * agrees with it with probability (1 + E)/2.
 */
export function sampleQuantumPair(
  alphaDeg: number,
  betaDeg: number,
  rand: () => number
): [1 | -1, 1 | -1] {
  const e = analyzerCorrelation(alphaDeg, betaDeg)
  const a: 1 | -1 = rand() < 0.5 ? 1 : -1
  const agree = rand() < (1 + e) / 2
  return [a, (agree ? a : -a) as 1 | -1]
}

// ─────────────────────────────────────────────────────────────────────────────
// Local hidden variables
// ─────────────────────────────────────────────────────────────────────────────

export type LhvStrategy = 'naive' | 'conspiracy'

export const LHV_STRATEGY_LABELS: Record<LhvStrategy, string> = {
  naive: 'Naive realist',
  conspiracy: 'Best conspiracy',
}

/**
 * The hidden variable carried by one pair.
 *
 * `angleDeg` is the shared secret the two photons agreed on at the source.
 * `ua` and `ub` are each side's own private randomness — allowed, and included
 * because a hidden-variable model is not required to be deterministic. They are
 * drawn ONCE per pair and reused across whichever setting that side is asked
 * about, which is what makes the outcome a well-defined function of (setting, λ)
 * and therefore what makes `chshWitness` meaningful.
 */
export type Lambda = {
  angleDeg: number
  ua: number
  ub: number
}

export function sampleLambda(rand: () => number): Lambda {
  return { angleDeg: rand() * 180, ua: rand(), ub: rand() }
}

/**
 * One side's outcome. Note the signature: a side is given ITS OWN setting and the
 * shared λ, and nothing else. There is no channel here for the far analyzer's
 * angle to reach this function — locality, enforced by the type.
 */
export function lhvOutcome(
  strategy: LhvStrategy,
  side: 'A' | 'B',
  settingDeg: number,
  lambda: Lambda
): 1 | -1 {
  const delta = (settingDeg - lambda.angleDeg) * DEG
  if (strategy === 'naive') {
    // Malus's law on a definite polarization. Bob's photon leaves the source
    // polarized at right angles to Alice's, hence sin² rather than cos².
    if (side === 'A') return lambda.ua < Math.cos(delta) ** 2 ? 1 : -1
    return lambda.ub < Math.sin(delta) ** 2 ? 1 : -1
  }
  // The optimal deterministic strategy: split the Poincaré circle in half at λ.
  const sign = Math.cos(2 * delta) >= 0 ? 1 : -1
  return (side === 'A' ? sign : -sign) as 1 | -1
}

/** Both sides' outcomes for one pair at one setting combination. */
export function sampleLhvPair(
  strategy: LhvStrategy,
  alphaDeg: number,
  betaDeg: number,
  lambda: Lambda
): [1 | -1, 1 | -1] {
  return [
    lhvOutcome(strategy, 'A', alphaDeg, lambda),
    lhvOutcome(strategy, 'B', betaDeg, lambda),
  ]
}

/** Fold an angle difference in degrees onto [0, 180]. */
function fold180(deg: number): number {
  const m = ((deg % 360) + 360) % 360
  return m > 180 ? 360 - m : m
}

/**
 * The exact expected correlator for a strategy — the value the simulation
 * converges to, derived analytically rather than measured, so the tests can
 * compare the sampler against something independent of itself.
 *
 *   naive:       ⟨A|λ⟩ = cos(2(α−λ)), ⟨B|λ⟩ = −cos(2(β−λ)); averaging the product
 *                over λ leaves −½cos(2(α−β)).
 *   conspiracy:  two half-circles overlap in proportion to their angular offset,
 *                giving the triangle wave −(1 − d/90) with d = |2(α−β)| folded
 *                onto [0°, 180°].
 */
export function lhvCorrelation(strategy: LhvStrategy, alphaDeg: number, betaDeg: number): number {
  if (strategy === 'naive') return -0.5 * Math.cos(2 * (alphaDeg - betaDeg) * DEG)
  return -(1 - fold180(2 * (alphaDeg - betaDeg)) / 90)
}

/** The exact expected correlators for a strategy at these settings. */
export function lhvCorrelators(strategy: LhvStrategy, settings: ChshSettings): Correlators {
  const e = (pair: SettingPairKey) => {
    const [alpha, beta] = anglesFor(settings, pair)
    return lhvCorrelation(strategy, alpha, beta)
  }
  return {
    ab: e('ab'),
    abPrime: e('abPrime'),
    aPrimeB: e('aPrimeB'),
    aPrimeBPrime: e('aPrimeBPrime'),
  }
}

/** The exact expected S for a hidden-variable strategy. Always within ±2. */
export function lhvS(strategy: LhvStrategy, settings: ChshSettings): number {
  return chshFromCorrelators(lhvCorrelators(strategy, settings))
}

/**
 * The CHSH combination evaluated against a SINGLE hidden variable — the quantity
 * whose average is S, and the reason the classical bound exists.
 *
 * Because B(b) and B(b′) are each ±1, exactly one of the two brackets below is
 * zero and the other is ±2. So this returns ±2 for every λ, and S — an average of
 * ±2 values — can never leave [−2, 2]. This is Bell's argument in four lines, and
 * it is why the classical racer in the visualization stalls rather than being
 * stopped.
 *
 * A quantum pair has no λ to hand to this function. That is the entire point:
 * you cannot ask a qubit what it *would* have said at the angle you did not use.
 */
export function chshWitness(
  strategy: LhvStrategy,
  settings: ChshSettings,
  lambda: Lambda
): number {
  const a = lhvOutcome(strategy, 'A', settings.a, lambda)
  const aP = lhvOutcome(strategy, 'A', settings.aPrime, lambda)
  const b = lhvOutcome(strategy, 'B', settings.b, lambda)
  const bP = lhvOutcome(strategy, 'B', settings.bPrime, lambda)
  return a * (b - bP) + aP * (b + bP)
}

// ─────────────────────────────────────────────────────────────────────────────
// Accumulating a run
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-setting-pair tallies for one model: how many pairs were measured at each
 * combination, and the running sum of the A·B products (each ±1).
 */
export type Tally = {
  counts: [number, number, number, number]
  sums: [number, number, number, number]
}

function emptyTally(): Tally {
  return { counts: [0, 0, 0, 0], sums: [0, 0, 0, 0] }
}

/** One point on the convergence chart. */
export type RunSample = {
  trials: number
  /** |S| for the quantum experiment at this trial count. */
  quantum: number
  /** One standard error on the quantum |S|. */
  quantumSe: number
  classical: number
  classicalSe: number
}

export type ChshRun = {
  strategy: LhvStrategy
  settings: ChshSettings
  trials: number
  quantum: Tally
  classical: Tally
  samples: RunSample[]
  /** The most recent pairs, newest last, for the raw-data strip. */
  recent: RecentTrial[]
  nextSampleAt: number
  sampleEvery: number
  /**
   * Running sum of `chshWitness` over every λ the classical source has emitted —
   * the counterfactual audit. Each term is exactly ±2, so `witnessSum / trials`
   * is confined to [−2, 2] by arithmetic and never fluctuates past it, unlike the
   * measured S above. `witnessMaxAbs` is the largest single term seen, which is
   * always exactly 2: the classical model's best pair is never better than that.
   */
  witnessSum: number
  witnessMaxAbs: number
}

export type RecentTrial = {
  pair: 0 | 1 | 2 | 3
  quantumAgree: boolean
  classicalAgree: boolean
}

/** How many recent trials the raw-data strip keeps. */
export const RECENT_TRIALS = 64

export function createRun(
  strategy: LhvStrategy,
  settings: ChshSettings,
  sampleEvery: number
): ChshRun {
  return {
    strategy,
    settings,
    trials: 0,
    quantum: emptyTally(),
    classical: emptyTally(),
    samples: [],
    recent: [],
    nextSampleAt: sampleEvery,
    sampleEvery,
    witnessSum: 0,
    witnessMaxAbs: 0,
  }
}

/**
 * Run `batch` more pairs.
 *
 * Each trial picks one of the four setting combinations at random — the protocol a
 * real Bell test uses, and the reason each correlator is estimated from only about
 * a quarter of the trials. Both models see the SAME choice on the same trial and
 * the same number of trials overall, so the race is fair.
 */
export function advanceRun(run: ChshRun, rand: () => number, batch: number): void {
  for (let i = 0; i < batch; i++) {
    const idx = Math.min(3, Math.floor(rand() * 4)) as 0 | 1 | 2 | 3
    const [alpha, beta] = anglesFor(run.settings, SETTING_PAIRS[idx])

    const [qa, qb] = sampleQuantumPair(alpha, beta, rand)
    const lambda = sampleLambda(rand)
    const [ca, cb] = sampleLhvPair(run.strategy, alpha, beta, lambda)

    run.quantum.counts[idx]++
    run.quantum.sums[idx] += qa * qb
    run.classical.counts[idx]++
    run.classical.sums[idx] += ca * cb
    run.trials++

    // The counterfactual audit: interrogate the SAME λ at all four settings.
    // A real experiment cannot do this — the point of the exercise — but the
    // classical source is a piece of code, so we can, and the answer is always ±2.
    const witness = chshWitness(run.strategy, run.settings, lambda)
    run.witnessSum += witness
    run.witnessMaxAbs = Math.max(run.witnessMaxAbs, Math.abs(witness))

    run.recent.push({ pair: idx, quantumAgree: qa === qb, classicalAgree: ca === cb })
    if (run.recent.length > RECENT_TRIALS) run.recent.shift()

    if (run.trials >= run.nextSampleAt) {
      run.samples.push(sampleOf(run))
      run.nextSampleAt += run.sampleEvery
    }
  }
}

/** Measured correlators and their standard errors, from a tally. */
export type TallyStats = {
  correlators: Correlators
  /** Estimated E and its standard error, per setting pair, in SETTING_PAIRS order. */
  perPair: { e: number; se: number; n: number }[]
  s: number
  sAbs: number
  /** One standard error on S, propagated from the four independent correlators. */
  se: number
}

/**
 * Each correlator is the mean of n draws of ±1, so its variance is (1 − E²)/n.
 * The four correlators come from disjoint trials and are therefore independent,
 * so the variances add. With no data the error is reported as Infinity rather
 * than 0 — an unmeasured quantity is not a precisely known one.
 */
export function summarize(t: Tally): TallyStats {
  const perPair = t.counts.map((n, i) => {
    const e = n > 0 ? t.sums[i] / n : 0
    const se = n > 0 ? Math.sqrt(Math.max(0, 1 - e * e) / n) : Infinity
    return { e, se, n }
  })
  const correlators: Correlators = {
    ab: perPair[0].e,
    abPrime: perPair[1].e,
    aPrimeB: perPair[2].e,
    aPrimeBPrime: perPair[3].e,
  }
  const s = chshFromCorrelators(correlators)
  const variance = perPair.reduce((acc, p) => acc + (p.n > 0 ? (1 - p.e * p.e) / p.n : Infinity), 0)
  return { correlators, perPair, s, sAbs: Math.abs(s), se: Math.sqrt(variance) }
}

function sampleOf(run: ChshRun): RunSample {
  const q = summarize(run.quantum)
  const c = summarize(run.classical)
  return {
    trials: run.trials,
    quantum: q.sAbs,
    quantumSe: Number.isFinite(q.se) ? q.se : 0,
    classical: c.sAbs,
    classicalSe: Number.isFinite(c.se) ? c.se : 0,
  }
}

/**
 * A complete seeded run in one call — the form the unit tests use, and the form
 * `prefers-reduced-motion` takes on the page (no animation, one quiet batch).
 */
export function runChsh(
  strategy: LhvStrategy,
  settings: ChshSettings,
  trials: number,
  seed: number
): { quantum: TallyStats; classical: TallyStats; run: ChshRun } {
  const run = createRun(strategy, settings, Math.max(1, Math.floor(trials / 60)))
  advanceRun(run, mulberry32(seed), trials)
  return { quantum: summarize(run.quantum), classical: summarize(run.classical), run }
}
