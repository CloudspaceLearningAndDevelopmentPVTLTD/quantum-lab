"""A full estimator round trip, the observable wire shape, and the rules.

The estimator is the primitive every variational algorithm needs, and it has
three rules that are easy to break invisibly: the circuit must carry no
measurements, a Pauli string needs one letter per qubit, and the labels must be
sent back on the poll or the values come home called ``obs0``.
"""

from __future__ import annotations

import math

import pytest
from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp

from qubit16 import EstimatorV2, Qubit16Provider
from qubit16.exceptions import InvalidRequestError, Qubit16Error

from conftest import BRISBANE, FakeHTTP

SUBMITTED = {
    "job_id": "e9xyz",
    "backend": "ibm_brisbane",
    "status": "queued",
    "submitted_at": "2026-09-17T10:00:00Z",
    "provider": "ibm",
    "shots": 4096,
    "primitive": "estimator",
    "observable_labels": ["ZZ", "XX"],
    "resilience_level": 1,
}

DONE = {
    "job_id": "e9xyz",
    "provider": "ibm",
    "status": "done",
    "primitive": "estimator",
    "expectation_values": [
        {"label": "ZZ", "value": 0.947, "std_error": 0.006},
        {"label": "XX", "value": 0.931, "std_error": 0.007},
    ],
    "qpu_seconds": 2.1,
}


def _bell_state() -> QuantumCircuit:
    """A Bell state preparation with NO measurements.

    Returns:
        The circuit. The absence of measurements is the point: the observable
        is measured for us and a terminal measurement would collapse the state
        first.
    """
    circuit = QuantumCircuit(2)
    circuit.h(0)
    circuit.cx(0, 1)
    return circuit


def _wire_up(http: FakeHTTP) -> None:
    """Program the catalogue and a queued-then-done estimator job.

    Args:
        http: The fake transport.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/submit", 200, SUBMITTED)
    http.route(
        "GET", "/api/hardware/job/ibm/e9xyz", 200,
        {"job_id": "e9xyz", "provider": "ibm", "status": "running"},
    )
    http.route("GET", "/api/hardware/job/ibm/e9xyz", 200, DONE, times=None)


def test_estimator_round_trip_returns_evs_and_stds(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches the estimator result shape drifting from Qiskit's.

    Variational code reads ``result[0].data.evs`` and nothing else; if that
    stops being an array of floats, every VQE written against this breaks.
    """
    _wire_up(http)
    backend = provider.backend("ibm_brisbane")

    job = EstimatorV2(mode=backend).run(
        [(_bell_state(), {"ZZ": SparsePauliOp("ZZ"), "XX": SparsePauliOp("XX")})]
    )
    data = job.result()[0].data

    assert list(data.evs) == [0.947, 0.931]
    assert list(data.stds) == [0.006, 0.007]


def test_sparse_pauli_op_is_expanded_into_the_wire_terms(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a weighted sum losing its coefficients on the way out.

    A Hamiltonian submitted with its coefficients dropped returns a perfectly
    plausible number for a different operator, which is the worst kind of bug
    this package could have.
    """
    _wire_up(http)
    backend = provider.backend("ibm_brisbane")

    hamiltonian = SparsePauliOp.from_list([("ZI", 0.5), ("IZ", 0.5)])
    EstimatorV2(mode=backend).run([(_bell_state(), {"energy": hamiltonian})])

    body = http.calls_to("POST", "/api/hardware/submit")[0].json
    assert body["observables"] == [
        {"label": "energy", "terms": [["ZI", 0.5], ["IZ", 0.5]]}
    ]
    assert body["resilience_level"] == 1


def test_the_poll_carries_the_labels_back(provider: Qubit16Provider, http: FakeHTTP) -> None:
    """Catches the labels being dropped on the poll.

    IBM stores the observables but not our names for them, so the labels from
    the submission are the only thing that can turn the returned floats back
    into named values. Poll without them and everything is called obs0, obs1.
    """
    _wire_up(http)
    backend = provider.backend("ibm_brisbane")

    EstimatorV2(mode=backend).run(
        [(_bell_state(), {"ZZ": SparsePauliOp("ZZ"), "XX": SparsePauliOp("XX")})]
    ).result()

    polls = http.calls_to("GET", "/api/hardware/job/ibm/e9xyz")
    assert polls[0].params == {"observables": "ZZ,XX"}


def test_a_null_expectation_value_becomes_nan_and_not_zero(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches the single most dangerous conflation in the estimator path.

    An expectation value of 0.0 is a real and common answer — it is what ⟨Z⟩
    gives for a perfect superposition. A value that could not be read is null.
    If null became 0.0 an optimiser would happily converge on a number that was
    never measured.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/submit", 200, SUBMITTED)
    http.route(
        "GET", "/api/hardware/job/ibm/e9xyz", 200,
        {
            "job_id": "e9xyz",
            "provider": "ibm",
            "status": "done",
            "expectation_values": [
                {"label": "ZZ", "value": 0.0, "std_error": 0.01},
                {"label": "XX", "value": None, "std_error": None},
            ],
        },
        times=None,
    )
    backend = provider.backend("ibm_brisbane")

    job = EstimatorV2(mode=backend).run(
        [(_bell_state(), {"ZZ": SparsePauliOp("ZZ"), "XX": SparsePauliOp("XX")})]
    )
    evs = job.result()[0].data.evs

    assert evs[0] == 0.0
    assert math.isnan(evs[1])
    # The untouched None survives too, for code that needs to tell them apart
    # without reasoning about NaN.
    assert job.expectation_values()[1]["value"] is None


def test_a_measured_circuit_is_refused_before_it_costs_anything(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a measured circuit reaching the estimator.

    The observable is measured for you; a terminal measurement collapses the
    state first. Neither end strips the measurements, because that would edit
    the caller's circuit and return a number for something they did not submit.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    backend = provider.backend("ibm_brisbane")

    measured = _bell_state()
    measured.measure_all()

    with pytest.raises(InvalidRequestError, match="must not contain measure"):
        EstimatorV2(mode=backend).run([(measured, SparsePauliOp("ZZ"))])
    assert http.calls_to("POST", "/api/hardware/submit") == []


def test_a_pauli_string_of_the_wrong_width_names_the_padding_fix(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches 'ZZ' on a three-qubit circuit being sent and rejected upstream.

    One letter per qubit is the rule people break first, and the useful error
    shows the padded string rather than restating the rule.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    backend = provider.backend("ibm_brisbane")

    three = QuantumCircuit(3)
    three.h(0)

    with pytest.raises(InvalidRequestError) as caught:
        EstimatorV2(mode=backend).run([(three, "ZZ")])
    assert "ZZI" in str(caught.value)


def test_a_complex_coefficient_is_refused_rather_than_truncated(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a non-Hermitian operator being quietly made real.

    Truncating the imaginary part changes the operator, and the caller would
    get a number for something else with nothing to indicate it.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    backend = provider.backend("ibm_brisbane")

    with pytest.raises(InvalidRequestError, match="Hermitian"):
        EstimatorV2(mode=backend).run(
            [(_bell_state(), SparsePauliOp.from_list([("ZZ", 1.0 + 0.5j)]))]
        )


def test_a_bare_circuit_is_not_an_estimator_pub(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches an estimator guessing what to measure.

    There is no sensible default observable, and a guess would return a
    confident number nobody asked for.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    backend = provider.backend("ibm_brisbane")

    with pytest.raises(InvalidRequestError, match="bare circuit"):
        EstimatorV2(mode=backend).run([_bell_state()])


def test_precision_is_ignored_loudly(provider: Qubit16Provider, http: FakeHTTP) -> None:
    """Catches a requested precision being silently honoured or silently lost.

    The API takes a shot count. Converting one into the other would be
    inventing statistics, so the pub is accepted and the caller is told.
    """
    _wire_up(http)
    backend = provider.backend("ibm_brisbane")

    with pytest.warns(UserWarning, match="precision"):
        EstimatorV2(mode=backend).run([(_bell_state(), SparsePauliOp("ZZ"), None, 0.01)])


def test_values_returned_out_of_order_are_realigned_to_the_submission(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches evs[i] silently meaning a different observable than pub i.

    Every variational loop reads data.evs positionally. A response whose values
    arrive in another order — a service change, a cache, a proxy that reorders
    — would feed an optimiser ⟨XX⟩ where it reads ⟨ZZ⟩, converge, and raise
    nothing. The labels we submitted are the only thing that can catch it.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/submit", 200, SUBMITTED, times=None)
    http.route(
        "GET", "/api/hardware/job/ibm/e9xyz", 200,
        {
            "job_id": "e9xyz", "provider": "ibm", "status": "done",
            "expectation_values": [
                {"label": "XX", "value": 0.931, "std_error": 0.007},
                {"label": "ZZ", "value": 0.947, "std_error": 0.006},
            ],
        },
        times=None,
    )
    backend = provider.backend("ibm_brisbane")

    data = EstimatorV2(mode=backend).run(
        [(_bell_state(), {"ZZ": SparsePauliOp("ZZ"), "XX": SparsePauliOp("XX")})]
    ).result()[0].data

    # ZZ was asked for first, so it must be evs[0] whatever order it came back.
    assert list(data.evs) == [0.947, 0.931]
    assert list(data.stds) == [0.006, 0.007]


def test_fewer_values_than_observables_is_refused_not_silently_short(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a truncated result being handed to an optimiser as if complete.

    A Hamiltonian split across observables is summed by the caller. One value
    missing makes that sum wrong by exactly one term, with no exception and a
    perfectly plausible magnitude.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/submit", 200, SUBMITTED, times=None)
    http.route(
        "GET", "/api/hardware/job/ibm/e9xyz", 200,
        {"job_id": "e9xyz", "provider": "ibm", "status": "done",
         "expectation_values": [{"label": "ZZ", "value": 0.947}]},
        times=None,
    )
    backend = provider.backend("ibm_brisbane")

    with pytest.raises(Qubit16Error, match="cannot be matched"):
        EstimatorV2(mode=backend).run(
            [(_bell_state(), {"ZZ": SparsePauliOp("ZZ"), "XX": SparsePauliOp("XX")})]
        ).result()


def test_an_over_long_label_is_refused_before_it_can_be_truncated(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a label the two ends shorten differently.

    The service truncates a label to 64 characters; the web proxy drops one
    longer than 64 from the poll query entirely, which shifts every label after
    it onto the wrong value. Refusing locally is the only outcome that cannot
    mislabel somebody's results.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    backend = provider.backend("ibm_brisbane")

    with pytest.raises(InvalidRequestError, match="64"):
        EstimatorV2(mode=backend).run([(_bell_state(), {"E" * 65: SparsePauliOp("ZZ")})])
    assert http.calls_to("POST", "/api/hardware/submit") == []
