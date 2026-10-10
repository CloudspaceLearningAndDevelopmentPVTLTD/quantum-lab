# GPU, stabilizer & other engines

The 16-qubit statevector engine is the workhorse, but `lib/quantum/` holds several other engines, each chosen for a regime where the dense statevector is the wrong tool.

## Backends: CPU reference and WebGPU

`lib/quantum/backend.ts` defines a `StatevectorBackend` interface (allocate, apply gates, flush, read probabilities, amplitudes, top-k states, marginals, measure, dispose) and two implementations.

**`CpuBackend`** (float64) wraps `StateVector` up to 16 qubits and switches to raw-`Float64Array` reference kernels above that, up to **27 qubits** (2²⁷ complex doubles is 2 GiB; 28 is 4 GiB and fails on most machines).

**`WebGpuBackend`** (float32) stores the state as an `array<vec2<f32>>` storage buffer and applies gates with WGSL compute kernels: one thread per amplitude pair for single and controlled gates, plus swap, probability, marginal, block-max and collapse kernels. Up to 512 dispatches are batched per submit through a uniform ring, workgroups go two-dimensional when a 26-qubit gate's 2²⁵ pairs overflow the one-dimensional limit, and `maxQubits` is derived from the device's buffer limits (capped at 30, which is 8 GB and past any current device). Exact top-k readback reads only the winning 256-amplitude blocks; marginals are reduced on the GPU in float32 and summed on the host in float64.

**Gate fusion** (`fusion.ts`) keeps one pending 2×2 per qubit and multiplies consecutive single-qubit gates into it, flushing when a two-qubit op touches the qubit. It is exact because gates on different qubits commute, and it is what makes dispatch count, not gate count, the thing the GPU pays for.

The GPU Simulator workbench page runs the same circuit on both backends, reports wall time and dispatch count, measures the float32-versus-float64 gap up to 20 qubits (the copy cites the float32 ulp of 1.19×10⁻⁷ and an error estimate of roughly √gates × 10⁻⁷), and probes capacity by walking the qubit count upward under a 1 GiB / 2 s budget. Browser support is Chrome, Edge and Safari 17+; anything without WebGPU falls back to the CPU backend with a stated reason.

## Stabilizer tableau

`stabilizer.ts` implements the Aaronson–Gottesman tableau (Phys. Rev. A 70, 052328): 2n destabilizer and stabilizer rows stored as bit-packed `Uint32Array`s plus a sign vector, so a Clifford circuit on **4,096 qubits** costs about 8 MB rather than the 2⁴⁰⁹⁶ amplitudes a statevector would need. It supports H, S, S†, X, Y, Z, √X, √X†, CX, CY, CZ, SWAP, measurement (reporting whether an outcome was deterministic) and reset, with GHZ, cluster-chain, cluster-grid and random brickwork generators drawn from the 11,520 two-qubit Cliffords. The Stabilizer workbench and the surface-code visualizations use it.

## Noise, density matrices and tomography

- **`noise.ts`** applies Monte-Carlo trajectory noise on top of the statevector engine: depolarising after one- and k-qubit gates, amplitude damping from T1, dephasing from T2 (clamped to 2·T1), idle noise per ASAP-scheduled layer, and readout confusion. A no-qubit BARRIER is an explicit idle step.
- **`densityMatrix.ts`** holds dense ρ for a few qubits: mixtures, partial trace, purity, dephasing, Pauli measurement.
- **`tomography.ts`** reconstructs one- and two-qubit states from Pauli-basis counts with linear inversion and Smolin–Gambetta–Smith maximum-likelihood, reporting trace distance, Hilbert–Schmidt distance and fidelity. The eigensolver is a Jacobi iteration over the real embedding of the Hermitian matrix.
- **Readout mitigation** in the workbench inverts a tensor-product confusion matrix built from the same noise model.

## Routing and topology

`routing.ts` implements SABRE (Li, Ding and Xie, ASPLOS 2019) with forward–backward initial layout, and a learned router: a softmax policy over swap candidates with eight features, initialised to reproduce SABRE's ranking and trained with REINFORCE off the main thread in a Web Worker. Routed circuits are verified equivalent by statevector where the physical register fits in 16 qubits; Toffolis expand to six CX for routing. `topology.ts` builds linear, ring, grid, heavy-hex (IBM Falcon/Eagle/Heron style, degree ≤ 3) and all-to-all coupling maps with hop-distance matrices and drawing positions.

## Physics modules

Each visualization that is not a circuit has a dependency-free module tested against closed-form results: a 1-D Schrödinger solver (tridiagonal Sturm bisection with inverse iteration, plus time evolution), separable 3-D eigenstates for the volume renderer, analytic hydrogen orbitals, Kronig–Penney band structure by transfer matrix, single-photon optics through beam splitters and wave plates with an optional entangled idler for the quantum eraser, Wigner and Husimi distributions in a truncated Fock basis, three-level laser rate equations in SI units, Gamow tunnelling for alpha decay, the Majorana stellar representation, symmetrised two-particle states, and a no-cloning fidelity checker that reproduces the 5/6 optimal-cloner bound.

## Presets and editing

Eight core presets (Bell, GHZ, uniform superposition, two-qubit Grover, interference, teleportation in two forms, superdense coding), two extended presets (period finding ×2 mod 3; Shor's order finding for N = 15 on seven qubits) and eight algorithm presets (Deutsch–Jozsa constant and balanced, Bernstein–Vazirani, Simon, phase estimation, HHL, a VQE ansatz, a QAOA MaxCut ansatz) ship with the editor. Edits go through pure, non-mutating functions (`moveOp`, `retargetOp`, `insertOpAt`, `removeOpAt`) and a generic undo/redo stack of 100 states, which is what makes the editor's history testable without a DOM.
