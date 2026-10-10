"""Offline tests for circuit analysis, cost estimation and the hardware layer.

Nothing here touches the network and nothing requires a vendor SDK. Every test
clears the credential environment variables (and the cached settings object)
first, so the results do not depend on the developer's shell.
"""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.quantum import hardware
from app.quantum.transpile import (
    DEFAULT_BASIS_GATES,
    analyse_circuit,
    estimate_cost,
    transpile_for,
)

BELL_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c = measure q;
"""

_CREDENTIAL_ENV_VARS = (
    "IBM_QUANTUM_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_PROFILE",
    "AWS_ROLE_ARN",
    "BRAKET_S3_BUCKET",
)

# Operation names that are not gates and so are exempt from basis-set checks.
_NON_GATES = {"measure", "barrier", "reset", "delay"}


@pytest.fixture(autouse=True)
def _no_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clear every vendor credential so the tests are deterministic.

    Args:
        monkeypatch: pytest's environment patcher.
    """
    for name in _CREDENTIAL_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(settings, "ibm_quantum_token", None, raising=False)
    monkeypatch.setattr(settings, "aws_access_key_id", None, raising=False)


def test_analyse_bell_circuit() -> None:
    """A Bell pair is reported as 2 qubits, depth >= 2, with exactly one cx."""
    analysis = analyse_circuit(BELL_QASM)

    assert analysis["num_qubits"] == 2
    assert analysis["depth"] >= 2
    assert analysis["gate_counts"]["cx"] == 1
    assert analysis["two_qubit_gates"] == 1
    assert analysis["has_measurements"] is True


def test_analyse_garbage_raises() -> None:
    """Unparseable source raises ValueError rather than a parser exception."""
    with pytest.raises(ValueError):
        analyse_circuit("definitely not a quantum circuit")


def test_estimate_simulator_is_free() -> None:
    """Simulators cost nothing, however many shots are requested."""
    estimate = estimate_cost("aer_simulator", 10_000, 2)

    assert estimate["is_free"] is True
    assert estimate["estimated_total"] == 0
    assert estimate["currency"] == "usd"


def test_estimate_ionq_includes_task_fee() -> None:
    """IonQ pricing is per-shot plus a fixed per-task fee."""
    estimate = estimate_cost("ionq_aria", 1000, 2)

    assert estimate["estimated_total"] > 0
    assert estimate["is_free"] is False
    assert estimate["task_fee"] == pytest.approx(0.3)
    assert estimate["estimated_total"] == pytest.approx(
        estimate["per_shot"] * 1000 + estimate["task_fee"]
    )
    assert estimate["estimated_total"] > estimate["task_fee"]


def test_transpile_default_basis() -> None:
    """Transpiling to the default basis emits only gates from that basis."""
    result = transpile_for(BELL_QASM, "aer_simulator")

    assert result["basis_gates"] == DEFAULT_BASIS_GATES
    emitted = {name for name in result["gate_counts_after"] if name not in _NON_GATES}
    assert emitted <= set(DEFAULT_BASIS_GATES), emitted
    assert result["depth_before"] >= 1
    assert result["depth_after"] >= 1
    assert "OPENQASM" in result["qasm"]


def test_transpile_ionq_falls_back_to_universal_basis() -> None:
    """IonQ's native gates are not Qiskit-targetable, so a fallback is reported."""
    result = transpile_for(BELL_QASM, "ionq_aria")

    assert result["requested_basis_gates"] == ["gpi", "gpi2", "ms"]
    assert result["basis_gates"] == DEFAULT_BASIS_GATES
    assert result["notes"] is not None


def test_transpile_rejects_bad_optimization_level() -> None:
    """An out-of-range optimisation level is rejected with ValueError."""
    with pytest.raises(ValueError):
        transpile_for(BELL_QASM, "aer_simulator", optimization_level=9)


def test_list_hardware_devices_falls_back_to_catalogue() -> None:
    """Without credentials every device comes from the static catalogue."""
    devices = hardware.list_hardware_devices()

    assert devices, "the catalogue should never be empty"
    for device in devices:
        assert device["source"] == "catalogue"
        assert device["available"] is False
        assert device["reason"]
        for key in ("provider", "qubits", "technology"):
            assert key in device, f"{device['id']} is missing {key}"

    by_id = {device["id"]: device for device in devices}
    assert by_id["ibm_brisbane"]["qubits"] == 127
    assert by_id["ionq_aria"]["technology"] == "trapped-ion"
    assert by_id["rigetti_ankaa"]["qubits"] == 84


def test_is_hardware_available_without_token() -> None:
    """IBM hardware is unavailable and the reason names the token."""
    available, reason = hardware.is_hardware_available("ibm_brisbane")

    assert available is False
    assert "IBM_QUANTUM_TOKEN" in reason


def test_is_hardware_available_unknown_backend() -> None:
    """An unknown backend id is reported as unavailable, not raised."""
    available, reason = hardware.is_hardware_available("not_a_device")

    assert available is False
    assert "not a hardware backend" in reason


def test_submit_ibm_without_token_raises_value_error() -> None:
    """Submitting with no SDK and no token raises ValueError, never ImportError."""
    with pytest.raises(ValueError) as excinfo:
        hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", 100)

    message = str(excinfo.value)
    assert "qiskit-ibm-runtime" in message or "IBM_QUANTUM_TOKEN" in message


def test_submit_braket_without_credentials_raises_value_error() -> None:
    """The Braket path fails the same way: a clear ValueError, not a crash."""
    with pytest.raises(ValueError) as excinfo:
        hardware.submit_braket_job(BELL_QASM, "ionq_aria", 100)

    message = str(excinfo.value)
    assert "amazon-braket-sdk" in message or "AWS_ACCESS_KEY_ID" in message


def test_missing_dependency_is_a_value_error() -> None:
    """MissingDependency stays catchable by existing ValueError handlers."""
    assert issubclass(hardware.MissingDependency, ValueError)
