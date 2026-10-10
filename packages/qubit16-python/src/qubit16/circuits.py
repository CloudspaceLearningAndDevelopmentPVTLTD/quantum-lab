"""Turning a ``QuantumCircuit`` into what the wire accepts, and refusing early.

Every check in this module could be left to the server, which performs all of
them. They are here anyway because a refusal that arrives after a network round
trip, an auth check and a Qiskit parse is a slower and vaguer version of the
same refusal — and because two of them (the classical-register rule and the
parameter rule) are consequences of *our* wire format that the server's error
message cannot explain as well from where it stands.
"""

from __future__ import annotations

from typing import Any

from qiskit import QuantumCircuit

from .exceptions import InvalidRequestError


def to_qasm3(circuit: QuantumCircuit) -> str:
    """Serialise a circuit as OpenQASM 3.

    QASM 3 rather than QASM 2 because the service parses both and QASM 3 is
    what Qiskit 1+ exports losslessly for the gates these devices support.

    Args:
        circuit: The circuit to send.

    Returns:
        The QASM source.

    Raises:
        InvalidRequestError: When Qiskit cannot export the circuit. The usual
            cause is an instruction with no QASM representation — a custom
            gate that was never decomposed, or a control-flow block the
            exporter does not cover. ``circuit.decompose()`` fixes most of it.
    """
    from qiskit import qasm3

    try:
        return qasm3.dumps(circuit)
    except Exception as exc:  # noqa: BLE001 - the exporter raises many types
        raise InvalidRequestError(
            f"This circuit could not be exported to OpenQASM 3: {exc}. qubit16 takes circuits "
            "as QASM over the wire, so anything Qiskit cannot export cannot be submitted. Try "
            "circuit.decompose() if it contains custom gates."
        ) from exc


def measured_register(circuit: QuantumCircuit) -> tuple[str, int]:
    """Find the single classical register a sampler result will come back in.

    WHY THIS REFUSES A CIRCUIT WITH TWO REGISTERS. The API returns a sampler
    result as one flat ``{bitstring: count}`` histogram, and the service builds
    it by taking the FIRST register-shaped field on the vendor's pub result.
    With two registers that silently discards one of them. Returning the
    survivor under its own name would be technically accurate and practically a
    trap: the caller asked for two histograms and would get one, with nothing
    in the result saying so.

    So this refuses, and names the fix. The real repair is a wire format that
    carries per-register counts, which is a server change.

    Args:
        circuit: A circuit destined for the Sampler.

    Returns:
        ``(register name, width in bits)``. The name becomes the field on the
        result's ``DataBin``, so ``measure_all()`` — which creates a register
        called ``meas`` — gives you the familiar ``result[0].data.meas``.

    Raises:
        InvalidRequestError: When the circuit has no classical register, or
            more than one.
    """
    registers = list(circuit.cregs)
    if not registers:
        raise InvalidRequestError(
            "A Sampler circuit must contain measurements — without them the device returns an "
            "empty histogram. Add circuit.measure_all(), or use EstimatorV2 if what you want "
            "is an expectation value rather than a histogram."
        )
    if len(registers) > 1:
        names = ", ".join(register.name for register in registers)
        raise InvalidRequestError(
            f"This circuit has {len(registers)} classical registers ({names}). qubit16 returns "
            "one flat histogram per job, so all but one register would be silently dropped. "
            "Merge them into a single register (circuit.measure_all() does), or submit one "
            "circuit per register."
        )
    register = registers[0]
    return register.name, register.size


def assert_no_measurements(circuit: QuantumCircuit) -> None:
    """Refuse a measured circuit on the Estimator path.

    The observable is measured for you, in a basis the Estimator chooses; a
    terminal measurement collapses the state before that happens. The service
    refuses such a circuit rather than stripping the measurements, because
    stripping would edit your circuit and hand back a number for something you
    did not submit. This check is the same refusal, one round trip earlier.

    Args:
        circuit: A circuit destined for the Estimator.

    Raises:
        InvalidRequestError: When the circuit measures or resets.
    """
    operations = circuit.count_ops()
    offenders = [name for name in ("measure", "reset") if operations.get(name)]
    if offenders:
        raise InvalidRequestError(
            f"An Estimator circuit must not contain {' or '.join(offenders)}. The observable is "
            "measured for you, and a terminal measurement collapses the state first. Build the "
            "state-preparation circuit without measure_all() — the same circuit works for both "
            "primitives if you add measurements only for the Sampler."
        )


def bind_parameters(circuit: QuantumCircuit, values: Any) -> QuantumCircuit:
    """Bind a single set of parameter values, client-side.

    WHY CLIENT-SIDE, AND WHAT IS NOT SUPPORTED. The wire format carries QASM,
    and QASM has no representation for a free parameter here yet, so a
    parameterised circuit is bound before it is serialised. That makes a single
    parameter point work exactly as it does locally.

    A **sweep** — an array of parameter sets in one pub, which is what Qiskit's
    primitives natively accept — does not work, and is refused rather than
    quietly expanded. Expanding it would submit one job per point, and each job
    is one unit of the monthly hardware allowance: a fifty-point sweep written
    as one ``run()`` call would spend fifty. The caller should be the one who
    decides to do that, in a loop they can see.

    Args:
        circuit: The circuit, possibly parameterised.
        values: A mapping of ``Parameter`` (or name) to number, or a flat
            sequence of numbers in ``circuit.parameters`` order. None or an
            empty mapping is a no-op.

    Returns:
        The bound circuit, or the original when there was nothing to bind.

    Raises:
        InvalidRequestError: When the values do not bind, including the sweep
            shape described above.
    """
    if values is None:
        return circuit
    if hasattr(values, "__len__") and len(values) == 0:
        return circuit
    if not circuit.parameters:
        raise InvalidRequestError(
            "Parameter values were supplied for a circuit that has no free parameters."
        )

    try:
        return circuit.assign_parameters(values)
    except Exception as exc:  # noqa: BLE001 - assign_parameters raises several types
        raise InvalidRequestError(
            f"Could not bind parameter values to this circuit: {exc}. qubit16 binds parameters "
            "client-side and submits one circuit per job, so a pub carrying an ARRAY of "
            f"parameter sets (a sweep) is not supported — this circuit has "
            f"{len(circuit.parameters)} free parameter(s) and needs exactly that many values. "
            "Loop over your sweep and call run() per point; each point is one job of your "
            "monthly allowance either way, and this way you can see that."
        ) from exc


__all__ = [
    "assert_no_measurements",
    "bind_parameters",
    "measured_register",
    "to_qasm3",
]
