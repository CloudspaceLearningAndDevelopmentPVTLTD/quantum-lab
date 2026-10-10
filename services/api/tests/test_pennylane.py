"""Offline tests for the PennyLane middleware and the Azure Quantum backend.

Nothing here touches the network. The PennyLane tests run on the bundled
``lightning.qubit`` simulator; the Azure tests deliberately clear every
credential so the unconfigured paths are what gets exercised.

The bit-order test is the reason this file exists: PennyLane writes wire 0 as
the leftmost character of a bitstring while this project labels qubit 0 as the
least significant (rightmost) bit. Getting that wrong mirrors every multi-qubit
result silently, so it is asserted explicitly with an asymmetric state.
"""

from __future__ import annotations

import pytest

from app.quantum.azure import azure_available, list_azure_targets, submit_azure_job
from app.quantum.pennylane_runner import qasm_to_pennylane, run_with_pennylane
from app.quantum.presets import get_preset
from app.quantum.runner import run_circuit

SHOTS = 2000

# X on qubit 0 of a two-qubit register. Qubit 0 is the LEAST significant bit,
# so the only correct answer is "01"; PennyLane natively reports "10".
ASYMMETRIC_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
x q[0];
c = measure q;
"""

GHZ3_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[3] q;
bit[3] c;
h q[0];
cx q[0], q[1];
cx q[1], q[2];
c = measure q;
"""

# u3 is deliberately outside the translation map, so this circuit must fall
# back to the Qiskit engine rather than failing.
UNSUPPORTED_GATE_QASM = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[1];
u3(pi,0,pi) q[0];
measure q -> c;
"""

# The key set run_circuit() has always returned, plus the additive `engine` key.
EXPECTED_RESULT_KEYS = {
    "counts",
    "probabilities",
    "labels",
    "shots",
    "backend",
    "duration_ms",
    "num_qubits",
    "depth",
    "notes",
    "engine",
}

AZURE_ENV_VARS = (
    "AZURE_QUANTUM_RESOURCE_ID",
    "AZURE_QUANTUM_LOCATION",
)


def _bell() -> str:
    """Return the Bell preset's QASM source.

    Returns:
        OpenQASM 3 source for a two-qubit Bell pair.
    """
    preset = get_preset("bell")
    assert preset is not None, "the bell preset should exist"
    return preset["qasm"]


@pytest.fixture
def no_azure_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clear every Azure Quantum credential from the environment and settings.

    Args:
        monkeypatch: pytest's environment patcher.
    """
    from app.core.config import settings

    for name in AZURE_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
        # Settings ignores unknown keys, so these usually are not fields at all;
        # only blank one out when a deployment has actually declared it.
        if name.lower() in type(settings).model_fields:
            monkeypatch.setattr(settings, name.lower(), None)


def test_qasm_to_pennylane_builds_bell() -> None:
    """Translating a Bell circuit reports two wires and produces a callable."""
    wires, apply = qasm_to_pennylane(_bell())

    assert wires == 2
    assert callable(apply)


def test_pennylane_bell_only_correlated_outcomes() -> None:
    """A Bell pair run through PennyLane yields only 00 and 11, each near half."""
    result = run_with_pennylane(_bell(), "aer_simulator", SHOTS)
    counts = result["counts"]

    assert set(counts) <= {"00", "11"}
    assert sum(counts.values()) == SHOTS
    for label in ("00", "11"):
        fraction = counts.get(label, 0) / SHOTS
        assert 0.40 <= fraction <= 0.60, f"{label} fraction was {fraction}"


def test_pennylane_bit_order_qubit_zero_is_least_significant() -> None:
    """X on qubit 0 of a 2-qubit register must report "01", never "10"."""
    result = run_with_pennylane(ASYMMETRIC_QASM, "aer_simulator", 256)

    assert result["counts"] == {"01": 256}
    assert "10" not in result["counts"]


def test_pennylane_ghz_only_all_same() -> None:
    """A 3-qubit GHZ state run through PennyLane yields only 000 and 111."""
    result = run_with_pennylane(GHZ3_QASM, "aer_simulator", SHOTS)

    assert set(result["counts"]) <= {"000", "111"}
    assert sum(result["counts"].values()) == SHOTS


def test_unsupported_gate_raises_value_error() -> None:
    """A gate outside the translation map raises ValueError naming the gate."""
    with pytest.raises(ValueError) as excinfo:
        qasm_to_pennylane(UNSUPPORTED_GATE_QASM)

    assert "u3" in str(excinfo.value).lower()


def test_run_circuit_uses_pennylane_for_aer_simulator() -> None:
    """The default simulator path is routed through PennyLane end to end."""
    result = run_circuit(_bell(), backend_id="aer_simulator", shots=512)

    assert result["engine"] == "pennylane"
    assert set(result["counts"]) <= {"00", "11"}
    assert "pennylane" in (result["notes"] or "").lower()


def test_run_circuit_returns_the_full_original_key_set() -> None:
    """The result contract is unchanged apart from the additive `engine` key."""
    result = run_circuit(_bell(), backend_id="aer_simulator", shots=256)

    assert set(result) == EXPECTED_RESULT_KEYS
    assert result["backend"] == "aer_simulator"
    assert result["shots"] == 256
    assert len(result["labels"]) == len(result["probabilities"])


def test_untranslatable_circuit_falls_back_to_qiskit() -> None:
    """A circuit PennyLane cannot translate still runs, and reports engine qiskit."""
    result = run_circuit(UNSUPPORTED_GATE_QASM, backend_id="aer_simulator", shots=256)

    assert result["engine"] == "qiskit"
    # u3(pi, 0, pi) is an X gate, so every shot must measure 1.
    assert result["counts"] == {"1": 256}


def test_azure_unavailable_without_credentials(no_azure_credentials: None) -> None:
    """Without a workspace id or location, Azure reports itself unavailable."""
    available, reason = azure_available()

    assert available is False
    assert "AZURE_QUANTUM_RESOURCE_ID" in reason or "azure-quantum" in reason


def test_list_azure_targets_returns_static_catalogue(no_azure_credentials: None) -> None:
    """The catalogue is served with every documented key when Azure is unconfigured."""
    targets = list_azure_targets()
    ids = {target["id"] for target in targets}

    assert {
        "quantinuum.qpu.h1-1",
        "quantinuum.sim.h1-1e",
        "ionq.qpu.aria-1",
        "ionq.simulator",
    } <= ids

    for target in targets:
        assert set(target) >= {
            "id",
            "name",
            "provider",
            "qubits",
            "technology",
            "available",
            "reason",
            "source",
        }
        assert target["available"] is False
        assert target["source"] == "catalogue"
        assert target["reason"]


def test_submit_azure_job_raises_value_error_without_credentials(
    no_azure_credentials: None,
) -> None:
    """Submission without configuration is a ValueError, never a bare ImportError."""
    with pytest.raises(ValueError) as excinfo:
        submit_azure_job(_bell(), "quantinuum.qpu.h1-1", 100)

    message = str(excinfo.value)
    assert "azure-quantum" in message or "AZURE_QUANTUM_RESOURCE_ID" in message
