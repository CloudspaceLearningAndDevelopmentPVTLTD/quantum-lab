/**
 * driver.mjs — runs apps/web/lib/quantum.ts and prints what it computed.
 *
 * This is the JS half of tests/test_js_random_crosscheck.py. That test invents
 * random circuits, hands them here, and compares the answers against Qiskit
 * and PennyLane. It exists because the checked-in fixture in
 * tests/data/js_statevectors.json covers twelve hand-picked circuits: enough to
 * catch a mirrored register, not enough to catch a gate that is wrong only in
 * combination with another one.
 *
 * Deliberately NOT a copy of anything: the module under test is imported, not
 * reimplemented. Argument 1 is the path to an esbuild-transpiled quantum.mjs
 * (the Python side builds it from apps/web/lib/quantum.ts on every run, so a
 * stale artefact cannot make this pass). The circuit list arrives on stdin as
 * JSON; the results leave on stdout as JSON.
 *
 * Input:  {"circuits": [{"id": str, "numQubits": int, "ops": GateOp[],
 *                        "shots": int|null, "seed": int|null}]}
 * Output: {"results": [{"id", "qasm", "amplitudes": [[re,im],...],
 *                       "labels": [...], "counts": {label: n}|null}]}
 *
 * Any throw becomes {"error": "..."} on stdout with exit code 1, so the Python
 * side reports a real message instead of an empty pipe.
 */

const modulePath = process.argv[2]
if (!modulePath) {
  process.stdout.write(JSON.stringify({ error: 'usage: driver.mjs <quantum.mjs>' }))
  process.exit(1)
}

const { simulate, toQasm, run } = await import(modulePath)

let raw = ''
for await (const chunk of process.stdin) raw += chunk

try {
  const { circuits } = JSON.parse(raw)
  const results = circuits.map((spec) => {
    const circuit = { numQubits: spec.numQubits, ops: spec.ops }
    const sv = simulate(circuit)
    const amplitudes = sv.amplitudes().map((a) => [a.re, a.im])
    const labels = amplitudes.map((_, i) => sv.label(i))
    // Sampling is exercised only when the Python side asks for it, and always
    // with an explicit seed: an unseeded run uses Math.random and would make
    // the comparison flaky rather than reproducible.
    const counts =
      spec.shots ? run(circuit, spec.shots, 0, spec.seed ?? 1).counts : null
    return { id: spec.id, qasm: toQasm(circuit), amplitudes, labels, counts }
  })
  process.stdout.write(JSON.stringify({ results }))
} catch (err) {
  process.stdout.write(JSON.stringify({ error: String(err && err.stack ? err.stack : err) }))
  process.exit(1)
}
