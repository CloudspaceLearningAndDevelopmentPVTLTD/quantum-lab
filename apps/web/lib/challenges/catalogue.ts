/**
 * catalogue.ts — the challenge set.
 *
 * Every challenge here has been checked against `lib/quantum.ts` by hand: the
 * stated target is reachable with the gates in `GATE_LIBRARY`, and the
 * reference solution is written into the hints as a shape, never as an answer.
 * `lib/challenges/catalogue.test.ts` builds a solution for every challenge and
 * runs it through the real grader, so a par that drifts out of reach fails CI
 * rather than wasting a learner's afternoon.
 *
 * Index convention (from quantum.ts): qubit 0 is the LEAST significant bit, and
 * labels print MSB-first. So for two qubits, index 1 is |01⟩ = q1=0, q0=1.
 *
 * ─────────────────────────────────────────────────────────────
 * TWO CONSTRAINTS A FUTURE EDITOR MUST NOT FORGET
 * ─────────────────────────────────────────────────────────────
 * 1. THE θ SLIDER STEPS IN π/16. `ChallengeWorkbench` renders the rotation
 *    angle with `<Slider min={0} max={2π} step={π/16}>`, so a learner can only
 *    place RX/RY/RZ/P at multiples of π/16. Any angle outside that lattice —
 *    the 2·asin(√(2/3)) in the W state, for instance — has to arrive in
 *    `startingCircuit`, already placed, and the brief has to tell the learner
 *    not to delete it, because they cannot type it back in. Do not write a
 *    challenge whose solution needs an angle the UI cannot express.
 *
 * 2. `maxGates` IS ONLY ENFORCED FOR `gate-golf`. For every other kind it is
 *    displayed as "par" and nothing more (see grade.ts). That is deliberate:
 *    par here is a target worth aiming at, not a pass condition, so a learner
 *    who solves it the long way still gets full marks and a note about the
 *    shorter route.
 *
 * A third thing, said plainly because it shapes several challenges below: the
 * grader sees only the final statevector. It cannot see WHICH gates you used.
 * So no challenge can force a particular construction — a "build SWAP out of
 * CNOTs" task is really "reach this state, and here is why the three-CNOT
 * route is the one worth learning". Where that gap matters the brief says so
 * rather than pretending the puzzle is airtight.
 */

import type { Challenge } from './types'

/**
 * Build a probability vector of length 2^n from a sparse {index: p} map.
 * Keeps the catalogue readable — `dist(3, { 0: 0.5, 7: 0.5 })` beats an
 * eight-element array where a typo is invisible.
 */
function dist(numQubits: number, entries: Record<number, number>): number[] {
  const out = new Array<number>(1 << numQubits).fill(0)
  for (const [index, p] of Object.entries(entries)) out[Number(index)] = p
  return out
}

/** Uniform 1/2^n over every basis state. */
function uniform(numQubits: number): number[] {
  const dim = 1 << numQubits
  return new Array<number>(dim).fill(1 / dim)
}

/**
 * Sign vector for an oracle target: +1 everywhere except the listed indices.
 * Written this way because the interesting content of an oracle is the short
 * list of marked states, and a hand-written array of sixteen +1s hides a typo.
 */
function signs(numQubits: number, flipped: number[]): number[] {
  const out = new Array<number>(1 << numQubits).fill(1)
  for (const i of flipped) out[i] = -1
  return out
}

export const CHALLENGES: Challenge[] = [
  // ══════════════════════════════════════════════════════════
  // BEGINNER — one idea each, and none of them needs a two-qubit
  // gate until the Bell pair.
  // ══════════════════════════════════════════════════════════

  // ── 1 ──────────────────────────────────────────────────────
  {
    id: 'flip-it',
    title: 'Flip it',
    brief:
      'Your qubit starts in |0⟩, as every qubit in this simulator does. Get it to |1⟩ with certainty — the histogram should show a single bar at |1⟩ and nothing anywhere else.',
    kind: 'target-state',
    level: 'Beginner',
    numQubits: 1,
    lessonSlug: 'what-is-a-qubit',
    targetProbabilities: dist(1, { 1: 1 }),
    maxGates: 1,
    hints: [
      'You are not looking for superposition here. You want a definite answer, just the other definite answer.',
      'One of the single-qubit gates is the direct translation of the classical NOT gate. Its palette label is a single letter.',
    ],
    successNote:
      'X is the quantum NOT: it swaps the amplitudes of |0⟩ and |1⟩. Notice that nothing random happened — a quantum computer is perfectly capable of doing ordinary deterministic logic, and most of any real algorithm is exactly that.',
  },

  // ── 2 ──────────────────────────────────────────────────────
  {
    id: 'fair-coin',
    title: 'Fair coin',
    brief:
      'Build a circuit whose measurement is a genuine 50/50 coin flip: half the shots read |0⟩, half read |1⟩.',
    kind: 'target-distribution',
    level: 'Beginner',
    numQubits: 1,
    lessonSlug: 'superposition-and-measurement',
    targetProbabilities: dist(1, { 0: 0.5, 1: 0.5 }),
    tolerance: 0.03,
    maxGates: 1,
    hints: [
      'One gate is enough. You want the qubit halfway between the two poles of the Bloch sphere.',
      'The Hadamard gate takes |0⟩ to (|0⟩ + |1⟩)/√2. Squaring 1/√2 gives 0.5 — exactly the odds you need.',
    ],
    successNote:
      'This is a fair coin, but it is not a coin that was already heads or tails and hidden from you. Before measurement the qubit is in a definite state — (|0⟩ + |1⟩)/√2 — that simply is not |0⟩ or |1⟩. The next challenge exploits the difference.',
  },

  // ── 3 ──────────────────────────────────────────────────────
  {
    id: 'label-the-register',
    title: 'Read the label',
    brief:
      'Three qubits, no superposition, no entanglement: put the register into |101⟩ with certainty. The only difficulty is the labelling. Bars are printed MSB-first — q2 q1 q0 — so |101⟩ means q2 = 1, q1 = 0, q0 = 1. Get the wrong qubit and the histogram will tell you immediately.',
    kind: 'target-state',
    level: 'Beginner',
    numQubits: 3,
    lessonSlug: 'gates-and-circuits',
    targetProbabilities: dist(3, { 5: 1 }),
    maxGates: 2,
    hints: [
      'Nothing here is quantum. You are setting two classical bits and leaving the third alone.',
      'The wires in the editor are labelled q0 at the top. The histogram writes q0 LAST. Two X gates, on the two wires whose label is 1.',
    ],
    successNote:
      'Bit ordering is the single most common source of "my circuit is wrong" in this whole product, and it is not a physics problem — it is a convention. This app follows Qiskit: qubit 0 is the least significant bit, so it appears on the right-hand end of every printed bitstring. Every target histogram you meet from here on is written that way.',
  },

  // ── 4 ──────────────────────────────────────────────────────
  {
    id: 'bell-pair',
    title: 'Make a Bell pair',
    brief:
      'Two qubits. Half the shots must read |00⟩ and half must read |11⟩ — and |01⟩ and |10⟩ must never appear. The two qubits always agree, but neither one is decided in advance.',
    kind: 'target-state',
    level: 'Beginner',
    numQubits: 2,
    lessonSlug: 'entanglement',
    targetProbabilities: dist(2, { 0: 0.5, 3: 0.5 }),
    maxGates: 2,
    hints: [
      'Two gates. Start by making ONE of the qubits undecided, exactly as you did for the fair coin.',
      'Now you need the second qubit to copy the first. A controlled gate fires only when its control reads |1⟩ — and here the control is in superposition, so it half-fires.',
      'Order matters: superposition first, then CX with the superposed qubit as the control.',
    ],
    successNote:
      'That is the Bell state Φ+. Look at the histogram: two bars of 50%. Now look at what is missing — |01⟩ and |10⟩ have probability zero, which is not something two independent coins could ever manage. The correlation lives in the pair, not in either qubit.',
  },

  // ── 5 ──────────────────────────────────────────────────────
  {
    id: 'psi-plus',
    title: 'The other Bell state',
    brief:
      'Same idea, opposite correlation. Half the shots must read |01⟩ and half |10⟩ — the two qubits must always DISAGREE. |00⟩ and |11⟩ must never appear.',
    kind: 'target-state',
    level: 'Beginner',
    numQubits: 2,
    lessonSlug: 'entanglement',
    targetProbabilities: dist(2, { 1: 0.5, 2: 0.5 }),
    maxGates: 3,
    hints: [
      'You already know how to make the qubits agree. What single extra gate turns "always agree" into "always disagree"?',
      'Flip the target qubit before or after the CX, or flip either qubit after it — that relabels the outcomes without breaking the entanglement.',
    ],
    successNote:
      'This is Ψ+. It is just as entangled as Φ+; the entanglement entropy of each qubit is still exactly 1 bit. Anti-correlation and correlation are the same physics wearing a different label, which is why an X gate can convert one into the other for free.',
  },

  // ── 6 ──────────────────────────────────────────────────────
  {
    id: 'uniform-three',
    title: 'Uniform over three qubits',
    brief:
      'Three qubits, eight basis states, and every one of them equally likely: 1/8 = 12.5% each. This is the starting line for almost every quantum algorithm.',
    kind: 'target-distribution',
    level: 'Beginner',
    numQubits: 3,
    lessonSlug: 'superposition-and-measurement',
    targetProbabilities: uniform(3),
    tolerance: 0.02,
    maxGates: 3,
    hints: [
      'You do not need any two-qubit gates. The qubits do not need to know about each other at all.',
      'Whatever made one qubit a fair coin, do it to each of the three.',
    ],
    successNote:
      'Three gates produced eight simultaneous amplitudes. Add one more qubit and one more gate and you have sixteen; at 63 qubits a single layer of Hadamards spans more basis states than there are grains of sand on Earth (2^63 ≈ 9×10^18). That exponential is the resource — the hard part, which Grover and Shor solve, is getting an answer out of it.',
  },

  // ══════════════════════════════════════════════════════════
  // INTERMEDIATE — phase, basis, and the first circuits whose
  // point is invisible in the histogram.
  // ══════════════════════════════════════════════════════════

  // ── 7 ──────────────────────────────────────────────────────
  {
    id: 'undo-the-hadamard',
    title: 'Undo the Hadamard',
    brief:
      'This circuit was meant to leave the qubit exactly where it started — H, then H again, is the identity. Someone slipped an extra gate into the middle and now it lands on |1⟩ every time. Repair it: |0⟩ with certainty. Click a placed gate to remove it.',
    kind: 'fix-the-bug',
    level: 'Intermediate',
    numQubits: 1,
    lessonSlug: 'interference',
    startingCircuit: {
      numQubits: 1,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'Z', qubits: [0] },
        { name: 'H', qubits: [0] },
      ],
    },
    targetProbabilities: dist(1, { 0: 1 }),
    maxGates: 2,
    hints: [
      'Between the two Hadamards, the qubit is in an equal superposition. The stray gate does not change either probability — but it changes something.',
      'Z flips the sign of the |1⟩ amplitude. On the way back through the second H, the two paths that used to add now subtract.',
      'You can either delete the offending gate or add a second copy of it — Z twice in a row is the identity. Both fixes work; one of them is shorter.',
    ],
    successNote:
      'H·Z·H is exactly X. No probability changed in the middle of that circuit, yet the final answer flipped completely. That is interference: amplitudes, unlike probabilities, carry signs, and signs can cancel. Every quantum speedup is a carefully arranged version of this.',
  },

  // ── 8 ──────────────────────────────────────────────────────
  {
    id: 'broken-cnot',
    title: 'Broken CNOT',
    brief:
      'This was supposed to be a Bell pair, and the two gates are the right two gates — but the result is nothing like entangled. Fix it so half the shots read |00⟩ and half read |11⟩.',
    kind: 'fix-the-bug',
    level: 'Intermediate',
    numQubits: 2,
    lessonSlug: 'gates-and-circuits',
    startingCircuit: {
      numQubits: 2,
      ops: [
        { name: 'CX', qubits: [0, 1] },
        { name: 'H', qubits: [0] },
      ],
    },
    targetProbabilities: dist(2, { 0: 0.5, 3: 0.5 }),
    maxGates: 2,
    hints: [
      'Read the circuit left to right and ask what q0 is doing at the moment the CX fires.',
      'A controlled gate acting on a control that is definitely |0⟩ does nothing at all. The CX is a no-op here, and the H afterwards only touches q0.',
      'The gates are correct; the order is not. Rebuild them the other way round.',
    ],
    successNote:
      'Circuits are matrix products, and matrices do not commute: H·CX and CX·H are different operations. Putting the control into superposition BEFORE the controlled gate is what makes the CX fire "partly", and partly-firing is precisely what entanglement is.',
  },

  // ── 9 ──────────────────────────────────────────────────────
  {
    id: 'ghz-three',
    title: 'GHZ for three',
    brief:
      'Scale the Bell pair up. Three qubits, half the shots reading |000⟩ and half reading |111⟩ — all three always agree, and the other six basis states never appear.',
    kind: 'target-state',
    level: 'Intermediate',
    numQubits: 3,
    lessonSlug: 'entanglement',
    targetProbabilities: dist(3, { 0: 0.5, 7: 0.5 }),
    maxGates: 3,
    hints: [
      'Build a Bell pair first, then bring the third qubit into the agreement.',
      'One more CX does it. You can chain it off the qubit you just entangled — a qubit that already agrees with q0 makes a perfectly good control.',
      'Three gates total: one H and two CX.',
    ],
    successNote:
      'The GHZ state. Measure any one qubit and all three collapse together, instantly and consistently. It is also famously fragile: a single phase error on one qubit ruins the whole correlation, which is why GHZ fidelity is a standard benchmark for real hardware.',
  },

  // ── 10 ─────────────────────────────────────────────────────
  {
    id: 'tilt-the-coin',
    title: 'Tilt the coin',
    brief:
      'A fair coin is one particular superposition; you can dial any other. Build a single-qubit circuit that reads |1⟩ about 15% of the time and |0⟩ the rest — one gate, one angle. The θ slider moves in steps of π/16, and one of those stops lands within a fraction of a percent of the target.',
    kind: 'target-distribution',
    level: 'Intermediate',
    numQubits: 1,
    lessonSlug: 'superposition-and-measurement',
    // sin²(π/8) = 0.14645, the exact value RY(π/4) produces. The brief says
    // "about 15%" because that is the number a learner can aim at; the tolerance
    // is wide enough that the neighbouring slider stops (π/8 → 3.8%, 3π/8 →
    // 30.9%) are both clearly wrong.
    targetProbabilities: dist(1, { 0: 0.85355, 1: 0.14645 }),
    tolerance: 0.02,
    maxGates: 1,
    hints: [
      'H is the only fixed gate that makes a superposition, and it always makes a 50/50 one. You need the family of gates that takes an angle.',
      'A rotation about the Y axis by θ sends |0⟩ to cos(θ/2)|0⟩ + sin(θ/2)|1⟩, so P(1) = sin²(θ/2). Solve sin²(θ/2) ≈ 0.15 and you get θ ≈ 0.25π.',
      'Select RY, set the θ slider to 0.25π, then click the wire.',
    ],
    successNote:
      'RY(θ) is the continuous version of everything you have done so far: θ = 0 leaves |0⟩ alone, θ = π/2 is the fair coin, θ = π is an X gate. Real hardware implements X and H this way — as calibrated pulses that rotate by a fixed angle — so the "discrete gate set" you see in the palette is a convenience layer over a continuous knob.',
  },

  // ── 11 ─────────────────────────────────────────────────────
  {
    id: 'minus-sign',
    title: 'The invisible sign',
    brief:
      'Produce (|0⟩ − |1⟩)/√2, the state usually written |−⟩. Both outcomes must stay at 50%, and the |1⟩ amplitude must be negative. The histogram cannot see the difference between this and the fair coin — this one is graded on amplitudes.',
    kind: 'oracle',
    level: 'Intermediate',
    numQubits: 1,
    lessonSlug: 'interference',
    targetProbabilities: dist(1, { 0: 0.5, 1: 0.5 }),
    targetSigns: signs(1, [1]),
    maxGates: 2,
    hints: [
      'Start from the fair coin. You need one more gate, and it must not change either probability.',
      'Z multiplies the |1⟩ amplitude by −1 and leaves |0⟩ alone. There is also a two-gate route that never uses Z at all: H sends |1⟩ to (|0⟩ − |1⟩)/√2.',
    ],
    successNote:
      '|+⟩ and |−⟩ give identical measurement statistics in the computational basis and are still completely different states — perfectly distinguishable, with certainty, by a single measurement in the X basis. That sign is the whole substrate that interference, Grover\'s oracle and phase kickback are built on, and it is why "just look at the histogram" is not a sufficient debugging strategy.',
  },

  // ── 12 ─────────────────────────────────────────────────────
  {
    id: 'read-the-y-axis',
    title: 'Read the Y axis',
    brief:
      'The two gates already on the wire prepare |+i⟩ = (|0⟩ + i|1⟩)/√2 — a state that is perfectly definite along the Y axis and a coin flip along Z. Your detector only measures Z. Add gates so the circuit reads |1⟩ on every single shot, without deleting the preparation.',
    kind: 'target-state',
    level: 'Intermediate',
    numQubits: 1,
    lessonSlug: 'superposition-and-measurement',
    startingCircuit: {
      numQubits: 1,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'S', qubits: [0] },
      ],
    },
    targetProbabilities: dist(1, { 1: 1 }),
    maxGates: 4,
    hints: [
      'Measuring "in the Y basis" is not a different measurement — it is the same Z measurement with a rotation in front of it. Your job is that rotation.',
      'Two steps: first turn the Y axis into the X axis, then turn the X axis into Z. The second step is a Hadamard.',
      'S rotates a quarter turn about Z, which is exactly what maps the Y axis onto X. Two more gates after the preparation: a quarter turn, then H.',
    ],
    successNote:
      'A quantum computer measures one basis and one only. Everything else — X basis, Y basis, an arbitrary observable — is a rotation applied first, and this is precisely what a real device does when you ask it for ⟨Y⟩: it appends S† and H and counts zeros and ones. Note the corollary: measuring three different observables on the same qubit needs three separately prepared copies, which is why VQE\'s shot budget grows with the number of Pauli terms in the Hamiltonian.',
  },

  // ── 13 ─────────────────────────────────────────────────────
  {
    id: 'phase-kickback',
    title: 'Kick the phase back',
    brief:
      'Put q0 into |+⟩ and q1 into |−⟩, then apply CX with q0 as the control and q1 as the target. Predict the result before you check it: the target comes out exactly as it went in, and the CONTROL is the qubit that changes. All four bars stay at 25%; this one is graded on amplitudes, and the target signs say the |1⟩ branch of q0 has picked up a minus.',
    kind: 'oracle',
    level: 'Intermediate',
    numQubits: 2,
    lessonSlug: 'gates-and-circuits',
    targetProbabilities: uniform(2),
    // |+⟩⊗|−⟩ through a CX becomes |−⟩⊗|−⟩: amplitude sign is (−1)^(q0+q1),
    // i.e. negative on |01⟩ and |10⟩ (indices 1 and 2).
    targetSigns: signs(2, [1, 2]),
    maxGates: 4,
    hints: [
      'Four gates: one to prepare q0, two to prepare q1, and the CX. |−⟩ is X then H.',
      'Work out what CX does to |−⟩ on its own: it swaps the two amplitudes of the target, and those amplitudes are +1/√2 and −1/√2, so swapping them multiplies the whole thing by −1.',
      'That −1 is a number, not a gate on a wire. It attaches to whichever branch of the control made the CX fire — the |1⟩ branch of q0 — which is exactly the sign the target asks for.',
    ],
    successNote:
      'Phase kickback: a controlled gate whose target sits in an eigenstate leaves the target untouched and writes the eigenvalue onto the control instead. Every algorithm that "learns a phase" is this trick run at scale — Deutsch–Jozsa, quantum phase estimation, and therefore the order-finding register in Shor. It is also the reason the |−⟩ ancilla is a standard fixture: it turns a bit-flip oracle into a sign-flip oracle for free.',
  },

  // ── 14 ─────────────────────────────────────────────────────
  {
    id: 'deutsch-one-query',
    title: 'One question, one answer',
    brief:
      'A CX with q0 as control and q1 as target is the oracle for a hidden one-bit function f, writing f into q1. This particular f is balanced — f(0) ≠ f(1) — and a classical computer needs two queries to know that. Build the whole circuit, using that CX ONCE and only once, so that q0 reads |1⟩ on every shot: q0 = 1 means balanced, and you asked once. Par is 5.',
    kind: 'target-state',
    level: 'Intermediate',
    numQubits: 2,
    lessonSlug: 'interference',
    // NO startingCircuit, deliberately. The oracle used to arrive pre-placed
    // with a brief that said "leave the CX where it is" — but the workbench
    // only ever APPENDS a gate to the end of `circuit.ops` (CircuitGrid has no
    // insert-at-column), so a learner obeying that instruction could not put
    // the H on q0 in front of the oracle and the challenge was unsolvable as
    // written. It looked fine in CI because the reference solution in
    // catalogue.test.ts prepended to the starting ops, which is a move no user
    // can make. If you ever pre-place gates again, the solution must remain
    // reachable by appending to them — there is a test for that now.
    targetProbabilities: dist(2, { 1: 0.5, 3: 0.5 }),
    maxGates: 5,
    hints: [
      'The oracle can only tell you about f(0) and f(1) separately — unless you ask about both at once. Put q0 into superposition BEFORE the oracle, and interfere the two branches afterwards.',
      'On its own that is not enough: a CX writes f into q1 as a bit, and a bit written into another wire destroys the interference. Prepare q1 so the oracle writes a SIGN instead — the |−⟩ trick from the previous challenge.',
      'Five gates, in this order: H on q0, X then H on q1, the oracle CX (control q0, target q1), and a final H on q0.',
    ],
    successNote:
      'Deutsch\'s algorithm, and the first quantum advantage anyone proved: one query where classical needs two. Look at what it is made of — kickback turns f into a relative phase on q0, and the final H converts that phase into a certainty. The speedup does not come from evaluating f twice at once; it comes from arranging for the two answers to interfere so that the QUESTION you actually care about (are they equal?) is the thing left standing.',
  },

  // ── 15 ─────────────────────────────────────────────────────
  {
    id: 'route-the-pair',
    title: 'Route around the coupling map',
    brief:
      'Entangle q0 with q2 — half the shots reading |000⟩ and half |101⟩, with q1 left clean at |0⟩. The catch is the hardware story: on this imaginary device only NEIGHBOURING qubits are connected, so a two-qubit gate may act on q0-q1 or q1-q2 but never directly on q0-q2. Build the pair on a connected edge and then move it, using CNOTs only. Par is 5.',
    kind: 'target-state',
    level: 'Intermediate',
    numQubits: 3,
    lessonSlug: 'entanglement',
    targetProbabilities: dist(3, { 0: 0.5, 5: 0.5 }),
    maxGates: 5,
    hints: [
      'Two gates make a Bell pair on q0 and q1. The remaining problem is purely one of moving q1\'s half of it onto q2 without disturbing the correlation.',
      'Exchanging two qubits is what SWAP does — and SWAP is three CNOTs: control-target, target-control, control-target again. Try it on paper with a basis state and watch the two bits trade places.',
      'H, CX(q0→q1), then the three alternating CNOTs between q1 and q2.',
    ],
    successNote:
      'This is what a transpiler spends most of its time on. A real device has a coupling map, and any gate between unconnected qubits is compiled into SWAPs — three CNOTs each, on hardware where the CNOT is the noisiest thing you own. Routing overhead, not gate count in the abstract, is usually what decides whether a circuit fits inside the coherence time. Be honest about one thing: the grader only sees the final state, so nothing stopped you from placing a CX straight across q0 and q2 and finishing in two gates. The device would have refused; the simulator cannot. The par of 5 is the real score here.',
  },

  // ══════════════════════════════════════════════════════════
  // ADVANCED — multi-stage circuits where the point is the
  // structure, not the individual gate.
  // ══════════════════════════════════════════════════════════

  // ── 16 ─────────────────────────────────────────────────────
  {
    id: 'gate-golf-top-two',
    title: 'Gate golf: entangle the top two',
    brief:
      'Three qubits. Entangle q1 and q2 into a Bell pair — half the shots reading |000⟩ and half reading |110⟩ — while leaving q0 untouched at |0⟩. Par is 2 gates. Hitting the target with more still counts, but the score rewards the shortest circuit.',
    kind: 'gate-golf',
    level: 'Advanced',
    numQubits: 3,
    lessonSlug: 'entanglement',
    targetProbabilities: dist(3, { 0: 0.5, 6: 0.5 }),
    maxGates: 2,
    hints: [
      'q0 is already exactly where it needs to be. Every gate you spend on it is a gate wasted — and most of them will break the target.',
      'Entanglement is local: a Bell pair on q1 and q2 does not need to route through q0 at all.',
      'Two gates: put q1 into superposition, then copy it onto q2.',
    ],
    successNote:
      'Two gates, and q0 is still a clean unentangled |0⟩ — its entanglement entropy is 0 while q1 and q2 each carry a full bit. Entanglement is a relationship between specific qubits, not a property that leaks across the whole register. On real hardware, gate count is the currency: every extra gate spends coherence you cannot get back.',
  },

  // ── 17 ─────────────────────────────────────────────────────
  {
    id: 'mark-the-state',
    title: 'Mark the state',
    brief:
      'Build a Grover oracle for |11⟩. Put both qubits into an equal superposition, then flip the SIGN of the |11⟩ amplitude and only that one. The histogram will not move at all — every outcome stays at 25% — and that is the entire point. The grader checks amplitudes.',
    kind: 'oracle',
    level: 'Advanced',
    numQubits: 2,
    lessonSlug: 'grover',
    targetProbabilities: uniform(2),
    targetSigns: signs(2, [3]),
    maxGates: 3,
    hints: [
      'Start where every Grover search starts: a Hadamard on each qubit.',
      'You now need a gate that does nothing except attach a minus sign when BOTH qubits read |1⟩. Look at the two-qubit gates and read their descriptions.',
      'Three gates: H, H, and one controlled phase flip.',
    ],
    successNote:
      'You just built an oracle. It changed no probability whatsoever — measuring now is exactly as useless as before — and yet the marked state is genuinely distinguished, in the sign of its amplitude. Grover\'s algorithm works by following this with a diffusion step that converts that invisible sign into a visible probability. Marking is easy; harvesting the mark is the algorithm.',
  },

  // ── 18 ─────────────────────────────────────────────────────
  {
    id: 'uncompute-the-ancilla',
    title: 'Borrow a qubit and give it back',
    brief:
      'Mark |11⟩ on q0 and q1 the way a real algorithm does it: with a scratch qubit. Put q0 and q1 into equal superposition, prepare q2 as a |−⟩ ancilla, use a Toffoli to write the AND of q0 and q1 into it, then UNCOMPUTE the ancilla so it ends at exactly |0⟩ and is unentangled from everything else. The target says all four q2 = 0 bars sit at 25% and every q2 = 1 bar is empty; the signs say |11⟩ carries the minus. Par is 7.',
    kind: 'oracle',
    level: 'Advanced',
    numQubits: 3,
    lessonSlug: 'grover',
    // q2 = 0 in every surviving branch, so only indices 0..3 are populated.
    targetProbabilities: dist(3, { 0: 0.25, 1: 0.25, 2: 0.25, 3: 0.25 }),
    targetSigns: signs(3, [3]),
    maxGates: 7,
    hints: [
      'A Toffoli writes a BIT into the ancilla. What you want is a SIGN on the control register — which is what a Toffoli gives you for free if the ancilla is sitting in |−⟩ when it fires.',
      'Preparing |−⟩ takes X then H. Undoing it takes the same two gates in reverse: H then X. That reversal is the uncomputation.',
      'Seven gates: H, H, X on q2, H on q2, CCX(q0, q1 → q2), then H on q2 and X on q2 to put the scratch qubit back where you found it.',
    ],
    successNote:
      'Try deleting the last two gates and checking again: the histogram spreads over all eight states. Not because the ancilla is entangled — a Toffoli firing on a |−⟩ target only kicks a phase back onto the controls, and the ancilla is still exactly |−⟩, in a product with the register — but because a scratch qubit left in |−⟩ reads 0 or 1 with equal probability and pollutes every measurement. Uncomputing it to |0⟩ is what makes it safe to measure, discard or reuse. The stakes are higher when the ancilla is NOT in an eigenstate of the operation — prepare it in |0⟩ instead, skip the uncompute, and it really does become entangled with the register, a which-path record that kills the interference the oracle was meant to set up. Every reversible algorithm pays this cost, and it is why quantum memory budgets count scratch space that is provably returned to |0⟩.',
  },

  // ── 19 ─────────────────────────────────────────────────────
  {
    id: 'w-state-repair',
    title: 'GHZ\'s awkward cousin',
    brief:
      'This circuit was meant to build the three-qubit W state — one excitation shared equally between the qubits, so |001⟩, |010⟩ and |100⟩ each come up 33.3% of the time and nothing else ever does. It is one gate short: the excitation gets to the third qubit but the second one never lets go of it, so 33.3% is sitting on |110⟩ instead of |100⟩. Add the missing CNOT. Leave the two rotations alone. Their angles are not multiples of π/16 and the θ slider cannot type them back in.',
    kind: 'fix-the-bug',
    level: 'Advanced',
    numQubits: 3,
    lessonSlug: 'entanglement',
    startingCircuit: {
      numQubits: 3,
      ops: [
        { name: 'X', qubits: [0] },
        // Controlled-RY(θ₁), decomposed as RY(θ/2) · CX · RY(−θ/2) · CX, which
        // is the only way to get a controlled rotation out of this gate set.
        // θ₁ = 2·asin(√(2/3)) hands 2/3 of the amplitude on to q1.
        { name: 'RY', qubits: [1], theta: Math.asin(Math.sqrt(2 / 3)) },
        { name: 'CX', qubits: [0, 1] },
        { name: 'RY', qubits: [1], theta: -Math.asin(Math.sqrt(2 / 3)) },
        { name: 'CX', qubits: [0, 1] },
        { name: 'CX', qubits: [1, 0] },
        // Controlled-RY(π/2): an even split of what is left between q1 and q2.
        { name: 'RY', qubits: [2], theta: Math.PI / 4 },
        { name: 'CX', qubits: [1, 2] },
        { name: 'RY', qubits: [2], theta: -Math.PI / 4 },
        { name: 'CX', qubits: [1, 2] },
      ],
    },
    targetProbabilities: dist(3, { 1: 1 / 3, 2: 1 / 3, 4: 1 / 3 }),
    tolerance: 0.02,
    maxGates: 11,
    hints: [
      'Compare the two histograms bar by bar. Exactly one bar is in the wrong place, and its label tells you which two qubits are both excited when they should not be.',
      'Each transfer block in this circuit has two halves: a controlled rotation that moves amplitude onto the next qubit, and then a CNOT that switches the previous qubit OFF in the branch where the transfer happened. The second block is missing its second half.',
      'One CX, control q2, target q1, at the very end.',
    ],
    successNote:
      'GHZ and W are the two inequivalent kinds of three-qubit entanglement — no sequence of local operations turns one into the other, which is a theorem, not a limitation of your gate set. They fail differently too: lose a qubit from GHZ and the remaining two are left with no entanglement at all, whereas W degrades gracefully into a Bell-like pair. That robustness is why W-type states show up in proposals for quantum networks. Notice what building one costs. GHZ was three gates; W needs controlled rotations, and a controlled rotation costs four gates in this gate set because there is no CRY in the palette. Equal thirds are simply not something Hadamards can make: every amplitude a Clifford circuit produces on n qubits is a multiple of a power of 1/√2, and 1/√3 is not.',
  },

  // ── 20 ─────────────────────────────────────────────────────
  {
    id: 'qft-two-qubit',
    title: 'The two-qubit QFT, missing its last step',
    brief:
      'This is a two-qubit quantum Fourier transform applied to the input state (|00⟩ + |01⟩)/√2 — the H on q0 is the input, the rest is the transform. The gates are all correct and the output is still wrong: the probabilities land on the right values but the wrong labels. Add the one gate that fixes it, so the histogram reads 50% on |00⟩, 25% on |01⟩, nothing on |10⟩ and 25% on |11⟩.',
    kind: 'fix-the-bug',
    level: 'Advanced',
    numQubits: 2,
    // The QFT has no lesson of its own in the foundations track; interference is
    // the right place to send someone who is stuck, since that is all the
    // transform is. Deliberately not 'shor' — that lesson sits behind the paid
    // advanced track, and a hint link that 402s is worse than a loose fit.
    lessonSlug: 'interference',
    startingCircuit: {
      numQubits: 2,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'H', qubits: [1] },
        // Controlled-S between q0 and q1, built from T gates because there is
        // no controlled-phase in GATE_LIBRARY. CS is symmetric in its two
        // qubits, which is why the QFT diagram draws it as a bare line.
        { name: 'T', qubits: [0] },
        { name: 'T', qubits: [1] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'TDG', qubits: [1] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'H', qubits: [0] },
      ],
    },
    targetProbabilities: dist(2, { 0: 0.5, 1: 0.25, 3: 0.25 }),
    tolerance: 0.01,
    maxGates: 9,
    hints: [
      'Nothing is wrong with the transform. Compare your histogram with the target and read the labels of the two bars that disagree — they are the same two probabilities, on the wrong states.',
      'The QFT circuit processes the most significant qubit first and emits its answer on the least significant wire. The standard diagram ends with an explicit correction for exactly this.',
      'One SWAP, on q0 and q1, at the end.',
    ],
    successNote:
      'Every textbook QFT circuit ends in a ladder of SWAPs, and it is not decoration: the recursive structure of the transform delivers the output bits reversed. Implementations usually delete the SWAPs and relabel the wires instead, which costs nothing and is why you will see the QFT quoted at n(n+1)/2 gates — but if you delete them and forget to relabel, you get exactly the bug you just fixed, and it is quiet. The probabilities are all still plausible; only the addresses moved. The other thing worth taking away: the controlled-S here is five gates. Scaling the QFT means controlled rotations by π/2^k, they get exponentially small, and on real hardware the tiny ones are below the noise floor and are simply dropped — the "approximate QFT", which is provably good enough for Shor.',
  },

  // ── 21 ─────────────────────────────────────────────────────
  {
    id: 'teleport-the-state',
    title: 'Finish the teleporter',
    brief:
      'q0 holds an unknown state — here RY(π/4)|0⟩, which reads |1⟩ about 14.6% of the time — and the circuit already entangles q1 with q2, performs the Bell measurement basis change on q0 and q1, and gets as far as that. It stops before the corrections, so q2 currently comes out uniformly random: teleportation without the classical fix-up moves nothing at all. Add the two conditional corrections so that q2 carries the original state. Target: the four bars with q2 = 0 sit at 21.3% and the four with q2 = 1 at 3.7% — that is q2 holding the original 85/15 split while q0 and q1 read uniform noise.',
    kind: 'fix-the-bug',
    level: 'Advanced',
    numQubits: 3,
    lessonSlug: 'entanglement',
    startingCircuit: {
      numQubits: 3,
      ops: [
        // The payload. π/4 is a multiple of π/16, so a learner who deletes it by
        // accident can put it back from the slider.
        { name: 'RY', qubits: [0], theta: Math.PI / 4 },
        { name: 'H', qubits: [1] },
        { name: 'CX', qubits: [1, 2] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'H', qubits: [0] },
      ],
    },
    targetProbabilities: dist(3, {
      0: 0.21339,
      1: 0.21339,
      2: 0.21339,
      3: 0.21339,
      4: 0.03661,
      5: 0.03661,
      6: 0.03661,
      7: 0.03661,
    }),
    tolerance: 0.01,
    maxGates: 7,
    hints: [
      'In the textbook protocol Alice measures q0 and q1 and phones the two bits to Bob, who applies X if the second bit is 1 and Z if the first is 1. You have no phone and no measurement here — but a controlled gate does the same job, because the control wire already holds exactly that bit.',
      'So: one gate conditioned on q1 that flips q2, and one gate conditioned on q0 that flips q2\'s phase.',
      'CX with control q1 and target q2, then CZ across q0 and q2. Seven gates in total.',
    ],
    successNote:
      'That is quantum teleportation, with the classical channel replaced by coherent control — the "deferred measurement" trick, which is legitimate precisely because measuring a control before a controlled gate and measuring it after give identical statistics. Three things this circuit proves, none of them obvious: the state moved without anything travelling between q0 and q2 (the entanglement was distributed in advance); q0 is left in a random, useless state, so no-cloning is respected — teleportation is a MOVE, never a copy; and until the two corrections are applied, q2 is exactly uniform, which is what stops the protocol from signalling faster than light. Delete the CX and CZ and look at qubit 2 on its own: it reads 50/50, no matter what state you sent. Without the two classical bits, Bob has nothing.',
  },

  // ── 22 ─────────────────────────────────────────────────────
  {
    id: 'grover-one-iteration',
    title: 'One full turn of Grover',
    brief:
      'Search eight items for the marked one, by hand. Mark |111⟩ with a phase, then run one full diffusion step, so the histogram reads 78.1% on |111⟩ and 3.1% on each of the other seven. That 78.1% is the point: one iteration out of the two that N = 8 wants, and the number is the fingerprint of having actually amplified rather than just written the answer down. Par is 21 gates — this is the longest circuit in the catalogue and it is meant to be.',
    kind: 'target-distribution',
    level: 'Advanced',
    numQubits: 3,
    lessonSlug: 'grover',
    targetProbabilities: dist(3, {
      0: 0.03125,
      1: 0.03125,
      2: 0.03125,
      3: 0.03125,
      4: 0.03125,
      5: 0.03125,
      6: 0.03125,
      7: 0.78125,
    }),
    tolerance: 0.01,
    maxGates: 21,
    hints: [
      'Three stages: an equal superposition, an oracle that flips the sign of |111⟩, and a diffusion operator that reflects every amplitude about their mean. The second and third stages are the same shape as each other.',
      'There is no CCZ in the palette, but a CCZ is a CCX with a Hadamard on the target either side — that identity is worth three gates and you will need it twice.',
      'Diffusion is "flip the sign of everything except |000⟩", sandwiched in Hadamards: H on all three, X on all three, CCZ, X on all three, H on all three. Written out: 3 H, then the oracle CCZ (3), then 3 H, 3 X, a second CCZ (3), 3 X, 3 H — 21 gates.',
    ],
    successNote:
      'One iteration rotated the marked amplitude from 1/√8 to 0.884, which is 78.1% of the probability. Run a second and you reach 94.5%; run a third and it falls back to about 33%. That non-monotonicity is the thing to remember about Grover — it is a rotation, not a search that converges, so knowing when to stop is part of the algorithm and requires knowing N in advance. Count what you paid: 21 gates for a search over 8 items, where trying all eight classically costs 8 lookups. Grover only wins asymptotically, and the constant factor is brutal, which is why the standard advice about symmetric crypto is "double the key length" rather than "panic".',
  },
  // ── 23 ─────────────────────────────────────────────────────
  {
    id: 'mark-one-of-eight',
    title: 'Mark one of eight',
    brief:
      'A Grover oracle for a three-qubit search: put all three qubits into equal superposition, then flip the sign of the |101⟩ amplitude — and only that one. Every bar stays at 12.5%; the grader checks amplitudes. The catch: the only multi-controlled gate in the palette fires when its controls read |1⟩, and the state you are marking has a 0 in the middle. Par is 8.',
    kind: 'oracle',
    level: 'Advanced',
    numQubits: 3,
    lessonSlug: 'grover',
    targetProbabilities: uniform(3),
    // |101⟩ is index 5: q2 = 1, q1 = 0, q0 = 1.
    targetSigns: signs(3, [5]),
    maxGates: 8,
    hints: [
      'You need a sign flip on exactly one of eight states, which means a phase gate conditioned on ALL THREE qubits. There is no CCZ in the palette — but a CCX with a Hadamard on the target either side is one, the same identity Grover\'s diffusion uses.',
      'A CCZ marks |111⟩. Your state has q1 = 0 where the CCZ wants a 1. Conjugation fixes that: X on q1 before the CCZ relabels |101⟩ as |111⟩, and a second X on q1 afterwards relabels it back.',
      'Eight gates: H on each qubit, then X(q1), H(q2), CCX(q0,q1→q2), H(q2), X(q1).',
    ],
    successNote:
      'The X-sandwich is how every Grover oracle for an arbitrary bitstring is built: one X on each wire where the marked state has a 0, a multi-controlled Z in the middle, and the same Xs to undo it. The controlled gate never changes — only the dressing does — which is why the oracle\'s cost depends on the number of qubits, not on which state is marked. Note also which qubit hosts the CCX target: any of the three works, because CCZ, unlike CCX, is completely symmetric in its qubits. A phase belongs to a basis state, not to a wire.',
  },

  // ── 24 ─────────────────────────────────────────────────────
  {
    id: 'parity-kickback',
    title: 'Two kicks, one parity',
    brief:
      'Phase kickback, iterated. Put q0 and q1 into equal superposition, park q2 in |−⟩, then run CX(q0→q2) and CX(q1→q2). Each CX writes its control bit into the ancilla — but the ancilla is in |−⟩, so each write comes back as a sign on the control register instead. Predict the pattern before you build it: the amplitude of every basis state picks up (−1)^(q0⊕q1), and the ancilla\'s own |1⟩ half carries its |−⟩ minus. All eight bars sit at 12.5%; the grader checks the signs.',
    kind: 'oracle',
    level: 'Advanced',
    numQubits: 3,
    lessonSlug: 'interference',
    targetProbabilities: uniform(3),
    // Sign is (−1)^(q0⊕q1) from the two kickbacks, times (−1)^(q2) from the
    // ancilla's own |−⟩. Negative exactly on the odd-bit-parity indices.
    targetSigns: signs(3, [1, 2, 4, 7]),
    maxGates: 6,
    hints: [
      'One CX into a |−⟩ ancilla kicks (−1)^(control) back onto the control — that was the phase-kickback challenge. Two CXs into the SAME ancilla multiply their kickbacks: (−1)^(q0) · (−1)^(q1) = (−1)^(q0⊕q1).',
      'So the whole two-gate block acts as Z on q0 times Z on q1, without ever touching either wire directly — an XOR computed into an ancilla becomes a parity phase on the register.',
      'Six gates: H on q0, H on q1, then X and H on q2 to make |−⟩, then the two CXs. No uncomputation needed — the CXs leave |−⟩ exactly as they found it.',
    ],
    successNote:
      'This is the engine of Bernstein–Vazirani: an oracle that XORs a subset of the input bits into a |−⟩ ancilla is, by kickback, a layer of Z gates on exactly that subset — and one layer of Hadamards turns those Zs into a readable bitstring, so the whole hidden subset comes out in a single query. Notice the ancilla is untouched at the end, with no uncomputation: |−⟩ is an eigenstate of X, so every kick leaves it where it was. That is why the |−⟩ ancilla is reusable across an entire algorithm, and it is the sense in which "the oracle writes its answer into the phase" is literal arithmetic, not metaphor.',
  },

  // ── 25 ─────────────────────────────────────────────────────
  {
    id: 'golf-move-the-pair',
    title: 'Gate golf: move half a Bell pair',
    brief:
      'The two pre-placed gates entangle q0 with q1. Hand q1\'s half of the pair to q2, so that half the shots read |000⟩ and half |101⟩ with q1 left clean at |0⟩ — keeping the two starting gates. Par is 4 total, which means TWO added gates. The routing challenge did this with a three-CNOT SWAP for five; the point of this hole is that a full SWAP is more than the job needs. As always, the grader only sees the final state — rebuilding the pair from scratch on q0 and q2 also lands on the target, but then you have practised nothing.',
    kind: 'gate-golf',
    level: 'Advanced',
    numQubits: 3,
    lessonSlug: 'entanglement',
    startingCircuit: {
      numQubits: 3,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'CX', qubits: [0, 1] },
      ],
    },
    targetProbabilities: dist(3, { 0: 0.5, 5: 0.5 }),
    maxGates: 4,
    hints: [
      'A SWAP is three CNOTs because it must exchange ARBITRARY states. But q2 is not arbitrary — it is |0⟩, and half of a Bell pair is not arbitrary either. Cheaper moves exist for states you know something about.',
      'First copy q1 onto q2 with a CX — that is a GHZ state, all three agreeing. Now every branch has q1 = q2, so a CNOT between them can switch q1 off without losing any information.',
      'CX(q1→q2), then CX(q2→q1). The third CNOT of the SWAP would transfer q2\'s state back onto q1 — but q2 held |0⟩, so there was never anything to send back.',
    ],
    successNote:
      'Two CNOTs, not three. The general rule: SWAP costs three CNOTs, but swapping WITH A KNOWN |0⟩ costs two, because one direction of the exchange carries no information. Transpilers exploit exactly this — routing a qubit through a freshly reset neighbour is cheaper than routing through a busy one — and on hardware where every CNOT costs fidelity, a third of the routing bill is worth real money. The intermediate state was GHZ: entangling a third qubit and then disentangling one is not a detour, it is the mechanism.',
  },

  // ── 26 ─────────────────────────────────────────────────────
  {
    id: 'golf-odd-one-out',
    title: 'Gate golf: the odd one out',
    brief:
      'Half the shots must read |011⟩ and half |100⟩ — q0 and q1 always agree with each other, and q2 always disagrees with both. Nothing else ever appears. Par is 4. The state is exactly as entangled as GHZ; the extra gate pays for the disagreement.',
    kind: 'gate-golf',
    level: 'Advanced',
    numQubits: 3,
    lessonSlug: 'entanglement',
    targetProbabilities: dist(3, { 3: 0.5, 4: 0.5 }),
    maxGates: 4,
    hints: [
      'Start from the GHZ recipe — one H, two CX — and then ask what single change turns "q2 agrees" into "q2 disagrees".',
      'An X on q2 after the entangling gates swaps the roles of its |0⟩ and |1⟩ in every branch at once: |000⟩ becomes |100⟩ and |111⟩ becomes |011⟩.',
      'Four gates: H(q0), CX(q0→q1), CX(q0→q2), X(q2). The X can equally go BEFORE the CX onto q2 — check on paper why a pre-flip and a post-flip both work here.',
    ],
    successNote:
      'This state is GHZ wearing a relabelled q2 — one local X maps one onto the other, so every entanglement measure agrees they are the same resource. That is worth internalising: which basis states are correlated is partly a labelling convention, and local gates move the labels without touching the entanglement. It is the three-qubit version of the Φ+/Ψ+ pair from the Bell challenges, and it is why hardware benchmarks quote "GHZ fidelity" without specifying which of the eight sign-and-flip variants they prepared — a local frame change converts any of them into any other.',
  },

  // ── 27 ─────────────────────────────────────────────────────
  {
    id: 'teleport-crossed-wires',
    title: 'Teleportation, wires crossed',
    brief:
      'A complete teleporter — payload RY(3π/8) on q0, entangled pair, Bell-basis change, and both corrections — that still delivers noise. The builder swapped the classical logic: the X correction is conditioned on q0 and the Z on q1, when the protocol wants exactly the reverse. Repair it (delete the two wrong gates, add the right ones) so q2 carries the payload: every q2 = 0 bar at 17.3%, every q2 = 1 bar at 7.7%.',
    kind: 'fix-the-bug',
    level: 'Advanced',
    numQubits: 3,
    lessonSlug: 'entanglement',
    startingCircuit: {
      numQubits: 3,
      ops: [
        // Payload: 3π/8 is on the π/16 lattice, so it is recoverable if deleted.
        { name: 'RY', qubits: [0], theta: (3 * Math.PI) / 8 },
        { name: 'H', qubits: [1] },
        { name: 'CX', qubits: [1, 2] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'H', qubits: [0] },
        // The bug: corrections conditioned on the wrong bits. The X correction
        // must follow the CX-measurement bit (q1) and the Z the H-measurement
        // bit (q0); here they are crossed.
        { name: 'CX', qubits: [0, 2] },
        { name: 'CZ', qubits: [1, 2] },
      ],
    },
    // q2 carries sin²(3π/16) ≈ 0.3087 on |1⟩, spread evenly over the four
    // (q1, q0) measurement branches.
    targetProbabilities: dist(3, {
      0: 0.17284,
      1: 0.17284,
      2: 0.17284,
      3: 0.17284,
      4: 0.07716,
      5: 0.07716,
      6: 0.07716,
      7: 0.07716,
    }),
    tolerance: 0.01,
    maxGates: 7,
    hints: [
      'Trace one branch by hand. Take q1 = 1, q0 = 0: the shared pair was flipped by the Bell-basis CX, so Bob\'s half needs an X and no Z. What does THIS circuit apply in that branch?',
      'The two bits mean different things: q1 records whether the payload\'s bit was XORed into the pair (fix with X on q2), and q0 records the phase comparison from the final H (fix with Z on q2). Conditioning each correction on the other qubit\'s bit applies the right medicine to the wrong diagnosis.',
      'Delete the last two gates, then add CX with control q1 and target q2, and CZ across q0 and q2.',
    ],
    successNote:
      'Both corrections were present, every gate was individually legitimate, and the output was still noise in half the branches — this bug survives any check that only counts gates. It is also a faithful copy of a real failure mode: on hardware, teleportation\'s classical bits travel through a control system, and crossing two channel labels in software produces exactly this circuit. The fix-it-by-branches method you just used — pick a measurement outcome, propagate what the pair must look like, compare with what is applied — is the standard way to debug any circuit with mid-circuit feedback, and it works because each branch is a small classical story you can follow by hand.',
  },

  // ── 28 ─────────────────────────────────────────────────────
  {
    id: 'qft-wrong-way-round',
    title: 'The transform that turned the wrong way',
    brief:
      'This circuit prepares (|00⟩ + i|01⟩)/√2 — the H and S at the front — and then runs what was meant to be the two-qubit QFT, bit-reversal SWAP included. The builder copied the controlled phase from a table of the INVERSE transform: the T-gate block in the middle rotates by −π/2 where the forward QFT wants +π/2. Every probability is right except two: 50% sits on |01⟩ and it belongs on |11⟩. One appended gate can fix it — without touching the T gates at all. Target: 25% on |00⟩, 25% on |10⟩, 50% on |11⟩.',
    kind: 'fix-the-bug',
    level: 'Advanced',
    numQubits: 2,
    // Same reasoning as qft-two-qubit: the QFT lives in the paid track's Shor
    // lesson, and a hint link that 402s is worse than a loose fit. The repair
    // is a pure phase-arithmetic argument, which is the interference lesson.
    lessonSlug: 'interference',
    startingCircuit: {
      numQubits: 2,
      ops: [
        // Input: (|00⟩ + i|01⟩)/√2. The i matters — on a REAL input state the
        // QFT and its inverse give identical probabilities (conjugate vectors
        // have the same magnitudes) and this bug would be invisible.
        { name: 'H', qubits: [0] },
        { name: 'S', qubits: [0] },
        { name: 'H', qubits: [1] },
        // Controlled-S†, five gates — the inverse-QFT rotation, which is the
        // bug. The forward transform wants controlled-S (T, T, CX, T†, CX).
        { name: 'TDG', qubits: [0] },
        { name: 'TDG', qubits: [1] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'T', qubits: [1] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'H', qubits: [0] },
        { name: 'SWAP', qubits: [0, 1] },
      ],
    },
    targetProbabilities: dist(2, { 0: 0.25, 2: 0.25, 3: 0.5 }),
    tolerance: 0.01,
    maxGates: 11,
    hints: [
      'You could delete the five-gate block and rebuild it with the daggers the other way round. The shorter repair never touches it: ask what single operation turns a controlled-S† into a controlled-S. S† times WHAT equals S?',
      'S† · Z = S, so controlled-S† followed by CZ is controlled-S — and both are diagonal, so the CZ may be written anywhere on that side of the block. The obstacle is that two gates now stand between that slot and the end of the circuit, where you are able to append.',
      'Push the CZ through them: past the H on q0 it becomes a CX with control q1 and target q0 (H trades Z for X on the wire it acts on), and the SWAP then exchanges the two roles. One appended CX, control q0, target q1.',
    ],
    successNote:
      'Two lessons, both load-bearing. First, the bug: QFT and QFT† differ only in the sign of their rotation angles, every probability they assign to a REAL input vector is identical, and the pair are conflated in print constantly — this is among the most reported errata in quantum computing textbooks, and it only becomes visible on an input with a complex relative phase, which is exactly what phase estimation feeds it. Second, the fix: you repaired a mid-circuit error from the end of the circuit by conjugation — S†·Z = S turned the missing rotation into a CZ, H turned the CZ into a CX, the SWAP relabelled its qubits. Pushing corrections through a circuit instead of rebuilding it is everyday practice in compiler passes and error tracking, and it works for the same reason the bug existed: gates are algebra, not furniture.',
  },

  // ── 29 ─────────────────────────────────────────────────────
  {
    id: 'w-state-from-scratch',
    title: 'W, by hand, within tolerance',
    brief:
      'Build the three-qubit W state yourself — one excitation shared equally, so |001⟩, |010⟩ and |100⟩ each near 33.3% and every other bar at zero — using only gates you place. The repair challenge handed you the awkward angles; this time the θ slider\'s π/16 steps are all you get, and 1/3 is not exactly reachable with them: sin²(3π/16) ≈ 30.9%, not 33.3%. The tolerance is 3%, and the slider can get every bar inside it. The zeros are NOT tolerant in spirit: any recipe that leaks probability onto |000⟩, |111⟩ or the two-excitation states will fail long before the thirds do. Par is 10.',
    kind: 'target-state',
    level: 'Advanced',
    numQubits: 3,
    lessonSlug: 'entanglement',
    targetProbabilities: dist(3, { 1: 1 / 3, 2: 1 / 3, 4: 1 / 3 }),
    tolerance: 0.03,
    maxGates: 10,
    hints: [
      'Split the problem: first decide q0 — excited with probability near 1/3, via one RY. Then, ONLY in the branch where q0 came up 0, share the excitation evenly between q1 and q2. "Only in the branch where q0 is 0" means controls with an X sandwich around them.',
      'The middle step is a controlled-RY(π/2), which this palette lacks — build it as RY(π/4) on the target, CX, RY(7π/4), CX. The 7π/4 is −π/4 plus a full turn; RY(2π) is −1 on everything, a global phase the grader cannot see.',
      'Ten gates: RY(3π/8) on q0; X(q0); RY(π/4) on q1, CX(q0→q1), RY(7π/4) on q1, CX(q0→q1); X(q1), CCX(q0,q1→q2), X(q1); X(q0). The last CCX block reads "q2 fires exactly when nothing else did".',
    ],
    successNote:
      'Look at what you spent: ten gates and a borrowed identity for a state GHZ reaches in three, and the thirds STILL land at 30.9/34.6/34.6 rather than 33.3 — because every amplitude a circuit of H, S, T and CNOTs can produce is a power of 1/√2 times integers, and 1/√3 is not among them. Exact thirds need the angle 2·asin(1/√3), which no finite slider lattice contains. Real compilers meet exactly this wall: arbitrary angles are approximated by long H-and-T sequences (Solovay–Kitaev and its successors), and precision is paid for in gate count. Your 3% tolerance bought you a 10-gate circuit; every extra digit of fidelity would buy more gates. That exchange rate — accuracy for depth — is one of the honest costs of fault-tolerant quantum computing.',
  },

  // ── 30 ─────────────────────────────────────────────────────
  {
    id: 'read-the-phase-bit',
    title: 'Read the phase bit',
    brief:
      'The three pre-placed gates prepare Φ− = (|00⟩ − |11⟩)/√2, which the histogram cannot tell apart from the Φ+ you built in the Bell challenge: both read 50/50 on |00⟩ and |11⟩. The minus sign is real physics, and there is a measurement that extracts it. Append gates — keeping the preparation — so the circuit ends on |01⟩ with certainty: q0 reads 1 exactly because the phase was −, and q1 reads 0 exactly because the parity was "equal". Par is 5.',
    kind: 'target-state',
    level: 'Advanced',
    numQubits: 2,
    lessonSlug: 'interference',
    startingCircuit: {
      numQubits: 2,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'Z', qubits: [0] },
      ],
    },
    targetProbabilities: dist(2, { 1: 1 }),
    maxGates: 5,
    hints: [
      'The preparation is H, CX, Z. A circuit that MAKES a Bell state, run backwards, is a circuit that IDENTIFIES one — each of the four Bell states comes back as a different basis state.',
      'Undo the entangling part: CX(q0→q1) first. Work out what is left on q0 — two amplitudes, equal size, opposite sign. One more gate turns that into a certainty.',
      'CX(q0→q1), then H(q0). The CX brings the parity bit out on q1; the H interferes the two paths so the sign lands on q0 as a readable 1.',
    ],
    successNote:
      'This two-gate tail is the Bell measurement, and the four Bell states map cleanly onto its four outcomes: q1 is the parity bit (do the qubits agree?) and q0 is the phase bit (+ or −). The sign you extracted was invisible to every computational-basis measurement, yet came out with CERTAINTY — not statistics — once the right interference ran first. That is worth sitting with: relative phase is not a bookkeeping artifact, it is one full bit of the state, and superdense coding sends two classical bits with one qubit precisely because a Bell pair stores one bit in parity and one in phase. It is also why this product keeps insisting the histogram is not the state.',
  },
]

/** Lookup by id — used by the challenge route and the daily pick. */
export function getChallenge(id: string): Challenge | undefined {
  return CHALLENGES.find((ch) => ch.id === id)
}
