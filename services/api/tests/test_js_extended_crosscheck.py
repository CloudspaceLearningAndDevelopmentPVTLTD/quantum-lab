"""Cross-check the browser simulator's EXTENDED gates against Qiskit, up to 16 qubits.

``test_js_random_crosscheck.py`` covers the original palette (one- and two-qubit
basics plus Toffoli) at 2, 3 and 5 qubits. That left the gates researchers reach
for most — U3, √X, Fredkin, multi-controlled X, custom 2×2/4×4 matrices, gates
behind X/Y/Z-basis and anti-controls, (controlled) QFT/IQFT and the modular
arithmetic blocks — and every width above 5, including the product's 16-qubit
ceiling, without an independent check.

It is not a hypothetical gap. A custom 1-qubit matrix behind a control was
exported as a bare ``U(θ,φ,λ)``, dropping the matrix's global phase. Uncontrolled
that phase is unobservable; behind ``ctrl @`` it is a RELATIVE phase, so the
exported file computed a different state from the one the simulator showed
(fidelity down to 0.02 against Qiskit). Every case of that shape here failed
before the fix in ``toQasm``.

Same contract as the sibling suite: the real ``quantum.ts`` runs in Node, its
exported QASM is parsed by this service's own ``parse_qasm`` and simulated by
Qiskit, and the amplitudes must agree to 1e-9 with the global phase included.
"""

from __future__ import annotations

import math
import random
from typing import Any

import pytest

from tests.test_js_random_crosscheck import (
    TOLERANCE,
    _UNAVAILABLE,
    _bundle,
    _qiskit_amplitudes,
    _run_js,
    _worst,
)

pytestmark = pytest.mark.skipif(_UNAVAILABLE is not None, reason=str(_UNAVAILABLE))

#: 16 is the simulator's hard ceiling (StateVector rejects numQubits > 16).
WIDTHS = (2, 3, 5, 8, 12, 16)
CIRCUITS_PER_WIDTH = 6

_ONE = ["H", "X", "Y", "Z", "S", "SDG", "T", "TDG", "SX", "SXDG"]
_ROT = ["RX", "RY", "RZ", "P"]


def _angle(rng: random.Random) -> float:
    return (rng.random() * 4 - 2) * math.pi


def _random_unitary(rng: random.Random, dim: int) -> list[dict[str, float]]:
    """A Haar-ish random unitary by Gram–Schmidt, row-major, as GateOp Complex entries."""
    cols: list[list[complex]] = []
    for _ in range(dim):
        v = [complex(rng.uniform(-1, 1), rng.uniform(-1, 1)) for _ in range(dim)]
        for u in cols:
            dot = sum(a.conjugate() * b for a, b in zip(u, v))
            v = [b - dot * a for a, b in zip(u, v)]
        norm = math.sqrt(sum(abs(x) ** 2 for x in v))
        cols.append([x / norm for x in v])
    return [{"re": cols[c][r].real, "im": cols[c][r].imag} for r in range(dim) for c in range(dim)]


def _single(rng: random.Random, target: int) -> dict[str, Any]:
    roll = rng.random()
    if roll < 0.35:
        return {"name": rng.choice(_ONE), "qubits": [target]}
    if roll < 0.6:
        return {"name": rng.choice(_ROT), "qubits": [target], "theta": _angle(rng)}
    if roll < 0.8:
        return {"name": "U3", "qubits": [target], "theta": _angle(rng), "phi": _angle(rng),
                "lambda": _angle(rng)}
    return {"name": "UNITARY", "qubits": [target], "matrix": _random_unitary(rng, 2), "label": "V"}


def _op(rng: random.Random, n: int) -> dict[str, Any]:
    roll = rng.random()
    if roll < 0.35 or n < 2:
        return _single(rng, rng.randrange(n))
    if roll < 0.50:
        # A single-qubit gate behind 1–3 controls in random bases, some negated.
        k = 1 + rng.randrange(min(3, n - 1))
        target, *controls = rng.sample(range(n), k + 1)
        op = _single(rng, target)
        op["extraControls"] = [
            {"qubit": q, "basis": rng.choice(["X", "Y", "Z"]), "anti": rng.random() < 0.4}
            for q in controls
        ]
        return op
    if roll < 0.62:
        return {"name": rng.choice(["CX", "CY", "CZ", "SWAP"]), "qubits": rng.sample(range(n), 2)}
    if roll < 0.68 and n >= 3:
        return {"name": rng.choice(["CCX", "CSWAP"]), "qubits": rng.sample(range(n), 3)}
    if roll < 0.73 and n >= 3:
        return {"name": "MCX", "qubits": rng.sample(range(n), 3 + rng.randrange(min(3, n - 2)))}
    if roll < 0.80:
        return {"name": "UNITARY", "qubits": rng.sample(range(n), 2),
                "matrix": _random_unitary(rng, 4), "label": "W"}
    width = 2 + rng.randrange(min(4, n - 1))
    controls = 1 if n - width >= 1 and rng.random() < 0.4 else 0
    qubits = rng.sample(range(n), width + controls)
    if roll < 0.90:
        return {"name": rng.choice(["QFT", "IQFT"]), "qubits": qubits, "controls": controls}
    width = min(width, 4)
    qubits = qubits[: width + controls]
    modulus = 2 + rng.randrange((1 << width) - 1)
    if rng.random() < 0.5:
        return {"name": "ADDK", "qubits": qubits, "controls": controls,
                "k": rng.randrange(-modulus, modulus), "modulus": modulus}
    k = 1 + rng.randrange(modulus - 1)
    while math.gcd(k, modulus) != 1:
        k = 1 + rng.randrange(modulus - 1)
    return {"name": "MULK", "qubits": qubits, "controls": controls, "k": k, "modulus": modulus}


def _specs() -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    for n in WIDTHS:
        rng = random.Random(20261009 + n)
        for index in range(CIRCUITS_PER_WIDTH):
            ops = [{"name": "RY", "qubits": [q], "theta": _angle(rng)} for q in range(n)]
            ops += [_op(rng, n) for _ in range(10 * n)]
            specs.append({"id": f"extended-q{n}-{index:02d}", "numQubits": n, "ops": ops,
                          "shots": None, "seed": None})
    return specs


@pytest.fixture(scope="module")
def extended_results(tmp_path_factory: pytest.TempPathFactory) -> list[dict[str, Any]]:
    module_path = _bundle(tmp_path_factory.mktemp("jsextended"))
    return _run_js(module_path, _specs())


def test_the_batch_covers_every_extended_gate_and_width(
    extended_results: list[dict[str, Any]],
) -> None:
    """Guard against a generator that quietly stops producing what this file is for."""
    assert len(extended_results) == len(WIDTHS) * CIRCUITS_PER_WIDTH
    widths = {int(math.log2(len(r["amplitudes"]))) for r in extended_results}
    assert 16 in widths, "nothing at the 16-qubit ceiling"
    names = {op["name"] for spec in _specs() for op in spec["ops"]}
    for gate in ("U3", "SX", "SXDG", "CSWAP", "MCX", "UNITARY", "QFT", "IQFT", "ADDK", "MULK"):
        assert gate in names, f"{gate} never generated"
    assert any(
        op["name"] == "UNITARY" and op.get("extraControls")
        for spec in _specs() for op in spec["ops"]
    ), "no controlled custom matrix — the case that was exported wrong"


def test_js_and_qiskit_agree_on_extended_gates_up_to_16_qubits(
    extended_results: list[dict[str, Any]],
) -> None:
    """Every amplitude, global phase included, through the exported QASM."""
    failures: list[str] = []
    for result in extended_results:
        js = [complex(re_, im) for re_, im in result["amplitudes"]]
        worst = _worst(js, _qiskit_amplitudes(result["qasm"]))
        if worst >= TOLERANCE:
            failures.append(f"{result['id']}: {worst:.3e}")
    assert not failures, (
        f"{len(failures)} of {len(extended_results)} circuits disagree between "
        "apps/web/lib/quantum.ts and Qiskit:\n" + "\n".join(failures)
    )
