"""Cross-check the browser simulator against Qiskit and PennyLane, live.

``tests/test_js_crosscheck.py`` compares against a checked-in fixture of twelve
hand-picked circuits. That catches a mirrored register or a flipped rotation
sign, and it is fast and dependency-free. It cannot catch a gate that is wrong
only in combination with another gate, and it cannot notice that the fixture
itself went stale, because the fixture IS the JS answer.

This module closes both holes. It transpiles ``apps/web/lib/quantum.ts`` with
esbuild on every run, executes the real module in Node, and compares:

* **every preset** the web app ships (``PRESETS`` in quantum.ts, read through
  the module rather than copied), and
* **a seeded spread of random circuits** — three widths, drawn from the full
  gate palette including the three-qubit Toffoli and all four rotation gates,
  with the angles ``formatAngle`` special-cases (exact pi fractions) as well as
  ones it cannot (arbitrary doubles).

Three engines are compared, not two: JS vs Qiskit vs PennyLane. Two agreeing
engines and one outlier tells you immediately which one is wrong, which a
pairwise check does not.

Bit order is checked explicitly rather than assumed. All three index basis
state ``i`` with qubit ``q`` set when ``(i >> q) & 1`` — but PennyLane natively
does the opposite, and ``pennylane_runner`` reverses to compensate in two
separate places (amplitude index, and every counts key). Both reversals are
exercised here on asymmetric circuits, where dropping either one changes the
answer. On a symmetric circuit it would not.

Requires Node and the repo's node_modules (for esbuild). The whole module skips
when either is absent, so a Python-only checkout still runs the rest of the
suite — but the fixture-based file always runs, so the cross-check is never
entirely absent.
"""

from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
QUANTUM_TS = REPO_ROOT / "apps" / "web" / "lib" / "quantum.ts"
ESBUILD = REPO_ROOT / "node_modules" / ".bin" / "esbuild"
DRIVER = Path(__file__).parent / "jsbridge" / "driver.mjs"

#: Measured worst-case disagreement over this suite on this machine:
#: 6.713e-16 (JS vs Qiskit, random-q2-00) and 6.661e-16 (JS vs PennyLane,
#: preset:grover2) across all 66 circuits of up to 5 qubits and 24 gates — a few
#: units in the last place of a double. 1e-9 leaves six orders of magnitude of headroom
#: for floating-point reassociation while still failing on any real physics
#: change: the smallest wrong answer a single mis-signed rotation can produce is
#: order 1e-3 for the smallest angle in the generator.
TOLERANCE = 1e-9

#: Circuits per width. 20 x 3 widths = 60 random circuits plus the web
#: presets (every unitary one; the measuring presets are excluded). A pass takes ~5 s wall clock, dominated by one Node
#: start-up and one PennyLane device construction per circuit.
CIRCUITS_PER_WIDTH = 20
WIDTHS = (2, 3, 5)

_ONE_QUBIT = ["H", "X", "Y", "Z", "S", "SDG", "T", "TDG"]
_ROTATIONS = ["RX", "RY", "RZ", "P"]
_TWO_QUBIT = ["CX", "CY", "CZ", "SWAP"]

#: Angles worth generating. The exact fractions are the ones ``formatAngle``
#: snaps to and writes as ``pi/3``-style text, so they exercise the QASM 3
#: importer's expression folding; the arbitrary doubles are written as decimals
#: and exercise shortest-round-trip printing instead. Both must survive the
#: browser -> QASM -> Qiskit trip.
_ANGLES = [
    math.pi,
    -math.pi,
    math.pi / 2,
    math.pi / 3,
    -math.pi / 4,
    2 * math.pi / 3,
    -3 * math.pi / 4,
    math.pi / 12,
    math.pi / 16,
    0.7391,
    -1.234567890123,
    2.5,
]

_UNAVAILABLE = None
if not shutil.which("node"):
    _UNAVAILABLE = "node is not on PATH"
elif not ESBUILD.exists():
    _UNAVAILABLE = f"esbuild is not installed at {ESBUILD} (run npm install at the repo root)"
elif not QUANTUM_TS.exists():
    _UNAVAILABLE = f"{QUANTUM_TS} is missing"

pytestmark = pytest.mark.skipif(_UNAVAILABLE is not None, reason=str(_UNAVAILABLE))


def _pennylane_available() -> bool:
    """Report whether PennyLane and the lightning device are both installed."""
    import importlib.util

    return all(
        importlib.util.find_spec(name) is not None
        for name in ("pennylane", "pennylane_lightning")
    )


# ---------------------------------------------------------------------------
# Random circuit generation
# ---------------------------------------------------------------------------


def _random_circuit(rng: Any, index: int, num_qubits: int) -> dict[str, Any]:
    """Build one random circuit in the web app's GateOp shape.

    Every gate is placed on randomly chosen distinct qubits, which is what makes
    the comparison sharp: a controlled gate applied with its operands swapped,
    or a register indexed from the wrong end, changes the statevector on an
    asymmetric circuit and is invisible on a symmetric one.

    Args:
        rng: A seeded :class:`random.Random`.
        index: Position in the batch, used only in the id.
        num_qubits: Circuit width.

    Returns:
        A ``{id, numQubits, ops, shots, seed}`` dictionary for the Node driver.
    """
    num_ops = rng.randint(4, 24)
    ops: list[dict[str, Any]] = []
    for _ in range(num_ops):
        roll = rng.random()
        if roll < 0.40:
            ops.append({"name": rng.choice(_ONE_QUBIT), "qubits": [rng.randrange(num_qubits)]})
        elif roll < 0.70:
            ops.append(
                {
                    "name": rng.choice(_ROTATIONS),
                    "qubits": [rng.randrange(num_qubits)],
                    "theta": rng.choice(_ANGLES),
                }
            )
        elif roll < 0.95 or num_qubits < 3:
            a, b = rng.sample(range(num_qubits), 2)
            ops.append({"name": rng.choice(_TWO_QUBIT), "qubits": [a, b]})
        else:
            a, b, c = rng.sample(range(num_qubits), 3)
            ops.append({"name": "CCX", "qubits": [a, b, c]})
    return {
        "id": f"random-q{num_qubits}-{index:02d}",
        "numQubits": num_qubits,
        "ops": ops,
        "shots": None,
        "seed": None,
    }


def _build_specs() -> list[dict[str, Any]]:
    """Assemble the circuit batch: every web preset plus the random spread.

    The presets are read out of ``quantum.ts`` itself by the Node driver's
    caller — see :func:`_run_js` — rather than transcribed here, so a preset
    added in the web app is picked up without touching this file.

    Returns:
        The list of circuit specs to send to Node.
    """
    import random

    specs: list[dict[str, Any]] = []
    for width in WIDTHS:
        # One seed per width, fixed: a failure is reproducible by re-running the
        # suite, and adding a width does not renumber the existing circuits.
        rng = random.Random(20260817 + width)
        for index in range(CIRCUITS_PER_WIDTH):
            specs.append(_random_circuit(rng, index, width))
    return specs


# ---------------------------------------------------------------------------
# The Node bridge
# ---------------------------------------------------------------------------


def _bundle(tmp_dir: Path) -> Path:
    """Transpile apps/web/lib/quantum.ts into an importable ES module.

    Built fresh every session on purpose: a cached artefact would let this suite
    keep passing against a version of the simulator that no longer ships.

    Args:
        tmp_dir: Where to write the output.

    Returns:
        Path to the transpiled module.

    Raises:
        AssertionError: When esbuild fails, with its stderr attached.
    """
    out = tmp_dir / "quantum.mjs"
    proc = subprocess.run(
        [
            str(ESBUILD),
            str(QUANTUM_TS),
            # --bundle: quantum.ts imports ./quantum/gates-extended. Transpiling
            # the one file left that import dangling, and every test in this
            # suite errored on ERR_MODULE_NOT_FOUND before comparing anything.
            "--bundle",
            "--platform=node",
            "--format=esm",
            f"--outfile={out}",
            "--log-level=warning",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, f"esbuild failed on {QUANTUM_TS}:\n{proc.stderr}"
    return out


def _run_js(module_path: Path, specs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Execute the circuits in Node against the real quantum.ts module.

    Args:
        module_path: The transpiled module from :func:`_bundle`.
        specs: Circuit specs.

    Returns:
        One result dictionary per spec, in the same order.

    Raises:
        AssertionError: When Node exits non-zero or reports an error.
    """
    proc = subprocess.run(
        ["node", str(DRIVER), str(module_path)],
        input=json.dumps({"circuits": specs}),
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert proc.stdout, f"the Node driver produced no output (rc={proc.returncode}):\n{proc.stderr}"
    payload = json.loads(proc.stdout)
    assert "error" not in payload, f"the Node driver failed: {payload['error']}"
    results = list(payload["results"])
    assert len(results) == len(specs)
    return results


def _preset_specs(module_path: Path) -> list[dict[str, Any]]:
    """Read the web app's PRESETS through the module and turn them into specs.

    Args:
        module_path: The transpiled module.

    Returns:
        One spec per preset the web app ships.
    """
    script = (
        f"const m = await import({str(module_path)!r});"
        "process.stdout.write(JSON.stringify(m.PRESETS.map((p) => ({"
        "id: 'preset:' + p.id, numQubits: p.circuit.numQubits, ops: p.circuit.ops,"
        "shots: null, seed: null}))));"
    )
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0 and proc.stdout, (
        f"could not read PRESETS from quantum.ts:\n{proc.stderr}"
    )
    return list(json.loads(proc.stdout))


@pytest.fixture(scope="module")
def js_results(tmp_path_factory: pytest.TempPathFactory) -> list[dict[str, Any]]:
    """Transpile, generate the batch, and run it all through Node once.

    Args:
        tmp_path_factory: pytest's per-module temp directory factory.

    Returns:
        The JS results, presets first.
    """
    tmp_dir = tmp_path_factory.mktemp("jscrosscheck")
    module_path = _bundle(tmp_dir)
    specs = _preset_specs(module_path) + _build_specs()
    return _run_js(module_path, specs)


# ---------------------------------------------------------------------------
# The Python engines
# ---------------------------------------------------------------------------


#: A mid-circuit write into a single classical bit: ``c[0] = measure q[0];``.
#: The trailing whole-register ``c = measure q;`` every export ends with is NOT
#: this, and is what the statevector comparisons already strip.
_MID_CIRCUIT_MEASURE = re.compile(r"^\s*c\[\d+\]\s*=\s*measure\b", re.MULTILINE)


def _has_classical_control(qasm: str) -> bool:
    """Report whether a circuit measures mid-flight or gates on a measured bit.

    Such a circuit has no statevector to compare. Its state after the first
    mid-circuit measurement depends on the outcome that measurement happened to
    give, so ``simulate()`` in quantum.ts returns ONE seeded branch (see
    ``hasClassicalControl`` there), and reconstructing a unitary from the
    parsed circuit — which is what :func:`_qiskit_amplitudes` does — is not
    defined at all: an ``if_else`` instruction cannot be appended to a circuit
    with no classical register. Comparing the two is not a check that fails,
    it is a question with no answer.

    What IS checkable for these circuits is the part that broke in practice:
    that the service can read and run the QASM. See
    :func:`test_classically_controlled_circuits_run_on_the_service`.

    Args:
        qasm: OpenQASM 3 source as ``toQasm`` produced it.

    Returns:
        True when the circuit contains a conditional or a mid-circuit measure.
    """
    return "if (" in qasm or _MID_CIRCUIT_MEASURE.search(qasm) is not None


def _unitary_results(js_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The subset of a batch that has a statevector worth comparing."""
    return [r for r in js_results if not _has_classical_control(r["qasm"])]


def _qiskit_amplitudes(qasm: str) -> list[complex]:
    """Simulate the app's exported QASM with Qiskit, measurements stripped.

    Args:
        qasm: OpenQASM 3 source exactly as ``toQasm`` produced it.

    Returns:
        Amplitudes indexed with qubit 0 as the least significant bit.
    """
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import Statevector

    from app.quantum.runner import parse_qasm

    circuit = parse_qasm(qasm)
    unitary = QuantumCircuit(circuit.num_qubits)
    for instruction in circuit.data:
        if instruction.operation.name in ("measure", "barrier", "reset"):
            continue
        unitary.append(
            instruction.operation,
            [circuit.find_bit(qubit).index for qubit in instruction.qubits],
        )
    return list(Statevector.from_instruction(unitary).data)


def _worst(left: list[complex], right: list[complex]) -> float:
    """Largest per-amplitude distance between two statevectors.

    Args:
        left: One engine's amplitudes.
        right: Another engine's amplitudes, same index order and length.

    Returns:
        The maximum modulus of the difference.
    """
    assert len(left) == len(right), f"length mismatch: {len(left)} vs {len(right)}"
    return max(abs(a - b) for a, b in zip(left, right))


def test_the_batch_is_the_size_it_claims(js_results: list[dict[str, Any]]) -> None:
    """Guard against an empty or truncated batch silently passing everything.

    Every parametrized test below is driven by this list. If generation broke
    and produced nothing, zero comparisons would run and the suite would still
    be green — the exact failure mode this project has been bitten by.
    """
    ids = [result["id"] for result in js_results]
    assert len(ids) == len(set(ids)), "duplicate circuit ids in the batch"
    assert len(ids) >= len(WIDTHS) * CIRCUITS_PER_WIDTH + 4, f"batch too small: {len(ids)}"
    assert sum(1 for i in ids if i.startswith("preset:")) >= 4, "the web presets are missing"
    # At least one circuit must contain a Toffoli and one an exact pi fraction,
    # or the generator has quietly stopped covering them.
    qasm = "\n".join(result["qasm"] for result in js_results)
    assert "ccx" in qasm, "no three-qubit gate anywhere in the batch"
    assert "pi/" in qasm, "no exact pi-fraction angle anywhere in the batch"


def test_every_generated_circuit_is_parseable(js_results: list[dict[str, Any]]) -> None:
    """The whole batch survives the browser -> QASM -> parse_qasm round trip.

    Reported as one test with an aggregated failure list rather than 63 separate
    ones, so a systematic parser regression shows every affected circuit at once.
    """
    from app.quantum.runner import parse_qasm

    failures: list[str] = []
    for result in js_results:
        try:
            circuit = parse_qasm(result["qasm"])
        except ValueError as exc:
            failures.append(f"{result['id']}: {exc}")
            continue
        expected_width = int(math.log2(len(result["amplitudes"])))
        if circuit.num_qubits != expected_width:
            failures.append(
                f"{result['id']}: parsed {circuit.num_qubits} qubits, JS used {expected_width}"
            )
    assert not failures, "circuits the service cannot read:\n" + "\n".join(failures)


def test_js_and_qiskit_agree_on_every_circuit(js_results: list[dict[str, Any]]) -> None:
    """The browser simulator and Qiskit compute the same state, phase included.

    Global phase is not modded out. Both are expected to agree exactly on it,
    which pins ``rz`` to Qiskit's ``e^{-i0/2}`` convention rather than ``u1``'s.

    Classically-controlled circuits sit this one out — see
    :func:`_has_classical_control` for why there is nothing to compare — and are
    covered by :func:`test_classically_controlled_circuits_run_on_the_service`.
    """
    unitary = _unitary_results(js_results)
    failures: list[str] = []
    for result in unitary:
        js_amps = [complex(re_, im) for re_, im in result["amplitudes"]]
        worst = _worst(js_amps, _qiskit_amplitudes(result["qasm"]))
        if worst >= TOLERANCE:
            failures.append(f"{result['id']}: {worst:.3e}")
    assert not failures, (
        f"{len(failures)} of {len(unitary)} circuits disagree between "
        "apps/web/lib/quantum.ts and Qiskit:\n" + "\n".join(failures)
    )


@pytest.mark.skipif(not _pennylane_available(), reason="pennylane/lightning not installed")
def test_js_and_pennylane_agree_on_every_circuit(js_results: list[dict[str, Any]]) -> None:
    """The PennyLane path agrees too, which is the amplitude reversal's real test.

    ``statevector_with_pennylane`` reverses the bits of every amplitude index
    because PennyLane puts wire 0 in the MOST significant position. Deleting
    that reversal leaves Bell and GHZ passing and fails most circuits here.
    """
    from app.quantum.pennylane_runner import statevector_with_pennylane

    unitary = _unitary_results(js_results)
    failures: list[str] = []
    for result in unitary:
        pennylane = statevector_with_pennylane(result["qasm"])
        assert pennylane["labels"] == result["labels"], (
            f"{result['id']}: label convention differs between the engines"
        )
        amps = [complex(a["re"], a["im"]) for a in pennylane["amplitudes"]]
        js_amps = [complex(re_, im) for re_, im in result["amplitudes"]]
        worst = _worst(js_amps, amps)
        if worst >= TOLERANCE:
            failures.append(f"{result['id']}: {worst:.3e}")
    assert not failures, (
        f"{len(failures)} of {len(unitary)} circuits disagree between "
        "apps/web/lib/quantum.ts and PennyLane:\n" + "\n".join(failures)
    )


#: Shots per circuit in the counts comparison. With 32 outcomes the expected
#: total-variation distance from pure sampling noise is ~sqrt(k/(2*pi*n)) = 0.035
#: at n=8192, k=32; the 0.10 bound below is ~3x that. A mirrored bitstring key
#: on any of these circuits moves TVD to order 0.5.
_COUNTS_SHOTS = 8192
_TVD_BOUND = 0.10


def test_measured_counts_match_the_js_distribution(js_results: list[dict[str, Any]]) -> None:
    """The counts path agrees with the JS state, keys and frequencies both.

    A statevector comparison cannot catch a bit-order bug in the counts path,
    because counts keys are produced by entirely different code: ``_clean_counts``
    on the Qiskit side, ``_to_project_bitstring`` on the PennyLane side (which
    reverses every key), and ``run_circuit`` picks whichever engine is available.
    This is the only test in the repo that exercises that code against a second
    implementation.

    Two assertions per circuit, chosen so neither needs a statistical fudge:

    * **Impossible outcomes never appear.** Any bitstring the JS state gives
      probability < 1e-12 must have zero counts. This is exact — a mirrored key
      lands on an impossible outcome immediately — and it is what actually
      failed when this test was first written with a sloppy threshold.
    * **The frequencies match**, as total-variation distance under
      :data:`_TVD_BOUND`. This catches a permutation that happens to map the
      support onto itself, which the first assertion alone would miss.
    """
    from app.quantum.runner import run_circuit

    checked = 0
    failures: list[str] = []
    # Classically-controlled circuits have no single distribution to compare
    # against: the JS side reports one seeded branch, the service samples the
    # whole tree. See :func:`_has_classical_control`.
    for result in _unitary_results(js_results):
        probabilities = [re_ * re_ + im * im for re_, im in result["amplitudes"]]
        by_label = dict(zip(result["labels"], probabilities))
        impossible = {label for label, p in by_label.items() if p < 1e-12}
        # A circuit whose every outcome is reachable cannot demonstrate the
        # first assertion, but it still contributes to the TVD one.
        if impossible:
            checked += 1

        counts = run_circuit(result["qasm"], shots=_COUNTS_SHOTS)["counts"]
        assert sum(counts.values()) == _COUNTS_SHOTS, f"{result['id']}: shots went missing"

        seen_impossible = sorted(set(counts) & impossible)
        if seen_impossible:
            failures.append(
                f"{result['id']}: sampled {seen_impossible}, which the JS state says "
                "is impossible (amplitude exactly zero)"
            )
            continue

        tvd = 0.5 * sum(
            abs(counts.get(label, 0) / _COUNTS_SHOTS - by_label.get(label, 0.0))
            for label in set(by_label) | set(counts)
        )
        if tvd > _TVD_BOUND:
            failures.append(f"{result['id']}: total-variation distance {tvd:.3f}")

    assert checked >= 5, (
        f"only {checked} circuits had an impossible outcome; the exact half of this "
        "check is toothless and the generator needs revisiting"
    )
    assert not failures, "the counts path disagrees with the JS state:\n" + "\n".join(failures)


def test_an_inverted_bit_order_would_be_caught(js_results: list[dict[str, Any]]) -> None:
    """Prove the comparison above has teeth, by breaking it on purpose.

    Every test in this file would still pass if both engines were mirrored the
    same way, and none of them would notice a comparison that never actually
    compares. So: take the JS amplitudes, reverse the bits of every index the
    way a dropped ``statevector_with_pennylane`` reversal would, and assert that
    at least one circuit now disagrees with Qiskit by more than the tolerance.

    If this test fails, the batch has become too symmetric to detect a mirrored
    register and the agreement tests above are not proving what they claim.
    """
    unitary = _unitary_results(js_results)
    detected = 0
    for result in unitary:
        js_amps = [complex(re_, im) for re_, im in result["amplitudes"]]
        width = int(math.log2(len(js_amps)))
        mirrored = [0j] * len(js_amps)
        for index, amplitude in enumerate(js_amps):
            mirrored[int(format(index, f"0{width}b")[::-1], 2)] = amplitude
        if _worst(mirrored, _qiskit_amplitudes(result["qasm"])) >= TOLERANCE:
            detected += 1
    assert detected >= len(unitary) // 2, (
        f"a mirrored register was only detectable on {detected} of {len(unitary)} "
        "circuits; the batch is too symmetric to be a real bit-order check"
    )


#: Shots for the classical-control run. Smaller than :data:`_COUNTS_SHOTS`
#: because the assertion is a marginal on one qubit, not a whole distribution:
#: the 3-sigma band on p=0.25 at 4096 shots is +/- 0.020, and the check below
#: allows 0.05.
_CONTROL_SHOTS = 4096


def test_classically_controlled_circuits_run_on_the_service(
    js_results: list[dict[str, Any]],
) -> None:
    """Circuits with mid-circuit measurement survive the trip to the service.

    This is the half of the contract the statevector tests above cannot state,
    and it is the half that actually broke. ``toQasm`` used to write
    ``if (c[0] == 1) x q[2];``, which reads perfectly and which no Qiskit parser
    accepts: a single ``bit`` compares against ``true``/``false``, only a whole
    register compares against an integer, and the body needs braces. Every
    classically-controlled circuit the app exported was rejected by
    ``parse_qasm`` outright — so the teleportation preset could be simulated in
    the browser and could not be run on a backend, on a page whose whole point
    is showing both answers.

    The physics assertion is teleportation itself: the protocol only works when
    Bob's two corrections are applied on exactly the right measured bits, so the
    marginal on the destination qubit reproducing the input state is a check on
    the conditionals having survived with their bits and polarity intact. A
    dropped condition, or the two swapped, moves this marginal to 0.5.
    """
    from app.quantum.runner import run_circuit

    controlled = [r for r in js_results if _has_classical_control(r["qasm"])]
    # The exclusions above are only honest if something is actually excluded.
    assert controlled, (
        "no classically-controlled circuit in the batch — either PRESETS lost the "
        "teleportation preset or _has_classical_control has stopped matching, and "
        "the exclusions in the tests above are now silently skipping nothing"
    )

    for result in controlled:
        counts = run_circuit(result["qasm"], shots=_CONTROL_SHOTS)["counts"]
        assert sum(counts.values()) == _CONTROL_SHOTS, f"{result['id']}: shots went missing"
        width = int(math.log2(len(result["amplitudes"])))
        for label in counts:
            assert len(label) == width and set(label) <= {"0", "1"}, (
                f"{result['id']}: malformed counts key {label!r}"
            )

    teleport = next((r for r in controlled if r["id"] == "preset:teleport-classical"), None)
    if teleport is None:  # pragma: no cover - the preset is expected to exist
        pytest.skip("the teleport-classical preset is not in this build")

    # The preset prepares ry(pi/3)|0> on q0, so the state teleported to q2 has
    # P(1) = sin^2(pi/6) = 0.25. Labels print MSB-first with qubit 0 as the LSB,
    # so q2 is character 0 of a 3-character key.
    counts = run_circuit(teleport["qasm"], shots=_CONTROL_SHOTS)["counts"]
    ones = sum(n for label, n in counts.items() if label[0] == "1")
    assert abs(ones / _CONTROL_SHOTS - 0.25) < 0.05, (
        f"the teleported qubit came out with P(1) = {ones / _CONTROL_SHOTS:.3f}, not 0.25 — "
        "Bob's corrections are not landing on the bits Alice measured"
    )
