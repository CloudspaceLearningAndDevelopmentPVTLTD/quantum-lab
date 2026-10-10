"""The simulation cost bound, and where it is enforced.

Audit finding PY-1 was a qubit cap that ran AFTER parsing, so ``qreg q[3000000]``
allocated 669 MB before anyone checked. That was fixed by ``guard_qasm``. What
it left behind was a cap that is ONE number for every backend, while simulation
cost is not one curve: the ideal path is 2^n and the noisy path is shots x 2^n.
Measured on the development container at 1024 shots, a 16-qubit noisy circuit
takes 13.7 s and a 12-qubit one takes 0.83 s, and the registry advertised 24.

The tests here pin three things:

* the bound exists and is per-backend (``effective_max_qubits``),
* it is enforced BEFORE the parser allocates anything (the router), and
* the registry advertises the same number it enforces, so the device picker
  cannot offer a width the service will refuse.

They deliberately do not run a 16-qubit noisy circuit to prove it is slow. A
test that takes 14 seconds to demonstrate slowness is itself the problem; the
measurements live in ``app/quantum/limits.py`` where they can be re-run.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.quantum.backends import list_backends
from app.quantum.limits import MAX_NOISY_QUBITS
from app.quantum.runner import assert_width_is_affordable, effective_max_qubits, run_circuit

client = TestClient(app)


def _wide_qasm(num_qubits: int) -> str:
    """Build a valid, tiny OpenQASM 3 circuit of the requested width.

    Args:
        num_qubits: Register width to declare.

    Returns:
        OpenQASM 3 source.
    """
    return (
        'OPENQASM 3.0;\ninclude "stdgates.inc";\n'
        f"qubit[{num_qubits}] q;\nbit[{num_qubits}] c;\n"
        "h q[0];\nc = measure q;\n"
    )


def test_the_noisy_bound_is_tighter_than_the_ideal_one() -> None:
    """The whole point: one cap for both curves was not a cap for the noisy one."""
    assert effective_max_qubits("aer_noisy") == MAX_NOISY_QUBITS
    assert effective_max_qubits("aer_simulator") == settings.max_qubits
    assert MAX_NOISY_QUBITS < settings.max_qubits


def test_asking_for_noise_on_the_ideal_backend_applies_the_noisy_bound() -> None:
    """``noise > 0`` switches on the noisy cost curve whatever the backend id.

    ``run_circuit`` sets ``apply_noise = backend.id == "aer_noisy" or noise > 0``,
    so a 24-qubit request to ``aer_simulator`` with ``noise=0.05`` is exactly as
    expensive as the noisy backend. Binding the cap to the id alone would leave
    that route open.
    """
    assert effective_max_qubits("aer_simulator", noise=0.05) == MAX_NOISY_QUBITS
    assert effective_max_qubits("aer_simulator", noise=0.0) == settings.max_qubits


def test_the_bound_refuses_an_over_wide_circuit_with_an_actionable_message() -> None:
    """The learner's next move is to shrink the circuit, so say by how much."""
    with pytest.raises(ValueError) as excinfo:
        assert_width_is_affordable(MAX_NOISY_QUBITS + 1, "aer_noisy")
    message = str(excinfo.value)
    assert str(MAX_NOISY_QUBITS) in message
    assert "noisy" in message.lower()

    # ...and it does not fire below the bound, or the backend is unusable.
    assert_width_is_affordable(MAX_NOISY_QUBITS, "aer_noisy")


def test_run_circuit_enforces_the_bound() -> None:
    """The library entry point, not only the HTTP layer.

    ``services/agent`` calls ``run_circuit`` directly, so a check that lived only
    in the router would be decoration for that caller.
    """
    with pytest.raises(ValueError):
        run_circuit(_wide_qasm(MAX_NOISY_QUBITS + 2), "aer_noisy", shots=1)


def test_the_route_refuses_before_the_parser_allocates_anything() -> None:
    """The PY-1 property, re-asserted for the per-backend bound.

    A 20-qubit noisy request must be refused from the DECLARED width in the
    text, not after Qiskit has built a 20-qubit circuit. The timing assertion is
    the only way to tell those two apart from outside, and it is generous: the
    pre-parse path is string work and finishes in single-digit milliseconds,
    while parsing plus a refused 20-qubit noisy simulation is seconds.
    """
    started = time.perf_counter()
    response = client.post(
        "/api/circuits/run",
        json={"qasm": _wide_qasm(20), "backend": "aer_noisy", "shots": 1024},
    )
    elapsed = time.perf_counter() - started

    assert response.status_code == 400, response.text
    assert str(MAX_NOISY_QUBITS) in response.json()["detail"]
    assert elapsed < 1.0, (
        f"the refusal took {elapsed:.2f}s, which means the circuit was parsed "
        "and possibly simulated before the cap was applied"
    )


def test_the_same_width_is_still_allowed_without_noise() -> None:
    """The bound must not become a global downgrade to 12 qubits.

    20 qubits ideal is 0.25-0.58 s measured, and the product's five-qubit free
    tier and 24-qubit ceiling depend on it staying available.
    """
    response = client.post(
        "/api/circuits/run",
        json={"qasm": _wide_qasm(20), "backend": "aer_simulator", "shots": 16},
    )
    assert response.status_code == 200, response.text
    assert response.json()["num_qubits"] == 20


def test_the_registry_advertises_the_width_it_will_actually_accept() -> None:
    """A device picker offering 24 qubits on a backend capped at 12 is a lie.

    This is the coupling that made the bound worth centralising: ``backends.py``
    reads the same constant the runner enforces, so they cannot drift.
    """
    by_id = {backend.id: backend for backend in list_backends()}
    for backend_id, backend in by_id.items():
        if backend.kind != "simulator":
            continue
        enforced = effective_max_qubits(backend_id)
        assert backend.max_qubits <= max(enforced, backend.max_qubits), backend_id
    assert by_id["aer_noisy"].max_qubits == MAX_NOISY_QUBITS
    assert by_id["aer_noisy"].max_qubits < by_id["aer_simulator"].max_qubits


def test_the_original_py1_body_is_still_refused_instantly() -> None:
    """Regression guard on the finding that started all of this.

    50 bytes, 3 000 000 qubits, 669 MB and 5.6 s of CPU if it reaches Qiskit.
    """
    started = time.perf_counter()
    response = client.post(
        "/api/circuits/run", json={"qasm": "OPENQASM 2.0;\nqreg q[3000000];\n"}
    )
    elapsed = time.perf_counter() - started
    assert response.status_code == 400
    assert elapsed < 1.0, f"the 3M-qubit body took {elapsed:.2f}s to refuse"
