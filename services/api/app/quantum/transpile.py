"""Vendor-neutral circuit analysis, cost estimation and transpilation.

Everything in this module is pure Qiskit: it never touches the network and
never imports a vendor SDK, so the UI can analyse, price and preview a circuit
long before any credentials exist. The hardware submission path in
:mod:`app.quantum.hardware` reuses :func:`transpile_for` so that what the user
is shown is what the device actually executes.
"""

from __future__ import annotations

from typing import Any

from qiskit import QuantumCircuit, transpile as qiskit_transpile

from app.quantum.runner import parse_qasm

# Indicative published per-shot prices in USD, transcribed by hand from the
# vendors' public pricing pages. These are NOT a live price feed and they are
# not a quote: rates change, and your actual invoice comes from AWS/IBM.
PER_SHOT_USD: dict[str, float] = {
    "ionq": 0.00003,
    "rigetti": 0.00035,
    "ibm": 0.0,
    # Quantinuum does not bill in dollars at all — it bills H-System Credits,
    # and the credit-to-currency rate depends on the customer's Azure agreement.
    # A per-shot USD figure would be an invention. The rate is left at zero and
    # estimate_cost() special-cases the vendor so the response says "we cannot
    # price this" instead of "this is free"; see _UNPRICED_VENDORS.
    "quantinuum": 0.0,
    "simulator": 0.0,
}

# Per-task (per-submission) fee in USD, charged once per job on Braket devices.
TASK_FEE_USD: dict[str, float] = {
    "ionq": 0.3,
    "rigetti": 0.3,
    "ibm": 0.0,
    "quantinuum": 0.0,
    "simulator": 0.0,
}

#: Vendors whose price this module genuinely does not know. Reporting is_free
#: for one of these would be a lie with a bill attached.
_UNPRICED_VENDORS: frozenset[str] = frozenset({"quantinuum"})

# Which vendor family each backend id belongs to, for pricing and basis gates.
#
# EVERY hardware id in app.quantum.hardware.BACKEND_PROVIDER must appear here.
# Five of them did not — ibm_kyiv, ibm_sherbrooke, ionq_forte,
# azure_quantinuum_h1, azure_ionq_aria — and vendor_for() defaults an unknown id
# to "simulator", which prices at zero. So /api/hardware/estimate told a user
# that an IonQ Forte run cost $0.00 and was "free: simulators run locally". The
# device picker offers those backends. tests/test_hardware.py::
# test_every_hardware_backend_is_priced fails if a new one is added without a
# vendor.
BACKEND_VENDOR: dict[str, str] = {
    "aer_simulator": "simulator",
    "aer_noisy": "simulator",
    "cirq_simulator": "simulator",
    "braket_local": "simulator",
    "ibm_quantum": "ibm",
    "ibm_brisbane": "ibm",
    "ibm_kyiv": "ibm",
    "ibm_sherbrooke": "ibm",
    "ionq_aria": "ionq",
    "ionq_forte": "ionq",
    "rigetti_ankaa": "rigetti",
    # Reached through an Azure Quantum workspace rather than Braket. Same
    # hardware for IonQ, different billing relationship; Quantinuum is priced in
    # credits, which is why it gets its own vendor family.
    "azure_ionq_aria": "ionq",
    "azure_quantinuum_h1": "quantinuum",
}

# Native basis gate sets per vendor family. IonQ's true native set
# (gpi/gpi2/ms) is not expressible through Qiskit's ``basis_gates`` argument,
# so it is declared here and falls back to a universal set at transpile time.
VENDOR_BASIS_GATES: dict[str, list[str]] = {
    "ibm": ["sx", "rz", "cx", "x"],
    "ionq": ["gpi", "gpi2", "ms"],
    "rigetti": ["rx", "rz", "cz"],
    "simulator": ["u", "cx"],
}

DEFAULT_BASIS_GATES: list[str] = ["u", "cx"]

# Gates Qiskit accepts through ``basis_gates``; anything outside this needs a
# vendor Target object, which we do not have without the SDK installed.
_STANDARD_BASIS_GATES: frozenset[str] = frozenset(
    {
        "u", "u1", "u2", "u3", "p", "rx", "ry", "rz", "x", "y", "z",
        "h", "s", "sdg", "t", "tdg", "sx", "sxdg", "id",
        "cx", "cy", "cz", "ch", "crx", "cry", "crz", "cp", "cu",
        "swap", "iswap", "ecr", "rzz", "rxx", "ryy", "rzx", "ccx",
    }
)

_NON_GATE_OPS: frozenset[str] = frozenset({"measure", "barrier", "reset", "delay"})

# The transpiled instruction list is returned to the UI so a submitted job can
# show "what the device actually ran" without the browser parsing OpenQASM. A
# pathological circuit can hold tens of thousands of instructions, and the list
# exists for a human to read, so it is capped; `sequence_truncated` says when
# the cap bit. 200 comfortably covers every preset and shared circuit today.
SEQUENCE_CAP: int = 200


def vendor_for(backend_id: str) -> str:
    """Map a backend id onto its vendor family.

    Args:
        backend_id: A backend identifier from the registry.

    Returns:
        One of ``"ibm"``, ``"ionq"``, ``"rigetti"`` or ``"simulator"``;
        unknown ids are treated as simulators (free, universal basis).
    """
    return BACKEND_VENDOR.get(backend_id, "simulator")


def basis_gates_for(backend_id: str) -> list[str]:
    """Return the declared native basis gate set for a backend.

    Args:
        backend_id: A backend identifier from the registry.

    Returns:
        The vendor's native gate names, which may include gates that Qiskit
        cannot target directly (see :func:`transpile_for`).
    """
    return list(VENDOR_BASIS_GATES.get(vendor_for(backend_id), DEFAULT_BASIS_GATES))


def _gate_counts(circuit: QuantumCircuit) -> dict[str, int]:
    """Count operations by name.

    Args:
        circuit: The circuit to inspect.

    Returns:
        A plain dict of operation name to occurrence count.
    """
    return {str(name): int(count) for name, count in circuit.count_ops().items()}


def _two_qubit_gate_count(circuit: QuantumCircuit) -> int:
    """Count entangling operations (two or more qubits, excluding barriers).

    Args:
        circuit: The circuit to inspect.

    Returns:
        The number of multi-qubit gate instances.
    """
    total = 0
    for instruction in circuit.data:
        if instruction.operation.name in _NON_GATE_OPS:
            continue
        if len(instruction.qubits) >= 2:
            total += 1
    return total


def _gate_sequence(
    circuit: QuantumCircuit, cap: int = SEQUENCE_CAP
) -> tuple[list[dict[str, Any]], bool]:
    """List a circuit's instructions in execution order, capped for display.

    Barriers are skipped (they are compiler directives, not operations the
    device performs); measurements are kept, because on real hardware the
    measurement is a physical operation with its own error rate and the UI
    should show it.

    Args:
        circuit: The circuit to walk.
        cap: Maximum number of entries to return.

    Returns:
        ``(sequence, truncated)`` where each entry is
        ``{"gate": name, "qubits": [indices]}`` and ``truncated`` is True when
        the circuit held more instructions than ``cap``.
    """
    sequence: list[dict[str, Any]] = []
    truncated = False
    for instruction in circuit.data:
        name = str(instruction.operation.name)
        if name == "barrier":
            continue
        if len(sequence) >= cap:
            truncated = True
            break
        sequence.append(
            {
                "gate": name,
                "qubits": [int(circuit.find_bit(q).index) for q in instruction.qubits],
            }
        )
    return sequence, truncated


def analyse_circuit(qasm: str) -> dict[str, Any]:
    """Report the structural properties of a circuit.

    Args:
        qasm: OpenQASM 3 (or 2) circuit source.

    Returns:
        A dictionary with ``num_qubits``, ``num_clbits``, ``depth``, ``size``
        (total gate count), ``gate_counts``, ``has_measurements`` and
        ``two_qubit_gates``.

    Raises:
        ValueError: When the source cannot be parsed.
    """
    circuit = parse_qasm(qasm)
    counts = _gate_counts(circuit)

    return {
        "num_qubits": int(circuit.num_qubits),
        "num_clbits": int(circuit.num_clbits),
        "depth": int(circuit.depth()),
        "size": int(circuit.size()),
        "gate_counts": counts,
        "has_measurements": "measure" in counts,
        "two_qubit_gates": _two_qubit_gate_count(circuit),
    }


def estimate_cost(backend_id: str, shots: int, num_qubits: int) -> dict[str, Any]:
    """Estimate what one submission of a circuit would cost.

    The model is deliberately transparent: ``total = per_shot * shots +
    task_fee``. It does not model per-qubit surcharges, reservation pricing or
    free-tier credits.

    Args:
        backend_id: The target backend id.
        shots: Number of repetitions the job would request.
        num_qubits: Circuit width, echoed back for the caller's convenience.

    Returns:
        ``{currency, backend, vendor, shots, num_qubits, per_shot, task_fee,
        estimated_total, is_free, note}``.

    Raises:
        ValueError: When ``shots`` is not a positive integer.
    """
    if not isinstance(shots, int) or isinstance(shots, bool) or shots < 1:
        raise ValueError(f"shots must be a positive integer, got {shots!r}.")

    vendor = vendor_for(backend_id)
    per_shot = PER_SHOT_USD.get(vendor, 0.0)
    task_fee = TASK_FEE_USD.get(vendor, 0.0)
    total = round(per_shot * shots + task_fee, 6)
    # A zero total means free ONLY when we actually know the price is zero.
    # For a vendor we cannot price, zero means "no number", and reporting that
    # as free is how somebody submits to a paid QPU believing it costs nothing.
    is_free = total == 0.0 and vendor not in _UNPRICED_VENDORS

    if vendor in _UNPRICED_VENDORS:
        note = (
            f"This service cannot price {vendor} runs. {vendor.title()} bills in "
            "H-System Credits through your Azure Quantum agreement, not in dollars, "
            "and the credit rate is specific to your contract. This is NOT free: "
            "check your Azure Quantum workspace's pricing before submitting."
        )
    elif is_free:
        note = (
            "No charge: simulators run locally and IBM's open plan is free "
            "(it is metered in QPU-seconds, not dollars)."
        )
    else:
        note = (
            "Indicative published rate, not a live price feed or a quote. "
            f"{vendor} bills roughly ${per_shot:.5f} per shot plus a "
            f"${task_fee:.2f} per-task fee; confirm against your provider's "
            "current pricing page before submitting."
        )

    return {
        "currency": "usd",
        "backend": backend_id,
        "vendor": vendor,
        "shots": shots,
        "num_qubits": int(num_qubits),
        "per_shot": per_shot,
        "task_fee": task_fee,
        "estimated_total": total,
        "is_free": is_free,
        "note": note,
    }


def transpile_for(qasm: str, backend_id: str, optimization_level: int = 1) -> dict[str, Any]:
    """Transpile a circuit into a backend's native gate set.

    Args:
        qasm: OpenQASM 3 (or 2) circuit source.
        backend_id: The target backend id, used to pick the basis gates.
        optimization_level: Qiskit optimisation level, 0..3.

    Returns:
        ``{backend, vendor, basis_gates, requested_basis_gates,
        optimization_level, qasm (transpiled, OpenQASM 3), depth_before,
        depth_after, gate_counts_before, gate_counts_after,
        two_qubit_gates_before, two_qubit_gates_after, num_qubits, notes,
        sequence, sequence_truncated}`` — ``sequence`` is the transpiled
        instruction list in execution order (see :func:`_gate_sequence`),
        capped at :data:`SEQUENCE_CAP` entries.

    Raises:
        ValueError: When the source cannot be parsed, the optimisation level is
            out of range, or Qiskit cannot transpile onto the target basis.
    """
    if optimization_level not in (0, 1, 2, 3):
        raise ValueError(f"optimization_level must be 0, 1, 2 or 3, got {optimization_level!r}.")

    circuit = parse_qasm(qasm)

    vendor = vendor_for(backend_id)
    requested = basis_gates_for(backend_id)
    notes: str | None = None

    basis = requested
    unsupported = [gate for gate in requested if gate not in _STANDARD_BASIS_GATES]
    if unsupported:
        basis = list(DEFAULT_BASIS_GATES)
        notes = (
            f"Qiskit cannot target {vendor}'s native gates "
            f"({', '.join(unsupported)}) without the vendor SDK's Target, so the "
            f"circuit was transpiled to {DEFAULT_BASIS_GATES} instead. The provider "
            "performs the final native translation server-side."
        )

    try:
        transpiled = qiskit_transpile(
            circuit,
            basis_gates=basis,
            optimization_level=optimization_level,
        )
    except Exception as exc:  # noqa: BLE001 - surfaced as a clean ValueError
        raise ValueError(
            f"Could not transpile the circuit for backend '{backend_id}' "
            f"onto basis {basis}: {exc}"
        ) from exc

    try:
        from qiskit import qasm3

        transpiled_qasm = qasm3.dumps(transpiled)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(
            f"The circuit was transpiled for '{backend_id}' but could not be "
            f"serialised back to OpenQASM 3: {exc}"
        ) from exc

    sequence, sequence_truncated = _gate_sequence(transpiled)

    return {
        "backend": backend_id,
        "vendor": vendor,
        "basis_gates": basis,
        "requested_basis_gates": requested,
        "optimization_level": optimization_level,
        "qasm": transpiled_qasm,
        "num_qubits": int(transpiled.num_qubits),
        "depth_before": int(circuit.depth()),
        "depth_after": int(transpiled.depth()),
        "gate_counts_before": _gate_counts(circuit),
        "gate_counts_after": _gate_counts(transpiled),
        "two_qubit_gates_before": _two_qubit_gate_count(circuit),
        "two_qubit_gates_after": _two_qubit_gate_count(transpiled),
        "notes": notes,
        "sequence": sequence,
        "sequence_truncated": sequence_truncated,
    }
