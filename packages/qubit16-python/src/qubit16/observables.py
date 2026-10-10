"""Turning Qiskit observables into the ``observables`` field on the wire.

THE ORDERING CONVENTION IS QISKIT'S, EXACTLY
--------------------------------------------
The service builds each observable with ``SparsePauliOp.from_list(terms)`` —
the same constructor Qiskit uses — so a label means what it means in Qiskit:
the **rightmost** character acts on qubit 0. ``"ZI"`` is Z on qubit 1. Because
both ends use the same constructor, ``SparsePauliOp.to_list()`` round-trips
through this module without a re-indexing step, and there is no convention
mismatch to get wrong. That is worth stating explicitly, because a silently
reversed Pauli string does not raise — it returns a plausible expectation value
for a question nobody asked.

WHY LABELS MATTER
-----------------
The result poll can only name expectation values if the labels are passed back
to it: IBM stores the observables but not our names for them. The labels are
therefore the caller's record, and this module makes sure every observable has
a unique one before anything is submitted.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from .exceptions import InvalidRequestError

#: Mirrors MAX_OBSERVABLES in services/api/app/quantum/observables.py, which is
#: authoritative. Checked here so the refusal costs no round trip.
MAX_OBSERVABLES = 32

#: Mirrors MAX_TERMS_PER_OBSERVABLE upstream.
MAX_TERMS_PER_OBSERVABLE = 512

#: Mirrors MAX_LABEL_CHARS in services/api/app/quantum/observables.py.
#:
#: Enforced here as a REFUSAL rather than a truncation, because both ends
#: truncate differently and the label is the only thing pairing a number with
#: the observable it belongs to. The service silently truncates to 64; the web
#: proxy DROPS a label longer than 64 from the poll query entirely, which
#: shortens the label list and re-pairs every value after it. A label nobody
#: will notice being shortened is worth a clear refusal before submission.
MAX_LABEL_CHARS = 64

#: Anything below this in the imaginary part of a coefficient is floating-point
#: noise from arithmetic on a SparsePauliOp; anything above it is a physical
#: claim the API cannot carry. See :func:`_real`.
_IMAGINARY_TOLERANCE = 1e-9


def observables_to_wire(observables: Any, num_qubits: int) -> list[dict[str, Any]]:
    """Normalise whatever the caller passed into the API's observable list.

    Accepted shapes, all of which appear in real Qiskit code:

    * a single ``SparsePauliOp``, ``Pauli``, or Pauli string ``"ZZ"``;
    * a list or tuple of any of those;
    * a mapping of label to any of those, which is the only shape that lets you
      choose the names the results come back under.

    Args:
        observables: The caller's observables.
        num_qubits: Width of the circuit the observables are written against —
            the circuit the user wrote, not the transpiled one. The service
            maps them through the device layout on its side.

    Returns:
        ``[{"label": str, "terms": [[pauli, coefficient], …]}]``, in the order
        given, which is the order the expectation values come back in.

    Raises:
        InvalidRequestError: On an empty list, too many observables or terms, a
            label that is blank or longer than :data:`MAX_LABEL_CHARS`, a
            duplicate label, a Pauli string of the wrong width, a complex
            coefficient, or a shape this function does not recognise.
    """
    entries: list[tuple[str | None, Any]]

    if isinstance(observables, Mapping):
        entries = [(str(label), value) for label, value in observables.items()]
    elif _is_single(observables):
        entries = [(None, observables)]
    elif isinstance(observables, Iterable):
        entries = [(None, value) for value in observables]
    else:
        raise InvalidRequestError(
            f"Cannot read {type(observables).__name__} as an observable. Pass a SparsePauliOp, a "
            'Pauli string like "ZZI", a list of either, or a {label: observable} mapping.'
        )

    if not entries:
        raise InvalidRequestError(
            "No observables were given. An Estimator job needs at least one — use the Sampler "
            "if what you want is a histogram."
        )
    if len(entries) > MAX_OBSERVABLES:
        raise InvalidRequestError(
            f"At most {MAX_OBSERVABLES} observables per job, got {len(entries)}. Each one is a "
            "separate expectation value the device has to estimate."
        )

    wire: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, (label, value) in enumerate(entries):
        terms = _terms(value, num_qubits, index)
        name = label if label is not None else f"obs{index}"
        if not name.strip():
            raise InvalidRequestError(
                f"observables[{index}] has an empty label. A label is what pairs a returned "
                "number with the observable you asked for, so it cannot be blank."
            )
        if len(name) > MAX_LABEL_CHARS:
            raise InvalidRequestError(
                f"Observable label '{name[:20]}…' is {len(name)} characters; the maximum is "
                f"{MAX_LABEL_CHARS}. Longer labels are truncated by the service and dropped "
                "from the result poll by the proxy, which would re-pair the values with the "
                "wrong observables — so this refuses instead of shortening it for you."
            )
        if name in seen:
            raise InvalidRequestError(
                f"Duplicate observable label '{name}'. Labels must be unique — they are the "
                "only thing that pairs a returned number back with the observable you asked "
                "for."
            )
        seen.add(name)
        wire.append({"label": name, "terms": terms})
    return wire


def _is_single(value: Any) -> bool:
    """Is this one observable rather than a collection of them?

    Args:
        value: The candidate.

    Returns:
        True for a string, a ``Pauli``, or anything exposing ``to_list`` (which
        ``SparsePauliOp`` does). Strings need the explicit case because a
        string is also iterable, and iterating ``"ZZ"`` would produce two
        one-character observables on a two-qubit circuit — each of which would
        then fail the width check with a baffling message.
    """
    if isinstance(value, str):
        return True
    return hasattr(value, "to_list") or type(value).__name__ == "Pauli"


def _terms(value: Any, num_qubits: int, index: int) -> list[list[Any]]:
    """Reduce one observable to ``[[pauli, coefficient], …]``.

    Args:
        value: One observable in any accepted shape.
        num_qubits: Circuit width, for the per-term check.
        index: Position, for error messages.

    Returns:
        The wire terms. The pair form is used rather than the object form
        because it is what ``SparsePauliOp.from_list`` takes at both ends.

    Raises:
        InvalidRequestError: On a bad shape, width, or coefficient.
    """
    raw: Any
    if isinstance(value, str):
        raw = [(value, 1.0)]
    elif hasattr(value, "to_list"):
        try:
            raw = value.to_list()
        except Exception as exc:  # noqa: BLE001
            raise InvalidRequestError(
                f"observables[{index}] could not be expanded into Pauli terms: {exc}"
            ) from exc
    elif type(value).__name__ == "Pauli":
        raw = [(str(value), 1.0)]
    elif isinstance(value, (list, tuple)):
        raw = value
    else:
        raise InvalidRequestError(
            f"observables[{index}] is a {type(value).__name__}, which is not an observable. "
            'Pass a SparsePauliOp, a Pauli string like "ZZI", or a list of (pauli, coefficient) '
            "pairs."
        )

    terms = list(raw)
    if not terms:
        raise InvalidRequestError(f"observables[{index}] has no Pauli terms.")
    if len(terms) > MAX_TERMS_PER_OBSERVABLE:
        raise InvalidRequestError(
            f"observables[{index}] has {len(terms)} terms; the maximum is "
            f"{MAX_TERMS_PER_OBSERVABLE}."
        )

    out: list[list[Any]] = []
    for position, term in enumerate(terms):
        where = f"observables[{index}].terms[{position}]"
        if isinstance(term, str):
            pauli, coefficient = term, 1.0
        elif isinstance(term, (list, tuple)) and len(term) == 2:
            pauli, coefficient = term
        else:
            raise InvalidRequestError(
                f'{where} must be a Pauli string or a (pauli, coefficient) pair, got {term!r}.'
            )

        pauli = str(pauli).strip().upper()
        if not pauli or any(letter not in "IXYZ" for letter in pauli):
            raise InvalidRequestError(
                f"{where} must be a Pauli string of I, X, Y and Z only, got {pauli!r}."
            )
        if len(pauli) != num_qubits:
            raise InvalidRequestError(
                f"{where} is {len(pauli)} characters but the circuit has {num_qubits} qubits. A "
                "Pauli string needs exactly one letter per qubit — pad with I for the qubits "
                f"this term does not act on, e.g. '{pauli.ljust(num_qubits, 'I')}'. Remember "
                "Qiskit's order: the rightmost letter acts on qubit 0."
            )

        out.append([pauli, _real(coefficient, where)])
    return out


def _real(value: Any, where: str) -> float:
    """Coerce a coefficient to a finite real number, or refuse.

    ``SparsePauliOp`` stores complex coefficients, and the API takes real ones
    only — an observable has to be Hermitian for its expectation value to be a
    real measurable quantity, so a genuinely complex coefficient is a physics
    error rather than an encoding one. Tiny imaginary parts from arithmetic
    (``op1 @ op2``, ``simplify()``) are dropped; anything larger is refused
    rather than truncated, because truncating changes the operator and the
    caller would never find out.

    Args:
        value: The coefficient, possibly complex.
        where: Position, for the error message.

    Returns:
        The real part as a float.

    Raises:
        InvalidRequestError: On a complex, infinite or unreadable coefficient.
    """
    try:
        as_complex = complex(value)
    except (TypeError, ValueError) as exc:
        raise InvalidRequestError(f"{where} coefficient must be a real number, got {value!r}.") from exc

    if abs(as_complex.imag) > _IMAGINARY_TOLERANCE:
        raise InvalidRequestError(
            f"{where} has a complex coefficient ({as_complex}). An observable must be Hermitian "
            "for its expectation value to be real, and the API takes real coefficients only. If "
            "this came from operator arithmetic, call .simplify() first; if it is genuinely "
            "complex, split it into Hermitian parts."
        )

    real = float(as_complex.real)
    if real != real or real in (float("inf"), float("-inf")):
        raise InvalidRequestError(f"{where} coefficient must be finite, got {real}.")
    return real


__all__ = [
    "MAX_LABEL_CHARS",
    "MAX_OBSERVABLES",
    "MAX_TERMS_PER_OBSERVABLE",
    "observables_to_wire",
]
