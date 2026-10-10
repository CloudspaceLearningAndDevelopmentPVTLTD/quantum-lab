"""Named example circuits, expressed as OpenQASM 3 source."""

from __future__ import annotations

from typing import Any

PRESETS: dict[str, dict[str, str]] = {
    "bell": {
        "name": "Bell State",
        "description": (
            "The canonical two-qubit entangled pair. Measuring gives only 00 or 11, "
            "each about half the time — the two qubits are perfectly correlated."
        ),
        "qasm": """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c = measure q;
""",
    },
    "ghz": {
        "name": "GHZ State",
        "description": (
            "A three-qubit Greenberger-Horne-Zeilinger state. All three qubits agree: "
            "outcomes are only 000 or 111."
        ),
        "qasm": """OPENQASM 3.0;
include "stdgates.inc";
qubit[3] q;
bit[3] c;
h q[0];
cx q[0], q[1];
cx q[1], q[2];
c = measure q;
""",
    },
    "superposition": {
        "name": "Uniform Superposition",
        "description": (
            "A Hadamard on every qubit puts the register into an equal superposition, "
            "so all four bitstrings appear with roughly equal probability."
        ),
        "qasm": """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
h q[1];
c = measure q;
""",
    },
    "grover2": {
        "name": "Grover Search (2 qubits)",
        "description": (
            "One Grover iteration over two qubits with an oracle marking |11>. "
            "A single iteration is exact here, so the answer 11 is found with certainty."
        ),
        "qasm": """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
h q[1];
cz q[0], q[1];
h q[0];
h q[1];
x q[0];
x q[1];
cz q[0], q[1];
x q[0];
x q[1];
h q[0];
h q[1];
c = measure q;
""",
    },
    "interference": {
        "name": "Single-Qubit Interference",
        "description": (
            "Hadamard, a phase rotation, then another Hadamard. The relative phase "
            "interferes on recombination and biases the measurement statistics."
        ),
        "qasm": """OPENQASM 3.0;
include "stdgates.inc";
qubit[1] q;
bit[1] c;
h q[0];
// phase of pi/3 radians
p(1.0471975512) q[0];
h q[0];
c = measure q;
""",
    },
    "teleport": {
        "name": "Quantum Teleportation",
        "description": (
            "Teleports the state of q[0] onto q[2] using an entangled pair and the "
            "deferred-measurement form of the corrections, so it runs on any backend."
        ),
        "qasm": """OPENQASM 3.0;
include "stdgates.inc";
qubit[3] q;
bit[3] c;
// prepare an arbitrary state on q[0] to be teleported (pi/4 radians)
ry(0.7853981634) q[0];
h q[1];
cx q[1], q[2];
cx q[0], q[1];
h q[0];
cx q[1], q[2];
cz q[0], q[2];
c = measure q;
""",
    },
}


def list_presets() -> list[dict[str, Any]]:
    """Return every preset circuit, each carrying its own id.

    Returns:
        A list of ``{id, name, description, qasm}`` dictionaries.
    """
    return [{"id": preset_id, **payload} for preset_id, payload in PRESETS.items()]


def get_preset(preset_id: str) -> dict[str, Any] | None:
    """Look up a single preset by id.

    Args:
        preset_id: The preset key, e.g. ``"bell"``.

    Returns:
        The ``{id, name, description, qasm}`` dictionary, or None when unknown.
    """
    payload = PRESETS.get(preset_id)
    if payload is None:
        return None
    return {"id": preset_id, **payload}
