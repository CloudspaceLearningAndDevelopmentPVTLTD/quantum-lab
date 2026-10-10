"""Tests for the ordered gate sequence surfaced by transpile_for.

The sequence exists so the hardware UI can show a submitted job's "what the
device actually ran" without parsing OpenQASM in the browser. Everything here
is offline pure Qiskit — no SDK, no network.
"""

from __future__ import annotations

from app.quantum.transpile import SEQUENCE_CAP, transpile_for

BELL_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c = measure q;
"""


def _long_qasm(gates: int) -> str:
    """A single-qubit circuit with `gates` X gates, to exercise the cap."""
    body = "\n".join("x q[0];" for _ in range(gates))
    return f'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\n{body}\n'


def test_sequence_is_present_ordered_and_typed() -> None:
    result = transpile_for(BELL_QASM, "ibm_brisbane")
    sequence = result["sequence"]

    assert isinstance(sequence, list) and len(sequence) > 0
    assert result["sequence_truncated"] is False

    for entry in sequence:
        assert isinstance(entry["gate"], str) and entry["gate"]
        assert isinstance(entry["qubits"], list)
        assert all(isinstance(index, int) for index in entry["qubits"])
        # Two qubits in the circuit, so no index can point past them.
        assert all(0 <= index < result["num_qubits"] for index in entry["qubits"])


def test_sequence_matches_the_declared_basis() -> None:
    """Every gate in the sequence is either in the basis or a measurement.

    This is the property the UI relies on when it captions the list "the
    device's native operations": if the sequence could contain gates outside
    the basis the caption would be a lie.
    """
    result = transpile_for(BELL_QASM, "ibm_brisbane")
    allowed = set(result["basis_gates"]) | {"measure", "reset", "delay"}
    assert all(entry["gate"] in allowed for entry in result["sequence"])


def test_sequence_agrees_with_gate_counts() -> None:
    """The sequence and gate_counts_after describe the same circuit."""
    result = transpile_for(BELL_QASM, "ibm_brisbane")
    counted = sum(result["gate_counts_after"].values())
    barriers = result["gate_counts_after"].get("barrier", 0)
    # Barriers are counted by count_ops but deliberately absent from the
    # sequence (they are compiler directives, not device operations).
    assert len(result["sequence"]) == counted - barriers


def test_sequence_is_capped_and_flagged() -> None:
    result = transpile_for(_long_qasm(SEQUENCE_CAP + 60), "aer_simulator", optimization_level=0)
    assert len(result["sequence"]) <= SEQUENCE_CAP
    assert result["sequence_truncated"] is True


def test_short_circuit_is_not_flagged_truncated() -> None:
    result = transpile_for(_long_qasm(3), "aer_simulator", optimization_level=0)
    assert result["sequence_truncated"] is False
    assert len(result["sequence"]) == 3
