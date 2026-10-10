/**
 * lib/workbench.ts — the canonical catalogue of the AI × quantum workbench.
 *
 * The visualizations (lib/visualizations.ts) exist to be LEARNED FROM. The
 * workbench tools exist to GET A RESULT: a verified circuit, a trained decoder,
 * a routed circuit with fewer two-qubit gates, a mitigated expectation value,
 * an experiment record an agent wrote. Same engines, different job.
 *
 * Pure data in its own module, importable from server, client and the
 * service-worker fallback alike. The /workbench index, the sitemap and the
 * site nav all derive from this array — register here and the page is real.
 */

export type WorkbenchAccent = 'violet' | 'teal' | 'amber' | 'rose' | 'sky'
export type WorkbenchKind = 'generate' | 'train' | 'optimise' | 'run' | 'measure'

export type WorkbenchTool = {
  href: string
  icon: string
  title: string
  /** What the developer walks away with. One sentence, concrete. */
  result: string
  kind: WorkbenchKind
  accent: WorkbenchAccent
  /** The published result this tool lets a developer reproduce at small scale. */
  field: string
}

/** Append only. The integration step orders and recolours the whole list. */
export const WORKBENCH: readonly WorkbenchTool[] = [
  {
    href: '/workbench/generate',
    icon: '✅',
    title: 'Verified Circuit Generation',
    result:
      'A circuit that passes a spec you wrote — target histogram, state or unitary, plus gate-set and depth limits — checked on the simulator, with every failed attempt and its diagnostics on the record.',
    kind: 'generate',
    accent: 'violet',
    field:
      'Verifier-in-the-loop code generation: the model proposes, an exact checker rejects, and the rejection is fed back — the pattern behind self-correcting LLM coding agents, applied to OpenQASM.',
  },
  {
    href: '/workbench/evolve',
    icon: '🧬',
    title: 'Algorithm Evolution',
    result:
      'A MaxCut or state-preparation heuristic that beat its own ancestors — QAOA schedules and local-search programs proposed by several models, scored on the simulator, with the lineage of every survivor.',
    kind: 'generate',
    accent: 'teal',
    field:
      "Quantinuum's Hive (2025): a swarm of frontier models evolving Guppy and CUDA-Q programs against an execution harness, here reduced to a closed DSL and a visible budget.",
  },
  {
    href: '/workbench/decoder-lab',
    icon: '🧠',
    title: 'Decoder Lab',
    result:
      'A logical-vs-physical error-rate chart across the surface-code threshold, with a lookup table, an MLP and a transformer you trained in-browser racing exact MWPM at d = 3, 5 and 7.',
    kind: 'train',
    accent: 'sky',
    field: 'AlphaQubit (Bausch et al., Nature 2024): a transformer decoder that beat matching on surface-code memory experiments.',
  },
  {
    href: '/workbench/calibration',
    icon: '🎛️',
    title: 'Calibration Agent',
    result:
      'A drifting qubit whose X gate an RL agent holds above 99.5% from measurement counts alone, at fewer shots per step than recalibrating on a schedule — with the hidden truth drawn for you.',
    kind: 'train',
    accent: 'amber',
    field:
      "Google's July 2026 result: an RL agent holding gate fidelity on Willow by adjusting 1,000+ control parameters from measurement statistics, replacing scheduled recalibration.",
  },
  {
    href: '/workbench/routing',
    icon: '🔀',
    title: 'Routing Race',
    result:
      'Your circuit routed onto a real coupling map twice — by SABRE and by a swap policy trained in your browser — with two-qubit count, depth and added SWAPs side by side.',
    kind: 'optimise',
    accent: 'rose',
    field:
      "IBM's AI transpiler routing passes: 24% and 36% improvements over the default heuristic on 100+ qubit circuits, reproduced here with an eight-weight REINFORCE policy on 8–12 qubits.",
  },
  {
    href: '/workbench/experiments',
    icon: '🧪',
    title: 'Experiment Runner',
    result:
      'A record your agent wrote over MCP while you slept: hypothesis, every circuit with its target and counts, conclusion.',
    kind: 'run',
    accent: 'violet',
    field:
      'The hypothesis → run → record → conclude loop of agent-driven science (e.g. the AI Scientist, 2024), with targets and jobs modelled on Coda MCP, at the scale of a 16-qubit simulator.',
  },
  {
    href: '/workbench/noise',
    icon: '🎛️',
    title: 'Noise Sandbox and Mitigation',
    result:
      'A circuit run under a depolarising, T1/T2 and readout noise model, with the ideal, noisy, readout-mitigated and zero-noise-extrapolated expectation values side by side — error bars included.',
    kind: 'measure',
    accent: 'teal',
    field:
      'Zero-noise extrapolation by gate folding (Temme, Bravyi & Gambetta 2017; Li & Benjamin 2017) and readout inversion via a calibrated confusion matrix, as run on IBM and Google hardware.',
  },
  {
    href: '/workbench/qml-check',
    icon: '⚖️',
    title: 'QML Reality Check',
    result:
      'An honest table: a variational quantum classifier against a tuned logistic regression and a small MLP on moons, circles and one quantum-generated set — held-out accuracy and training cost in circuit evaluations versus flops.',
    kind: 'measure',
    accent: 'sky',
    field:
      'The 2026 state of quantum machine learning: no accepted advantage on classical data, dequantised claims, data-loading and barren-plateau limits — and a demonstrated edge only when the data itself came from a quantum process.',
  },
  {
    href: '/workbench/gpu-simulator',
    icon: '⚡',
    title: 'GPU Simulator',
    result:
      'The same circuit on your CPU and your GPU: wall time, the largest statevector each reaches under a stated budget, and the float32-vs-float64 gap.',
    kind: 'run',
    accent: 'amber',
    field: 'WebGPU statevector simulation — 2^N × 8 bytes of float32 amplitudes in a compute shader',
  },
  {
    href: '/workbench/run-paper',
    icon: '📄',
    title: 'Run This Paper',
    result:
      'Teleportation, superdense coding, Grover, the GHZ paradox, BB84 and E91 — each paper’s own protocol, executed live and checked against what the paper reported.',
    kind: 'run',
    accent: 'rose',
    field:
      'Six landmark results (1984–1996) run on the site’s own presets and protocol simulators — not a general paper-to-circuit pipeline, a curated and citation-checked set.',
  },
  {
    href: '/workbench/equivalence',
    icon: '⚖️',
    title: 'Circuit Equivalence Checker',
    result:
      'A pass/fail verdict and process fidelity for whether two OpenQASM circuits are the same unitary up to global phase — paste both, get |Tr(V†U)|²/d² and a verdict.',
    kind: 'measure',
    accent: 'sky',
    field:
      'Unitary equivalence checking as used in compiler and transpiler validation — did an optimisation pass change what the circuit computes.',
  },
  {
    href: '/workbench/simulator-benchmark',
    icon: '📈',
    title: 'Simulator Benchmark',
    result:
      "A correctness suite (Bell, GHZ-3, GHZ-5, 4-qubit QFT, Grover-2 vs. their closed-form targets) plus a performance sweep from 4 to 16 qubits, timed live in your own browser.",
    kind: 'measure',
    accent: 'amber',
    field:
      'The standard way a statevector simulator earns trust before it earns a speed claim: known-answer correctness tests, then a measured, reproducible throughput curve.',
  },
  {
    href: '/workbench/device-advisor',
    icon: '🧭',
    title: 'Device Advisor',
    result:
      'Every QPU qubit16 reaches — IBM, IonQ, Rigetti, Quantinuum — ranked for your circuit by projected success and cost per surviving shot, with each row’s calibration provenance and the model’s blind spots listed.',
    kind: 'measure',
    accent: 'amber',
    field:
      'Cross-vendor device selection: transpile to each native gate set, project whole-circuit survival from calibration medians, price it — the comparison no single-vendor console can make.',
  },
  {
    href: '/workbench/resource-estimator',
    icon: '🏗️',
    title: 'Fault-Tolerant Resource Estimator',
    result:
      'Physical qubits, runtime, code distance and magic-state factory count for an algorithm under surface-code error correction — plus how the answer explodes as the physical error rate nears threshold.',
    kind: 'measure',
    accent: 'violet',
    field:
      'Surface-code resource estimation (Fowler et al. 2012; Litinski 2019; Bravyi–Kitaev distillation) — the order-of-magnitude analysis behind results like Gidney’s 2025 RSA-2048 estimate.',
  },
  {
    href: '/workbench/stabilizer',
    icon: '🧮',
    title: 'Stabilizer Simulator',
    result:
      'A Clifford circuit on up to 4,096 qubits, run exactly in your browser: the stabilizer generators, the entanglement entropy across every cut, and measurement samples.',
    kind: 'run',
    accent: 'teal',
    field:
      'The Gottesman–Knill theorem and the Aaronson–Gottesman tableau algorithm (2004) — the method behind Stim and every large-scale error-correction simulation.',
  },
  {
    href: '/workbench/entanglement-transition',
    icon: '📉',
    title: 'Measurement-Induced Entanglement Transition',
    result:
      'Half-chain entanglement entropy against measurement rate for chains of 8 to 128 qubits, with error bars and CSV export — the volume-law to area-law transition, computed live.',
    kind: 'measure',
    accent: 'rose',
    field:
      'Measurement-induced phase transitions in hybrid random circuits (Li, Chen & Fisher 2018; Skinner, Ruhman & Nahum 2019), in the stabilizer-circuit form the original numerics used.',
  },
  {
    href: '/workbench/code-explorer',
    icon: '🧩',
    title: 'Stabilizer Code Explorer',
    result:
      'The [[n, k, d]] parameters, logical operators, degeneracy and single-error syndrome table of any stabilizer code you write down — with nine named codes to start from.',
    kind: 'measure',
    accent: 'violet',
    field:
      'The stabilizer formalism (Gottesman 1997): code parameters by symplectic linear algebra over GF(2), with each preset linked to its Error Correction Zoo entry.',
  },
  {
    href: '/workbench/barren-plateaus',
    icon: '🏜️',
    title: 'Barren Plateau Explorer',
    result:
      'Gradient variance against qubit count for random parameterised circuits — deep versus shallow, global cost versus local — on one log-scale chart with error bars.',
    kind: 'measure',
    accent: 'amber',
    field:
      'Barren plateaus in variational training landscapes (McClean et al. 2018) and their dependence on the cost function (Cerezo et al. 2021).',
  },
]
