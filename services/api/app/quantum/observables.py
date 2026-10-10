"""Parsing and validating the observables an Estimator job measures.

WHY THIS MODULE EXISTS
----------------------
Until it did, this service could only run ``SamplerV2`` and hand back a
bitstring histogram. That is the right primitive for teaching and the wrong one
for research: VQE, QAOA, most of quantum chemistry and most of quantum machine
learning compute an expectation value of an observable, not a histogram, and
``EstimatorV2`` is the primitive for that. The practical consequence of the
omission was not that it was awkward — you could not run a variational
algorithm on hardware through this platform at all.

WHAT AN OBSERVABLE IS HERE
--------------------------
A named weighted sum of Pauli strings::

    {"label": "energy",
     "terms": [{"pauli": "ZZ", "coefficient": 1.0},
               {"pauli": "XI", "coefficient": 0.5}]}

Named because a job usually asks for several at once — ``<Z0>``, ``<Z1>``,
``<Z0 Z1>`` from one run — and a caller receiving three bare floats in an array
has to trust positional order to know which is which. The label travels with
the value all the way back to the result.

THE STEP THAT IS EASY TO GET WRONG
----------------------------------
An observable is written against the circuit the user wrote. The circuit that
runs is the *transpiled* one, laid out onto a 127-qubit device, where the
user's qubit 0 may be physical qubit 43. An observable handed to the Estimator
without ``apply_layout`` measures the wrong physical qubits and returns a
number that is not wrong-looking — it is a plausible expectation value of
something nobody asked about. :func:`observables_for_circuit` does that
mapping, and it is the reason this module takes the transpiled circuit rather
than just a qubit count.
"""

from __future__ import annotations

import re
from typing import Any

#: A Pauli string: one letter per qubit, no coefficients, no spaces.
#: Lower case is accepted from callers and upper-cased before use, because
#: "zz" is an obvious thing to type and refusing it teaches nothing.
_PAULI = re.compile(r"^[IXYZ]+$")

#: How many observables one job may ask for.
#:
#: Each one is a separate expectation value the device has to estimate, and
#: they are not free: the Estimator groups commuting terms but a caller asking
#: for hundreds of non-commuting observables multiplies the QPU time. Bounded
#: here so the refusal is a clear 400 rather than a surprising bill.
MAX_OBSERVABLES = 32

#: How many Pauli terms one observable may sum.
#:
#: A 12-qubit molecular Hamiltonian has a few hundred terms, so this is
#: generous for anything that fits on the devices in the catalogue.
MAX_TERMS_PER_OBSERVABLE = 512

#: Longest label, since it is echoed back and rendered.
MAX_LABEL_CHARS = 64


class ObservableError(ValueError):
    """An observable could not be parsed or does not fit the circuit.

    A ``ValueError`` so the routers' existing ``_guard`` maps it to a 400
    without a new branch: every one of these is the caller's input.
    """


def parse_observables(raw: Any, num_qubits: int) -> list[dict[str, Any]]:
    """Validate a caller's observable list against a circuit width.

    Args:
        raw: The ``observables`` field from the request.
        num_qubits: Qubits in the circuit the user wrote — NOT the transpiled
            width. An observable is written against the logical circuit;
            :func:`observables_for_circuit` maps it onto the physical one.

    Returns:
        Normalised observables: ``[{"label": str, "terms": [(pauli, coeff)]}]``
        with every Pauli upper-cased and checked.

    Raises:
        ObservableError: On any malformed, oversized or mis-sized input.
    """
    if not isinstance(raw, list) or not raw:
        raise ObservableError(
            "observables must be a non-empty list, e.g. "
            '[{"label": "ZZ", "terms": [{"pauli": "ZZ", "coefficient": 1.0}]}].'
        )
    if len(raw) > MAX_OBSERVABLES:
        raise ObservableError(
            f"At most {MAX_OBSERVABLES} observables per job, got {len(raw)}. Each one is a "
            "separate expectation value the device has to estimate."
        )

    parsed: list[dict[str, Any]] = []
    seen_labels: set[str] = set()

    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise ObservableError(f"observables[{index}] must be an object, got {type(entry).__name__}.")

        label = entry.get("label")
        if label is None:
            # A caller who sends one observable and no label should not have to
            # invent one. Position is a poor name but a correct one.
            label = f"obs{index}"
        if not isinstance(label, str) or not label.strip():
            raise ObservableError(f"observables[{index}].label must be a non-empty string.")
        label = label.strip()[:MAX_LABEL_CHARS]
        if label in seen_labels:
            # Duplicates would make the result ambiguous in exactly the way
            # labels exist to prevent.
            raise ObservableError(f"Duplicate observable label '{label}'. Labels must be unique.")
        seen_labels.add(label)

        terms = _parse_terms(entry.get("terms"), num_qubits, index)
        parsed.append({"label": label, "terms": terms})

    return parsed


def _parse_terms(raw: Any, num_qubits: int, index: int) -> list[tuple[str, float]]:
    """Validate the Pauli terms of one observable.

    Args:
        raw: The ``terms`` field.
        num_qubits: Width of the circuit the observable is written against.
        index: Position of the observable, for error messages.

    Returns:
        ``[(pauli, coefficient)]`` with Paulis upper-cased.

    Raises:
        ObservableError: On any malformed or mis-sized term.
    """
    if not isinstance(raw, list) or not raw:
        raise ObservableError(f"observables[{index}].terms must be a non-empty list.")
    if len(raw) > MAX_TERMS_PER_OBSERVABLE:
        raise ObservableError(
            f"observables[{index}] has {len(raw)} terms; the maximum is "
            f"{MAX_TERMS_PER_OBSERVABLE}."
        )

    terms: list[tuple[str, float]] = []
    for position, term in enumerate(raw):
        where = f"observables[{index}].terms[{position}]"

        if isinstance(term, dict):
            pauli_raw = term.get("pauli")
            coeff_raw = term.get("coefficient", 1.0)
        elif isinstance(term, (list, tuple)) and len(term) == 2:
            # ["ZZ", 1.0] is the shape Qiskit's own SparsePauliOp.from_list
            # takes, so a caller coming from Qiskit will reach for it.
            pauli_raw, coeff_raw = term
        else:
            raise ObservableError(
                f'{where} must be an object like {{"pauli": "ZZ", "coefficient": 1.0}} '
                'or a pair like ["ZZ", 1.0].'
            )

        if not isinstance(pauli_raw, str):
            raise ObservableError(f"{where}.pauli must be a string.")
        pauli = pauli_raw.strip().upper()
        if not _PAULI.match(pauli):
            raise ObservableError(
                f"{where}.pauli must be a Pauli string of I, X, Y and Z only, got {pauli_raw!r}."
            )
        if len(pauli) != num_qubits:
            raise ObservableError(
                f"{where}.pauli is {len(pauli)} characters but the circuit has {num_qubits} "
                f"qubits. A Pauli string needs exactly one letter per qubit — pad with I for "
                f"the qubits this term does not act on."
            )

        # bool is an int in Python and would silently become 1.0.
        if isinstance(coeff_raw, bool) or not isinstance(coeff_raw, (int, float)):
            raise ObservableError(f"{where}.coefficient must be a real number.")
        coefficient = float(coeff_raw)
        # NaN and infinity survive JSON in some encoders and would poison the
        # whole expectation value with no error anywhere.
        if coefficient != coefficient or coefficient in (float("inf"), float("-inf")):
            raise ObservableError(f"{where}.coefficient must be finite.")

        terms.append((pauli, coefficient))

    return terms


def observables_for_circuit(parsed: list[dict[str, Any]], isa_circuit: Any) -> list[Any]:
    """Build layout-corrected ``SparsePauliOp``s for a transpiled circuit.

    THIS IS THE STEP THAT IS EASY TO GET WRONG. The observable is written
    against the circuit the user wrote; the circuit that runs has been laid out
    onto the device, so the user's qubit 0 may be physical qubit 43 of 127.
    Handing the Estimator an un-mapped observable does not raise — it measures
    different physical qubits and returns a perfectly plausible number for a
    question nobody asked.

    Args:
        parsed: Output of :func:`parse_observables`.
        isa_circuit: The transpiled circuit, carrying a ``layout``.

    Returns:
        One ``SparsePauliOp`` per observable, in the same order.

    Raises:
        ObservableError: When an operator cannot be built or mapped.
    """
    from qiskit.quantum_info import SparsePauliOp

    operators: list[Any] = []
    for observable in parsed:
        try:
            operator = SparsePauliOp.from_list(observable["terms"])
        except Exception as exc:  # noqa: BLE001
            raise ObservableError(
                f"Observable '{observable['label']}' could not be built: {exc}"
            ) from exc

        layout = getattr(isa_circuit, "layout", None)
        if layout is not None:
            try:
                operator = operator.apply_layout(layout)
            except Exception as exc:  # noqa: BLE001
                raise ObservableError(
                    f"Observable '{observable['label']}' could not be mapped onto the device "
                    f"layout: {exc}"
                ) from exc
        elif operator.num_qubits != isa_circuit.num_qubits:
            # No layout AND a width mismatch is unrecoverable. Refusing beats
            # padding on a guess: a silently widened observable measures the
            # wrong thing.
            raise ObservableError(
                f"Observable '{observable['label']}' acts on {operator.num_qubits} qubits but "
                f"the transpiled circuit has {isa_circuit.num_qubits}, and the circuit carries "
                "no layout to map it through."
            )

        operators.append(operator)

    return operators


def expectation_values(result: Any, parsed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pair an Estimator result back up with the labels that were asked for.

    THE RESULT SHAPE. Submission sends ONE pub carrying an ARRAY of observables
    rather than one pub per observable, because the Estimator can then group
    commuting terms across all of them and spend less QPU time. The consequence
    here is that the values live in a single ``PubResult`` whose ``data.evs`` is
    an array indexed like the observables array — not in ``result[i]``, which is
    what a one-pub-per-observable submission would have produced and is the
    natural thing to write if you have not looked at the pub shape.

    Args:
        result: The object returned by ``job.result()``.
        parsed: The observables as submitted, in order.

    Returns:
        ``[{"label", "value", "std_error"}]``. A value that cannot be read is
        reported as None rather than 0.0 — an expectation value of zero is a
        real, meaningful answer and must never be confused with a missing one.
    """
    evs = _as_float_list(_read_field(result, "evs"), len(parsed))
    stds = _as_float_list(_read_field(result, "stds"), len(parsed))

    return [
        {
            "label": observable["label"],
            "value": evs[index] if index < len(evs) else None,
            "std_error": stds[index] if index < len(stds) else None,
        }
        for index, observable in enumerate(parsed)
    ]


def _read_field(result: Any, field: str) -> Any:
    """Pull one data field out of the first pub result.

    Args:
        result: The Estimator result.
        field: ``"evs"`` or ``"stds"``.

    Returns:
        Whatever the field holds, or None when it cannot be reached.
    """
    try:
        return getattr(result[0].data, field, None)
    except Exception:  # noqa: BLE001
        return None


def _as_float_list(raw: Any, expected: int) -> list[float | None]:
    """Coerce a numpy array, a list or a bare scalar into a list of floats.

    The Estimator returns a numpy array whose shape follows the observables
    array, but a single-observable job can come back as a 0-d array or a bare
    float depending on the shape that went in. Handling all three here keeps
    that from being a caller-visible difference between asking for one
    observable and asking for two.

    Args:
        raw: The field value.
        expected: How many values the caller asked for.

    Returns:
        A list of floats and Nones, at most ``expected`` long.
    """
    if raw is None:
        return []
    # numpy arrays expose .tolist(); a 0-d array gives a bare float from it.
    tolist = getattr(raw, "tolist", None)
    if callable(tolist):
        try:
            raw = tolist()
        except Exception:  # noqa: BLE001
            return []
    if not isinstance(raw, (list, tuple)):
        raw = [raw]

    values: list[float | None] = []
    for item in list(raw)[:expected]:
        try:
            values.append(float(item))
        except (TypeError, ValueError):
            values.append(None)
    return values


def swept_expectation_values(
    result: Any, parsed: list[dict[str, Any]], num_points: int
) -> list[dict[str, Any]]:
    """Read a SWEPT Estimator result: one series per observable.

    THE SHAPE IS DIFFERENT AND THE FLAT READER DOES NOT NOTICE. An un-swept job
    puts ``evs`` in shape ``(n_observables,)``; a swept one submitted through
    :func:`app.quantum.parameters.estimator_pub_arrays` puts it in shape
    ``(n_observables, n_points)`` — observable-major, point-minor. Handing that
    to :func:`expectation_values` does not raise: ``_as_float_list`` calls
    ``tolist()``, gets a list of LISTS, and ``float(row)`` fails per entry, so
    every observable comes back as ``None``. Quiet, total data loss on a job
    that ran and was paid for.

    Args:
        result: The object returned by ``job.result()``.
        parsed: The observables as submitted, in order.
        num_points: How many sweep points were submitted.

    Returns:
        ``[{"label", "values", "std_errors"}]`` where each list is
        ``num_points`` long and in submission order. A value that could not be
        read is None inside the list rather than the list being dropped — an
        expectation value of 0.0 is a real answer at that point, and a gap is
        not the same as a zero.
    """
    evs = _read_field(result, "evs")
    stds = _read_field(result, "stds")

    series: list[dict[str, Any]] = []
    for index, observable in enumerate(parsed):
        series.append(
            {
                "label": observable["label"],
                "values": _row_of_floats(evs, index, num_points),
                "std_errors": _row_of_floats(stds, index, num_points),
            }
        )
    return series


def _row_of_floats(raw: Any, index: int, expected: int) -> list[float | None]:
    """Pull one observable's series out of a 2-D result field.

    Args:
        raw: The ``evs`` or ``stds`` field, expected 2-D.
        index: Which observable's row to take.
        expected: How many points the row should hold.

    Returns:
        The row as floats, padded with None to ``expected`` and truncated to
        it. An unreadable field gives a row of None rather than an empty list,
        so a caller can always zip it against the points it asked for.
    """
    tolist = getattr(raw, "tolist", None)
    if callable(tolist):
        try:
            raw = tolist()
        except Exception:  # noqa: BLE001
            raw = None

    if not isinstance(raw, (list, tuple)):
        return [None] * expected

    # THE FLAT CASE IS CHECKED FIRST, and the order is the whole of it. A
    # single-observable sweep can arrive as (n_points,) rather than
    # (1, n_points) depending on how the pub was shaped. Indexing first would
    # take raw[0] — a SCALAR — decide it is not a row, and return all-None for
    # a result that was right there. Deciding the rank before indexing is what
    # keeps a one-observable sweep from being a special case for the caller.
    is_flat = bool(raw) and not isinstance(raw[0], (list, tuple))

    row: Any
    if is_flat:
        # Only observable 0 exists in a flat result; anything else is absent.
        row = raw if index == 0 else None
    else:
        row = raw[index] if index < len(raw) else None

    if not isinstance(row, (list, tuple)):
        return [None] * expected

    out: list[float | None] = []
    for item in list(row)[:expected]:
        try:
            out.append(float(item))
        except (TypeError, ValueError):
            out.append(None)
    out.extend([None] * (expected - len(out)))
    return out
