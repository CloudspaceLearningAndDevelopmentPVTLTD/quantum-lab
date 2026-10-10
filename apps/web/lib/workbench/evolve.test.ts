import { describe, expect, it } from 'vitest'
import { StateVector } from '@/lib/quantum'
import {
  EVOLVE_LIMITS,
  GRAMMAR,
  PROBLEMS,
  applyCost,
  applyMixer,
  bruteForceMaxCut,
  buildProposalPrompt,
  cutValue,
  describeProgram,
  evolve,
  expectedCut,
  extractPrograms,
  fitnessCurve,
  formatProgram,
  getProblem,
  mutateProgram,
  parseProgram,
  runClassical,
  runQaoa,
  type Graph,
  type ProposalContext,
  type ProviderAdapter,
} from './evolve'
import { mulberry32 } from '@/lib/quantum'

const ring = (n: number): Graph => ({
  n,
  edges: Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as const),
})

function mustParse(text: string, numQubits: number) {
  const r = parseProgram(text, numQubits)
  if (!r.ok) throw new Error(`expected parse: ${r.error}`)
  return r.program
}

// ────────────────────────────────────────────────────────────
// The DSL interpreter on hand-written candidates
// ────────────────────────────────────────────────────────────

describe('parseProgram — qaoa', () => {
  it('parses cost/mix pairs with decimal and pi-fraction angles', () => {
    const p = mustParse('qaoa\ncost pi/4\nmix x pi/8\ncost -0.5\nmix xy 2pi', 4)
    expect(p.kind).toBe('qaoa')
    if (p.kind !== 'qaoa') return
    expect(p.layers).toHaveLength(2)
    expect(p.layers[0].gamma).toBeCloseTo(Math.PI / 4, 12)
    expect(p.layers[0].beta).toBeCloseTo(Math.PI / 8, 12)
    expect(p.layers[0].mixer).toBe('x')
    expect(p.layers[1].gamma).toBe(-0.5)
    expect(p.layers[1].mixer).toBe('xy')
    expect(p.layers[1].beta).toBeCloseTo(2 * Math.PI, 12)
  })

  it('expands anneal <p> <gamma> <beta> into the linear schedule the grammar states', () => {
    const p = mustParse('qaoa\nanneal 4 1.0 0.8', 4)
    if (p.kind !== 'qaoa') throw new Error('kind')
    expect(p.layers).toHaveLength(4)
    // gamma_k = gamma·k/p ; beta_k = beta·(1 − (k−1)/p)
    expect(p.layers.map((l) => l.gamma)).toEqual([0.25, 0.5, 0.75, 1.0])
    expect(p.layers.map((l) => l.beta)).toEqual([0.8, 0.6, 0.4, 0.2].map((v) => expect.closeTo(v, 12)))
    expect(p.layers.every((l) => l.mixer === 'x')).toBe(true)
  })

  it('ignores comments, blank lines and case', () => {
    const p = mustParse('  QAOA  # header\n\n# a comment line\nCost 0.3   # gamma\nMIX X 0.2\n', 3)
    expect(p.kind).toBe('qaoa')
    if (p.kind === 'qaoa') expect(p.layers).toEqual([{ gamma: 0.3, mixer: 'x', beta: 0.2 }])
  })

  it('rejects an unmatched cost, a mix before a cost, and an unknown mixer', () => {
    expect(parseProgram('qaoa\ncost 0.3', 3)).toMatchObject({ ok: false, error: expect.stringContaining('no matching mix') })
    expect(parseProgram('qaoa\nmix x 0.3', 3)).toMatchObject({ ok: false, error: expect.stringContaining('without a preceding cost') })
    expect(parseProgram('qaoa\ncost 0.3\nmix zz 0.3', 3)).toMatchObject({ ok: false, error: expect.stringContaining('unknown mixer') })
  })

  it('enforces the layer and angle budget', () => {
    const tooDeep = 'qaoa\n' + Array.from({ length: EVOLVE_LIMITS.maxLayers + 1 }, () => 'cost 0.1\nmix x 0.1').join('\n')
    expect(parseProgram(tooDeep, 3)).toMatchObject({ ok: false, error: expect.stringContaining('layers') })
    expect(parseProgram('qaoa\ncost 7\nmix x 0.1', 3)).toMatchObject({ ok: false, error: expect.stringContaining('2π') })
    expect(parseProgram(`qaoa\nanneal ${EVOLVE_LIMITS.maxLayers + 1} 1 1`, 3).ok).toBe(false)
  })
})

describe('parseProgram — classical', () => {
  it('parses every start mode and both step kinds', () => {
    const p = mustParse('classical\nstart random 42\nsweep 3\nkick 2 9\nsweep 5', 6)
    expect(p).toEqual({
      kind: 'classical',
      start: { kind: 'random', seed: 42 },
      steps: [
        { op: 'sweep', passes: 3 },
        { op: 'kick', flips: 2, seed: 9 },
        { op: 'sweep', passes: 5 },
      ],
    })
    for (const mode of ['zeros', 'alternate', 'greedy']) {
      expect(mustParse(`classical\nstart ${mode}`, 6)).toEqual({ kind: 'classical', start: { kind: mode }, steps: [] })
    }
  })

  it('requires a start line first and bounds kicks by the node count', () => {
    expect(parseProgram('classical\nsweep 3', 6)).toMatchObject({ ok: false, error: expect.stringContaining('start') })
    expect(parseProgram('classical\nstart zeros\nkick 7 1', 6)).toMatchObject({ ok: false, error: expect.stringContaining('1 to 6') })
    expect(parseProgram('classical\nstart zeros\nsweep 0', 6).ok).toBe(false)
    expect(parseProgram(`classical\nstart zeros\nsweep ${EVOLVE_LIMITS.maxSweeps + 1}`, 6).ok).toBe(false)
  })
})

describe('parseProgram — circuit', () => {
  it('parses single, rotation, two-qubit and Toffoli gates into GateOps', () => {
    const p = mustParse('circuit\nh 0\nry 1 pi/2\ncx 0 1\nswap 1 2\nccx 0 1 2', 3)
    expect(p).toEqual({
      kind: 'circuit',
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'RY', qubits: [1], theta: expect.closeTo(Math.PI / 2, 12) },
        { name: 'CX', qubits: [0, 1] },
        { name: 'SWAP', qubits: [1, 2] },
        { name: 'CCX', qubits: [0, 1, 2] },
      ],
    })
  })

  it('rejects out-of-range and repeated qubits and an unknown gate', () => {
    expect(parseProgram('circuit\nh 3', 3)).toMatchObject({ ok: false, error: expect.stringContaining('outside 0..2') })
    expect(parseProgram('circuit\ncx 1 1', 3)).toMatchObject({ ok: false, error: expect.stringContaining('different') })
    expect(parseProgram('circuit\nmeasure 0', 3)).toMatchObject({ ok: false, error: expect.stringContaining('unknown gate') })
    const tooMany = 'circuit\n' + Array.from({ length: EVOLVE_LIMITS.maxGates + 1 }, () => 'h 0').join('\n')
    expect(parseProgram(tooMany, 3).ok).toBe(false)
  })

  it('does not mistake Object.prototype names for gates', () => {
    // `'constructor' in {}` is true; a lookup that walked the prototype chain
    // would admit these with op.name = a function or Object.prototype.
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(parseProgram(`circuit\n${name} 0`, 3)).toMatchObject({ ok: false, error: expect.stringContaining('unknown gate') })
      expect(parseProgram(`circuit\n${name} 0 1`, 3)).toMatchObject({ ok: false, error: expect.stringContaining('unknown gate') })
      expect(parseProgram(`circuit\n${name} 0 0.5`, 3)).toMatchObject({ ok: false, error: expect.stringContaining('unknown gate') })
    }
  })
})

describe('the DSL is closed — nothing escapes the parser', () => {
  it('rejects, and never runs, text that would be code under eval', () => {
    const attempts = [
      'globalThis.__evolveEscaped = true',
      'qaoa\ncost eval("1")\nmix x 0.1',
      'circuit\nh 0\nprocess.exit(1)',
      'classical\nstart zeros\nrequire("fs")',
      'function f(){ globalThis.__evolveEscaped = true }; f()',
      'qaoa\ncost 0.1; mix x 0.1',
      'python\nprint(1)',
      '',
      '   \n# only a comment\n',
    ]
    for (const text of attempts) {
      const r = parseProgram(text, 4)
      expect(r.ok, text).toBe(false)
    }
    expect((globalThis as Record<string, unknown>).__evolveEscaped).toBeUndefined()
  })

  it('rejects a candidate over the line or character budget before reading it', () => {
    const longLines = 'qaoa\n' + '# c\n'.repeat(EVOLVE_LIMITS.maxLines)
    expect(parseProgram(longLines, 4)).toMatchObject({ ok: false, error: expect.stringContaining('lines') })
    const longText = 'qaoa\n#' + 'x'.repeat(EVOLVE_LIMITS.maxChars)
    expect(parseProgram(longText, 4)).toMatchObject({ ok: false, error: expect.stringContaining('characters') })
  })

  it('reports the offending line number', () => {
    expect(parseProgram('qaoa\ncost 0.2\nmix x 0.1\nfrobnicate', 4)).toMatchObject({ ok: false, error: expect.stringMatching(/^line 4:/) })
  })
})

describe('formatProgram round-trips', () => {
  it('re-parses to the same program for every kind', () => {
    const texts = ['qaoa\ncost 0.5\nmix xy -0.25', 'classical\nstart random 3\nsweep 2\nkick 1 4', 'circuit\nh 0\nrz 1 0.75\ncx 0 1']
    for (const t of texts) {
      const p = mustParse(t, 3)
      const again = mustParse(formatProgram(p), 3)
      expect(again).toEqual(p)
      expect(formatProgram(again)).toBe(formatProgram(p))
    }
  })

  it('the grammar examples describe every kind the problems accept', () => {
    for (const problem of PROBLEMS) for (const k of problem.kinds) expect(GRAMMAR[k].startsWith(k)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// MaxCut physics against analytic values
// ────────────────────────────────────────────────────────────

describe('MaxCut cut values', () => {
  it('scores the known optimal cut of the 6-ring at 6, alternating sides', () => {
    expect(cutValue(ring(6), [0, 1, 0, 1, 0, 1])).toBe(6)
    expect(cutValue(ring(6), [0, 0, 0, 0, 0, 0])).toBe(0)
    expect(cutValue(ring(6), [0, 0, 1, 1, 0, 0])).toBe(2)
    const bf = bruteForceMaxCut(ring(6))
    expect(bf.value).toBe(6)
    expect(bf.assignments).toEqual([0b010101, 0b101010])
  })

  it('the 7-node house graph has optimum 9: three triangles, two sharing an edge, cost at least two edges', () => {
    const problem = getProblem('maxcut-house-7')
    if (!problem?.graph) throw new Error('missing problem')
    // Hand-derived assignment (see the derivation in the module header of the test):
    // 0=A 1=B 2=A 3=B 4=A 5=A 6=B leaves exactly edges 2-0 and 4-5 uncut.
    expect(cutValue(problem.graph, [0, 1, 0, 1, 0, 0, 1])).toBe(9)
    expect(bruteForceMaxCut(problem.graph).value).toBe(9)
    expect(problem.graph.edges).toHaveLength(11)
  })
})

describe('QAOA on the simulator against the p=1 closed form', () => {
  // For a triangle-free graph, p=1 QAOA with U(C,γ)=e^{-iγC}, C=Σ(1−ZZ)/2,
  // U(B,β)=e^{-iβΣX} gives per edge ⟨C_uv⟩ = 1/2 + ¼ sin4β sinγ (cos^{d_u}γ + cos^{d_v}γ)
  // where d_u is the number of OTHER neighbours of u (Wang, Hadfield, Jiang,
  // Rieffel 2018, and derivable by hand in the Heisenberg picture).
  it('a single edge is solved exactly at γ=π/2, β=π/8', () => {
    const edge: Graph = { n: 2, edges: [[0, 1]] }
    const sv = runQaoa(edge, [{ gamma: Math.PI / 2, mixer: 'x', beta: Math.PI / 8 }])
    expect(expectedCut(edge, sv)).toBeCloseTo(1, 10)
    // and the state is (|01⟩ + |10⟩)/√2 up to phase
    const p = sv.probabilities()
    expect(p[0b01]).toBeCloseTo(0.5, 10)
    expect(p[0b10]).toBeCloseTo(0.5, 10)
  })

  it('on the 4-ring the optimum is ⟨C⟩ = 3 (ratio 3/4) at γ=π/4, β=π/8', () => {
    const c4 = ring(4)
    const sv = runQaoa(c4, [{ gamma: Math.PI / 4, mixer: 'x', beta: Math.PI / 8 }])
    expect(expectedCut(c4, sv)).toBeCloseTo(3, 10)
  })

  it('matches the closed form on a grid of angles for the 4-ring: ⟨C⟩ = 2 + sin4β sin2γ', () => {
    const c4 = ring(4)
    for (const gamma of [0.2, 0.7, 1.1, -0.4]) {
      for (const beta of [0.15, 0.5, -0.3]) {
        const sv = runQaoa(c4, [{ gamma, mixer: 'x', beta }])
        // 4 edges × (½ + ¼ sin4β sinγ · 2cosγ) = 2 + sin4β sin2γ
        expect(expectedCut(c4, sv)).toBeCloseTo(2 + Math.sin(4 * beta) * Math.sin(2 * gamma), 10)
      }
    }
  })

  it('γ = 0 leaves the uniform superposition: ⟨C⟩ = |E|/2 for any mixer angle', () => {
    const g = ring(6)
    expect(expectedCut(g, runQaoa(g, [{ gamma: 0, mixer: 'x', beta: 0.9 }]))).toBeCloseTo(3, 10)
  })

  it('the cost layer is diagonal: it changes no probability on its own', () => {
    const g = ring(5)
    const sv = new StateVector(5)
    for (let q = 0; q < 5; q++) sv.applySingle('H', q)
    sv.applySingle('RY', 2, 0.7)
    const before = sv.probabilities()
    applyCost(sv, g, 1.3)
    const after = sv.probabilities()
    before.forEach((p, i) => expect(after[i]).toBeCloseTo(p, 12))
  })

  it('the XY ring mixer conserves Hamming weight; the X mixer does not', () => {
    const start = () => {
      const sv = new StateVector(4)
      sv.applySingle('X', 1) // |0010⟩, weight 1
      return sv
    }
    const xy = start()
    applyMixer(xy, 'xy', 0.9)
    const p = xy.probabilities()
    let weight1 = 0
    for (let b = 0; b < 16; b++) {
      const w = b.toString(2).split('1').length - 1
      if (w === 1) weight1 += p[b]
      else expect(p[b]).toBeCloseTo(0, 12)
    }
    expect(weight1).toBeCloseTo(1, 12)
    expect(p[0b0010]).toBeLessThan(0.999) // it actually moved something

    const x = start()
    applyMixer(x, 'x', 0.9)
    expect(x.probabilities()[0]).toBeGreaterThan(1e-3)
  })
})

describe('classical heuristic interpreter', () => {
  it('start alternate on an even ring is already optimal', () => {
    const g = ring(6)
    const t = runClassical(g, mustParse('classical\nstart alternate', 6) as never)
    expect(t.cut).toBe(6)
  })

  it('from all-zeros, each best-improvement flip on the 6-ring gains exactly 2', () => {
    const g = ring(6)
    expect(runClassical(g, mustParse('classical\nstart zeros\nsweep 1', 6) as never).cut).toBe(2)
    expect(runClassical(g, mustParse('classical\nstart zeros\nsweep 2', 6) as never).cut).toBe(4)
    expect(runClassical(g, mustParse('classical\nstart zeros\nsweep 3', 6) as never).cut).toBe(6)
    // extra passes stop at the local optimum rather than oscillating
    expect(runClassical(g, mustParse('classical\nstart zeros\nsweep 20', 6) as never).cut).toBe(6)
  })

  it('a kick never lowers the reported result below the best seen', () => {
    const g = ring(6)
    const t = runClassical(g, mustParse('classical\nstart alternate\nkick 3 5', 6) as never)
    expect(t.cut).toBe(6)
    expect(cutValue(g, t.assignment)).toBe(6)
  })

  it('is deterministic for a seed', () => {
    const g = ring(6)
    const a = runClassical(g, mustParse('classical\nstart random 9\nsweep 3\nkick 2 4\nsweep 3', 6) as never)
    const b = runClassical(g, mustParse('classical\nstart random 9\nsweep 3\nkick 2 4\nsweep 3', 6) as never)
    expect(a).toEqual(b)
  })
})

// ────────────────────────────────────────────────────────────
// Problems: fitness
// ────────────────────────────────────────────────────────────

describe('problem fitness', () => {
  it('a known-optimal MaxCut cut scores fitness 1 and the 1-sweep heuristic scores 1/3', () => {
    const problem = getProblem('maxcut-ring-6')!
    expect(problem.evaluate(mustParse('classical\nstart alternate', 6)).fitness).toBe(1)
    expect(problem.evaluate(mustParse('classical\nstart zeros\nsweep 1', 6)).fitness).toBeCloseTo(1 / 3, 12)
  })

  it('a qaoa candidate on the ring scores its approximation ratio', () => {
    const problem = getProblem('maxcut-ring-6')!
    // p=1 optimum on any ring is 3/4 of the edges.
    const ev = problem.evaluate(mustParse('qaoa\ncost pi/4\nmix x pi/8', 6))
    expect(ev.fitness).toBeCloseTo(0.75, 10)
    expect(ev.detail).toContain('⟨cut⟩ = 4.500 of 6')
  })

  it('a MaxCut problem scores a circuit program at 0 rather than throwing', () => {
    expect(getProblem('maxcut-ring-6')!.evaluate(mustParse('circuit\nh 0', 6)).fitness).toBe(0)
  })

  it('the GHZ challenge: the reference circuit passes the real grader with fitness 1; H⊗3 scores 1 − 0.75', () => {
    const problem = getProblem('challenge:ghz-three')!
    const ghz = problem.evaluate(mustParse('circuit\nh 0\ncx 0 1\ncx 1 2', 3))
    expect(ghz.fitness).toBeCloseTo(1, 12)
    expect(ghz.verified).toBe(true)
    const uniform = problem.evaluate(mustParse('circuit\nh 0\nh 1\nh 2', 3))
    // TVD between uniform(8) and {|000⟩:½, |111⟩:½} = ½·(2·0.375 + 6·0.125) = 0.75
    expect(uniform.fitness).toBeCloseTo(0.25, 12)
    expect(uniform.verified).toBe(false)
  })

  it('every seed of every problem parses and is of an accepted kind', () => {
    for (const problem of PROBLEMS) {
      for (const seed of problem.seeds) {
        const r = parseProgram(seed, problem.numQubits)
        expect(r.ok, `${problem.id}: ${seed}`).toBe(true)
        if (r.ok) expect(problem.kinds).toContain(r.program.kind)
      }
    }
  })
})

// ────────────────────────────────────────────────────────────
// The loop
// ────────────────────────────────────────────────────────────

/** A provider that returns a fixed script per generation and records what it was asked. */
function scripted(name: string, script: Record<number, string[]>): ProviderAdapter & { asked: ProposalContext[] } {
  const asked: ProposalContext[] = []
  return {
    name,
    asked,
    async propose(ctx) {
      asked.push(ctx)
      return script[ctx.generation] ?? []
    },
  }
}

describe('evolve', () => {
  it('strictly improves best fitness over 3 generations with a scripted provider on a fixed seed', async () => {
    // Population 4 with 3 seeds → one mutation at g0 (seed 2024 does not land
    // on GHZ); elite 2 + two admitted proposals per generation → the local
    // operator never runs after g0, so the run is entirely scripted and the
    // assertion is about the loop, not about luck.
    const provider = scripted('fake-model', {
      1: ['circuit\nh 0\ncx 0 1\ncx 1 2\nry 2 1.0', 'circuit\nh 0\ncx 0 1\ncx 1 2\nry 2 1.2'],
      2: ['not a program at all', 'circuit\nh 0\ncx 0 1\ncx 1 2\nry 2 0.4', 'circuit\nh 0\ncx 0 1\ncx 1 2\nry 2 0.5'],
      3: ['circuit\nh 0\ncx 0 1\ncx 1 2', 'circuit\nh 0\ncx 0 1\ncx 1 2\nry 2 0.2'],
    })
    const run = await evolve(
      { problemId: 'challenge:ghz-three', populationSize: 4, generations: 3, eliteCount: 2, seed: 2024 },
      [provider],
    )
    const curve = fitnessCurve(run)
    expect(curve).toHaveLength(4)
    for (let g = 1; g < curve.length; g++) expect(curve[g].best).toBeGreaterThan(curve[g - 1].best)
    expect(run.best.fitness).toBeCloseTo(1, 12)
    expect(run.best.verified).toBe(true)
    expect(run.best.operator).toBe('fake-model')
    expect(run.best.generation).toBe(3)
    expect(run.best.parentIds).toEqual(run.generations[2].population.slice(0, 2).map((c) => c.id))
    expect(run.stopped).toBe(false)
    // Nothing after g0 came from the local operator: the improvement is the provider's.
    for (const g of run.generations.slice(1)) for (const c of g.population) if (c.generation >= 1) expect(c.operator).not.toBe('mutation')
    // The junk proposal was rejected, recorded, and never evaluated.
    const rej = run.generations[2].rejected
    expect(rej.some((r) => r.text === 'not a program at all' && r.operator === 'fake-model')).toBe(true)
    expect(run.generations.flatMap((g) => g.population).some((c) => c.text.includes('not a program'))).toBe(false)
    // The provider saw the elites and the grammar it must follow.
    expect(provider.asked).toHaveLength(3)
    expect(provider.asked[0].elites).toHaveLength(2)
    expect(provider.asked[0].grammar).toContain('circuit')
    expect(provider.asked[0].count).toBe(EVOLVE_LIMITS.proposalsPerProvider)
  })

  it('is deterministic for a fixed seed with no providers, and best fitness never decreases', async () => {
    const cfg = { problemId: 'maxcut-house-7', populationSize: 8, generations: 4, eliteCount: 2, seed: 7 }
    const a = await evolve(cfg, [])
    const b = await evolve(cfg, [])
    expect(a.generations.map((g) => g.population.map((c) => [c.id, c.text, c.fitness]))).toEqual(
      b.generations.map((g) => g.population.map((c) => [c.id, c.text, c.fitness])),
    )
    const curve = fitnessCurve(a)
    for (let g = 1; g < curve.length; g++) expect(curve[g].best).toBeGreaterThanOrEqual(curve[g - 1].best)
    expect(a.generations).toHaveLength(5)
    for (const g of a.generations) {
      expect(g.population.length).toBeLessThanOrEqual(8)
      expect(g.population[0]).toBe(g.best)
      for (const c of g.population) {
        expect(c.fitness).toBeGreaterThanOrEqual(0)
        expect(c.fitness).toBeLessThanOrEqual(1)
        expect(parseProgram(c.text, 7).ok).toBe(true)
      }
    }
    // Every parent named in the lineage is a candidate that exists.
    const ids = new Set(a.generations.flatMap((g) => g.population.map((c) => c.id)))
    for (const g of a.generations) for (const c of g.population) for (const p of c.parentIds) expect(ids.has(p)).toBe(true)
    // Something beyond the seeds was actually tried.
    expect(a.generations.slice(1).some((g) => g.population.some((c) => c.operator === 'mutation'))).toBe(true)
  })

  it('no candidate can escape the DSL: malformed and off-kind proposals are rejected, not executed', async () => {
    const provider = scripted('hostile', {
      1: ['globalThis.__evolveEscaped = true', 'circuit\nh 0', 'qaoa\ncost 0.3\nmix x 0.2\nsystem("rm -rf /")'],
    })
    const run = await evolve(
      { problemId: 'maxcut-ring-6', populationSize: 4, generations: 1, eliteCount: 1, seed: 1 },
      [provider],
    )
    const rej = run.generations[1].rejected.filter((r) => r.operator === 'hostile')
    expect(rej).toHaveLength(3)
    expect(rej.map((r) => r.reason)).toEqual([
      expect.stringContaining('line 1'),
      expect.stringContaining('accepts qaoa or classical'),
      expect.stringContaining('line 4'),
    ])
    expect((globalThis as Record<string, unknown>).__evolveEscaped).toBeUndefined()
    for (const c of run.generations[1].population) expect(c.operator).not.toBe('hostile')
  })

  it('a proposal naming a prototype member is rejected and does not end the run', async () => {
    const provider = scripted('sneaky', { 1: ['circuit\nconstructor 0', 'circuit\n__proto__ 0', 'circuit\nh 0\ncx 0 1\nry 2 0.7'] })
    const run = await evolve(
      { problemId: 'challenge:ghz-three', populationSize: 4, generations: 1, eliteCount: 1, seed: 9 },
      [provider],
    )
    const rej = run.generations[1].rejected.filter((r) => r.operator === 'sneaky')
    expect(rej.map((r) => r.reason)).toEqual([expect.stringContaining('unknown gate'), expect.stringContaining('unknown gate')])
    expect(run.generations[1].population.some((c) => c.operator === 'sneaky')).toBe(true)
  })

  it('a provider that throws is recorded and does not end the run', async () => {
    const broken: ProviderAdapter = { name: 'down', propose: async () => { throw new Error('503 from upstream') } }
    const run = await evolve({ problemId: 'maxcut-ring-6', populationSize: 4, generations: 2, eliteCount: 1, seed: 3 }, [broken])
    expect(run.generations).toHaveLength(3)
    expect(run.generations[1].providerErrors).toEqual([{ provider: 'down', message: '503 from upstream' }])
  })

  it('honours shouldStop and clamps the budget', async () => {
    let calls = 0
    const run = await evolve(
      { problemId: 'maxcut-ring-6', populationSize: 999, generations: 999, eliteCount: 99, seed: 5 },
      [],
      { shouldStop: () => ++calls >= 3, yieldToHost: async () => undefined },
    )
    expect(run.config.populationSize).toBe(EVOLVE_LIMITS.populationMax)
    expect(run.config.generations).toBe(EVOLVE_LIMITS.generationsMax)
    expect(run.config.eliteCount).toBe(EVOLVE_LIMITS.eliteMax)
    expect(run.stopped).toBe(true)
    expect(run.generations).toHaveLength(3) // g0 + two before the stop
  })

  it('rejects an unknown problem', async () => {
    await expect(evolve({ problemId: 'nope', populationSize: 4, generations: 1, eliteCount: 1, seed: 1 }, [])).rejects.toThrow('unknown problem')
  })
})

describe('proposal plumbing', () => {
  it('extractPrograms takes every fenced block, or the whole reply when there is none', () => {
    expect(extractPrograms('Here:\n```dsl\nqaoa\ncost 1\nmix x 1\n```\nand\n```\nclassical\nstart zeros\n```')).toEqual([
      'qaoa\ncost 1\nmix x 1',
      'classical\nstart zeros',
    ])
    expect(extractPrograms('qaoa\ncost 1\nmix x 1')).toEqual(['qaoa\ncost 1\nmix x 1'])
    expect(extractPrograms('   ')).toEqual([])
  })

  it('the prompt carries the grammar, the elites and the count', () => {
    const problem = getProblem('maxcut-ring-6')!
    const prompt = buildProposalPrompt({
      problem,
      grammar: GRAMMAR.qaoa,
      elites: [{ id: 'g0-1', text: 'qaoa\ncost 0.5\nmix x 0.3', fitness: 0.61, detail: 'd' }],
      generation: 2,
      count: 3,
    })
    expect(prompt).toContain(GRAMMAR.qaoa)
    expect(prompt).toContain('fitness 0.6100')
    expect(prompt).toContain('Propose 3 NEW')
    expect(prompt).toContain(problem.description)
  })

  it('mutateProgram always yields a program the parser accepts', () => {
    const rng = mulberry32(11)
    const starts = [
      mustParse('qaoa\ncost 0.5\nmix x 0.3', 6),
      mustParse('classical\nstart greedy\nsweep 3', 6),
      mustParse('circuit\nh 0\ncx 0 1', 3),
    ]
    for (const start of starts) {
      let p = start
      for (let i = 0; i < 200; i++) {
        p = mutateProgram(p, rng, start.kind === 'circuit' ? 3 : 6)
        const r = parseProgram(formatProgram(p), start.kind === 'circuit' ? 3 : 6)
        expect(r.ok, formatProgram(p)).toBe(true)
        expect(describeProgram(p).length).toBeGreaterThan(0)
      }
    }
  })
})
