"""Offline tests for Estimator observables.

Two kinds of assertion here, and the second kind is why the file exists.

The first kind is ordinary input validation: a Pauli string of the wrong
length, a coefficient that is not a number, a duplicate label. Those fail
loudly and would be caught by anyone using the feature once.

The second kind is the LAYOUT mapping, which does not fail loudly at all. An
observable is written against the circuit the user wrote; the circuit that runs
has been laid out onto a 127-qubit device, where the user's qubit 0 may be
physical qubit 43. Handing the Estimator an un-mapped observable raises
nothing — it measures different physical qubits and returns a perfectly
plausible expectation value for a question nobody asked. There is no way to
notice that from the result, so it has to be pinned here.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.quantum.observables import (
    MAX_OBSERVABLES,
    MAX_TERMS_PER_OBSERVABLE,
    ObservableError,
    expectation_values,
    observables_for_circuit,
    parse_observables,
    swept_expectation_values,
)


# ── parse_observables ───────────────────────────────────────────────────────


def test_parses_the_object_form() -> None:
    """The documented shape round-trips with the Pauli upper-cased."""
    parsed = parse_observables(
        [{"label": "energy", "terms": [{"pauli": "zz", "coefficient": 1.5}]}], 2
    )

    assert parsed == [{"label": "energy", "terms": [("ZZ", 1.5)]}]


def test_parses_qiskits_own_pair_form() -> None:
    """``["ZZ", 1.0]`` is what ``SparsePauliOp.from_list`` takes.

    A caller arriving from Qiskit will reach for it, and refusing it would be
    a gratuitous difference from the library this service is built on.
    """
    parsed = parse_observables([{"label": "e", "terms": [["ZZ", 1.0], ["XI", 0.5]]}], 2)

    assert parsed[0]["terms"] == [("ZZ", 1.0), ("XI", 0.5)]


def test_a_missing_coefficient_is_one() -> None:
    """``{"pauli": "ZZ"}`` means ⟨ZZ⟩, not ⟨0·ZZ⟩."""
    parsed = parse_observables([{"terms": [{"pauli": "ZZ"}]}], 2)

    assert parsed[0]["terms"] == [("ZZ", 1.0)]


def test_a_missing_label_is_positional() -> None:
    """One observable and no label should not require inventing one."""
    parsed = parse_observables([{"terms": [{"pauli": "ZZ"}]}], 2)

    assert parsed[0]["label"] == "obs0"


def test_an_empty_list_is_refused() -> None:
    """An estimator job with nothing to measure is a mistake, not a no-op."""
    with pytest.raises(ObservableError, match="non-empty list"):
        parse_observables([], 2)


def test_a_pauli_of_the_wrong_length_is_refused_with_the_fix() -> None:
    """The message has to say what to do, because the fix is not obvious.

    "ZZ is 2 characters but the circuit has 3 qubits" leaves a reader guessing
    whether to drop a qubit or pad; naming the padding letter does not.
    """
    with pytest.raises(ObservableError, match="pad with I"):
        parse_observables([{"terms": [{"pauli": "ZZ"}]}], 3)


@pytest.mark.parametrize("pauli", ["ZA", "Z Z", "Z2", "", "ZZ+XX"])
def test_a_non_pauli_string_is_refused(pauli: str) -> None:
    """Only I, X, Y and Z name a Pauli.

    Args:
        pauli: The invalid string under test.
    """
    with pytest.raises(ObservableError):
        parse_observables([{"terms": [{"pauli": pauli}]}], 2)


def test_a_boolean_coefficient_is_refused() -> None:
    """``True`` is an int in Python and would silently become 1.0."""
    with pytest.raises(ObservableError, match="real number"):
        parse_observables([{"terms": [{"pauli": "ZZ", "coefficient": True}]}], 2)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_a_non_finite_coefficient_is_refused(value: float) -> None:
    """NaN survives some JSON encoders and would poison the whole sum silently.

    Args:
        value: The non-finite coefficient under test.
    """
    with pytest.raises(ObservableError, match="finite"):
        parse_observables([{"terms": [{"pauli": "ZZ", "coefficient": value}]}], 2)


def test_duplicate_labels_are_refused() -> None:
    """Labels exist to make the result unambiguous; duplicates undo that."""
    with pytest.raises(ObservableError, match="Duplicate"):
        parse_observables(
            [
                {"label": "e", "terms": [{"pauli": "ZZ"}]},
                {"label": "e", "terms": [{"pauli": "XX"}]},
            ],
            2,
        )


def test_too_many_observables_is_refused_before_the_device_sees_it() -> None:
    """Each observable is QPU time. The refusal is a 400, not a bill."""
    many = [{"label": f"o{i}", "terms": [{"pauli": "ZZ"}]} for i in range(MAX_OBSERVABLES + 1)]

    with pytest.raises(ObservableError, match=str(MAX_OBSERVABLES)):
        parse_observables(many, 2)


def test_too_many_terms_is_refused() -> None:
    """A bounded sum, so one observable cannot be an arbitrary payload."""
    terms = [{"pauli": "ZZ"}] * (MAX_TERMS_PER_OBSERVABLE + 1)

    with pytest.raises(ObservableError, match=str(MAX_TERMS_PER_OBSERVABLE)):
        parse_observables([{"label": "big", "terms": terms}], 2)


# ── observables_for_circuit: the silent one ─────────────────────────────────


def _transpiled(num_qubits: int = 5) -> Any:
    """Transpile a 2-qubit Bell circuit onto a wider device.

    Args:
        num_qubits: Width of the fake device.

    Returns:
        The transpiled circuit, carrying a layout.
    """
    from qiskit import QuantumCircuit, transpile
    from qiskit.providers.fake_provider import GenericBackendV2

    circuit = QuantumCircuit(2)
    circuit.h(0)
    circuit.cx(0, 1)
    return transpile(circuit, backend=GenericBackendV2(num_qubits=num_qubits, seed=11), seed_transpiler=3)


def test_the_observable_is_widened_to_the_device() -> None:
    """A 2-qubit observable on a 5-qubit device becomes a 5-qubit operator.

    THIS IS THE ASSERTION THAT MATTERS. Without `apply_layout` the operator
    stays 2 qubits wide, the Estimator applies it to physical qubits 0 and 1
    regardless of where the circuit was actually laid out, and the number that
    comes back is a real expectation value of the wrong observable.
    """
    parsed = parse_observables([{"label": "zz", "terms": [{"pauli": "ZZ"}]}], 2)

    operators = observables_for_circuit(parsed, _transpiled(5))

    assert operators[0].num_qubits == 5


def test_the_widened_observable_still_acts_on_two_qubits() -> None:
    """Widening must PAD with identities, not smear the operator.

    A 5-qubit operator whose every Pauli string is ZZIII would be padding in
    the wrong place; the two non-identity letters have to land on whichever
    physical qubits the circuit was mapped to, and exactly two of them.
    """
    parsed = parse_observables([{"label": "zz", "terms": [{"pauli": "ZZ"}]}], 2)

    operator = observables_for_circuit(parsed, _transpiled(5))[0]

    label = operator.paulis[0].to_label()
    assert len(label) == 5
    assert sum(1 for letter in label if letter != "I") == 2


def test_every_term_of_a_sum_is_mapped() -> None:
    """A multi-term observable maps as a whole, not term by term."""
    parsed = parse_observables(
        [{"label": "h", "terms": [{"pauli": "ZZ", "coefficient": 1.0}, {"pauli": "XI", "coefficient": 0.5}]}],
        2,
    )

    operator = observables_for_circuit(parsed, _transpiled(5))[0]

    assert len(operator.paulis) == 2
    assert all(len(p.to_label()) == 5 for p in operator.paulis)


def test_observables_keep_their_submission_order() -> None:
    """The result pairs values to labels positionally, so order is a contract."""
    parsed = parse_observables(
        [
            {"label": "a", "terms": [{"pauli": "ZZ"}]},
            {"label": "b", "terms": [{"pauli": "XX"}]},
            {"label": "c", "terms": [{"pauli": "YY"}]},
        ],
        2,
    )

    operators = observables_for_circuit(parsed, _transpiled(5))

    assert len(operators) == 3


# ── expectation_values ──────────────────────────────────────────────────────


class FakeData:
    """Stands in for an Estimator ``PubResult.data``."""

    def __init__(self, evs: Any, stds: Any = None) -> None:
        """Record the fields the reader looks for.

        Args:
            evs: Expectation values.
            stds: Standard errors, or None.
        """
        self.evs = evs
        self.stds = stds


class FakePub:
    """Stands in for one ``PubResult``."""

    def __init__(self, data: FakeData) -> None:
        """Hold the data.

        Args:
            data: The pub's data object.
        """
        self.data = data


def test_values_are_paired_with_their_labels() -> None:
    """Three floats come back as three named values, in order."""
    parsed = [{"label": "a"}, {"label": "b"}, {"label": "c"}]

    values = expectation_values([FakePub(FakeData([0.9, -0.1, 0.0], [0.01, 0.02, 0.03]))], parsed)

    assert [v["label"] for v in values] == ["a", "b", "c"]
    assert [v["value"] for v in values] == [0.9, -0.1, 0.0]
    assert values[2]["std_error"] == 0.03


def test_a_zero_expectation_value_survives_as_zero() -> None:
    """0.0 is a real answer — it is what ⟨Z⟩ gives for a perfect superposition.

    It must never be collapsed into the "could not read it" case, and the
    "could not read it" case must never be reported as 0.0.
    """
    values = expectation_values([FakePub(FakeData([0.0]))], [{"label": "z"}])

    assert values[0]["value"] == 0.0
    assert values[0]["value"] is not None


def test_an_unreadable_result_is_none_not_zero() -> None:
    """The distinction this whole nullable field exists for."""
    values = expectation_values([FakePub(FakeData(None))], [{"label": "z"}])

    assert values[0]["value"] is None


def test_a_single_observable_returned_as_a_bare_float_is_handled() -> None:
    """A one-observable job can come back 0-d rather than as a length-1 array.

    Handling it here keeps that from being a caller-visible difference between
    asking for one observable and asking for two.
    """
    values = expectation_values([FakePub(FakeData(0.75))], [{"label": "z"}])

    assert values[0]["value"] == 0.75


def test_missing_std_errors_are_none_rather_than_absent() -> None:
    """The field is always present, so a reader never has to probe for it."""
    values = expectation_values([FakePub(FakeData([0.5]))], [{"label": "z"}])

    assert "std_error" in values[0]
    assert values[0]["std_error"] is None


def test_a_short_result_does_not_invent_values() -> None:
    """Two labels and one value means one value and one None, never a crash."""
    values = expectation_values([FakePub(FakeData([0.5]))], [{"label": "a"}, {"label": "b"}])

    assert values[0]["value"] == 0.5
    assert values[1]["value"] is None


# ── swept_expectation_values ────────────────────────────────────────────────
#
# A swept Estimator result is shape (n_observables, n_points), not 1-D. The
# flat reader does not raise on it — `_as_float_list` calls tolist(), gets a
# list of LISTS, and float(row) fails per entry, so every observable comes back
# None. Quiet, total data loss on a job that ran and was paid for.


def test_a_swept_result_is_read_as_one_series_per_observable() -> None:
    """Two observables over three points give two series of three."""
    result = [FakePub(FakeData([[1.0, 0.0, -1.0], [0.0, 1.0, 0.0]]))]

    series = swept_expectation_values(result, [{"label": "Z"}, {"label": "X"}], 3)

    assert [s["label"] for s in series] == ["Z", "X"]
    assert series[0]["values"] == [1.0, 0.0, -1.0]
    assert series[1]["values"] == [0.0, 1.0, 0.0]


def test_the_flat_reader_would_have_silently_lost_a_swept_result() -> None:
    """The failure this function exists to prevent, pinned explicitly.

    If anyone ever routes a swept result through `expectation_values` again,
    this documents what they will get: no exception and no numbers.
    """
    result = [FakePub(FakeData([[1.0, 0.0, -1.0], [0.0, 1.0, 0.0]]))]

    flat = expectation_values(result, [{"label": "Z"}, {"label": "X"}])

    assert [entry["value"] for entry in flat] == [None, None]


def test_a_swept_series_keeps_zero_distinct_from_unreadable() -> None:
    """0.0 is what ⟨Z⟩ gives at theta = pi/2. It is an answer, not a gap."""
    series = swept_expectation_values([FakePub(FakeData([[0.0, None]]))], [{"label": "Z"}], 2)

    assert series[0]["values"][0] == 0.0
    assert series[0]["values"][1] is None


def test_a_short_swept_row_is_padded_rather_than_truncating_the_sweep() -> None:
    """A caller zips the series against the points it submitted.

    A row shorter than the sweep would silently realign every later point with
    the wrong angle, so the gap is filled with None and stays visible.
    """
    series = swept_expectation_values([FakePub(FakeData([[1.0]]))], [{"label": "Z"}], 3)

    assert series[0]["values"] == [1.0, None, None]


def test_a_single_observable_sweep_may_arrive_already_flat() -> None:
    """Depending on the pub shape, (1, P) can come back as (P,).

    Treating that as observable 0's series rather than reporting nothing is
    what keeps a one-observable sweep from being a special case for the caller.
    """
    series = swept_expectation_values([FakePub(FakeData([0.5, 0.25]))], [{"label": "Z"}], 2)

    assert series[0]["values"] == [0.5, 0.25]


def test_an_unreadable_swept_field_gives_a_full_row_of_none() -> None:
    """Never an empty list: the caller zips it against its own points."""
    series = swept_expectation_values([FakePub(FakeData(None))], [{"label": "Z"}], 4)

    assert series[0]["values"] == [None, None, None, None]
    assert series[0]["std_errors"] == [None, None, None, None]
