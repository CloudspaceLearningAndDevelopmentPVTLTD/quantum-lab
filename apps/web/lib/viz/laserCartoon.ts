/**
 * lib/viz/laserCartoon.ts — a few dozen atoms in a cavity, one photon at a time.
 *
 * The quantitative panels on /visualizations/lasers come from the closed-form
 * rate equations in lib/quantum/laser.ts, with 10¹⁹ ions and 10¹³ photons.
 * This module is the same physics at a size you can watch: a slab of atoms
 * between two mirrors, pump events lifting atoms, spontaneous photons leaving
 * in random directions, and — when a mode photon passes an excited atom — a
 * second photon appearing beside it with the same direction and phase.
 *
 * It is a kinetic Monte Carlo of the rate equations, not a drawing of them:
 *   - every atom-level change is a Bernoulli trial at the stated rate;
 *   - absorption and stimulated emission use the SAME probability per pass
 *     (that is B₁₂ = B₂₁), so photons only multiply when excited atoms
 *     outnumber ground ones along the path;
 *   - the only way a photon enters the mode is spontaneous emission that
 *     happens to point down the axis, and the only ways out are absorption
 *     and the output mirror.
 *
 * Coordinates: the cavity axis runs x = 0 (back mirror) to x = 1 (output
 * mirror); the atom slab occupies [SLAB_LEFT, SLAB_RIGHT]. Lanes are a
 * vertical offset in [−1, 1] used only for drawing. Time is wall-clock
 * seconds, with rates chosen to be watchable rather than physical.
 *
 * Nothing here touches the DOM; LaserLab.tsx draws whatever state this holds.
 */

export type Level = 1 | 2 | 3
export type Scheme = 'three' | 'two'

export type CartoonParams = {
  cols: number
  rows: number
  scheme: Scheme
  /** Pump rate per ground atom, in units of the spontaneous rate. */
  pumpRatio: number
  /** Spontaneous decay rate of level 2, s⁻¹ of wall time. */
  spontRate: number
  /** Decay rate of the pump band into level 2, s⁻¹ (three-level only). */
  pumpBandDecay: number
  /** Probability that a mode photon passing a column stimulates (or is absorbed by) the atom it meets. */
  stimProb: number
  /** Fraction of photons hitting the output mirror that leave. */
  mirrorTransmission: number
  /** Spontaneous photons within this angle (rad) of the axis join the mode. */
  modeHalfAngle: number
  /** Cavity lengths per second. */
  photonSpeed: number
  /** Mode photons are not cloned past this — a drawing budget, and it is reported. */
  maxModePhotons: number
}

export const SLAB_LEFT = 0.3
export const SLAB_RIGHT = 0.7
/**
 * Stray photons live in cavity-length units on both axes so they move
 * isotropically; a mode lane of ±1 maps to ±STRAY_LANE cavity lengths.
 */
export const STRAY_LANE = 0.08

export const DEFAULT_CARTOON: CartoonParams = {
  cols: 7,
  rows: 6,
  scheme: 'three',
  pumpRatio: 0.5,
  spontRate: 0.6,
  pumpBandDecay: 5,
  stimProb: 0.3,
  mirrorTransmission: 0.2,
  modeHalfAngle: 0.12,
  photonSpeed: 0.8,
  maxModePhotons: 500,
}

export type Atom = { level: Level }

export type ModePhoton = {
  x: number
  dir: 1 | -1
  lane: number
  phase: number
  /** Index of the column this photon most recently crossed, so a bounce does not re-trigger it. */
  lastCol: number
}

export type StrayKind = 'spontaneous' | 'output' | 'pump'

export type StrayPhoton = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  kind: StrayKind
}

export type CartoonCounts = {
  pumped: number
  /** Pump light knocking an excited two-level atom back down. */
  pumpedDown: number
  spontaneous: number
  /** Spontaneous photons that happened to leave along the axis. */
  seeded: number
  stimulated: number
  absorbed: number
  output: number
  /** Clones that were not created because the drawing budget was full. */
  overflow: number
}

export type CartoonState = {
  t: number
  atoms: Atom[]
  photons: ModePhoton[]
  strays: StrayPhoton[]
  counts: CartoonCounts
  /** Mode photon count sampled every HISTORY_DT seconds, oldest first. */
  history: number[]
  historyClock: number
}

export const HISTORY_DT = 0.1
export const HISTORY_LENGTH = 300
const STRAY_LIFETIME = 1.4

export function columnX(col: number, cols: number): number {
  return SLAB_LEFT + ((col + 0.5) / cols) * (SLAB_RIGHT - SLAB_LEFT)
}

export function createCartoon(params: CartoonParams): CartoonState {
  return {
    t: 0,
    atoms: Array.from({ length: params.cols * params.rows }, () => ({ level: 1 })),
    photons: [],
    strays: [],
    counts: {
      pumped: 0,
      pumpedDown: 0,
      spontaneous: 0,
      seeded: 0,
      stimulated: 0,
      absorbed: 0,
      output: 0,
      overflow: 0,
    },
    history: [],
    historyClock: 0,
  }
}

export function levelCounts(state: CartoonState): { n1: number; n2: number; n3: number } {
  let n1 = 0
  let n2 = 0
  let n3 = 0
  for (const a of state.atoms) {
    if (a.level === 1) n1++
    else if (a.level === 2) n2++
    else n3++
  }
  return { n1, n2, n3 }
}

/** Probability of at least one event in dt at rate r. */
const bern = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)

/**
 * Advance the cartoon by dt seconds. `rand` is a uniform [0, 1) source so the
 * stream is reproducible under test. Mutates `state`.
 */
export function stepCartoon(
  state: CartoonState,
  params: CartoonParams,
  dt: number,
  rand: () => number
): void {
  const { cols, rows } = params
  const pumpRate = params.pumpRatio * params.spontRate
  const pPump = bern(pumpRate, dt)
  const pSpont = bern(params.spontRate, dt)
  const pBand = bern(params.pumpBandDecay, dt)

  // ── Atoms ──
  for (let i = 0; i < state.atoms.length; i++) {
    const atom = state.atoms[i]
    const col = Math.floor(i / rows)
    const row = i % rows
    if (atom.level === 1) {
      if (rand() < pPump) {
        atom.level = params.scheme === 'three' ? 3 : 2
        state.counts.pumped++
      }
    } else if (atom.level === 3) {
      if (rand() < pBand) atom.level = 2
    } else {
      // Level 2. In the two-level scheme the pump light also drives 2 → 1 at
      // the same rate it drives 1 → 2, emitting a pump photon sideways.
      if (params.scheme === 'two' && rand() < pPump) {
        atom.level = 1
        state.counts.pumpedDown++
        state.strays.push({
          x: columnX(col, cols),
          y: laneOf(row, rows) * STRAY_LANE,
          vx: 0,
          vy: rand() < 0.5 ? -params.photonSpeed : params.photonSpeed,
          age: 0,
          kind: 'pump',
        })
      } else if (rand() < pSpont) {
        atom.level = 1
        state.counts.spontaneous++
        const theta = rand() * Math.PI * 2
        const dx = Math.cos(theta)
        const dy = Math.sin(theta)
        const offAxis = Math.min(Math.abs(theta), Math.abs(theta - Math.PI), Math.abs(theta - 2 * Math.PI))
        if (offAxis < params.modeHalfAngle) {
          state.counts.seeded++
          if (state.photons.length < params.maxModePhotons) {
            state.photons.push({
              x: columnX(col, cols),
              dir: dx >= 0 ? 1 : -1,
              lane: laneOf(row, rows),
              phase: rand() * Math.PI * 2,
              lastCol: col,
            })
          } else {
            state.counts.overflow++
          }
        } else {
          state.strays.push({
            x: columnX(col, cols),
            y: laneOf(row, rows) * STRAY_LANE,
            vx: dx * params.photonSpeed,
            vy: dy * params.photonSpeed,
            age: 0,
            kind: 'spontaneous',
          })
        }
      }
    }
  }

  // ── Mode photons ──
  const step = params.photonSpeed * dt
  const keep: ModePhoton[] = []
  const born: ModePhoton[] = []
  for (const ph of state.photons) {
    const x0 = ph.x
    let x1 = x0 + ph.dir * step
    let alive = true

    // Columns crossed on this move, in travel order.
    const from = Math.min(x0, x1)
    const to = Math.max(x0, x1)
    const crossed: number[] = []
    for (let c = 0; c < cols; c++) {
      const cx = columnX(c, cols)
      if (cx > from && cx <= to && c !== ph.lastCol) crossed.push(c)
    }
    if (ph.dir === -1) crossed.reverse()

    for (const c of crossed) {
      ph.lastCol = c
      const row = Math.floor(rand() * rows)
      const atom = state.atoms[c * rows + row]
      if (atom.level === 2) {
        if (rand() < params.stimProb) {
          atom.level = 1
          state.counts.stimulated++
          if (state.photons.length + born.length + keep.length < params.maxModePhotons) {
            born.push({
              x: columnX(c, cols),
              dir: ph.dir,
              lane: clampLane(ph.lane + (rand() - 0.5) * 0.25),
              phase: ph.phase,
              lastCol: c,
            })
          } else {
            state.counts.overflow++
          }
        }
      } else if (atom.level === 1) {
        if (rand() < params.stimProb) {
          atom.level = 2
          state.counts.absorbed++
          alive = false
          break
        }
      }
    }
    if (!alive) continue

    // Mirrors.
    if (x1 >= 1) {
      if (rand() < params.mirrorTransmission) {
        state.counts.output++
        state.strays.push({
          x: 1,
          y: ph.lane * STRAY_LANE,
          vx: params.photonSpeed,
          vy: 0,
          age: 0,
          kind: 'output',
        })
        continue
      }
      x1 = 2 - x1
      ph.dir = -1
      ph.lastCol = -1
    } else if (x1 <= 0) {
      x1 = -x1
      ph.dir = 1
      ph.lastCol = -1
    }
    ph.x = x1
    keep.push(ph)
  }
  // Clones start where they were made and travel with their parent from the
  // next frame; they never re-trigger the column they were born in.
  state.photons = keep.concat(born)

  // ── Strays ──
  const strays: StrayPhoton[] = []
  for (const s of state.strays) {
    s.x += s.vx * dt
    s.y += s.vy * dt
    s.age += dt
    if (s.age < STRAY_LIFETIME && s.x > -0.3 && s.x < 1.6 && s.y > -0.6 && s.y < 0.6) strays.push(s)
  }
  state.strays = strays

  // ── Clock and history ──
  state.t += dt
  state.historyClock += dt
  while (state.historyClock >= HISTORY_DT) {
    state.historyClock -= HISTORY_DT
    state.history.push(state.photons.length)
    if (state.history.length > HISTORY_LENGTH) state.history.shift()
  }
}

/** Reset the atoms and photons but keep the clock, for a scheme or pump change. */
export function resetCartoon(state: CartoonState, params: CartoonParams): void {
  const fresh = createCartoon(params)
  state.atoms = fresh.atoms
  state.photons = fresh.photons
  state.strays = fresh.strays
  state.counts = fresh.counts
  state.history = fresh.history
  state.historyClock = 0
}

function laneOf(row: number, rows: number): number {
  return rows <= 1 ? 0 : ((row + 0.5) / rows) * 2 - 1
}

function clampLane(v: number): number {
  return Math.max(-1, Math.min(1, v))
}
