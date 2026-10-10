"""The tutor's retrieval front end: real course content, with a curated fallback.

:func:`search_concepts` answers a free-text query in one of two ways:

1. **RAG over the course** (preferred). :mod:`agent.rag.retrieve` searches a
   TF-IDF index built from every lesson the app ships — prose, callouts, code
   listings, key points and quiz explanations — and the excerpts come back with
   the lesson title and link, so the tutor can cite its own course.
2. **Curated concept blurbs** (fallback). The hand-written :data:`CONCEPTS`
   entries and the keyword scorer below, used verbatim whenever the index is
   absent (a checkout that has not run the build) or matches nothing.

Both paths return the same shape — dicts with the keys ``id``, ``title``,
``keywords`` and ``summary`` — so callers need not care which ran. Use
:func:`search_source` when they do. There are still no network calls and no API
key on either path, and importing this module never builds an index.
"""

from __future__ import annotations

import math
import re
from typing import Any

try:  # The RAG package is pure-Python at query time; sklearn is build-only.
    from agent.rag import retrieve as _retrieve
except Exception:  # pragma: no cover - defensive: the fallback must always work
    _retrieve = None  # type: ignore[assignment]

#: Which backend served the most recent :func:`search_concepts` call.
_LAST_SOURCE: str = "keyword"

#: Whether that call mixed a curated blurb into course excerpts.
_LAST_TOPPED_UP: bool = False

#: Relevance floor for preferring a course excerpt over a curated blurb. This is
#: stricter than :data:`agent.rag.retrieve.DEFAULT_MIN_SCORE` on purpose: a weak
#: course match (one incidental shared word) is worse than the hand-written
#: concept summary it would displace, and the course does not cover every
#: concept the tutor is asked about — teleportation and decoherence, for
#: instance, have no lesson of their own and live only in :data:`CONCEPTS`.
COURSE_MIN_SCORE: float = 0.10

#: Score at or above which a course excerpt is treated as a CONFIDENT match and
#: allowed to answer on its own. Between :data:`COURSE_MIN_SCORE` and this value
#: the hit is kept — it is still a real, citable piece of the course — but one
#: curated blurb is added alongside it.
#:
#: MEASURED, not guessed (services/agent/eval, docs/TUTOR.md). A single absolute
#: floor turned out to be the wrong control, because TF-IDF cosine scores are not
#: comparable across queries: "what do T1 and T2 measure" scored a
#: superposition-lesson chunk at 0.121 and "what happens when you measure a
#: qubit" scored a VQE chunk at 0.108, and each of those, being above the floor,
#: DISPLACED a curated blurb that answered the question exactly — the course has
#: no T1/T2 content at all. Raising the floor instead fixes the rubric and guts
#: the feature: at a floor of 0.20 only 4 of the 25 graded questions were still
#: answered from the course. Topping up marginal hits keeps the citation and
#: adds the missing physics: mean rubric coverage over the graded set went from
#: 51% to 75% with course excerpts still returned for every question that has
#: one.
COURSE_STRONG_SCORE: float = 0.22

#: Weight applied when a query token appears in a concept's title.
TITLE_WEIGHT: int = 3

#: Weight applied when a query token matches one of a concept's keywords.
KEYWORD_WEIGHT: int = 1

#: Both weights above are DIVIDED by the number of concepts that share the
#: matching term (:func:`_term_spread`). Without that division the scorer was
#: dominated by ordinary English words that happen to sit in a concept title:
#: "why can't you copy an unknown quantum STATE" scored Bell State 3 (title
#: token "state") against No-Cloning's 1, and answered a no-cloning question
#: with a Bell-state blurb; "what does it mean for two QUBITS to be ENTANGLED"
#: ranked the Qubit blurb above the Entanglement one. Found by
#: services/agent/eval — see docs/TUTOR.md.

CONCEPTS: list[dict[str, Any]] = [
    {
        "id": "qubit",
        "title": "Qubit",
        "keywords": [
            "qubit",
            "qubits",
            "two-level",
            "two-level system",
            "quantum bit",
            "computational basis state",
        ],
        "summary": (
            "A qubit is the quantum version of a bit: a physical two-level "
            "system whose state is a complex linear combination of the two "
            "computational basis states |0> and |1>, written a|0> + b|1> with "
            "|a|^2 + |b|^2 = 1. The numbers a and b are amplitudes, not "
            "probabilities; they can be negative or complex, and that is "
            "exactly what lets quantum algorithms cancel unwanted answers. "
            "A single qubit therefore carries two continuous parameters (after "
            "removing normalization and an unobservable global phase), but any "
            "one measurement extracts at most one classical bit from it. "
            "Physically a qubit can be a superconducting circuit, a trapped "
            "ion's electronic levels, a photon's polarization, or a nuclear "
            "spin — the mathematics is identical in every case."
        ),
    },
    {
        "id": "superposition",
        "title": "Superposition",
        "keywords": [
            "superposition",
            "superposed",
            "linear combination",
            "both at once",
            "plus state",
            "coherent",
            "amplitude",
        ],
        "summary": (
            "Superposition is the statement that if |0> and |1> are valid "
            "states of a system, then so is any normalized complex combination "
            "of them. It is not the claim that the qubit is secretly 0 or 1 "
            "and we merely do not know which — that classical-ignorance model "
            "predicts different experimental results, as interference "
            "experiments demonstrate. A Hadamard gate on |0> produces the "
            "equal superposition (|0> + |1>)/sqrt(2), which measures 0 or 1 "
            "with 50% probability each, yet applying a second Hadamard returns "
            "the state deterministically to |0>. That recovery is impossible if "
            "the first Hadamard had merely randomized a hidden classical bit. "
            "Superposition survives only while the system stays isolated; "
            "contact with the environment destroys it through decoherence."
        ),
    },
    {
        "id": "entanglement",
        "title": "Entanglement",
        "keywords": [
            "entanglement",
            "entangled",
            "correlated",
            "correlation",
            "nonlocal",
            "bell inequality",
            "epr",
            "separable",
            "spooky",
        ],
        "summary": (
            "Two qubits are entangled when their joint state cannot be written "
            "as a product of individual qubit states, so neither qubit has a "
            "definite state of its own even though the pair does. Measuring "
            "one member of an entangled pair immediately fixes the state you "
            "would ascribe to the other CONDITIONED ON YOUR OUTCOME, no matter "
            "how far apart they are, which is why measuring the Bell state "
            "(|00> + |11>)/sqrt(2) always yields matching bits. Note the "
            "conditioning: the other party's own statistics do not change at "
            "all, so nothing observable happens at their end. This correlation "
            "cannot be reproduced by any "
            "pre-agreed classical strategy: Bell's theorem shows such "
            "strategies obey an inequality that entangled qubits provably "
            "violate, and experiments have confirmed the violation. Crucially, "
            "entanglement transmits no signal — each side alone sees uniformly "
            "random outcomes, and the correlation is only visible after the two "
            "results are compared over a classical channel. Entanglement is the "
            "resource behind teleportation, superdense coding, and the speedups "
            "of most quantum algorithms."
        ),
    },
    {
        "id": "measurement",
        "title": "Measurement and the Born Rule",
        "keywords": [
            "measurement",
            "measure",
            "collapse",
            "born rule",
            "probability",
            "counts",
            "shots",
            "observable",
            "projective",
        ],
        "summary": (
            "Measuring a qubit in the computational basis returns 0 or 1 with "
            "probabilities |a|^2 and |b|^2 — the Born rule — and leaves the "
            "qubit in the basis state that was observed. Because the outcome is "
            "probabilistic, a circuit is executed many times (shots) and the "
            "results are reported as counts over bitstrings. Measurement is "
            "irreversible and destroys the superposition it acts on, so where "
            "you place a measurement inside a circuit matters enormously; "
            "measuring mid-circuit collapses the state and changes everything "
            "downstream. Measurement is also basis-dependent: the same state "
            "that looks perfectly random in the Z basis can be perfectly "
            "deterministic in the X basis, which is why you rotate before "
            "measuring to probe phase information. Whether the update is a "
            "physical collapse or just bookkeeping — a change in your "
            "description — is what the interpretations of quantum mechanics "
            "argue about; every interpretation makes the same predictions, and "
            "nothing in the formalism singles out an observer, a mind, or a "
            "cosmic referee."
        ),
    },
    {
        "id": "bell_state",
        "title": "Bell State",
        "keywords": [
            "bell",
            "bell state",
            "bell pair",
            "epr pair",
            "phi plus",
            "maximally entangled",
            "h cx",
        ],
        "summary": (
            "The Bell states are the four maximally entangled two-qubit states, "
            "the most common being Phi+ = (|00> + |11>)/sqrt(2). It is prepared "
            "with two gates: a Hadamard on the first qubit to create a "
            "superposition, then a CNOT with that qubit as control, which "
            "copies the branch label onto the second qubit. Measuring Phi+ in "
            "the computational basis gives roughly 50% '00' and 50% '11' and "
            "essentially never '01' or '10' — off-pattern counts on real "
            "hardware indicate noise. Each qubit taken alone is in a maximally "
            "mixed state, carrying no information; all the information lives in "
            "the correlation. The four Bell states form an orthonormal basis "
            "for two qubits, and distinguishing them (Bell measurement) is the "
            "key step in teleportation and superdense coding. A frequent error "
            "is to say Phi+ is perfectly correlated in every matched basis. It "
            "is NOT every basis: matched X and matched Z measurements agree, "
            "but matched Y measurements ANTI-correlate. (Y tensor Y) Phi+ = "
            "-Phi+, so <YY> = -1 while <XX> = <ZZ> = +1, which follows from the "
            "operator identity YY = -XX.ZZ. The sign pattern is what a Bell "
            "test actually measures, and getting it wrong is what makes the "
            "'they were secretly labelled all along' explanation look viable."
        ),
    },
    {
        "id": "hadamard",
        "title": "Hadamard Gate",
        "keywords": [
            "hadamard",
            "h gate",
            "h",
            "basis change",
            "plus",
            "minus",
            "equal superposition",
            "fourier",
        ],
        "summary": (
            "The Hadamard gate maps |0> to (|0> + |1>)/sqrt(2) and |1> to "
            "(|0> - |1>)/sqrt(2), turning definite states into equal "
            "superpositions and back. Its matrix is (1/sqrt(2)) [[1, 1], [1, "
            "-1]], it is its own inverse (H·H = I), and it is exactly the "
            "change of basis between the Z eigenstates and the X eigenstates. "
            "The minus sign in the image of |1> is what makes H useful: it "
            "encodes phase, so a second Hadamard can make branches interfere "
            "constructively or destructively rather than just re-randomizing. "
            "Applying H to every qubit of an n-qubit register creates a uniform "
            "superposition over all 2^n bitstrings, which is the opening move of "
            "Deutsch–Jozsa, Grover and Simon's algorithm."
        ),
    },
    {
        "id": "phase",
        "title": "Phase and Relative Phase",
        "keywords": [
            "phase",
            "relative phase",
            "global phase",
            "s gate",
            "t gate",
            "rz",
            "z gate",
            "kickback",
            "complex",
        ],
        "summary": (
            "Phase is the complex argument attached to an amplitude. A global "
            "phase multiplying the whole state is physically unobservable, but "
            "a relative phase between branches — the difference between "
            "(|0> + |1>) and (|0> - |1>) — is entirely observable once those "
            "branches recombine. Z, S, T and RZ gates do nothing to measurement "
            "probabilities in the computational basis; they only rewrite phase, "
            "which is why a circuit of Z rotations alone looks inert until a "
            "Hadamard converts the phase into an amplitude difference. Phase "
            "kickback, where the phase of an eigenstate of a controlled "
            "operation appears on the control qubit instead of the target, is "
            "the mechanism at the heart of phase estimation, Shor's algorithm "
            "and Grover's oracle."
        ),
    },
    {
        "id": "interference",
        "title": "Quantum Interference",
        "keywords": [
            "interference",
            "constructive",
            "destructive",
            "cancel",
            "amplitude cancellation",
            "path",
            "double slit",
        ],
        "summary": (
            "Interference is the reason quantum computers can beat classical "
            "ones: because amplitudes are signed complex numbers, contributions "
            "to a wrong answer can cancel while contributions to the right "
            "answer add. When two computational paths lead to the same final "
            "bitstring, their amplitudes are summed before the modulus is "
            "squared, so +1/2 and -1/2 give probability zero rather than 1/2. "
            "The H–Z–H sequence is the smallest example: the phase flip in the "
            "middle turns what would have been a return to |0> into a "
            "deterministic |1>. Every quantum algorithm is essentially a "
            "carefully engineered interference pattern, and interference "
            "requires coherence, so any leakage of which-path information to "
            "the environment washes the pattern out."
        ),
    },
    {
        "id": "bloch_sphere",
        "title": "Bloch Sphere",
        "keywords": [
            "bloch",
            "bloch sphere",
            "visualization",
            "vector",
            "rotation",
            "poles",
            "mixed state",
            "geometry",
        ],
        "summary": (
            "The Bloch sphere is the geometric picture of a single qubit: every "
            "pure state cos(theta/2)|0> + e^{i·phi} sin(theta/2)|1> is a point "
            "on the unit sphere at polar angle theta and azimuth phi. The north "
            "and south poles are |0> and |1>, the equator holds the equal "
            "superpositions such as |+> and |->, and the azimuthal angle is "
            "exactly the relative phase. Every single-qubit unitary is a "
            "rotation of the sphere, which makes gate sequences easy to reason "
            "about: X is a half turn about the x-axis, Z about the z-axis, and "
            "H is a half turn about the diagonal x+z axis. Mixed states, "
            "produced by noise or by ignoring an entangled partner, live "
            "strictly inside the ball, with the center being the maximally "
            "mixed state. The picture does not extend to multiple qubits, "
            "which is precisely where entanglement lives."
        ),
    },
    {
        "id": "decoherence",
        "title": "Decoherence and Noise",
        "keywords": [
            "decoherence",
            "noise",
            "t1",
            "t2",
            "relaxation",
            "dephasing",
            "environment",
            "fidelity",
            "error",
        ],
        "summary": (
            "Decoherence is the loss of quantum coherence that happens when a "
            "qubit becomes entangled with its uncontrolled environment, "
            "effectively leaking which-path information and destroying "
            "interference. It is usually split into energy relaxation, "
            "characterized by the timescale T1, in which |1> decays toward |0>, "
            "and dephasing, characterized by T2, in which the relative phase "
            "randomizes while populations survive; T2 is at most 2·T1. In the "
            "density-matrix picture decoherence shrinks the off-diagonal terms "
            "toward zero, turning a coherent superposition into a classical "
            "probabilistic mixture. Practically it sets the depth budget of a "
            "circuit: gates must complete well within T1 and T2, or the results "
            "drift toward uniform noise. Small counts on bitstrings a clean "
            "circuit should never produce are the usual fingerprint of "
            "decoherence and gate infidelity on real hardware."
        ),
    },
    {
        "id": "error_correction",
        "title": "Quantum Error Correction",
        "keywords": [
            "error correction",
            "qec",
            "surface code",
            "stabilizer",
            "syndrome",
            "logical qubit",
            "threshold",
            "shor code",
            "fault tolerance",
        ],
        "summary": (
            "Quantum error correction protects information by spreading one "
            "logical qubit across many physical qubits so that errors can be "
            "detected without measuring — and thus collapsing — the encoded "
            "state. Stabilizer measurements extract only a syndrome, telling "
            "you which error occurred without revealing the logical value, and "
            "because arbitrary qubit errors decompose into X, Z and Y "
            "components, correcting those discrete cases corrects everything. "
            "The no-cloning theorem forbids simple repetition of the state "
            "itself, which is why codes like Shor's nine-qubit code, Steane's "
            "seven-qubit code and the surface code use entangled encodings "
            "instead. The threshold theorem guarantees that if the physical "
            "error rate is below a code-dependent threshold — around 1% for the "
            "surface code — arbitrarily long computations become possible with "
            "only polylogarithmic overhead. The cost is steep: useful "
            "fault-tolerant algorithms are projected to need thousands of "
            "physical qubits per logical one."
        ),
    },
    {
        "id": "grover",
        "title": "Grover's Search Algorithm",
        "keywords": [
            "grover",
            "search",
            "unstructured",
            "oracle",
            "amplitude amplification",
            "diffusion",
            "sqrt n",
            "quadratic speedup",
        ],
        "summary": (
            "Grover's algorithm finds a marked item in an unstructured search "
            "space of size N in about sqrt(N) oracle queries, a quadratic "
            "speedup over the N/2 a classical search needs on average. It "
            "starts from a uniform superposition and repeats two steps: an "
            "oracle that flips the sign of the marked state's amplitude, and a "
            "diffusion operator that reflects all amplitudes about their mean. "
            "Each round rotates the state vector a little further toward the "
            "marked item, so the success probability rises roughly as "
            "sin^2((2k+1)·theta); running too many iterations overshoots and "
            "the probability falls again. For two qubits with a single marked "
            "state, one iteration is exact and measures the answer with "
            "certainty. The sqrt(N) query count is provably optimal, so Grover "
            "is a ceiling as well as a speedup, and it halves rather than "
            "breaks the effective key length of symmetric cryptography."
        ),
    },
    {
        "id": "shor",
        "title": "Shor's Factoring Algorithm",
        "keywords": [
            "shor",
            "factoring",
            "factorization",
            "rsa",
            "period finding",
            "order finding",
            "modular exponentiation",
            "cryptography",
            "qft",
        ],
        "summary": (
            "Shor's algorithm factors an n-bit integer in time polynomial in n, "
            "an exponential speedup over the best known classical methods and "
            "the reason quantum computing threatens RSA and elliptic-curve "
            "cryptography. The number-theoretic core is classical: factoring "
            "reduces to finding the period r of the function f(x) = a^x mod N, "
            "after which gcd(a^{r/2} ± 1, N) usually yields a nontrivial "
            "factor. The quantum part does the period finding by preparing a "
            "superposition over x, computing modular exponentiation into a "
            "second register, and applying the quantum Fourier transform, whose "
            "interference concentrates the measurement onto multiples of 1/r; "
            "continued fractions then recover r. It is a probabilistic "
            "algorithm, repeated a few times until a useful factor appears. "
            "Running it on cryptographically relevant sizes requires millions "
            "of physical qubits with error correction, which is far beyond "
            "current hardware."
        ),
    },
    {
        "id": "teleportation",
        "title": "Quantum Teleportation",
        "keywords": [
            "teleportation",
            "teleport",
            "bell measurement",
            "classical channel",
            "no cloning",
            "state transfer",
            "epr",
        ],
        "summary": (
            "Quantum teleportation transfers an unknown qubit state from one "
            "party to another using a shared entangled pair and two classical "
            "bits. Alice performs a Bell measurement jointly on the unknown "
            "qubit and her half of the pair, which destroys the original and "
            "yields two random classical bits; she sends those to Bob, who "
            "applies the corresponding X and/or Z correction to his half and "
            "recovers the exact state. No matter is transported and nothing "
            "travels faster than light: before the classical bits arrive Bob's "
            "qubit is maximally mixed and useless. The protocol does not "
            "violate no-cloning because the original state is annihilated by "
            "the measurement. Teleportation is a practical building block for "
            "quantum repeaters, for moving states between modules in a "
            "distributed quantum computer, and for gate teleportation in "
            "fault-tolerant architectures."
        ),
    },
    {
        "id": "tunneling",
        "title": "Quantum Tunneling",
        "keywords": [
            "tunneling",
            "tunnelling",
            "barrier",
            "potential",
            "josephson",
            "wavefunction",
            "penetration",
            "annealing",
        ],
        "summary": (
            "Quantum tunneling is the ability of a particle to pass through a "
            "potential barrier that it lacks the energy to climb classically. "
            "The wavefunction does not stop at the barrier: it decays "
            "exponentially inside it, so a small but nonzero amplitude emerges "
            "on the far side, with transmission probability falling roughly as "
            "exp(-2·kappa·L) in the barrier width L and the square root of the "
            "energy deficit. It explains alpha decay, nuclear fusion rates in "
            "stars, and the operation of scanning tunneling microscopes and "
            "flash memory. In quantum computing it is directly relevant twice "
            "over: Josephson junctions, the nonlinear element of "
            "superconducting qubits, rely on Cooper pairs tunneling across a "
            "thin insulating barrier, and quantum annealers use tunneling "
            "through energy barriers to escape local minima that classical "
            "thermal hopping would be trapped in."
        ),
    },
    {
        "id": "qft",
        "title": "Quantum Fourier Transform",
        "keywords": [
            "qft",
            "fourier",
            "quantum fourier transform",
            "phase estimation",
            "controlled phase",
            "period",
            "frequency",
        ],
        "summary": (
            "The quantum Fourier transform is the discrete Fourier transform "
            "acting on amplitudes: it maps the basis state |x> to a uniform "
            "superposition whose phases wind as exp(2·pi·i·x·y / 2^n). On n "
            "qubits it can be implemented with about n^2/2 gates using "
            "Hadamards and controlled-phase rotations of angle pi/2^k, followed "
            "by a reversal of qubit order — exponentially fewer operations than "
            "the 2^n·n classical FFT would need on the same vector length. That "
            "does not by itself give a speedup, because you cannot read the "
            "amplitudes out; the power comes from using the QFT to convert a "
            "periodicity hidden in a state into a measurable peak, as in phase "
            "estimation and Shor's algorithm. The small rotation angles are the "
            "practical weak point: on noisy hardware the tiniest controlled "
            "phases are often truncated away with little loss of accuracy."
        ),
    },
    {
        "id": "no_cloning",
        "title": "No-Cloning Theorem",
        "keywords": [
            "no cloning",
            "cloning",
            "copy",
            "unitary",
            "linearity",
            "no broadcast",
            "cryptography",
        ],
        "summary": (
            "The no-cloning theorem states that no unitary operation can copy "
            "an arbitrary unknown quantum state. The proof is two lines of "
            "linearity: a machine that maps |psi>|0> to |psi>|psi> for two "
            "non-orthogonal states cannot also do so for their superposition, "
            "because linearity forces a cross term the copy would not have. "
            "Orthogonal states, and therefore classical bits, can be copied "
            "freely; it is only unknown superpositions that are protected. This "
            "single fact shapes the whole field: it rules out naive repetition "
            "codes and forces the syndrome-based design of quantum error "
            "correction, it prevents entanglement from being used for "
            "faster-than-light signalling, and it is the security foundation of "
            "quantum key distribution, where an eavesdropper cannot copy the "
            "transmitted qubits without leaving detectable disturbance."
        ),
    },
    {
        "id": "vqe",
        "title": "Variational Quantum Eigensolver (VQE)",
        "keywords": [
            "vqe",
            "variational",
            "eigensolver",
            "ansatz",
            "nisq",
            "noisy hardware",
            "hybrid",
            "ground state",
            "optimizer",
            "barren plateau",
        ],
        "summary": (
            "VQE, the variational quantum eigensolver, is a hybrid "
            "quantum-classical algorithm for estimating ground-state energies. "
            "A shallow parameterized circuit — the ansatz — prepares a trial "
            "state on the quantum device, which estimates the expectation "
            "value of the problem Hamiltonian by decomposing it into Pauli "
            "terms, <H> = sum_i c_i <P_i>, and sampling each term; a classical "
            "optimizer then adjusts the circuit parameters to push that energy "
            "down. The variational principle guarantees the measured energy is "
            "an upper bound on the true ground-state energy, so lower is "
            "always better. It is the algorithm people actually run on "
            "today's NISQ hardware because the circuits are shallow enough to "
            "fit inside coherence times, and because a noisy estimate of an "
            "upper bound is still an upper bound. The costs are real: the "
            "number of Pauli terms to sample grows quickly with system size, "
            "and barren plateaus can make the optimization landscape "
            "exponentially flat. VQE has no proof of quantum advantage — it "
            "is a heuristic, valuable because it is runnable now."
        ),
    },
    {
        "id": "quantum_speedup",
        "title": "Quantum Speedup",
        "keywords": [
            "speedup",
            "advantage",
            "parallel",
            "all possible answers",
            "faster than classical",
            "quantum computer",
            "supremacy",
        ],
        "summary": (
            "The speedup of a quantum computer does not come from trying "
            "every candidate answer at once. An n-qubit register does carry "
            "amplitudes over 2^n basis states, but a measurement returns only "
            "n classical bits — one sample, not the whole table — so 'having' "
            "every answer is worth nothing by itself. The real mechanism is "
            "interference: an algorithm arranges phases so that amplitudes "
            "for wrong answers cancel while those for the right answer add, "
            "and that choreography only exists for problems with the right "
            "structure — period finding (Shor, exponential), unstructured "
            "search (Grover, quadratic and provably no better), and "
            "simulating quantum systems themselves. For most everyday "
            "computing a quantum computer offers no advantage at all, which "
            "is why 'it computes everything in parallel' is the misconception "
            "this field spends the most time unteaching."
        ),
    },
    {
        "id": "ghz_state",
        "title": "GHZ State",
        "keywords": [
            "ghz",
            "greenberger",
            "multipartite",
            "three qubit",
            "cat state",
            "all zeros all ones",
            "entangled",
        ],
        "summary": (
            "The GHZ state is the n-qubit generalization of a Bell state, "
            "(|000...0> + |111...1>)/sqrt(2), built by a Hadamard on the first "
            "qubit followed by a chain of CNOTs onto the rest. Measuring it "
            "yields only the all-zeros or the all-ones bitstring, each about "
            "half the time, so any other outcome in a run is a direct signature "
            "of noise. GHZ states give a stronger refutation of local hidden "
            "variables than Bell inequalities do: they produce an outright "
            "logical contradiction with local realism in a single run rather "
            "than a statistical violation. They are also maximally fragile — "
            "losing or dephasing a single qubit destroys the entanglement of "
            "the whole register — which makes GHZ preparation a standard "
            "benchmark of a device's multi-qubit coherence."
        ),
    },
    {
        "id": "qaoa",
        "title": "QAOA",
        "keywords": [
            "qaoa",
            "quantum approximate optimization",
            "approximate optimization algorithm",
            "maxcut",
            "max-cut",
            "combinatorial",
            "cost hamiltonian",
            "mixer",
        ],
        "summary": (
            "QAOA, the quantum approximate optimization algorithm, is the "
            "combinatorial-optimization sibling of VQE. The problem — MaxCut "
            "is the standard example — is encoded as a cost Hamiltonian C "
            "whose ground state is the best solution, and the circuit applies "
            "p alternating layers: a cost layer exp(-i*gamma*C) that writes "
            "each candidate's cost into its phase, and a mixer layer "
            "exp(-i*beta*sum X_i) that moves amplitude between candidates so "
            "those phases can interfere. The 2p angles are tuned by a "
            "classical optimizer in a variational outer loop, and as p grows "
            "the schedule can approximate an adiabatic sweep. The honest "
            "status: QAOA does not solve NP-hard problems efficiently — "
            "nothing known does — and at NISQ-runnable depths there is no "
            "demonstrated quantum advantage on any practical problem. At "
            "p = 1 its MaxCut approximation ratio is provably beaten by the "
            "classical Goemans-Williamson algorithm (0.878 guarantee), and "
            "low-depth QAOA is fundamentally local, seeing only a "
            "neighborhood of the graph per layer. It is a heuristic whose "
            "behavior at larger depth is an open experimental question, and "
            "that is the entire claim."
        ),
    },
    {
        "id": "quantum_advantage",
        "title": "Quantum Advantage Experiments",
        "keywords": [
            "quantum supremacy",
            "quantum advantage",
            "random circuit sampling",
            "sycamore",
            "boson sampling",
            "cross-entropy",
            "google",
            "jiuzhang",
        ],
        "summary": (
            "The quantum supremacy / quantum advantage experiments are "
            "narrower than the headlines. In 2019 Google's 53-qubit Sycamore "
            "chip did random circuit sampling — sample bitstrings from a "
            "random shallow circuit's output distribution, verified by "
            "cross-entropy benchmarking. Google estimated the classical "
            "equivalent at 10,000 years; IBM argued days with smarter use of "
            "disk, and by 2022 tensor-network methods reproduced the sampling "
            "on classical clusters in hours. That is not scandal but the "
            "structure of the claim: 'advantage' is relative to the best "
            "known classical algorithm, so it is provisional by construction, "
            "and classical algorithms improved because the experiments gave "
            "them a target. Keep two things separate. The task was chosen to "
            "be classically hard, not useful — random circuit sampling and "
            "boson sampling (USTC's Jiuzhang) have no known application; they "
            "are benchmarks of hardware control, not useful computation. And "
            "none of it means quantum computers now beat classical machines "
            "on practical problems — no quantum speedup has yet been shown on "
            "a problem anyone independently wanted solved. What was really "
            "established is that ~50+ programmable qubits can hold enough "
            "coherence to occupy a region of Hilbert space classical "
            "simulation genuinely struggles to follow: an engineering "
            "milestone, honestly framed."
        ),
    },
    {
        "id": "quantum_annealing",
        "title": "Quantum Annealing",
        "keywords": [
            "quantum annealing",
            "annealing",
            "annealer",
            "adiabatic",
            "d-wave",
            "ising",
            "gate model",
            "gate-model",
            "transverse field",
        ],
        "summary": (
            "Quantum annealing and gate-model quantum computing are different "
            "machines, and their qubit counts cannot be compared. An annealer "
            "(D-Wave's flux-qubit machines are the canonical example) encodes "
            "an optimization problem as an Ising cost Hamiltonian whose "
            "ground state is the best solution, starts in the easy ground "
            "state of a strong transverse field, and ramps slowly between the "
            "two; the adiabatic theorem says a slow enough ramp keeps the "
            "system in its instantaneous ground state, with tunneling through "
            "energy-landscape barriers as the hoped-for edge over classical "
            "thermal hopping. A gate-model machine applies programmable "
            "unitary gates and is universal. An annealer is not universal: it "
            "only accepts problems in optimization format and cannot run "
            "Shor's algorithm, Grover, or error-corrected circuits, so 5,000 "
            "annealer qubits are not 5,000 gate-model qubits. Two caveats "
            "complete the picture: idealized adiabatic computation with "
            "arbitrary Hamiltonians is polynomially equivalent to the gate "
            "model in theory, but hardware annealers implement a restricted "
            "(stoquastic) class not believed to reach that power; and there "
            "is no demonstrated scaling advantage of quantum annealing over "
            "the best classical heuristics — simulated annealing and parallel "
            "tempering remain brutally strong — so annealing is a heuristic "
            "with interesting physics, not an established speedup."
        ),
    },
    {
        "id": "t1_t2",
        "title": "Coherence Times T1 and T2",
        "keywords": [
            "t1",
            "t2",
            "coherence time",
            "relaxation time",
            "dephasing time",
            "energy relaxation",
            "ramsey",
            "hahn echo",
            "amplitude damping",
        ],
        "summary": (
            "T1 and T2 are the two clocks that say how long a qubit stays "
            "quantum, and they time different kinds of dying. T1 is the "
            "energy relaxation time: prepare |1> and the excited population "
            "decays toward |0> as exp(-t/T1), the qubit leaking its energy "
            "quantum into the environment. T2 is the dephasing time: prepare "
            "(|0> + |1>)/sqrt(2) and the relative phase between branches "
            "randomizes on timescale T2, visible as decay of the "
            "off-diagonal density-matrix elements — populations can be intact "
            "while all interference is gone. The bound T2 <= 2*T1 is a "
            "consequence, not a convention: losing energy also scrambles "
            "phase, so amplitude damping alone imposes 1/T2 = 1/(2*T1), and "
            "pure dephasing on top (1/T2 = 1/(2*T1) + 1/T_phi) only shortens "
            "T2 — it can never be longer than twice T1. They are measured "
            "differently: T1 by exciting and waiting, T2 by a Ramsey "
            "experiment (T2*, which also absorbs slow drift) or a Hahn echo "
            "that refocuses slow noise. On today's transmons both sit at tens "
            "to a few hundred microseconds against gate times of tens of "
            "nanoseconds, and that ratio is the entire depth budget of a "
            "NISQ circuit."
        ),
    },
    {
        "id": "parallel_universes",
        # Hyphenated on purpose: a bare title token "universes" matched the
        # measurement-universe-chooses question ("does the universe check it")
        # and displaced the measurement blurb from the top-up slot — caught by
        # eval.grade_retrieval when this concept landed. The id still spells
        # "parallel universes" for _named_curated.
        "title": "The Parallel-Universes Picture",
        "keywords": [
            "parallel universes",
            "many worlds",
            "multiverse",
            "2^n",
            "exponential state space",
            "exponentially many",
        ],
        "summary": (
            "It takes 2^n complex amplitudes to write down the state of n "
            "qubits, and the tempting inference is that 2^n parallel "
            "universes are each doing part of your computation. They are not: "
            "that is a statement about the cost of DESCRIBING the state "
            "classically — bookkeeping a simulator must carry — not about a "
            "workforce. Two hard facts break the picture. A measurement "
            "returns n classical bits, one sample rather than 2^n answers, "
            "so whatever the register 'held' cannot be collected. And if "
            "exponentially many universes really did the work in parallel, "
            "unstructured search would be essentially instant; in reality "
            "Grover gives sqrt(N), quadratic and provably optimal, which is "
            "exactly what a multiverse of free labour would not predict. The "
            "actual mechanism is interference: phases are choreographed so "
            "amplitudes on wrong answers cancel and the right answer's "
            "amplitude adds, which works only for problems with exploitable "
            "structure. Many-worlds is a respectable interpretation of "
            "quantum mechanics, but it is an interpretation — same "
            "predictions as every other — and quantum speedups neither "
            "require it nor evidence it."
        ),
    },
    {
        "id": "hardware_platforms",
        "title": "Hardware Platforms",
        "keywords": [
            "superconducting",
            "transmon",
            "trapped ion",
            "ion trap",
            "photonic",
            "neutral atom",
            "hardware platform",
            "made of",
            "spin qubit",
        ],
        "summary": (
            "A qubit is any well-controlled two-level system, and the leading "
            "hardware platforms realize that in very different physics while "
            "obeying the same mathematics. Superconducting transmons (Google, "
            "IBM) are microwave circuits whose nonlinearity comes from a "
            "Josephson junction: gates in tens of nanoseconds and chip "
            "fabrication, but coherence of tens to hundreds of microseconds, "
            "operation at ~15 millikelvin in a dilution refrigerator, and "
            "mostly nearest-neighbour connectivity on a 2D grid. Trapped ions "
            "(IonQ, Quantinuum) store qubits in atomic levels: coherence of "
            "seconds or better, the best measured gate fidelities, and "
            "all-to-all interaction within a trap — but gates of microseconds "
            "to milliseconds and scaling beyond one trap still being "
            "engineered via shuttling or photonic links. Neutral atoms in "
            "optical tweezers scale to thousands of reconfigurable sites; "
            "photonic qubits fly at room temperature but make two-qubit gates "
            "probabilistic; silicon spin qubits are foundry-compatible but "
            "young. There is no clear winner: each platform trades gate "
            "speed, coherence, connectivity and manufacturability against "
            "the others, and error correction reshuffles what matters — a "
            "slower, higher-fidelity qubit can beat a faster, noisier one. "
            "Every platform implements the identical formalism; the open "
            "question is engineering, not physics."
        ),
    },
]


#: How many chunks of one lesson are merged into that lesson's excerpt. One was
#: MEASURED to be the wrong number (docs/TUTOR.md, 2026-08-25): routing was
#: 25/25 while nine questions failed, because the single best-scoring chunk of
#: the right lesson was often a quiz aside and the fact that answers the
#: question sat in a sibling chunk the per-lesson dedupe threw away. Three keeps
#: the context block small enough to read while covering questions whose answer
#: spans a lesson.
MERGE_CHUNKS_PER_LESSON: int = 3

#: Relevance floor for the *sibling* chunks merged into an already-routed
#: lesson. Deliberately looser than :data:`COURSE_MIN_SCORE`: that floor decides
#: whether a lesson is worth citing at all, but once its best chunk has cleared
#: it, a sibling from the same lesson only has to be better than noise —
#: "Grover's" keypoints chunk scored 0.085 on the very question it answers.
SIBLING_MIN_SCORE: float = 0.05


def _course_hits_as_concepts(query: str, top_k: int) -> tuple[list[dict[str, Any]], float]:
    """Search the course index and map hits onto the concept-dict shape.

    Hits are grouped by lesson, so ``top_k`` results mean ``top_k`` different
    lessons — but each lesson's excerpt merges up to
    :data:`MERGE_CHUNKS_PER_LESSON` of that lesson's best chunks rather than
    keeping only the single top one. The single-chunk version failed
    measurably (docs/TUTOR.md): the chunk that *matches* a question's wording
    and the chunk that *answers* it are often different chunks of the same
    lesson.

    Within a lesson, the highest-scoring chunks are kept, with one exception:
    if the lesson has a matching ``keypoints`` chunk that did not make the cut,
    it replaces the last pick. Key points are the lesson's own factual digest —
    the densest statement of exactly the claims a direct question needs — and
    they lose vocabulary matches to quiz chunks that quote the question's words
    back at it. Merged chunks are ordered by position, so the excerpt reads in
    lesson order rather than score order.

    Args:
        query: Free-text search string.
        top_k: Maximum number of results (distinct lessons).

    Returns:
        A pair of (up to ``top_k`` dicts with the keys ``id``, ``title``,
        ``keywords`` and ``summary``, best cosine score seen). The list is empty
        and the score 0.0 when no index exists or nothing clears the relevance
        floor.
    """
    if _retrieve is None:
        return [], 0.0
    try:
        # Fetch wide and shallow-filtered: the strict COURSE_MIN_SCORE gate is
        # applied per *lesson* below (to its best chunk), not per chunk here,
        # so sibling chunks worth merging are not lost before grouping.
        hits = _retrieve.search_course(
            query,
            top_k=max(top_k * 8, top_k),
            min_score=SIBLING_MIN_SCORE,
        )
    except Exception:  # pragma: no cover - retrieval must never break the tutor
        return [], 0.0

    # Group by lesson, preserving score order. A lesson qualifies only if its
    # best (first-seen) chunk clears the strict floor — the sibling floor never
    # decides which lessons are cited, only what rides along with them.
    lesson_order: list[str] = []
    by_lesson: dict[str, list[dict[str, Any]]] = {}
    for hit in hits:
        slug = str(hit.get("lesson_slug", ""))
        if slug not in by_lesson:
            if float(hit.get("score", 0.0)) < COURSE_MIN_SCORE or len(lesson_order) >= top_k:
                continue
            lesson_order.append(slug)
            by_lesson[slug] = []
        by_lesson[slug].append(hit)

    results: list[dict[str, Any]] = []
    for slug in lesson_order:
        lesson_hits = by_lesson[slug]
        kept = lesson_hits[:MERGE_CHUNKS_PER_LESSON]
        if not any(h.get("block_kind") == "keypoints" for h in kept):
            keypoints = next(
                (
                    h
                    for h in lesson_hits[MERGE_CHUNKS_PER_LESSON:]
                    if h.get("block_kind") == "keypoints"
                ),
                None,
            )
            if keypoints is not None:
                kept = kept[: MERGE_CHUNKS_PER_LESSON - 1] + [keypoints]
        kept = sorted(kept, key=lambda h: int(h.get("position", 0)))

        top = lesson_hits[0]
        title = str(top.get("lesson_title", "")) or slug
        url = str(top.get("url", f"/learn/{slug}"))
        body = "\n\n".join(
            str(h.get("text", "")).strip() for h in kept if str(h.get("text", "")).strip()
        )
        results.append(
            {
                "id": slug or "course",
                "title": title,
                "keywords": [
                    part
                    for part in (
                        slug,
                        top.get("track", ""),
                        top.get("level", ""),
                        top.get("block_kind", ""),
                    )
                    if part
                ],
                "summary": f"{body}\n\n(From the course lesson “{title}” — {url})",
            }
        )

    if not results:
        return [], 0.0
    best = max((float(hit.get("score", 0.0)) for hit in hits), default=0.0)
    return results, best


def _named_curated(query: str, course: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the curated blurb the query literally NAMES, if the course lacks it.

    A strong course match used to suppress the curated tier entirely, and that
    was MEASURED to be wrong in one specific way (docs/TUTOR.md, 2026-08-25):
    "are Bell-state qubits perfectly correlated in every basis?" routed to the
    right lessons at score 0.39, but the X/Z-agree-Y-anti-correlates fact lives
    only in the curated ``bell_state`` blurb — the 2026-08-17 physics fix landed
    there, not in the lessons. When the learner has spelled out the name of a
    concept we keep a hand-written blurb for, withholding that blurb because an
    excerpt scored well is optimizing the ranking at the expense of the answer.

    Deliberately narrow: only the TOP keyword-scored concept is considered, and
    only when its id or full title, stemmed, appears verbatim in the stemmed
    query — a query that merely brushes a concept's vocabulary does not qualify,
    and a concept the course results already cover is never duplicated.

    Args:
        query: The free-text query.
        course: The course-excerpt results already selected.

    Returns:
        The named concept dict, or ``None`` when nothing qualifies.
    """
    curated = _keyword_concepts(query, 1)
    if not curated:
        return None
    concept = curated[0]
    if concept["id"] in {c["id"] for c in course}:
        return None
    stemmed_query = _stem_phrase(query.lower())
    names = {
        _stem_phrase(str(concept["id"]).replace("_", " ")),
        _stem_phrase(str(concept["title"]).lower()),
    }
    if any(name and name in stemmed_query for name in names):
        return concept
    return None


def search_source() -> str:
    """Report which backend answered the most recent :func:`search_concepts`.

    Returns:
        ``'rag'`` if the highest-ranked result of the last call was a course
        excerpt, ``'keyword'`` if it came from the curated :data:`CONCEPTS`
        scorer. Before any call has run, this reflects the fallback default.

        A ``'rag'`` answer may still carry ONE curated blurb in the lower
        positions — see :data:`COURSE_STRONG_SCORE`. Use
        :func:`search_was_topped_up` to tell the two apart.
    """
    return _LAST_SOURCE


def search_was_topped_up() -> bool:
    """Report whether the last :func:`search_concepts` mixed both backends.

    Returns:
        ``True`` when a curated blurb was appended to the course excerpts —
        either because the course match was above :data:`COURSE_MIN_SCORE` but
        below :data:`COURSE_STRONG_SCORE`, or because the query literally named
        a curated concept the course results did not cover
        (:func:`_named_curated`).
    """
    return _LAST_TOPPED_UP


def search_concepts(query: str, top_k: int = 3) -> list[dict[str, Any]]:
    """Retrieve the material most relevant to a free-text query.

    The course index is consulted first: it covers roughly twenty thousand words
    of real lesson content and returns citable excerpts. When no index has been
    built, or nothing in it clears the relevance floor, this falls back to the
    curated concept blurbs scored by keyword — the query is lowercased, each
    concept scores :data:`TITLE_WEIGHT` for every query token found in its title
    (or every title token found in the query) and :data:`KEYWORD_WEIGHT` for
    every keyword phrase present in the query.

    Args:
        query: Free-text search string, e.g. ``"why do entangled qubits match"``.
        top_k: Maximum number of results to return.

    Returns:
        Up to ``top_k`` dicts with the keys ``id``, ``title``, ``keywords`` and
        ``summary``, sorted by descending relevance — the same shape from either
        backend. An unrelated query returns ``[]``. See :func:`search_source`.
    """
    global _LAST_SOURCE, _LAST_TOPPED_UP

    _LAST_TOPPED_UP = False
    course, best_score = _course_hits_as_concepts(query, top_k)
    if course:
        _LAST_SOURCE = "rag"
        if best_score >= COURSE_STRONG_SCORE or top_k < 2:
            named = _named_curated(query, course)
            if named is None:
                return course
            _LAST_TOPPED_UP = True
            trimmed = course[: top_k - 1] if len(course) >= top_k else course
            return trimmed + [named]
        # Marginal course match: keep the citable excerpts, but give up one slot
        # to the curated blurb so the tutor is not left holding an incidental
        # paragraph as its only reference. See COURSE_STRONG_SCORE.
        curated = _keyword_concepts(query, top_k)
        if not curated:
            return course
        _LAST_TOPPED_UP = True
        return course[: top_k - 1] + curated[:1]

    _LAST_SOURCE = "keyword"
    return _keyword_concepts(query, top_k)


def _stem(word: str) -> str:
    """Fold a word onto a conservative stem.

    The RAG side already stems ("entangled"/"entanglement", "measure"/
    "measurement"); the curated scorer did not, so a learner asking what
    happens when they MEASURE a qubit never matched the concept titled
    "MEASUREMENT and the Born Rule" and was answered from the Qubit blurb
    instead. Deliberately timid — it only strips suffixes that are safe on this
    vocabulary and never shortens a word below four characters.

    Args:
        word: A single lower-cased word.

    Returns:
        Its stem.
    """
    out = word.strip(".,;:!?()[]{}'\"").lower()
    if out.endswith("'s"):
        out = out[:-2]
    for suffix in ("ements", "ement", "ments", "ment", "ions", "ion", "ing", "ies", "es", "ed", "s"):
        if out.endswith(suffix) and len(out) - len(suffix) >= 4:
            out = out[: -len(suffix)]
            break
    # "entanglement" -> "entangle" and "entangled" -> "entangl" must agree.
    if out.endswith("e") and len(out) > 4:
        out = out[:-1]
    return out


def _stem_phrase(phrase: str) -> str:
    """Stem every word of a phrase, preserving order."""
    return " ".join(_stem(word) for word in str(phrase).split())


def _concept_terms(concept: dict[str, Any]) -> set[str]:
    """Return this concept's searchable terms — title words and keywords, stemmed.

    The concept id (underscores as spaces) is included as a term. A set, so a
    term that is both a title word, a keyword and the id is counted once.
    Scoring it twice is how the Qubit blurb — "qubit" in its title and in its
    keywords — outscored concepts whose subject a question actually named.

    Args:
        concept: An entry of :data:`CONCEPTS`.

    Returns:
        The stemmed terms.
    """
    terms = {_stem_phrase(keyword) for keyword in concept["keywords"]}
    terms.add(_stem_phrase(str(concept["id"]).replace("_", " ")))
    terms |= {
        _stem(token)
        for token in concept["title"].lower().replace("'s", "").split()
        if len(token) > 3
    }
    return terms


def _build_term_idf() -> dict[str, float]:
    """Inverse document frequency of every stemmed term over :data:`CONCEPTS`.

    Counting how many concepts merely *list* a term is too coarse a measure of
    how informative it is: "qubit" appears in one concept's keywords and in
    almost every concept's prose, so it looked distinctive while being the least
    distinctive word in the knowledge base. Frequency over the summaries is the
    honest estimate, and it is what a TF-IDF index would use — this is the same
    idea as :mod:`agent.rag.index`, at a scale where a dict is the whole
    implementation.

    Returns:
        Stemmed term -> ``log((N + 1) / (df + 1)) + 1``, near 1.0 for a term
        every concept uses and larger for a rare one.
    """
    documents = [
        {
            _stem(word)
            for word in re.split(
                r"[^a-z0-9]+",
                f"{concept['title']} {' '.join(concept['keywords'])} {concept['summary']}".lower(),
            )
            if word
        }
        for concept in CONCEPTS
    ]
    total = len(documents)
    idf: dict[str, float] = {}
    for document in documents:
        for term in document:
            idf[term] = idf.get(term, 0.0) + 1.0
    return {
        term: math.log((total + 1) / (count + 1)) + 1.0 for term, count in idf.items()
    }


#: See :func:`_build_term_idf`.
_TERM_IDF: dict[str, float] = _build_term_idf()

def _idf(term: str) -> float:
    """Return the inverse document frequency of ``term`` (1.0 if unseen)."""
    return _TERM_IDF.get(term, 1.0)


def _keyword_concepts(query: str, top_k: int) -> list[dict[str, Any]]:
    """Score the curated :data:`CONCEPTS` against ``query`` by keyword.

    Every matched term — title word or keyword, stemmed, counted once — scores
    its :func:`_idf`, so a word most of the knowledge base uses cannot outrank
    the term that names the subject, and a matched phrase scores the sum of its
    words. There is no flat title multiplier: a title word is informative
    exactly to the extent that it is rare, which idf already says. An exact whole-title match, and a
    concept id spelled out in the query, are both worth a full title weight on
    top.

    Args:
        query: Free-text search string.
        top_k: Maximum number of results.

    Returns:
        Up to ``top_k`` concept dicts, best first; ``[]`` when nothing matches.
    """
    q = (query or "").lower().strip()
    if not q:
        return []

    stems = {_stem(word) for word in q.split()}
    stems.discard("")
    stemmed_query = _stem_phrase(q)

    scored: list[tuple[float, dict[str, Any]]] = []
    for concept in CONCEPTS:
        score = 0.0
        for term in _concept_terms(concept):
            hit = term in stemmed_query if " " in term else term in stems
            if hit:
                score += sum(_idf(part) for part in term.split())

        if score > 0:
            scored.append((score, concept))

    scored.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
    return [concept for _score, concept in scored[:top_k]]


def concept_titles() -> list[str]:
    """List the titles of every concept in the knowledge base.

    Returns:
        The concept titles in declaration order, useful for telling a learner
        what the tutor actually knows about.
    """
    return [concept["title"] for concept in CONCEPTS]
