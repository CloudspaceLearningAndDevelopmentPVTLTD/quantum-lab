"""PennyLane middleware: one integration instead of one per vendor.

The platform's architecture calls for a single quantum middleware layer rather
than a hand-written adapter per SDK: *"Use PennyLane as your unified quantum
middleware — it wraps Qiskit, Cirq, Braket, and others under one API. Your
platform talks to PennyLane; PennyLane routes to whichever backend the user
picks."*

This module is that layer. It translates the OpenQASM the rest of the service
already parses (via :func:`app.quantum.runner.parse_qasm`) into PennyLane gate
calls, executes them on whichever PennyLane device a backend id maps to, and
normalises the answer into the exact result dictionary
:func:`app.quantum.runner.run_circuit` has always returned.

Two things are deliberate and load-bearing:

* **Every import is lazy.** PennyLane and each device plugin are imported inside
  the function that needs them, so a missing plugin degrades into a clear
  message naming the pip package instead of an import crash at start-up.
* **Translation fails loudly.** An unsupported gate raises :class:`ValueError`
  during translation, before anything executes, so the caller can fall back to
  the Qiskit path rather than silently returning a wrong distribution.
"""

from __future__ import annotations

import math
import time
from functools import lru_cache
from typing import Any, Callable

from qiskit import QuantumCircuit

from app.quantum.limits import MAX_STATEVECTOR_QUBITS
from app.quantum.runner import _ensure_measured, parse_qasm

# Backend id -> PennyLane device string. Adding a simulator backend to the
# platform is a single line here; nothing else in the execution path changes.
PENNYLANE_DEVICES: dict[str, str] = {
    # PennyLane's own high-performance C++ statevector simulator.
    "aer_simulator": "lightning.qubit",
    # `aer_noisy` is absent on purpose. Noise is modelled in exactly one place —
    # app/quantum/runner.py's build_device_noise_model — and served by Aer. See
    # the block comment in run_with_pennylane for why two models was a bug.
    #
    # Google Cirq, reached through the pennylane-cirq plugin.
    "cirq_simulator": "cirq.simulator",
    # Amazon Braket's local simulator, through the amazon-braket-pennylane-plugin.
    "braket_local": "braket.local.qubit",
    # Hardware ids are intentionally absent: real QPUs are queued and go through
    # the asynchronous submit/poll path in app.quantum.hardware and app.quantum.azure.
}

# PennyLane device string -> (importable module, pip package) needed to provide it.
_DEVICE_PLUGINS: dict[str, tuple[str, str]] = {
    "lightning.qubit": ("pennylane_lightning", "pennylane-lightning"),
    "cirq.simulator": ("pennylane_cirq", "pennylane-cirq"),
    "braket.local.qubit": ("braket.pennylane_plugin", "amazon-braket-pennylane-plugin"),
}


def _module_importable(name: str) -> bool:
    """Report whether a module can be located without importing it.

    Args:
        name: A module name, possibly dotted, e.g. ``"braket.pennylane_plugin"``.

    Returns:
        True when the module is installed.
    """
    import importlib.util

    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, ModuleNotFoundError, AttributeError):
        return False


@lru_cache(maxsize=1)
def is_pennylane_available() -> bool:
    """Report whether PennyLane itself can be imported, caching the answer.

    Returns:
        True when ``import pennylane`` succeeds.
    """
    try:
        import pennylane  # noqa: F401
    except ImportError:
        return False
    return True


def device_available(backend_id: str) -> tuple[bool, str]:
    """Check whether PennyLane can serve a given platform backend id.

    Both halves are checked: PennyLane must import, and the specific device
    plugin backing this backend must be installed too. No device is constructed
    and no network call is made.

    Args:
        backend_id: A backend id from the registry, e.g. ``"aer_simulator"``.

    Returns:
        ``(available, reason)``. ``reason`` names the missing pip package when
        unavailable, and is a short confirmation when available.
    """
    device_name = PENNYLANE_DEVICES.get(backend_id)
    if device_name is None:
        return False, (
            f"Backend '{backend_id}' has no PennyLane device mapping; it runs through the "
            "Qiskit path or the asynchronous hardware path."
        )

    if not is_pennylane_available():
        return False, (
            "PennyLane is not installed. Install it with 'pip install pennylane'."
        )

    module, package = _DEVICE_PLUGINS[device_name]
    if not _module_importable(module):
        return False, (
            f"The PennyLane device '{device_name}' needs the {module} plugin. "
            f"Install it with 'pip install {package}'."
        )

    return True, f"PennyLane can run '{backend_id}' on device '{device_name}'."


# ---------------------------------------------------------------------------
# QASM -> PennyLane translation
# ---------------------------------------------------------------------------

# Qiskit instruction name -> (PennyLane operation attribute, number of angle
# parameters, fixed extra angle factor). The gate set is deliberately explicit:
# anything not listed raises so the caller can fall back to Qiskit.
_ZERO_PARAM_GATES: dict[str, str] = {
    "h": "Hadamard",
    "x": "PauliX",
    "y": "PauliY",
    "z": "PauliZ",
    "s": "S",
    "t": "T",
    "cx": "CNOT",
    "cy": "CY",
    "cz": "CZ",
    "swap": "SWAP",
    "ccx": "Toffoli",
}

# Rotation-style gates: one angle, one wire.
_ONE_PARAM_GATES: dict[str, str] = {
    "rx": "RX",
    "ry": "RY",
    "rz": "RZ",
    "p": "PhaseShift",
    "u1": "PhaseShift",
}

# Daggered Clifford/T gates expressed exactly as negative phase shifts:
# S = PhaseShift(pi/2) and T = PhaseShift(pi/4), so their adjoints are the
# same gate with a negated angle (no global-phase discrepancy).
_ADJOINT_PHASE_GATES: dict[str, float] = {
    "sdg": -math.pi / 2,
    "tdg": -math.pi / 4,
}

# Instructions that carry no unitary action in the PennyLane picture. A
# measurement is expressed by what the QNode returns, not by an inline op.
_IGNORED_INSTRUCTIONS: frozenset[str] = frozenset({"barrier", "measure", "delay", "id"})

# A translated operation: (PennyLane op class, angle parameters, wire indices).
_Operation = tuple[Any, list[float], list[int]]


def _angles(instruction: Any, name: str, expected: int) -> list[float]:
    """Extract numeric angle parameters from a Qiskit instruction.

    Args:
        instruction: A ``CircuitInstruction`` from ``circuit.data``.
        name: The gate name, used in the error message.
        expected: How many parameters this gate must have.

    Returns:
        The parameters as plain floats.

    Raises:
        ValueError: When the count is wrong or a parameter is still symbolic.
    """
    params = list(instruction.operation.params)
    if len(params) != expected:
        raise ValueError(
            f"PennyLane translation expected {expected} parameter(s) for gate "
            f"'{name}' but the circuit supplied {len(params)}."
        )
    try:
        return [float(param) for param in params]
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"Gate '{name}' has a non-numeric (symbolic) parameter, which the "
            f"PennyLane translator cannot bind: {exc}"
        ) from exc


def _translate_circuit(circuit: QuantumCircuit) -> list[_Operation]:
    """Translate a Qiskit circuit into an ordered list of PennyLane operations.

    Args:
        circuit: The parsed circuit.

    Returns:
        A list of ``(op_class, params, wires)`` tuples in execution order.

    Raises:
        ValueError: On any gate outside the supported set, on a symbolic
            parameter, or on a measurement whose qubit and classical bit
            indices disagree (PennyLane returns whole-register samples, so a
            permuted measurement map cannot be reproduced faithfully).
    """
    import pennylane as qml

    if circuit.num_clbits not in (0, circuit.num_qubits):
        raise ValueError(
            f"PennyLane samples the whole {circuit.num_qubits}-qubit register, but this "
            f"circuit declares {circuit.num_clbits} classical bit(s); the Qiskit path "
            "reproduces partial measurement correctly."
        )

    operations: list[_Operation] = []
    for instruction in circuit.data:
        name = instruction.operation.name.lower()
        wires = [circuit.find_bit(qubit).index for qubit in instruction.qubits]

        if name == "measure":
            # Only an identity qubit->clbit map keeps the bitstring meaning intact.
            clbits = [circuit.find_bit(clbit).index for clbit in instruction.clbits]
            if clbits != wires:
                raise ValueError(
                    f"Measurement maps qubit {wires} onto classical bit {clbits}; the "
                    "PennyLane translator only supports the identity mapping."
                )
            continue
        if name in _IGNORED_INSTRUCTIONS:
            continue

        if name in _ZERO_PARAM_GATES:
            operations.append((getattr(qml, _ZERO_PARAM_GATES[name]), [], wires))
        elif name in _ONE_PARAM_GATES:
            operations.append(
                (getattr(qml, _ONE_PARAM_GATES[name]), _angles(instruction, name, 1), wires)
            )
        elif name in _ADJOINT_PHASE_GATES:
            operations.append((qml.PhaseShift, [_ADJOINT_PHASE_GATES[name]], wires))
        else:
            raise ValueError(
                f"Gate '{name}' is not in the PennyLane translation map "
                "(supported: h, x, y, z, s, sdg, t, tdg, rx, ry, rz, p/u1, cx, cy, cz, "
                "swap, ccx, barrier, measure)."
            )

    return operations


def _apply_all(operations: list[_Operation]) -> None:
    """Queue every translated operation inside the active PennyLane tape.

    Args:
        operations: The output of :func:`_translate_circuit`.
    """
    for op_class, params, wires in operations:
        op_class(*params, wires=wires)


def qasm_to_pennylane(qasm: str) -> tuple[int, Callable[[], None]]:
    """Translate OpenQASM into a PennyLane gate-application callable.

    The QASM is parsed with the service's existing
    :func:`app.quantum.runner.parse_qasm` — this module never re-implements
    parsing — and the resulting Qiskit instructions are converted eagerly, so an
    unsupported gate is reported before anything executes.

    Args:
        qasm: OpenQASM 3 (or 2) source.

    Returns:
        ``(num_wires, apply)``. Calling ``apply()`` inside a QNode queues the
        circuit's gates; it returns nothing, because the measurement is
        expressed by whatever the QNode itself returns.

    Raises:
        ValueError: When the source cannot be parsed, or contains a gate the
            translator does not support (the message names the gate).
    """
    circuit = parse_qasm(qasm)
    operations = _translate_circuit(circuit)

    def apply() -> None:
        """Queue this circuit's translated gates into the enclosing QNode."""
        _apply_all(operations)

    return circuit.num_qubits, apply


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------


def _to_project_bitstring(pennylane_key: str) -> str:
    """Convert a PennyLane sample label into this project's bit convention.

    THE BIT ORDER TRAP: PennyLane writes wire 0 as the **leftmost** character of
    its bitstring, whereas this project (following Qiskit) labels qubit 0 as the
    **least significant**, i.e. the **rightmost** character. Reversing the string
    is therefore mandatory, not cosmetic: an X on qubit 0 of a two-qubit register
    comes back from PennyLane as ``"10"`` and must be reported as ``"01"``.
    Skipping this mirrors every multi-qubit result silently.

    Args:
        pennylane_key: A PennyLane counts key, wire 0 first.

    Returns:
        The same outcome with qubit 0 as the last character.
    """
    return str(pennylane_key)[::-1]


def _normalise_counts(raw: dict[Any, Any]) -> dict[str, int]:
    """Convert PennyLane counts into plain, correctly ordered Python counts.

    Args:
        raw: The dictionary returned by ``qml.counts()``; keys are NumPy strings
            and values NumPy integers.

    Returns:
        Counts keyed by MSB-first bitstrings with zero-count entries dropped.
    """
    counts: dict[str, int] = {}
    for key, value in raw.items():
        total = int(value)
        if total <= 0:
            continue
        label = _to_project_bitstring(key)
        counts[label] = counts.get(label, 0) + total
    return counts


def _make_device(device_name: str, wires: int) -> Any:
    """Instantiate a PennyLane device, turning plugin absence into ValueError.

    Args:
        device_name: A PennyLane device string, e.g. ``"lightning.qubit"``.
        wires: The number of wires the circuit needs.

    Returns:
        The constructed device.

    Raises:
        ValueError: When PennyLane or the device plugin is not installed.
    """
    try:
        import pennylane as qml
    except ImportError as exc:
        raise ValueError(
            f"PennyLane is not installed. Install it with 'pip install pennylane'. "
            f"(import error: {exc})"
        ) from exc

    module, package = _DEVICE_PLUGINS.get(device_name, ("pennylane", "pennylane"))
    if not _module_importable(module):
        raise ValueError(
            f"The PennyLane device '{device_name}' requires the {module} plugin. "
            f"Install it with 'pip install {package}'."
        )

    try:
        return qml.device(device_name, wires=wires)
    except Exception as exc:  # noqa: BLE001 - plugin registration failures vary
        raise ValueError(
            f"PennyLane could not create the device '{device_name}': {exc}"
        ) from exc


def run_with_pennylane(
    qasm: str,
    backend_id: str,
    shots: int = 1024,
    noise: float = 0.0,
) -> dict[str, Any]:
    """Execute a circuit through PennyLane and return the standard result dict.

    Args:
        qasm: OpenQASM 3 (or 2) source.
        backend_id: A backend id present in :data:`PENNYLANE_DEVICES`.
        shots: Number of repetitions.
        noise: Depolarising strength in [0, 0.5]; only the density-matrix device
            (``aer_noisy``) can apply it.

    Returns:
        The same dictionary shape :func:`app.quantum.runner.run_circuit`
        returns: counts, probabilities, labels, shots, backend, duration_ms,
        num_qubits, depth, notes — plus ``engine`` set to ``"pennylane"``.

    Raises:
        ValueError: When the backend has no PennyLane device, when the circuit
            contains an untranslatable gate, or when the device/plugin is
            missing. Callers treat this as "fall back to Qiskit".
    """
    import pennylane as qml

    device_name = PENNYLANE_DEVICES.get(backend_id)
    if device_name is None:
        raise ValueError(
            f"Backend '{backend_id}' is not mapped to a PennyLane device; "
            f"mapped ids are: {', '.join(sorted(PENNYLANE_DEVICES))}."
        )

    circuit = parse_qasm(qasm)
    operations = _translate_circuit(circuit)
    wires = circuit.num_qubits
    # depth() is taken from the measured circuit so the reported value matches
    # the Qiskit path exactly.
    depth = _ensure_measured(circuit).depth()

    # ── NOISE IS NOT SERVED HERE, AND THAT IS THE FIX ──────────────────────
    #
    # This path used to accept noisy circuits on `default.mixed` and model them
    # as one DepolarizingChannel per wire appended AFTER the whole circuit. Aer
    # models noise per gate, with thermal relaxation and readout error. Those
    # are different physics: a 20-gate circuit got 3 channels on the PennyLane
    # engine and 20-plus on the Qiskit one. Which engine ran was decided by
    # whether a plugin happened to be installed, so the SAME request on the SAME
    # backend id returned materially different distributions on two deployments,
    # and nothing told the learner which they had.
    #
    # There is now exactly one noise model, in app/quantum/runner.py, grounded
    # in published device calibration. Raising here is not a failure: run_circuit
    # treats a ValueError from this module as "fall back to Qiskit", so a noisy
    # request runs on Aer and gets that model. The 100x slowdown and 16*4^n
    # memory of a density matrix go away with it.
    if backend_id == "aer_noisy" or noise > 0:
        raise ValueError(
            "Noisy simulation is served by the Qiskit Aer path, which models noise "
            "per gate with thermal relaxation and readout error. PennyLane's "
            "density-matrix device would apply a different and much coarser model, "
            "so this engine declines noisy circuits rather than answering differently "
            "for the same request."
        )

    notes: str | None = None
    device = _make_device(device_name, wires)

    def circuit_fn() -> Any:
        """Queue the translated circuit and return per-shot outcome counts."""
        _apply_all(operations)
        return qml.counts()

    node = qml.set_shots(qml.QNode(circuit_fn, device), shots=shots)

    start = time.perf_counter()
    raw = node()
    duration_ms = round((time.perf_counter() - start) * 1000, 2)

    if not isinstance(raw, dict):  # pragma: no cover - defensive
        raise ValueError(
            f"PennyLane device '{device_name}' returned {type(raw).__name__} instead of counts."
        )

    counts = _normalise_counts(raw)
    if not counts:
        raise ValueError(f"PennyLane device '{device_name}' returned no measurement results.")

    labels = sorted(counts)
    total = sum(counts.values()) or 1
    probabilities = [counts[label] / total for label in labels]

    device_note = f"Executed through PennyLane on the '{device_name}' device."
    notes = f"{notes} {device_note}" if notes else device_note

    return {
        "counts": counts,
        "probabilities": probabilities,
        "labels": labels,
        "shots": shots,
        "backend": backend_id,
        "duration_ms": duration_ms,
        "num_qubits": wires,
        "depth": depth,
        "notes": notes,
        "engine": "pennylane",
    }


def statevector_with_pennylane(qasm: str) -> dict[str, Any]:
    """Compute an exact statevector through PennyLane.

    Args:
        qasm: OpenQASM 3 (or 2) source.

    Returns:
        The same shape as :func:`app.quantum.runner.statevector`: amplitudes
        (``{re, im}`` pairs), probabilities, labels and num_qubits, indexed with
        qubit 0 as the least significant bit.

    Raises:
        ValueError: When the circuit cannot be parsed or translated, or exceeds
            the 12-qubit analysis limit.
    """
    import pennylane as qml

    circuit = parse_qasm(qasm)
    if circuit.num_qubits > MAX_STATEVECTOR_QUBITS:
        raise ValueError(
            f"Statevector analysis is limited to {MAX_STATEVECTOR_QUBITS} qubits; "
            f"this circuit uses {circuit.num_qubits}."
        )

    operations = _translate_circuit(circuit)
    width = circuit.num_qubits
    device = _make_device("lightning.qubit", width)

    def circuit_fn() -> Any:
        """Queue the translated circuit and return its full statevector."""
        _apply_all(operations)
        return qml.state()

    state = qml.QNode(circuit_fn, device)()

    # Index convention, again: PennyLane's amplitude index has wire 0 as its
    # most significant bit, while this project indexes with qubit 0 least
    # significant. Reversing the bits of the index converts between them.
    ordered: list[complex] = [0j] * (2**width)
    for index, amplitude in enumerate(state):
        reversed_index = int(format(index, f"0{width}b")[::-1], 2)
        ordered[reversed_index] = complex(amplitude)

    amplitudes = [{"re": float(amp.real), "im": float(amp.imag)} for amp in ordered]
    probabilities = [float(abs(amp) ** 2) for amp in ordered]
    labels = [format(index, f"0{width}b") for index in range(len(ordered))]

    return {
        "amplitudes": amplitudes,
        "probabilities": probabilities,
        "labels": labels,
        "num_qubits": width,
    }
