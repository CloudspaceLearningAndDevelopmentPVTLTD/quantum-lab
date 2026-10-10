/**
 * corpus.ts — the searchable index behind the ⌘K palette.
 *
 * Everything here is DERIVED from the real data modules. Nothing is hardcoded
 * that could go stale: lessons come from LESSONS, visualizations from
 * VISUALIZATIONS, workbench tools from WORKBENCH, challenges from CHALLENGES,
 * exams from EXAMS, gates from GATE_LIBRARY and presets from PRESETS. Add an eleventh lesson and it appears
 * in search with no edit here.
 *
 * The one thing that cannot be derived is SYNONYMS. A learner types "barrier",
 * not "Quantum Tunneling"; they type "spooky", not "Entanglement". Those live in
 * the keyword maps below, keyed by the stable id (slug / href / gate name), with
 * a generic fallback so that a brand-new entry is still findable by its own
 * words on the day it lands.
 */

import { CHALLENGES } from '@/lib/challenges/catalogue'
import { EXAMS } from '@/lib/exams/catalogue'
import { LESSONS } from '@/lib/lessons/index'
import { GATE_LIBRARY, PRESETS } from '@/lib/quantum'
import { VISUALIZATIONS } from '@/components/ui/Hero'
import { WORKBENCH } from '@/lib/workbench'

export type SearchKind =
  | 'lesson'
  | 'visualization'
  | 'workbench'
  | 'challenge'
  | 'exam'
  | 'page'
  | 'gate'
  | 'preset'
  | 'action'

export interface SearchDoc {
  id: string
  kind: SearchKind
  title: string
  subtitle: string
  href: string
  /** Synonyms and alternative phrasings a learner might actually type. */
  keywords: string[]
  level?: string
  icon?: string
}

/** Human-readable group headings, and the order groups prefer to appear in. */
export const KIND_LABEL: Record<SearchKind, string> = {
  action: 'Actions',
  lesson: 'Lessons',
  visualization: 'Visualizations',
  workbench: 'Workbench',
  challenge: 'Challenges',
  exam: 'Certification',
  page: 'Pages',
  gate: 'Gates',
  preset: 'Circuit presets',
}

export const KIND_ICON: Record<SearchKind, string> = {
  action: '⚡',
  lesson: '📘',
  visualization: '🔭',
  workbench: '🛠️',
  challenge: '🎯',
  exam: '🎓',
  page: '📄',
  gate: '⚛',
  preset: '🧪',
}

// ─────────────────────────────────────────────────────────────────────────────
// Synonym tables
// ─────────────────────────────────────────────────────────────────────────────

/** Terms shared by anything quantum, so a vague query still lands somewhere. */
const UNIVERSAL: string[] = ['quantum', 'physics']

const LESSON_KEYWORDS: Record<string, string[]> = {
  'what-is-a-qubit': [
    'qubit', 'bit', 'two level system', 'ket', 'amplitude', 'amplitudes',
    'normalization', 'born rule', 'state vector', 'basics', 'start here',
    'beginner', 'intro', 'introduction', 'bloch',
  ],
  'superposition-and-measurement': [
    'superposition', 'measurement', 'measure', 'collapse', 'wavefunction collapse',
    'observation', 'probability', 'probabilities', 'shots', 'schrodinger cat',
    'cat', 'both at once', 'plus state',
  ],
  interference: [
    'interference', 'destructive', 'constructive', 'cancel', 'cancellation',
    'phase', 'double slit', 'fringes', 'stripes', 'path', 'amplitude adds',
  ],
  'gates-and-circuits': [
    'gate', 'gates', 'circuit', 'circuits', 'unitary', 'matrix', 'hadamard',
    'cnot', 'pauli', 'rotation', 'wire', 'diagram', 'universal gate set',
  ],
  entanglement: [
    'entanglement', 'entangled', 'spooky', 'spooky action at a distance', 'epr',
    'einstein podolsky rosen', 'bell', 'bell state', 'bell inequality',
    'correlated', 'correlation', 'nonlocal', 'nonlocality', 'pair', 'chsh',
  ],
  grover: [
    'grover', 'search', 'searching', 'unstructured search', 'oracle',
    'amplitude amplification', 'needle in a haystack', 'database', 'speedup',
    'quadratic', 'sqrt n',
  ],
  shor: [
    'shor', 'factoring', 'factorisation', 'factorization', 'rsa', 'crypto',
    'period finding', 'order finding', 'qft', 'fourier', 'breaking encryption',
    'prime', 'primes', 'modular exponentiation', 'continued fractions',
  ],
  'error-correction': [
    'error correction', 'qec', 'noise', 'decoherence', 'surface code',
    'stabilizer', 'syndrome', 'threshold', 'logical qubit', 'bit flip',
    'phase flip', 'shor code', 'fault tolerance', 'fault tolerant', 'overhead',
  ],
  'vqe-and-nisq': [
    'vqe', 'nisq', 'variational', 'variational quantum eigensolver', 'ansatz',
    'hybrid', 'optimizer', 'chemistry', 'ground state', 'energy',
    'barren plateau', 'barren plateaus', 'near term',
  ],
  // 'qaoa' deliberately lives here and NOT in vqe-and-nisq's list, so the
  // query "qaoa" ranks the lesson actually about it first.
  'qaoa-and-optimization': [
    'qaoa', 'quantum approximate optimization', 'optimization', 'optimisation',
    'maxcut', 'max cut', 'cut', 'combinatorial', 'ising', 'cost hamiltonian',
    'mixer', 'annealing', 'adiabatic', 'graph', 'approximation ratio',
    'goemans williamson', 'depth', 'quantum advantage',
  ],
  tunneling: [
    'tunneling', 'tunnelling', 'tunnel', 'barrier', 'wall', 'through',
    'through the wall', 'stm', 'scanning tunneling microscope', 'alpha decay',
    'radioactive decay', 'potential barrier', 'evanescent', 'exponential decay',
    'fusion', 'sun', 'flash memory', 'leak through', 'forbidden region',
  ],
  'quantum-cryptography': [
    'cryptography', 'crypto', 'qkd', 'key distribution', 'bb84', 'e91',
    'eavesdropper', 'eve', 'eavesdropping', 'security', 'secure', 'encryption',
    'one time pad', 'post quantum', 'no cloning',
  ],
  'post-quantum-cryptography': [
    'post quantum', 'post-quantum', 'pqc', 'pq', 'lattice', 'lattices', 'lwe',
    'learning with errors', 'kyber', 'ml-kem', 'mlkem', 'dilithium', 'ml-dsa',
    'sphincs', 'slh-dsa', 'falcon', 'hqc', 'nist', 'fips 203', 'fips 204',
    'rsa', 'break rsa', 'harvest now decrypt later', 'hndl', 'q-day', 'qday',
    'mosca', 'migration', 'tls', 'x25519', 'hybrid', 'crypto agility',
    'crypto-agility', 'cnsa', 'sike', 'rainbow', 'quantum safe', 'quantum-safe',
  ],
  'inside-a-quantum-computer': [
    'hardware', 'transmon', 'superconducting', 'superconducting qubit',
    'josephson junction', 'anharmonic', 'anharmonicity', 'microwave',
    'pulse', 'pulses', 'rabi', 'dilution refrigerator', 'fridge', 'cryostat',
    'millikelvin', 'cold', 'chandelier', 'readout', 'resonator',
    'dispersive readout', 'trapped ion', 'ion trap', 'physical qubit',
    'real device', 'how qubits are built', 'how a quantum computer works',
  ],
}

const VIZ_KEYWORDS: Record<string, string[]> = {
  '/visualizations/double-slit': [
    'double slit', 'two slit', 'young', 'fringes', 'stripes', 'bands',
    'interference', 'wave particle duality', 'electron', 'photon', 'which path',
    'screen', 'detector',
  ],
  '/visualizations/superposition': [
    'superposition', 'measurement', 'measure', 'collapse', 'histogram',
    'probability', 'shots', 'build a state', 'plus state', 'minus state',
  ],
  '/visualizations/bloch-sphere': [
    'bloch sphere', 'bloch', 'sphere', 'globe', 'ball', 'arrow', 'vector',
    'rotation', 'rotate', 'north pole', 'south pole', 'latitude', 'longitude',
    'single qubit state', 'phase',
  ],
  '/visualizations/entanglement': [
    'entanglement', 'entangled', 'spooky', 'spooky action', 'epr', 'bell',
    'bell state', 'bell test', 'correlated', 'correlation', 'nonlocal', 'chsh',
    'two qubits', 'pair',
  ],
  '/visualizations/tunneling': [
    'tunneling', 'tunnelling', 'tunnel', 'barrier', 'wall', 'through',
    'through the wall', 'through a barrier', 'stm', 'scanning tunneling microscope',
    'alpha decay', 'radioactive', 'potential barrier', 'penetration',
    'evanescent', 'fusion', 'flash memory', 'leak through',
  ],
  '/visualizations/grover': [
    'grover', 'search', 'searching', 'oracle', 'marked state',
    'amplitude amplification', 'needle', 'haystack', 'database', 'speedup',
    'inversion about the mean', 'diffusion',
  ],
  '/visualizations/qft': [
    'qft', 'quantum fourier transform', 'fourier', 'transform', 'frequency',
    'phase ramp', 'period', 'periodicity', 'shor', 'dft', 'spectrum',
  ],
  '/visualizations/decoherence': [
    'decoherence', 'noise', 'dephasing', 'damping', 't1', 't2', 'relaxation',
    'environment', 'forget', 'mixed state', 'purity', 'shrinking arrow',
    'why quantum computers are hard',
  ],
  '/visualizations/alpha-decay': [
    'alpha decay', 'alpha particle', 'radioactive', 'radioactivity', 'half-life',
    'half life', 'gamow', 'gamow factor', 'geiger-nuttall', 'geiger nuttall',
    'coulomb barrier', 'wkb', 'uranium', 'radium', 'polonium', 'nucleus', 'nuclear',
    'stm', 'scanning tunneling microscope', 'scanning tunnelling microscope', 'tip',
    'work function', 'tunneling', 'tunnelling',
  ],
  '/visualizations/quantum-key-distribution': [
    'qkd', 'quantum key distribution', 'bb84', 'e91', 'ekert', 'key exchange',
    'eavesdropper', 'eve', 'intercept resend', 'qber', 'error rate', 'sifting',
    'basis reconciliation', 'privacy amplification', 'no cloning', 'cryptography',
    'secret key', 'chsh', 'bell test',
  ],
  '/visualizations/wigner-function': [
    'wigner', 'wigner function', 'phase space', 'quasiprobability', 'quasi-probability',
    'negativity', 'husimi', 'q function', 'coherent state', 'cat state', 'schrodinger cat',
    'squeezed', 'squeezing', 'fock state', 'thermal state', 'nonclassical', 'quantum optics',
  ],
}

/**
 * Per-tool synonyms for the workbench, keyed by href. A developer types
 * "zne" or "sabre" or "rl decoder", not the tool's marketing title.
 */
const WORKBENCH_KEYWORDS: Record<string, string[]> = {
  '/workbench/generate': [
    'generate', 'generation', 'verified', 'verifier', 'spec', 'specification', 'llm',
    'code generation', 'repair loop', 'self-correcting', 'agent', 'qasm', 'openqasm',
    'target histogram', 'target unitary', 'depth limit', 'gate set',
  ],
  '/workbench/evolve': [
    'evolve', 'evolution', 'evolutionary', 'genetic', 'genetic programming', 'search',
    'algorithm discovery', 'alphaevolve', 'hive', 'mutation', 'crossover', 'fitness',
    'population',
  ],
  '/workbench/decoder-lab': [
    'decoder', 'decoders', 'surface code', 'mwpm', 'matching', 'threshold', 'logical error',
    'alphaqubit', 'transformer', 'mlp', 'lookup table', 'train', 'training', 'neural network',
    'error correction', 'qec', 'syndrome',
  ],
  '/workbench/calibration': [
    'calibration', 'calibrate', 'reinforcement learning', 'rl', 'agent', 'policy', 'sweep',
    'drift', 'frequency', 'amplitude', 'pulse', 'rabi', 'ramsey', 'fidelity', 'tune up',
  ],
  '/workbench/routing': [
    'routing', 'router', 'route', 'sabre', 'swap', 'swaps', 'coupling map', 'topology',
    'transpile', 'transpiler', 'compile', 'compiler', 'reinforce', 'rl', 'heavy hex',
    'connectivity', 'qubit mapping', 'layout', 'two-qubit gates',
  ],
  '/workbench/experiments': [
    'experiment', 'experiments', 'runner', 'record', 'records', 'lab notebook', 'agent',
    'mcp', 'targets', 'hypothesis', 'reproduce', 'write-up', 'automation',
  ],
  '/workbench/noise': [
    'noise', 'noisy', 'mitigation', 'error mitigation', 'zne', 'zero noise extrapolation',
    'readout', 'readout error', 'confusion matrix', 'trajectory', 'depolarising',
    'depolarizing', 'amplitude damping', 'expectation value', 'measure',
  ],
  '/workbench/qml-check': [
    'qml', 'quantum machine learning', 'vqc', 'variational classifier', 'classifier',
    'classical baseline', 'logistic regression', 'mlp', 'advantage', 'dequantisation',
    'dequantization', 'barren plateau', 'parameter shift', 'cost', 'benchmark', 'moons',
  ],
  '/workbench/gpu-simulator': [
    'gpu', 'webgpu', 'compute shader', 'wgsl', 'float32', 'float64', 'benchmark',
    'wall time', 'capacity', 'statevector', 'backend', 'fallback',
  ],
  '/workbench/run-paper': [
    'paper', 'papers', 'arxiv', 'run this paper', 'reproduce', 'reproduction', 'citation',
    'grover 1996', 'teleportation 1993', 'superdense coding', 'ghz', 'bb84', 'e91',
    'ekert', 'bennett', 'brassard', 'landmark', 'historical', 'primary source',
  ],
}

/** Per-gate synonyms. Every gate also gets its name, label and description words. */
const GATE_KEYWORDS: Record<string, string[]> = {
  H: ['hadamard', 'h gate', 'superposition', 'equal superposition', 'plus state', 'basis change'],
  X: ['pauli x', 'not', 'not gate', 'bit flip', 'flip', 'invert', 'sigma x'],
  Y: ['pauli y', 'sigma y', 'bit and phase flip'],
  Z: ['pauli z', 'sigma z', 'phase flip', 'sign flip'],
  S: ['phase gate', 'quarter turn', 'sqrt z', 'square root of z', 'p90'],
  SDG: ['s dagger', 's inverse', 'inverse phase gate', 'sdg'],
  T: ['t gate', 'pi over eight', 'eighth turn', 'magic state'],
  TDG: ['t dagger', 't inverse', 'tdg'],
  RX: ['rotation x', 'rx theta', 'rotate about x', 'continuous rotation'],
  RY: ['rotation y', 'ry theta', 'rotate about y'],
  RZ: ['rotation z', 'rz theta', 'rotate about z', 'phase rotation'],
  P: ['phase shift', 'p gate', 'u1', 'relative phase'],
  CX: ['cnot', 'controlled not', 'controlled x', 'entangling gate', 'two qubit gate', 'target control'],
  CY: ['controlled y', 'cy gate'],
  CZ: ['controlled z', 'controlled phase', 'cphase', 'sign flip on 11'],
  SWAP: ['swap', 'exchange', 'switch qubits', 'trade'],
  CCX: ['toffoli', 'ccnot', 'controlled controlled not', 'three qubit gate', 'and gate', 'reversible and'],
  MEASURE: ['measure', 'measurement', 'readout', 'collapse', 'observe', 'sample'],
}

const PRESET_KEYWORDS: Record<string, string[]> = {
  bell: ['bell state', 'bell pair', 'phi plus', 'epr pair', 'entangled pair', 'spooky', 'maximally entangled', '00 or 11'],
  ghz: ['ghz', 'greenberger horne zeilinger', 'three qubit entanglement', 'cat state', 'all agree'],
  superposition: ['uniform superposition', 'all states', 'hadamard everywhere', 'equal weights', 'flat distribution'],
  grover2: ['grover', 'search', 'marked state', 'oracle', 'amplitude amplification', 'find the item'],
  interference: ['interference', 'cancellation', 'hzh', 'destructive', 'constructive', 'phase kickback'],
  teleport: ['teleportation', 'teleport', 'beam me up', 'move a state', 'classical bits', 'entanglement protocol'],
}

const CHALLENGE_KEYWORDS: Record<string, string[]> = {
  'flip-it': ['flip', 'not gate', 'x gate', 'first challenge', 'easy', 'one to zero'],
  'fair-coin': ['coin', 'coin flip', 'fifty fifty', '50/50', 'random', 'hadamard', 'fair'],
  'bell-pair': ['bell', 'bell pair', 'entangle', 'entanglement', 'epr', 'phi plus', 'cnot'],
  'psi-plus': ['psi plus', 'bell state', 'other bell state', 'entangle', 'triplet'],
  'uniform-three': ['uniform', 'three qubits', 'all eight', 'equal superposition', 'flat'],
  'undo-the-hadamard': ['undo', 'inverse', 'reverse', 'debug', 'fix', 'self inverse'],
  'broken-cnot': ['cnot', 'debug', 'fix', 'broken', 'repair', 'control target'],
  'ghz-three': ['ghz', 'three way entanglement', 'cat state', 'all three agree'],
  'gate-golf-top-two': ['gate golf', 'golf', 'fewest gates', 'shortest circuit', 'optimize', 'minimal'],
  'mark-the-state': ['oracle', 'mark', 'phase flip', 'sign', 'grover oracle', 'tag a state'],
}

// ─────────────────────────────────────────────────────────────────────────────
// Static pages and verb-shaped actions
// ─────────────────────────────────────────────────────────────────────────────

interface StaticEntry {
  id: string
  title: string
  subtitle: string
  href: string
  keywords: string[]
}

const PAGES: StaticEntry[] = [
  {
    id: 'page-home',
    title: 'Home',
    subtitle: 'The landing page and everything the lab can do',
    href: '/',
    keywords: ['home', 'start', 'landing', 'front page', 'index', 'main', 'overview'],
  },
  {
    id: 'page-learn',
    title: 'Learn',
    subtitle: 'The full course: foundations and advanced tracks',
    href: '/learn',
    keywords: ['course', 'lessons', 'curriculum', 'syllabus', 'track', 'tracks', 'study', 'read', 'tutorial'],
  },
  {
    id: 'page-visualizations',
    title: 'Visualizations',
    subtitle: 'Every interactive simulation in one place',
    href: '/visualizations',
    keywords: ['visualisations', 'demos', 'interactive', 'animations', 'simulations', 'play', 'explore', 'sandbox'],
  },
  {
    id: 'page-workbench',
    title: 'Workbench',
    subtitle: 'AI tools that produce a result on the same engines the course teaches with',
    href: '/workbench',
    keywords: ['workbench', 'tools', 'developer', 'developers', 'ai', 'agent', 'agents', 'mcp', 'research', 'reproduce'],
  },
  {
    id: 'page-simulator',
    title: 'Circuit Simulator',
    subtitle: 'Build and run circuits on up to 16 qubits on Team/University plans (5 on Free, 12 on Pro)',
    href: '/simulator',
    keywords: ['simulator', 'circuit', 'build', 'run', 'gates', 'qasm', 'histogram', 'statevector', 'playground', 'ide'],
  },
  {
    id: 'page-challenges',
    title: 'Challenges',
    subtitle: 'Puzzles that ask you to build a target state',
    href: '/challenges',
    keywords: ['puzzles', 'exercises', 'practice', 'problems', 'quiz', 'test yourself', 'gate golf'],
  },
  {
    id: 'page-tutor',
    title: 'AI Tutor',
    subtitle: 'Ask a question and get an answer grounded in the course',
    href: '/tutor',
    keywords: ['tutor', 'ai', 'chat', 'assistant', 'ask', 'question', 'help', 'explain', 'chatbot'],
  },
  {
    id: 'page-paths',
    title: 'Learning paths',
    subtitle: 'Goal-based roadmaps: software engineer, physics student, researcher, security, quantum ML',
    href: '/paths',
    keywords: [
      'paths', 'path', 'roadmap', 'career', 'goal', 'journey', 'curriculum', 'where to start',
      'beginner', 'software engineer', 'developer', 'physics student', 'researcher',
      'error correction', 'security', 'cryptography', 'machine learning', 'optimisation', 'dream',
    ],
  },
  {
    id: 'page-glossary',
    title: 'Glossary',
    subtitle: 'Every quantum term explained plainly, each linked to a live simulation',
    href: '/glossary',
    keywords: [
      'glossary', 'dictionary', 'definition', 'define', 'meaning', 'what does', 'terms',
      'terminology', 'jargon', 'vocabulary', 'cheat sheet', 'a-z', 'formula', 'formulas',
    ],
  },
  {
    id: 'page-coach',
    title: 'Coach',
    subtitle: 'What to study next, computed from your progress',
    href: '/coach',
    keywords: ['coach', 'next', 'what next', 'recommendation', 'plan', 'study plan', 'guidance', 'progress'],
  },
  {
    id: 'page-hardware',
    title: 'Real hardware',
    subtitle: 'Submit a circuit to a physical quantum computer',
    href: '/hardware',
    keywords: ['hardware', 'real device', 'qpu', 'ibm', 'backend', 'queue', 'job', 'physical', 'chip', 'submit'],
  },
  {
    id: 'page-instructor',
    title: 'Instructor tools',
    subtitle: 'Draft quizzes, lecture scripts and worked examples',
    href: '/instructor',
    keywords: ['instructor', 'teacher', 'teaching', 'classroom', 'quiz builder', 'lecture', 'course prep', 'copilot'],
  },
  {
    id: 'page-circuits',
    title: 'Saved circuits',
    subtitle: 'Your circuit library, stored in this browser',
    href: '/circuits',
    keywords: ['saved', 'library', 'my circuits', 'bookmarks', 'history', 'load', 'open circuit'],
  },
  {
    id: 'page-certify',
    title: 'Certification',
    subtitle: 'Timed, randomised exams with a verifiable certificate',
    href: '/certify',
    keywords: ['certification', 'certificate', 'exam', 'exams', 'test', 'assessment', 'credential', 'verify'],
  },
  {
    id: 'page-certificate',
    title: 'Certificates',
    subtitle: 'Download the certificates you have earned',
    href: '/learn/certificate',
    keywords: ['certificate', 'certificates', 'download', 'diploma', 'award', 'completion', 'pdf', 'print'],
  },
  {
    id: 'page-insights',
    title: 'Insights',
    subtitle: 'Your learning statistics, computed locally',
    href: '/insights',
    keywords: ['insights', 'stats', 'statistics', 'analytics', 'progress', 'streak', 'dashboard', 'time spent'],
  },
  {
    id: 'page-pricing',
    title: 'Pricing',
    subtitle: 'Plans, what is free, and what a licence unlocks',
    href: '/pricing',
    keywords: ['pricing', 'price', 'cost', 'plans', 'subscribe', 'subscription', 'upgrade', 'free', 'pro', 'billing', 'buy'],
  },
  {
    id: 'page-admin',
    title: 'Admin',
    subtitle: 'Seats, cohorts and organisation-wide progress',
    href: '/admin',
    keywords: ['admin', 'seats', 'cohort', 'team', 'organisation', 'organization', 'members', 'manage', 'licences'],
  },
  {
    id: 'page-account',
    title: 'Account',
    subtitle: 'Your plan, billing and sign-in details',
    href: '/account',
    keywords: ['account', 'profile', 'settings', 'billing', 'invoice', 'sign in', 'login', 'logout', 'email', 'plan'],
  },
  {
    id: 'page-offline',
    title: 'Offline',
    subtitle: 'What still works with no network connection',
    href: '/offline',
    keywords: ['offline', 'no internet', 'aeroplane', 'airplane mode', 'cached', 'service worker', 'pwa', 'disconnected'],
  },
]

const ACTIONS: StaticEntry[] = [
  {
    id: 'action-run-circuit',
    title: 'Run a circuit',
    subtitle: 'Open the simulator and execute gates (all 16 qubits free, no account needed)',
    href: '/simulator',
    keywords: [
      'run', 'execute', 'simulate', 'build a circuit', 'new circuit', 'try it',
      'gates', 'shots', 'measure', 'histogram', 'statevector', 'play',
    ],
  },
  {
    id: 'action-take-exam',
    title: 'Take a certification exam',
    subtitle: 'A timed paper with a pass mark and a certificate at the end',
    href: '/certify',
    keywords: [
      'take exam', 'sit exam', 'start test', 'get certified', 'certification',
      'assessment', 'credential', 'timed', 'pass mark', 'quiz me',
    ],
  },
  {
    id: 'action-what-next',
    title: 'See what to study next',
    subtitle: 'The coach reads your progress and picks the next step',
    href: '/coach',
    keywords: [
      'what next', 'what should i study', 'next lesson', 'recommend',
      'recommendation', 'where do i start', 'study plan', 'continue', 'resume',
      'stuck', 'guidance',
    ],
  },
  {
    id: 'action-install',
    title: 'Install the app',
    subtitle: 'Add Qubit16 to your device and keep using it offline',
    href: '/offline',
    keywords: [
      'install', 'pwa', 'add to home screen', 'desktop app', 'standalone',
      'offline', 'download', 'app', 'shortcut', 'no internet',
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Corpus construction
// ─────────────────────────────────────────────────────────────────────────────

/** Split a phrase into distinct lowercase word tokens of 3+ characters. */
function words(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3) seen.add(raw)
  }
  return [...seen]
}

/** Merge keyword lists, lowercase and de-duplicated, order preserved. */
function mergeKeywords(...lists: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const item of list) {
      const key = item.toLowerCase().trim()
      if (key && !seen.has(key)) {
        seen.add(key)
        out.push(key)
      }
    }
  }
  return out
}

/**
 * Build the full searchable index. Cheap enough (a few hundred small objects)
 * to run on the client at mount; memoised by the caller if it ever is not.
 */
export function buildCorpus(): SearchDoc[] {
  const docs: SearchDoc[] = []

  // ── Actions first: they are verbs, and a verb is usually what someone wants.
  for (const action of ACTIONS) {
    docs.push({
      id: action.id,
      kind: 'action',
      title: action.title,
      subtitle: action.subtitle,
      href: action.href,
      keywords: mergeKeywords(action.keywords, words(action.subtitle)),
      icon: KIND_ICON.action,
    })
  }

  // ── Lessons. Mapped, never hardcoded: a new lesson is searchable immediately,
  //    falling back to words from its own title, subtitle and objectives.
  for (const lesson of LESSONS) {
    const curated = LESSON_KEYWORDS[lesson.slug] ?? []
    docs.push({
      id: `lesson-${lesson.slug}`,
      kind: 'lesson',
      title: lesson.title,
      subtitle: lesson.subtitle,
      href: `/learn/${lesson.slug}`,
      level: lesson.level,
      icon: KIND_ICON.lesson,
      keywords: mergeKeywords(
        curated,
        words(lesson.slug.replace(/-/g, ' ')),
        words(lesson.title),
        lesson.objectives.flatMap(words),
        ['lesson', 'read', `${lesson.minutes} minutes`],
        UNIVERSAL,
      ),
    })
  }

  // ── Visualizations.
  for (const viz of VISUALIZATIONS) {
    docs.push({
      id: `viz-${viz.href}`,
      kind: 'visualization',
      title: viz.title,
      subtitle: viz.hook,
      href: viz.href,
      level: viz.level,
      icon: viz.icon,
      keywords: mergeKeywords(
        VIZ_KEYWORDS[viz.href] ?? [],
        words(viz.href.replace(/[/-]/g, ' ')),
        words(viz.title),
        words(viz.hook),
        ['visualization', 'visualisation', 'demo', 'interactive', 'animation'],
        UNIVERSAL,
      ),
    })
  }

  // ── Workbench tools. Derived from WORKBENCH like the visualizations are
  //    from VISUALIZATIONS: register a tool there and it is searchable here.
  for (const tool of WORKBENCH) {
    docs.push({
      id: `workbench-${tool.href}`,
      kind: 'workbench',
      title: tool.title,
      subtitle: tool.result,
      href: tool.href,
      level: tool.kind,
      icon: tool.icon,
      keywords: mergeKeywords(
        WORKBENCH_KEYWORDS[tool.href] ?? [],
        words(tool.href.replace(/[/-]/g, ' ')),
        words(tool.title),
        words(tool.result),
        words(tool.field),
        ['workbench', 'tool', tool.kind],
        UNIVERSAL,
      ),
    })
  }

  // ── Challenges.
  for (const challenge of CHALLENGES) {
    docs.push({
      id: `challenge-${challenge.id}`,
      kind: 'challenge',
      title: challenge.title,
      subtitle: challenge.brief,
      href: `/challenges/${challenge.id}`,
      level: challenge.level,
      icon: KIND_ICON.challenge,
      keywords: mergeKeywords(
        CHALLENGE_KEYWORDS[challenge.id] ?? [],
        words(challenge.id.replace(/-/g, ' ')),
        words(challenge.title),
        [challenge.kind.replace(/-/g, ' '), 'challenge', 'puzzle', 'exercise', 'practice'],
        [`${challenge.numQubits} qubit`],
      ),
    })
  }

  // ── Exams.
  for (const exam of EXAMS) {
    docs.push({
      id: `exam-${exam.id}`,
      kind: 'exam',
      title: exam.title,
      subtitle: exam.subtitle,
      href: `/certify/${exam.id}`,
      level: exam.level,
      icon: KIND_ICON.exam,
      keywords: mergeKeywords(
        words(exam.id.replace(/-/g, ' ')),
        words(exam.title),
        [
          'exam', 'test', 'certification', 'certificate', 'assessment',
          'credential', 'paper', 'timed', exam.trackId,
          `${exam.questionCount} questions`,
        ],
      ),
    })
  }

  // ── Gates. Every gate links into the simulator, so "hadamard" is one keystroke
  //    away from a place you can actually apply one.
  for (const gate of GATE_LIBRARY) {
    docs.push({
      id: `gate-${gate.name}`,
      kind: 'gate',
      title: `${gate.label} gate`,
      subtitle: gate.description,
      href: `/simulator?gate=${encodeURIComponent(gate.name)}`,
      icon: KIND_ICON.gate,
      keywords: mergeKeywords(
        [gate.name.toLowerCase(), gate.label.toLowerCase(), `${gate.name.toLowerCase()} gate`],
        GATE_KEYWORDS[gate.name] ?? [],
        words(gate.description),
        ['gate', 'operation', `${gate.arity} qubit gate`],
        gate.hasAngle ? ['angle', 'theta', 'parameterised', 'parameterized'] : [],
      ),
    })
  }

  // ── Presets: named circuits, loadable straight into the simulator.
  for (const preset of PRESETS) {
    docs.push({
      id: `preset-${preset.id}`,
      kind: 'preset',
      title: preset.name,
      subtitle: preset.blurb,
      href: `/simulator?preset=${encodeURIComponent(preset.id)}`,
      icon: KIND_ICON.preset,
      keywords: mergeKeywords(
        PRESET_KEYWORDS[preset.id] ?? [],
        [preset.id.toLowerCase()],
        words(preset.name),
        words(preset.blurb),
        ['preset', 'example circuit', 'template', 'load', `${preset.circuit.numQubits} qubits`],
      ),
    })
  }

  // ── Static pages last: they are the least specific answer to any query.
  for (const page of PAGES) {
    docs.push({
      id: page.id,
      kind: 'page',
      title: page.title,
      subtitle: page.subtitle,
      href: page.href,
      icon: KIND_ICON.page,
      keywords: mergeKeywords(page.keywords, words(page.subtitle), ['page', 'go to']),
    })
  }

  return docs
}

/**
 * The ids shown when the query is empty.
 *
 * Deliberately NOT "everything" and not "most recent". With no query there is no
 * signal to rank on, so a 90-item dump is just the nav problem again in a new
 * box. These are the highest-intent starting points: the two things a returning
 * learner does (resume, run a circuit), the two entry points a new one needs
 * (the course, the visualizations index), and a handful of the most-visited
 * destinations. Order here is the order shown.
 */
export const DEFAULT_DOC_IDS: string[] = [
  'action-what-next',
  'action-run-circuit',
  'page-learn',
  'page-visualizations',
  'lesson-what-is-a-qubit',
  'viz-/visualizations/bloch-sphere',
  'viz-/visualizations/entanglement',
  'page-challenges',
  'page-tutor',
  'action-take-exam',
  'page-circuits',
  'page-insights',
]
