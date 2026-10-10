"""Offline tests for the circuit runner.

Every test here runs on the bundled Aer simulator: no network access and no
optional vendor SDKs are required.
"""

from __future__ import annotations

import pytest

from app.quantum.presets import get_preset
from app.quantum.runner import run_circuit, statevector

SHOTS = 2000

X_GATE_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[1] q;
bit[1] c;
x q[0];
c = measure q;
"""


def _qasm(preset_id: str) -> str:
    """Fetch a preset's QASM source, failing loudly if the preset is missing.

    Args:
        preset_id: The preset key.

    Returns:
        The OpenQASM 3 source string.
    """
    preset = get_preset(preset_id)
    assert preset is not None, f"preset {preset_id} should exist"
    return preset["qasm"]


def test_bell_only_correlated_outcomes() -> None:
    """A Bell pair yields only 00 and 11, each near half the shots."""
    result = run_circuit(_qasm("bell"), shots=SHOTS)
    counts = result["counts"]

    assert set(counts) <= {"00", "11"}
    for label in ("00", "11"):
        fraction = counts.get(label, 0) / SHOTS
        assert 0.40 <= fraction <= 0.60, f"{label} fraction was {fraction}"


def test_ghz_only_all_same() -> None:
    """A GHZ state yields only the all-zero and all-one bitstrings."""
    result = run_circuit(_qasm("ghz"), shots=SHOTS)

    assert set(result["counts"]) <= {"000", "111"}
    assert sum(result["counts"].values()) == SHOTS


def test_x_gate_always_one() -> None:
    """An X gate on |0> is deterministic: every shot measures 1."""
    result = run_circuit(X_GATE_QASM, shots=512)

    assert result["counts"] == {"1": 512}


def test_invalid_qasm_raises() -> None:
    """Unparseable source raises ValueError rather than leaking a parser error."""
    with pytest.raises(ValueError):
        run_circuit("this is not qasm")


def test_shots_out_of_range_raises() -> None:
    """Shot counts below 1 or above the configured maximum are rejected."""
    with pytest.raises(ValueError):
        run_circuit(_qasm("bell"), shots=0)
    with pytest.raises(ValueError):
        run_circuit(_qasm("bell"), shots=999999)


def test_unknown_backend_raises() -> None:
    """An unrecognised backend id is rejected before any execution happens."""
    with pytest.raises(ValueError):
        run_circuit(_qasm("bell"), backend_id="nope")


def test_statevector_bell() -> None:
    """The Bell statevector has half the weight on |00> and half on |11>."""
    result = statevector(_qasm("bell"))
    probabilities = result["probabilities"]

    assert result["num_qubits"] == 2
    assert len(probabilities) == 4
    assert probabilities[0] == pytest.approx(0.5, abs=1e-6)
    assert probabilities[3] == pytest.approx(0.5, abs=1e-6)
    assert probabilities[1] == pytest.approx(0.0, abs=1e-6)
    assert probabilities[2] == pytest.approx(0.0, abs=1e-6)


def test_run_reports_metadata() -> None:
    """Results carry circuit metadata alongside the measurement statistics."""
    result = run_circuit(_qasm("superposition"), shots=256)

    for key in ("num_qubits", "depth", "duration_ms"):
        assert key in result

    assert result["num_qubits"] == 2
    assert result["depth"] >= 1
    assert result["duration_ms"] >= 0
    assert result["backend"] == "aer_simulator"
    assert len(result["labels"]) == len(result["probabilities"])
    assert sum(result["probabilities"]) == pytest.approx(1.0, abs=1e-6)
