/**
 * graph.ts — the knowledge graph the coach walks.
 *
 * Pure data and pure functions: no React, no browser APIs, no imports from
 * anything stateful. Everything here is deterministic, so the recommender that
 * sits on top of it produces the same answer for the same progress every time,
 * offline, with no API key and no model in the loop.
 *
 * The nodes mirror `LESSONS` one-for-one — the `requires` edges ARE the lesson
 * prerequisites, restated here so the graph module owns a single, traversable
 * shape rather than re-deriving it from lesson content at every call site. The
 * extra thing this file knows that the lesson data does not is which
 * visualization teaches each concept, which is what lets the coach recommend
 * "go *see* this" as well as "go read this".
 */

/** Sentinel `vizSlug` meaning the circuit simulator rather than /visualizations. */
export const SIMULATOR_SLUG = 'simulator'

export interface ConceptNode {
  id: string
  label: string
  lessonSlug: string
  requires: string[]
  unlocks: string[]
  vizSlugs: string[]
}

/**
 * One node per lesson, in teaching order.
 *
 * `unlocks` is the reverse of `requires` and is kept explicit rather than
 * computed so the graph reads correctly in both directions when you are
 * eyeballing it — `assertGraphConsistency()` below keeps the two halves honest.
 */
export const CONCEPT_GRAPH: ConceptNode[] = [
  {
    id: 'what-is-a-qubit',
    label: 'What Is a Qubit?',
    lessonSlug: 'what-is-a-qubit',
    requires: [],
    unlocks: ['superposition-and-measurement'],
    vizSlugs: ['bloch-sphere'],
  },
  {
    id: 'superposition-and-measurement',
    label: 'Superposition & Measurement',
    lessonSlug: 'superposition-and-measurement',
    requires: ['what-is-a-qubit'],
    unlocks: ['interference', 'tunneling'],
    vizSlugs: ['superposition'],
  },
  {
    id: 'interference',
    label: 'Interference',
    lessonSlug: 'interference',
    requires: ['superposition-and-measurement'],
    unlocks: ['gates-and-circuits'],
    vizSlugs: ['double-slit'],
  },
  {
    // Sits fourth in the foundations track, after `interference`, but its only
    // real dependency is `superposition-and-measurement`: tunnelling needs a
    // wavefunction and the Born rule, and nothing else. It does NOT require
    // interference — the lesson is written to lean on ψ and |ψ|² alone, and
    // claiming otherwise here would make the coach send someone to the
    // double-slit before it would let them read this.
    //
    // `unlocks` is empty on purpose. Nothing later in either track is built on
    // tunnelling: gates, entanglement and Grover are the discrete, gate-based
    // picture and never touch a barrier. Inventing a downstream edge would make
    // `firstUnmetPrerequisite` block a learner heading for Grover on a lesson
    // Grover does not use. A leaf here still gets recommended by rule 4 as soon
    // as its prerequisite is done, which is exactly the intended behaviour.
    id: 'tunneling',
    label: 'Quantum Tunneling',
    lessonSlug: 'tunneling',
    requires: ['superposition-and-measurement'],
    unlocks: [],
    vizSlugs: ['tunneling'],
  },
  {
    id: 'gates-and-circuits',
    label: 'Gates & Circuits',
    lessonSlug: 'gates-and-circuits',
    requires: ['interference'],
    unlocks: ['entanglement', 'inside-a-quantum-computer', 'vqe-and-nisq'],
    // Gates are not taught by a visualization — they are taught by building
    // something, so this concept points at the simulator instead.
    vizSlugs: [SIMULATOR_SLUG],
  },
  {
    id: 'entanglement',
    label: 'Entanglement',
    lessonSlug: 'entanglement',
    requires: ['gates-and-circuits'],
    unlocks: ['grover', 'quantum-cryptography', 'error-correction'],
    vizSlugs: ['entanglement'],
  },
  {
    id: 'grover',
    label: "Grover's Search",
    lessonSlug: 'grover',
    requires: ['entanglement'],
    unlocks: ['shor'],
    vizSlugs: ['grover'],
  },
  {
    // Sits last in the foundations track as the course closer, but its only
    // real dependency is `gates-and-circuits`: the lesson's load-bearing idea
    // is "a gate is a calibrated rotation, delivered as a microwave pulse",
    // and it uses nothing from entanglement or Grover. `unlocks` is empty on
    // purpose — nothing in either track is built on hardware details, and a
    // leaf still gets recommended once its prerequisite is done.
    id: 'inside-a-quantum-computer',
    label: 'Inside a Quantum Computer',
    lessonSlug: 'inside-a-quantum-computer',
    requires: ['gates-and-circuits'],
    unlocks: [],
    // The decoherence lab shows T1/T2 relaxation shrinking the Bloch vector —
    // the exact process the dilution refrigerator exists to slow down — so the
    // coach can honestly send a learner there even though the lesson's own
    // embed is /hardware, which is not a visualization.
    vizSlugs: ['decoherence'],
  },
  {
    id: 'shor',
    label: "Shor's Algorithm",
    lessonSlug: 'shor',
    requires: ['grover'],
    // Nothing downstream depends on Shor. Error correction used to be listed
    // here, which made the coach demand Grover and Shor before it would let
    // anyone read about the surface code — but the error-correction lesson uses
    // no period-finding, no continued fractions and no QFT. It needs entangled
    // encodings and reduced density matrices, which is the entanglement lesson.
    // The advanced track still *reads* Shor first; teaching order and
    // dependency order are different things, and only the second belongs here.
    // Post-quantum cryptography is the one genuine dependent: its central
    // argument — lattices hide no period for a QFT to read — is meaningless to
    // a learner who has not watched the QFT read one off a modular exponential.
    unlocks: ['post-quantum-cryptography'],
    vizSlugs: ['qft'],
  },
  {
    id: 'error-correction',
    label: 'Quantum Error Correction',
    lessonSlug: 'error-correction',
    requires: ['entanglement'],
    unlocks: [],
    vizSlugs: ['decoherence'],
  },
  {
    id: 'vqe-and-nisq',
    label: 'NISQ Algorithms and VQE',
    lessonSlug: 'vqe-and-nisq',
    requires: ['gates-and-circuits'],
    // QML and QAOA are the two lessons genuinely built ON this one: the
    // classifier loop and the QAOA outer loop ARE the VQE loop, and the
    // barren-plateau argument transfers to both.
    unlocks: ['quantum-machine-learning', 'qaoa-and-optimization'],
    // The lesson's embed is the simulator, not a visualization: a variational
    // ansatz is something you build and sweep by hand. An empty list here meant
    // rule 5 in `recommend.ts` could never suggest anything for this concept.
    vizSlugs: [SIMULATOR_SLUG],
  },
  {
    id: 'quantum-machine-learning',
    label: 'Quantum Machine Learning',
    lessonSlug: 'quantum-machine-learning',
    // Requires ONLY vqe-and-nisq. The lesson leans on the variational loop,
    // ansatz design and barren plateaus, all taught there; it does not use
    // period-finding, syndromes or Bell tests, so no edge from those lessons.
    requires: ['vqe-and-nisq'],
    unlocks: [],
    // The VQE visualization shows the flattening loss landscape — the exact
    // mechanism the QML lesson says makes deep quantum classifiers
    // untrainable — so the coach can honestly send a learner there.
    vizSlugs: ['vqe'],
  },
  {
    id: 'qaoa-and-optimization',
    label: 'QAOA and Quantum Optimization',
    lessonSlug: 'qaoa-and-optimization',
    // Requires ONLY vqe-and-nisq: the lesson leans on the variational outer
    // loop, the NISQ depth budget and barren plateaus, all taught there. It
    // uses no period-finding, no syndromes and no Bell tests, so no edges
    // from Shor, error correction or cryptography — and Grover's oracle
    // resemblance is remarked on, not relied on.
    requires: ['vqe-and-nisq'],
    unlocks: [],
    // The VQE visualization's flattening landscape is the exact outer loop
    // QAOA's classical optimiser walks, so the coach can honestly send a
    // learner there; the lesson's own embed points at the same place.
    vizSlugs: ['vqe'],
  },
  {
    id: 'quantum-cryptography',
    label: 'Quantum Cryptography',
    lessonSlug: 'quantum-cryptography',
    requires: ['entanglement'],
    // The QKD lesson ends by naming post-quantum cryptography as the practical
    // answer; the PQC lesson opens by assuming the learner knows what QKD does
    // and does not solve (authentication, endpoints, range).
    unlocks: ['post-quantum-cryptography'],
    // The QKD lab runs BB84 and E91 themselves; the entanglement lab stays as
    // the second stop because E91's security argument *is* its CHSH test.
    vizSlugs: ['quantum-key-distribution', 'entanglement'],
  },
  {
    id: 'post-quantum-cryptography',
    label: 'Post-Quantum Cryptography',
    lessonSlug: 'post-quantum-cryptography',
    // Both edges are real dependencies, not teaching order: the lesson's core
    // claim contrasts lattice problems with the period structure Shor exploits,
    // and it starts from the QKD lesson's closing verdict on what QKD leaves
    // unsolved.
    requires: ['shor', 'quantum-cryptography'],
    unlocks: [],
    // The lesson's embed points at the Shor visualization for the same reason
    // the dependency exists: the phase ramp the QFT reads is exactly the
    // structure that lattices lack.
    vizSlugs: ['shor'],
  },
]

const BY_ID: Map<string, ConceptNode> = new Map(
  CONCEPT_GRAPH.map((node) => [node.id, node])
)

export function nodeFor(slug: string): ConceptNode | undefined {
  return BY_ID.get(slug)
}

/**
 * CYCLE GUARD, used by every traversal below.
 *
 * CONCEPT_GRAPH is hand-edited data. A prerequisite loop introduced by a typo
 * (A requires B, B requires A) would make a naive depth-first walk recurse
 * forever and hang the coach page in the browser — a blank screen with a pegged
 * CPU, on a page whose entire job is to be reassuring. Every traversal
 * therefore carries a `seen` set and refuses to expand a node twice. The result
 * on a cyclic graph is merely incomplete, never non-terminating.
 */
function walk(
  startIds: string[],
  edgesOf: (node: ConceptNode) => string[]
): string[] {
  const seen = new Set<string>(startIds)
  const found = new Set<string>()
  const queue = [...startIds]

  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    const node = BY_ID.get(current)
    if (!node) continue
    for (const next of edgesOf(node)) {
      if (seen.has(next)) continue // ← the guard
      seen.add(next)
      found.add(next)
      queue.push(next)
    }
  }
  return [...found]
}

/**
 * Every transitive prerequisite of `slug`, in dependency order — the order you
 * would actually have to study them in, earliest first.
 */
export function ancestorsOf(slug: string): string[] {
  const ancestors = new Set(walk([slug], (node) => node.requires))
  return topologicalOrder().filter((id) => ancestors.has(id))
}

/** Everything transitively unlocked by `slug`, in dependency order. */
export function descendantsOf(slug: string): string[] {
  const descendants = new Set(walk([slug], (node) => node.unlocks))
  return topologicalOrder().filter((id) => descendants.has(id))
}

/**
 * Kahn's algorithm, with ties broken by declaration order so the result is
 * stable across runs — the SkillMap lays nodes out from this, and a layout that
 * reshuffles between renders is worse than no layout at all.
 *
 * Any node left over when the queue empties is part of a cycle; those are
 * appended in declaration order rather than dropped, so a broken graph still
 * renders every lesson instead of silently losing some.
 */
export function topologicalOrder(): string[] {
  const indegree = new Map<string, number>()
  for (const node of CONCEPT_GRAPH) {
    indegree.set(node.id, node.requires.filter((r) => BY_ID.has(r)).length)
  }

  const order: string[] = []
  const emitted = new Set<string>()
  let progressed = true

  while (progressed) {
    progressed = false
    for (const node of CONCEPT_GRAPH) {
      if (emitted.has(node.id)) continue
      if ((indegree.get(node.id) ?? 0) > 0) continue
      emitted.add(node.id)
      order.push(node.id)
      progressed = true
      for (const child of node.unlocks) {
        const current = indegree.get(child)
        if (current !== undefined) indegree.set(child, current - 1)
      }
    }
  }

  for (const node of CONCEPT_GRAPH) {
    if (!emitted.has(node.id)) order.push(node.id)
  }
  return order
}

/**
 * Depth of each node in the dependency graph: 0 for a node with no
 * prerequisites, otherwise one more than its deepest prerequisite. The SkillMap
 * uses this as the layout rank, which is why it lives here — the layout must be
 * a property of the graph, not of the component drawing it.
 */
export function layerOf(slug: string): number {
  const ancestors = ancestorsOf(slug)
  const depth = new Map<string, number>()
  for (const id of [...ancestors, slug]) {
    const node = BY_ID.get(id)
    if (!node) continue
    const parents = node.requires
      .map((r) => depth.get(r))
      .filter((d): d is number => d !== undefined)
    depth.set(id, parents.length === 0 ? 0 : Math.max(...parents) + 1)
  }
  return depth.get(slug) ?? 0
}

/**
 * The single most useful function in this file.
 *
 * Given a goal the learner has stated and the set of lessons they have
 * finished, return the EARLIEST thing standing in their way — not the next item
 * in a list. Someone who wants Shor and has done nothing should be sent to
 * "What Is a Qubit?", not to Shor, and not to Grover just because it happens to
 * sit immediately before Shor in the ordering.
 *
 * Returns the target itself when every prerequisite is met but the target is
 * not done, and `null` when the goal is already complete.
 */
export function firstUnmetPrerequisite(
  target: string,
  completed: readonly string[]
): string | null {
  if (!BY_ID.has(target)) return null
  const done = new Set(completed)
  for (const id of ancestorsOf(target)) {
    if (!done.has(id)) return id
  }
  return done.has(target) ? null : target
}

/**
 * True when a hand-edit has broken the graph: a dangling edge, or `unlocks` and
 * `requires` disagreeing. Not called at import time — it is here so a test or a
 * console poke can check the data without re-deriving the rules.
 */
export function graphInconsistencies(): string[] {
  const problems: string[] = []
  for (const node of CONCEPT_GRAPH) {
    for (const req of node.requires) {
      const parent = BY_ID.get(req)
      if (!parent) {
        problems.push(`${node.id} requires unknown node ${req}`)
      } else if (!parent.unlocks.includes(node.id)) {
        problems.push(`${req}.unlocks is missing ${node.id}`)
      }
    }
    for (const child of node.unlocks) {
      const target = BY_ID.get(child)
      if (!target) {
        problems.push(`${node.id} unlocks unknown node ${child}`)
      } else if (!target.requires.includes(node.id)) {
        problems.push(`${child}.requires is missing ${node.id}`)
      }
    }
  }
  return problems
}
