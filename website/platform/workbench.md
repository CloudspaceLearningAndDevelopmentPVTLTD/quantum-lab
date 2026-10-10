# Workbench

The workbench is eighteen research tools at `/workbench`, each a focused page over a tested, dependency-free module in `lib/workbench/` or `lib/quantum/`. The design rule is the same as the simulator's: the computation is a pure module with a unit test against a known result, and the page is a thin view over it.

| Tool | Kind | What it does |
| --- | --- | --- |
| Generate | generate | Generate → verify → repair loop: a model proposes a circuit against a spec, the verifier checks histogram, state or unitary and resource constraints, and the loop repairs. The provider is injected, so the loop is tested with a scripted fake |
| Algorithm Evolution | optimise | A demo-scale replica of an evolutionary program search. Candidates are programs in a tiny line-based DSL that is parsed and interpreted; nothing from a model is ever evaluated as code |
| Decoder Lab, Code Explorer, Stabilizer | measure | Surface-code decoders (lookup versus a learned decoder), Clifford circuits on thousands of qubits via the tableau engine |
| Calibration | train | A drifting single qubit with two calibration strategies, trained off the main thread in a worker |
| Routing | optimise | SABRE and a REINFORCE-trained router on real coupling maps, with equivalence verification |
| Experiments | run | A lab notebook: hypothesis, steps with circuits, seeds and results, conclusion; persisted to Supabase or memory and also exposed as five MCP tools |
| Noise, Mitigation | measure | Trajectory noise models and readout-error mitigation by confusion-matrix inversion |
| QML Check | train | A variational quantum classifier versus logistic regression and a small MLP on three datasets, in a worker |
| GPU Simulator, Simulator Benchmark | run | CPU float64 versus WebGPU float32, capacity probing, and the correctness and performance suites for the engine |
| Run This Paper | run | A curated list of landmark results, each backed by an existing tested module, not an arXiv executor |
| Equivalence | measure | Checks two circuits for equivalence up to global phase |
| Device Advisor, Resource Estimator | measure | Device ranking from calibration data; order-of-magnitude fault-tolerant resource estimates |
| Entanglement Transition, Barren Plateaus | measure | Measurement-induced entanglement transition; gradient variance falling with qubit count (McClean et al. 2018) |

## Shared machinery

- **`verify.ts`** checks a circuit against a spec in the engine's own qubit convention, so a verification result means the same thing in the workbench, in the MCP `generate_verified_circuit` tool and in the challenge grader.
- **`exportBundle.ts`** builds a citable, re-runnable bundle (`README.md`, `manifest.json`, `circuit.qasm`, `results.json`, `CITATION.bib`). It is pure, takes the timestamp as a parameter and never reads the clock, so the same inputs always produce the same bytes, which is the property a reproducibility artefact must have. The circuit is emitted once, by `toQasm`, so there is exactly one OpenQASM emitter in the codebase.
- **`notebook.ts`** writes a Jupyter notebook (nbformat 4.5) targeting Qiskit or PennyLane with deterministic cell ids, so exports are byte-identical for the same circuit.
- **`circuitImage.ts`** renders SVG, PNG and quantikz LaTeX from the same geometry the editor uses.
- **`lib/numerics/nn.ts`** is a minimal shared neural-network toolkit (Float64Array parameters, Adam, Glorot initialisation) used by the decoders, zero-noise extrapolation and QML modules, so every learned component in the workbench trains with the same, tested optimiser.

## Workers

Anything that trains runs in a Web Worker (`routing.worker.ts`, `calibration.worker.ts`, `qml.worker.ts`) with start and stop messages, periodic progress reports and budgets in episodes and seconds. The page stays responsive and a learner can abandon a run.

## Why no arbitrary code execution

Several tools take text from a language model. None evaluates it. Generated circuits are parsed by `fromQasm` into a `Circuit`, evolved candidates are interpreted by a purpose-built DSL interpreter, and verification runs on the parsed structure. This is both a security boundary and what makes the tools testable: a scripted fake provider exercises every branch of the generate–verify–repair loop in milliseconds.
