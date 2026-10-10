/**
 * lib/paths/catalogue.ts — goal-shaped routes through everything on the site.
 *
 * The course (lib/lessons) has one teaching order. The coach (lib/coach) picks
 * the next CONCEPT. Neither answers the question a newcomer actually arrives
 * with: "I want to become X — what do I do, in what order, and when am I done?"
 * A path answers that. It is an ordered list of milestones, and every step in
 * it is something that already exists here: a lesson, a visualization, a
 * challenge, a workbench tool, or a page.
 *
 * RULES FOR EDITING THIS FILE:
 *   · A step names its target by the id its own catalogue uses (lesson slug,
 *     visualization href, challenge id, workbench href). Titles are NOT
 *     restated here; `resolve.ts` looks them up, so a renamed lesson can never
 *     leave a path showing its old name. `catalogue.test.ts` fails on any step
 *     that does not resolve.
 *   · `why` is the reason THIS step sits at THIS point of THIS path. It is not
 *     a description of the step — the step's own page does that.
 *   · `outcomes` must be things the steps actually teach. A path that promises
 *     a skill none of its steps touches is marketing.
 */

export type PathAccent = 'violet' | 'teal' | 'amber' | 'rose' | 'sky'

export type PathStep =
  | { kind: 'lesson'; ref: string; why: string }
  | { kind: 'visualization'; ref: string; why: string }
  | { kind: 'challenge'; ref: string; why: string }
  | { kind: 'workbench'; ref: string; why: string }
  /** A top-level page. The title is given because pages have no catalogue. */
  | { kind: 'page'; ref: string; title: string; why: string }

export interface Milestone {
  title: string
  /** What is true of you once this milestone is done. */
  summary: string
  steps: PathStep[]
}

export interface LearningPath {
  slug: string
  icon: string
  accent: PathAccent
  title: string
  /** One line, in the learner's words: the dream this path is for. */
  tagline: string
  /** Who should pick this, and what they need walking in. */
  forWho: string
  /** Concrete things you can do at the end. */
  outcomes: string[]
  /** Where to go once the path is finished — beyond this site where honest. */
  beyond: string[]
  milestones: Milestone[]
}

export const PATHS: readonly LearningPath[] = [
  {
    slug: 'quantum-curious',
    icon: '✨',
    accent: 'violet',
    title: 'Quantum, explained properly',
    tagline: 'I keep hearing about quantum and I want to actually understand it.',
    forWho:
      'Anyone. No equations required walking in, and none are sprung on you — every idea is met first as an experiment you can run.',
    outcomes: [
      'Explain superposition without saying "it is both at once"',
      'Say what entanglement does and — just as important — what it cannot do',
      'Describe what a quantum computer physically is, and why it is hard to build',
      'Tell a real quantum claim from a marketing one',
    ],
    beyond: [
      'Carry on with the Quantum software engineer path — you have already done its first milestone.',
      'Read the popular-science books with a sharper eye: you now know where the metaphors break.',
    ],
    milestones: [
      {
        title: 'The experiment that broke physics',
        summary: 'You have seen, with your own clicks, that particles do something no ball can.',
        steps: [
          { kind: 'visualization', ref: '/visualizations/double-slit', why: 'Everything else on this path is an attempt to explain what happens here.' },
          { kind: 'visualization', ref: '/visualizations/photoelectric-effect', why: 'The experiment that forced light to come in lumps — and won Einstein his Nobel.' },
          { kind: 'visualization', ref: '/visualizations/stern-gerlach', why: 'Measurement is not passive: here it visibly changes what comes next.' },
        ],
      },
      {
        title: 'Qubits, in plain language',
        summary: 'You can describe a qubit, and say what measuring one does to it.',
        steps: [
          { kind: 'lesson', ref: 'what-is-a-qubit', why: 'The one idea everything else hangs on: a qubit is a direction, not a switch.' },
          { kind: 'visualization', ref: '/visualizations/bloch-sphere', why: 'Turn the words of the last lesson into a globe you can spin.' },
          { kind: 'lesson', ref: 'superposition-and-measurement', why: 'What "both at once" really means, and what a measurement throws away.' },
          { kind: 'lesson', ref: 'interference', why: 'The actual source of quantum computing power — not parallelism, cancellation.' },
        ],
      },
      {
        title: 'Spooky, but not magic',
        summary: 'You understand entanglement well enough to spot when it is being oversold.',
        steps: [
          { kind: 'lesson', ref: 'entanglement', why: 'The correlations, and the reason they cannot send a message.' },
          { kind: 'visualization', ref: '/visualizations/bell-test', why: 'The experiment that proved no hidden script could explain the results.' },
          { kind: 'visualization', ref: '/visualizations/teleportation', why: 'The most misunderstood word in the field, done step by step.' },
        ],
      },
      {
        title: 'The machine itself',
        summary: 'You know what a quantum computer is made of and what it is — and is not — good for.',
        steps: [
          { kind: 'lesson', ref: 'tunneling', why: 'A quantum effect you rely on every day, in every flash drive.' },
          { kind: 'visualization', ref: '/visualizations/decoherence', why: 'Why quantum states are fragile, and why that is the whole engineering problem.' },
          { kind: 'lesson', ref: 'inside-a-quantum-computer', why: 'From the formalism to the fridge: what the qubits physically are.' },
          { kind: 'page', ref: '/tutor', title: 'Ask the AI tutor anything', why: 'Bring the question you arrived with. You can now follow the answer.' },
        ],
      },
    ],
  },
  {
    slug: 'quantum-software-engineer',
    icon: '💻',
    accent: 'teal',
    title: 'Quantum software engineer',
    tagline: 'I want to write quantum programs and run them on real hardware.',
    forWho:
      'Programmers and CS students. Comfortable with code; linear algebra helps but the path builds what it needs.',
    outcomes: [
      'Build, debug and optimise multi-qubit circuits',
      "Implement Grover's search and the quantum Fourier transform from gates",
      'Read and write OpenQASM, and move circuits between tools',
      'Route a circuit onto a real device topology and reason about its noise',
      'Submit a job to a physical quantum computer and interpret the result',
    ],
    beyond: [
      'Install the qubit16 Python package and run your existing Qiskit code through the hardware layer.',
      'Contribute to an open-source SDK — Qiskit, Cirq and PennyLane all label good first issues.',
      'Sit the Advanced certification and put the certificate link on your CV.',
    ],
    milestones: [
      {
        title: 'Your first circuits',
        summary: 'You can put a qubit in any basis state or superposition on purpose.',
        steps: [
          { kind: 'lesson', ref: 'what-is-a-qubit', why: 'The data type. Everything else is operations on it.' },
          { kind: 'lesson', ref: 'gates-and-circuits', why: 'The instruction set: gates, wires, and reading a circuit diagram.' },
          { kind: 'challenge', ref: 'flip-it', why: 'Your first working program. Keep it — the rest build on it.' },
          { kind: 'challenge', ref: 'fair-coin', why: 'Superposition on demand: the quantum hello-world.' },
          { kind: 'page', ref: '/simulator', title: 'Free play in the circuit simulator', why: 'Break things on purpose, watch the statevector, then export your circuit as OpenQASM 3.' },
        ],
      },
      {
        title: 'Entanglement as a tool',
        summary: 'You use entanglement deliberately, and debug circuits that misuse it.',
        steps: [
          { kind: 'lesson', ref: 'entanglement', why: 'The resource every useful algorithm spends.' },
          { kind: 'challenge', ref: 'bell-pair', why: 'The two-gate circuit you will write more than any other.' },
          { kind: 'challenge', ref: 'broken-cnot', why: 'Debugging: the skill that separates writing circuits from copying them.' },
          { kind: 'challenge', ref: 'ghz-three', why: 'Scale an idea from two qubits to three without starting over.' },
          { kind: 'challenge', ref: 'teleport-the-state', why: 'A full protocol, with mid-circuit logic, finished by you.' },
        ],
      },
      {
        title: 'Real algorithms',
        summary: 'You have built the two workhorse subroutines of quantum computing by hand.',
        steps: [
          { kind: 'challenge', ref: 'phase-kickback', why: 'The trick behind nearly every quantum speedup, isolated.' },
          { kind: 'visualization', ref: '/visualizations/deutsch-jozsa', why: 'The first provable speedup — small enough to hold in your head.' },
          { kind: 'lesson', ref: 'grover', why: 'Amplitude amplification: search as a rotation.' },
          { kind: 'challenge', ref: 'grover-one-iteration', why: 'Build one full Grover turn and count what it costs.' },
          { kind: 'visualization', ref: '/visualizations/qft', why: 'The Fourier transform, the engine inside Shor and phase estimation.' },
          { kind: 'challenge', ref: 'qft-two-qubit', why: 'Finish a QFT yourself, including the step people forget.' },
          { kind: 'lesson', ref: 'shor', why: 'Put the pieces together into the algorithm that made the field famous.' },
        ],
      },
      {
        title: 'Engineering for real devices',
        summary: 'You write circuits that survive contact with actual hardware.',
        steps: [
          { kind: 'challenge', ref: 'route-the-pair', why: 'Real chips cannot connect every qubit to every other. Work around it.' },
          { kind: 'workbench', ref: '/workbench/routing', why: 'Watch a router spend SWAPs — and see why two-qubit gate count is the metric.' },
          { kind: 'workbench', ref: '/workbench/noise', why: 'Noise, and the mitigation techniques that claw accuracy back.' },
          { kind: 'challenge', ref: 'gate-golf-top-two', why: 'Fewer gates means less noise. Optimise against par.' },
          { kind: 'page', ref: '/hardware', title: 'Run a job on a real quantum computer', why: 'The finish line: your circuit, on a physical chip, with the result stored.' },
        ],
      },
      {
        title: 'Prove it',
        summary: 'You have a verifiable credential and a public track record.',
        steps: [
          { kind: 'page', ref: '/compete', title: 'Enter the weekly gate-golf competition', why: 'Measure yourself against everyone else, fresh every Monday.' },
          { kind: 'page', ref: '/certify', title: 'Earn a certification', why: 'A timed exam and a certificate anyone can verify by its link.' },
        ],
      },
    ],
  },
  {
    slug: 'physics-student',
    icon: '🎓',
    accent: 'sky',
    title: 'Quantum mechanics, the course companion',
    tagline: 'I am taking quantum mechanics and I want to see what the equations mean.',
    forWho:
      'Undergraduate physics, chemistry and engineering students. Follows the order of a typical first QM course, from the old quantum theory to spin and identical particles.',
    outcomes: [
      'Connect each textbook equation to a behaviour you have watched happen',
      'Solve bound-state problems with intuition for the answer before the algebra',
      'Reason about uncertainty as a Fourier trade-off, not a measurement flaw',
      'Handle spin, mixed states and identical particles with confidence',
    ],
    beyond: [
      'Keep the visualizations open while you do problem sets — changing one parameter beats reading one more paragraph.',
      'Move on to the Quantum hardware researcher path when you reach open quantum systems.',
    ],
    milestones: [
      {
        title: 'The old quantum theory',
        summary: 'You know which experiments forced quantisation, and what each one showed.',
        steps: [
          { kind: 'visualization', ref: '/visualizations/blackbody-spectrum', why: 'Where it began: Planck, and the ultraviolet catastrophe.' },
          { kind: 'visualization', ref: '/visualizations/photoelectric-effect', why: 'Light arrives in quanta of energy hf.' },
          { kind: 'visualization', ref: '/visualizations/hydrogen-atom', why: 'Bohr, then Schrödinger: why the spectrum has lines.' },
          { kind: 'visualization', ref: '/visualizations/electron-diffraction', why: 'Matter has a wavelength too — de Broglie, measured.' },
        ],
      },
      {
        title: 'The Schrödinger equation at work',
        summary: 'You can predict the shape of a bound state before you solve for it.',
        steps: [
          { kind: 'visualization', ref: '/visualizations/bound-states', why: 'The infinite and finite square well — chapter two of every textbook.' },
          { kind: 'visualization', ref: '/visualizations/harmonic-oscillator', why: 'The single most reused model in physics, with its ladder of levels.' },
          { kind: 'visualization', ref: '/visualizations/wave-packets', why: 'Time evolution, dispersion and scattering, animated.' },
          { kind: 'visualization', ref: '/visualizations/uncertainty', why: 'Heisenberg as a property of Fourier transforms.' },
          { kind: 'lesson', ref: 'tunneling', why: 'Barrier penetration, and the exponential that controls it.' },
          { kind: 'visualization', ref: '/visualizations/alpha-decay', why: 'Tunnelling explaining half-lives across twenty orders of magnitude.' },
        ],
      },
      {
        title: 'Spin and measurement',
        summary: 'You are fluent in two-level systems, the language of the rest of the subject.',
        steps: [
          { kind: 'visualization', ref: '/visualizations/stern-gerlach', why: 'Spin-½, discovered by accident, and sequential measurements.' },
          { kind: 'visualization', ref: '/visualizations/spin-precession', why: 'Larmor precession: the physics behind MRI.' },
          { kind: 'visualization', ref: '/visualizations/bloch-sphere', why: 'Every spin-½ state as one point, every operation as one rotation.' },
          { kind: 'visualization', ref: '/visualizations/wavefunctions-3d', why: 'Orbitals in three dimensions, the way chemistry needs them.' },
        ],
      },
      {
        title: 'Beyond the first course',
        summary: 'You are ready for the topics second courses and research groups assume.',
        steps: [
          { kind: 'visualization', ref: '/visualizations/identical-particles', why: 'Fermions, bosons and the exchange symmetry behind the periodic table.' },
          { kind: 'visualization', ref: '/visualizations/band-structure', why: 'Why some solids conduct and others insulate.' },
          { kind: 'visualization', ref: '/visualizations/density-matrix', why: 'Mixed states: the formalism for anything that touches an environment.' },
          { kind: 'visualization', ref: '/visualizations/wigner-function', why: 'Quantum mechanics in phase space, negativity and all.' },
          { kind: 'visualization', ref: '/visualizations/lasers', why: 'Stimulated emission and population inversion, end to end.' },
        ],
      },
    ],
  },
  {
    slug: 'hardware-researcher',
    icon: '🔬',
    accent: 'amber',
    title: 'Quantum hardware and error correction',
    tagline: 'I want to work on building quantum computers that actually work.',
    forWho:
      'Graduate students, lab engineers and researchers moving into quantum hardware, control or quantum error correction.',
    outcomes: [
      'Characterise noise: decoherence, readout error, and how to measure them',
      'Explain the surface code and why a threshold exists',
      'Train and compare decoders on your own noise model',
      'Calibrate, mitigate, and run a reproducible experiment on real hardware',
    ],
    beyond: [
      'Reproduce a landmark result in Run This Paper and publish the run permalink alongside your notes.',
      'Use the qubit16 Python package to keep a durable, comparable record of every hardware run you make.',
    ],
    milestones: [
      {
        title: 'What goes wrong',
        summary: 'You can name and model every way a physical qubit loses information.',
        steps: [
          { kind: 'visualization', ref: '/visualizations/decoherence', why: 'T1 and T2, and what each one does to a state.' },
          { kind: 'visualization', ref: '/visualizations/density-matrix', why: 'The formalism noise is written in.' },
          { kind: 'visualization', ref: '/visualizations/state-tomography', why: 'How to find out what state you actually made — and why you cannot copy it.' },
          { kind: 'lesson', ref: 'inside-a-quantum-computer', why: 'The physical platforms and their characteristic error sources.' },
        ],
      },
      {
        title: 'Error correction',
        summary: 'You understand how logical qubits are built out of bad physical ones.',
        steps: [
          { kind: 'lesson', ref: 'error-correction', why: 'Syndromes, stabilisers, and the threshold theorem.' },
          { kind: 'visualization', ref: '/visualizations/surface-code', why: 'The leading candidate code, on a lattice you can inject errors into.' },
          { kind: 'visualization', ref: '/visualizations/qec-duel', why: 'Lookup table versus learned decoder, head to head.' },
          { kind: 'workbench', ref: '/workbench/decoder-lab', why: 'Train a decoder and watch the threshold behaviour emerge.' },
        ],
      },
      {
        title: 'Working with a real device',
        summary: 'You can tune, mitigate and route for an actual chip.',
        steps: [
          { kind: 'workbench', ref: '/workbench/calibration', why: 'Closed-loop calibration: how pulses get tuned in practice.' },
          { kind: 'workbench', ref: '/workbench/noise', why: 'Zero-noise extrapolation and readout mitigation on a model you control.' },
          { kind: 'workbench', ref: '/workbench/routing', why: 'Mapping a circuit onto a real coupling graph.' },
          { kind: 'page', ref: '/hardware', title: 'Submit to real hardware', why: 'Device recommendation, cost estimate, and a stored, comparable result.' },
        ],
      },
      {
        title: 'Reproducible research',
        summary: 'You can reproduce a published result and record your own well enough for others to.',
        steps: [
          { kind: 'workbench', ref: '/workbench/run-paper', why: 'Landmark papers, executed live — check the claims yourself.' },
          { kind: 'workbench', ref: '/workbench/experiments', why: 'An experiment record an agent can run and a colleague can read.' },
        ],
      },
    ],
  },
  {
    slug: 'quantum-security',
    icon: '🔐',
    accent: 'rose',
    title: 'Quantum-safe security',
    tagline: 'I work in security and I need to know what quantum means for cryptography.',
    forWho:
      'Security engineers, cryptographers and IT leads planning a migration. Assumes you know what RSA and a key exchange are.',
    outcomes: [
      "Explain exactly which cryptography Shor's algorithm breaks, and which it does not",
      "Put Grover's effect on symmetric keys in the right proportion",
      'Describe how quantum key distribution detects an eavesdropper, and its practical limits',
      'Plan a post-quantum migration using the standardised algorithms',
    ],
    beyond: [
      'Inventory where your organisation uses RSA and elliptic-curve keys — that list is the start of every migration plan.',
      'Read the NIST post-quantum standards (FIPS 203, 204 and 205) with the background to follow them.',
    ],
    milestones: [
      {
        title: 'Just enough quantum',
        summary: 'You have the minimum physics to follow the threat model precisely.',
        steps: [
          { kind: 'lesson', ref: 'what-is-a-qubit', why: 'The unit of the threat.' },
          { kind: 'lesson', ref: 'superposition-and-measurement', why: 'Why a quantum computer is not just trying every key at once.' },
          { kind: 'lesson', ref: 'entanglement', why: 'The resource behind QKD and the Bell-test security argument.' },
        ],
      },
      {
        title: 'The threat',
        summary: 'You know what a large quantum computer breaks, and roughly what it would take.',
        steps: [
          { kind: 'lesson', ref: 'shor', why: 'Factoring and discrete logs: the end of RSA and elliptic curves.' },
          { kind: 'visualization', ref: '/visualizations/shor', why: 'Period finding, the core of the attack, running in front of you.' },
          { kind: 'lesson', ref: 'grover', why: 'The symmetric-key story: a quadratic speedup, answered by longer keys.' },
          { kind: 'lesson', ref: 'error-correction', why: 'Why a cryptographically relevant machine is a fault-tolerance problem.' },
        ],
      },
      {
        title: 'The defences',
        summary: 'You can compare the quantum and post-quantum answers and choose between them.',
        steps: [
          { kind: 'lesson', ref: 'quantum-cryptography', why: 'BB84 and E91: security from physics rather than hardness.' },
          { kind: 'visualization', ref: '/visualizations/quantum-key-distribution', why: 'Run BB84 with an eavesdropper and watch the error rate give her away.' },
          { kind: 'visualization', ref: '/visualizations/bell-test', why: 'The device-independent argument behind entanglement-based QKD.' },
          { kind: 'lesson', ref: 'post-quantum-cryptography', why: 'Lattice-based and hash-based schemes, and how to migrate to them.' },
        ],
      },
    ],
  },
  {
    slug: 'quantum-ai-optimization',
    icon: '🧠',
    accent: 'violet',
    title: 'Quantum machine learning and optimisation',
    tagline: 'I work in AI or operations research and want to know where quantum really helps.',
    forWho:
      'Data scientists, ML engineers and optimisation specialists. Assumes gradient descent and a loss function are familiar.',
    outcomes: [
      'Build and train variational circuits, and diagnose barren plateaus',
      'Formulate an optimisation problem for QAOA',
      'Benchmark a quantum model honestly against a classical baseline',
      'Separate genuine quantum advantage claims from dequantisable ones',
    ],
    beyond: [
      'Run a variational loop against real hardware with parameter sweeps and runtime sessions through the API.',
      'Hold every quantum ML result you read to the classical-baseline standard you practised here.',
    ],
    milestones: [
      {
        title: 'Circuits as models',
        summary: 'You can read a parameterised circuit as a function with trainable weights.',
        steps: [
          { kind: 'lesson', ref: 'what-is-a-qubit', why: 'The state space your model lives in.' },
          { kind: 'lesson', ref: 'gates-and-circuits', why: 'Rotations are your weights; entangling gates are your layers.' },
          { kind: 'challenge', ref: 'tilt-the-coin', why: 'Set a rotation angle to hit a target distribution — training, by hand.' },
          { kind: 'lesson', ref: 'interference', why: 'The mechanism any quantum model must exploit to beat a classical one.' },
        ],
      },
      {
        title: 'Variational algorithms',
        summary: 'You can train a hybrid quantum-classical loop and know when it will stall.',
        steps: [
          { kind: 'lesson', ref: 'vqe-and-nisq', why: 'The variational principle, and what near-term hardware can do with it.' },
          { kind: 'visualization', ref: '/visualizations/vqe', why: 'Watch an optimiser descend — and then watch the barren plateau flatten it.' },
          { kind: 'lesson', ref: 'qaoa-and-optimization', why: 'Combinatorial optimisation mapped onto a circuit.' },
          { kind: 'workbench', ref: '/workbench/evolve', why: 'Let an evolutionary search design a circuit for you.' },
        ],
      },
      {
        title: 'Honest benchmarking',
        summary: 'You can make — and refute — a quantum ML claim with evidence.',
        steps: [
          { kind: 'lesson', ref: 'quantum-machine-learning', why: 'Kernels, variational classifiers, and where the advantage arguments live.' },
          { kind: 'workbench', ref: '/workbench/qml-check', why: 'A quantum classifier against logistic regression and an MLP, same data.' },
          { kind: 'visualization', ref: '/visualizations/hhl-algorithm', why: 'The famous linear-systems speedup, and the fine print that limits it.' },
          { kind: 'page', ref: '/hardware', title: 'Run a variational circuit on hardware', why: 'Real noise is the benchmark that matters.' },
        ],
      },
    ],
  },
]

export function getPath(slug: string): LearningPath | undefined {
  return PATHS.find((p) => p.slug === slug)
}

/** A step's stable identity, used as its progress key. */
export function stepKey(step: Pick<PathStep, 'kind' | 'ref'>): string {
  return `${step.kind}:${step.ref}`
}

export function allSteps(path: LearningPath): PathStep[] {
  return path.milestones.flatMap((m) => m.steps)
}
