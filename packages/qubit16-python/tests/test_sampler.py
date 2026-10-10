"""A full sampler round trip, and the circuits that are refused before one.

The round-trip test is the one that would catch the package silently not being
a drop-in: if ``job.result()[0].data.meas.get_counts()`` stops returning a
histogram, every script this package exists to support is broken.
"""

from __future__ import annotations

import pytest
from qiskit import QuantumCircuit

from qubit16 import Qubit16Provider, SamplerV2
from qubit16.exceptions import InvalidRequestError, JobFailedError, JobTimeoutError

from conftest import BRISBANE, FakeHTTP

SUBMITTED = {
    "job_id": "d1abc",
    "backend": "ibm_brisbane",
    "status": "queued",
    "submitted_at": "2026-09-17T10:00:00Z",
    "provider": "ibm",
    "shots": 4096,
    "primitive": "sampler",
    "transpiled_depth": 11,
    "transpiled_two_qubit_gates": 1,
    "optimization_level": 3,
    "estimated_qpu_seconds": 1.4,
}


def _bell() -> QuantumCircuit:
    """A two-qubit Bell circuit with measurements.

    Returns:
        The circuit. ``measure_all`` names the register ``meas``, which is what
        makes ``result[0].data.meas`` the familiar spelling.
    """
    circuit = QuantumCircuit(2)
    circuit.h(0)
    circuit.cx(0, 1)
    circuit.measure_all()
    return circuit


def _wire_up(http: FakeHTTP) -> None:
    """Program the catalogue and a queued-then-done job.

    Args:
        http: The fake transport.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/submit", 200, SUBMITTED)
    http.route(
        "GET", "/api/hardware/job/ibm/d1abc", 200,
        {"job_id": "d1abc", "provider": "ibm", "status": "queued", "queue_position": 3},
    )
    http.route(
        "GET", "/api/hardware/job/ibm/d1abc", 200,
        {
            "job_id": "d1abc",
            "provider": "ibm",
            "status": "done",
            "backend": "ibm_brisbane",
            "counts": {"00": 2050, "11": 2046},
            "qpu_seconds": 2.1,
            "primitive": "sampler",
        },
        times=None,
    )


def test_sampler_round_trip_returns_a_qiskit_histogram(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches the drop-in promise breaking.

    This is verbatim the five lines the README tells people to write; if any of
    them stops working the package has no reason to exist.
    """
    _wire_up(http)
    backend = provider.backend("ibm_brisbane")

    sampler = SamplerV2(mode=backend, options={"optimization_level": 3})
    job = sampler.run([_bell()], shots=4096)
    counts = job.result()[0].data.meas.get_counts()

    assert counts == {"00": 2050, "11": 2046}
    assert sum(counts.values()) == 4096


def test_the_submission_carries_the_settings_that_change_results(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches an option being accepted locally and never reaching the wire.

    optimization_level is the setting that matters most — two-qubit gates
    dominate the error and level 3 routinely removes a third of them — and an
    option silently dropped here would be invisible: the job still runs, just
    worse.
    """
    _wire_up(http)
    backend = provider.backend("ibm_brisbane")

    SamplerV2(
        mode=backend,
        options={
            "optimization_level": 3,
            "dynamical_decoupling": True,
            "measurement_twirling": True,
        },
    ).run([_bell()], shots=1024)

    body = http.calls_to("POST", "/api/hardware/submit")[0].json
    assert body["backend"] == "ibm_brisbane"
    assert body["shots"] == 1024
    assert body["optimization_level"] == 3
    assert body["dynamical_decoupling"] is True
    assert body["measurement_twirling"] is True
    assert body["qasm"].startswith("OPENQASM 3.0")
    # A sampler submission must not carry observables — that would make it an
    # estimator job at the vendor and return no histogram at all.
    assert "observables" not in body


def test_result_polls_until_the_job_leaves_the_queue(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches result() reading the first poll and treating 'queued' as final."""
    _wire_up(http)
    backend = provider.backend("ibm_brisbane")

    job = SamplerV2(mode=backend).run([_bell()])
    job.result()

    assert len(http.calls_to("GET", "/api/hardware/job/ibm/d1abc")) >= 2


def test_a_second_result_call_does_not_re_poll(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a terminal answer being re-fetched on every access.

    Reads are limited to 60/minute, and a loop that inspects a finished job
    several times should not spend that budget.
    """
    _wire_up(http)
    backend = provider.backend("ibm_brisbane")

    job = SamplerV2(mode=backend).run([_bell()])
    job.result()
    before = len(http.calls_to("GET", "/api/hardware/job/ibm/d1abc"))
    job.result()

    assert len(http.calls_to("GET", "/api/hardware/job/ibm/d1abc")) == before


def test_pub_metadata_separates_estimated_from_measured_qpu_time(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a projection being presented as a measurement.

    The vendor's pre-run estimate and the metered figure are different claims
    and must not share a field name.
    """
    _wire_up(http)
    backend = provider.backend("ibm_brisbane")

    metadata = SamplerV2(mode=backend).run([_bell()]).result()[0].metadata
    assert metadata["estimated_qpu_seconds"] == 1.4
    assert metadata["qpu_seconds"] == 2.1
    assert metadata["transpiled_two_qubit_gates"] == 1


def test_a_failed_job_raises_with_the_provider_s_reason(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a failure being returned as an empty result instead of raised."""
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/submit", 200, SUBMITTED)
    http.route(
        "GET", "/api/hardware/job/ibm/d1abc", 200,
        {"job_id": "d1abc", "provider": "ibm", "status": "error",
         "error": "The circuit exceeds the device's instruction limit."},
        times=None,
    )
    backend = provider.backend("ibm_brisbane")

    with pytest.raises(JobFailedError) as caught:
        SamplerV2(mode=backend).run([_bell()]).result()
    assert caught.value.job_status == "error"
    assert "instruction limit" in str(caught.value)


def test_a_timeout_says_the_job_is_unaffected_and_names_the_handle(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a timeout reading as a lost job.

    The job is queued at the vendor, has already been counted against the
    allowance, and will finish. A timeout that does not say so invites a
    re-submission that spends the allowance twice.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/submit", 200, SUBMITTED)
    http.route(
        "GET", "/api/hardware/job/ibm/d1abc", 200,
        {"job_id": "d1abc", "provider": "ibm", "status": "queued"},
        times=None,
    )
    backend = provider.backend("ibm_brisbane")

    with pytest.raises(JobTimeoutError) as caught:
        SamplerV2(mode=backend).run([_bell()]).result(timeout=0)
    assert caught.value.job_ids == ["d1abc"]
    assert "UNAFFECTED" in str(caught.value)


def test_a_circuit_with_no_measurements_is_refused_before_it_costs_anything(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches an unmeasured circuit being submitted and returning nothing.

    It would run, spend a job of the allowance and come back with an empty
    histogram. Refusing locally costs the caller nothing.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    backend = provider.backend("ibm_brisbane")

    circuit = QuantumCircuit(2)
    circuit.h(0)

    with pytest.raises(InvalidRequestError, match="measure_all"):
        SamplerV2(mode=backend).run([circuit])
    assert http.calls_to("POST", "/api/hardware/submit") == []


def test_two_classical_registers_are_refused_rather_than_silently_halved(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches the wire format's one-histogram rule failing silently.

    The service builds the histogram from the first register-shaped field on
    the vendor's result, so a second register is dropped with nothing saying
    so. Returning the survivor would be worse than refusing.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    backend = provider.backend("ibm_brisbane")

    circuit = QuantumCircuit(2, 0)
    from qiskit import ClassicalRegister

    first, second = ClassicalRegister(1, "a"), ClassicalRegister(1, "b")
    circuit.add_register(first)
    circuit.add_register(second)
    circuit.measure(0, first[0])
    circuit.measure(1, second[0])

    with pytest.raises(InvalidRequestError, match="classical registers"):
        SamplerV2(mode=backend).run([circuit])


def test_shots_above_the_api_ceiling_are_refused_locally(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a bound that exists on the server and not here.

    The round trip would end in a 400 anyway; failing locally makes the
    message arrive at the call that is wrong.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    backend = provider.backend("ibm_brisbane")

    with pytest.raises(InvalidRequestError, match="20000"):
        SamplerV2(mode=backend).run([_bell()], shots=50_000)


def test_each_pub_is_its_own_job_and_its_own_allowance_unit(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches multi-pub batching being faked.

    The wire carries one circuit per submission. If this ever appears to cost
    one job for three pubs, the count is wrong somewhere and somebody's
    allowance is being spent without being reported.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/submit", 200, SUBMITTED, times=None)
    http.route(
        "GET", "/api/hardware/job/ibm/d1abc", 200,
        {"job_id": "d1abc", "provider": "ibm", "status": "done",
         "counts": {"00": 4096}},
        times=None,
    )
    backend = provider.backend("ibm_brisbane")

    job = SamplerV2(mode=backend).run([_bell(), _bell(), _bell()])

    assert len(http.calls_to("POST", "/api/hardware/submit")) == 3
    assert len(job.result()) == 3


def test_backend_run_still_works_for_legacy_scripts(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches `backend.run(qc, shots=...)` breaking.

    Plenty of existing code predates the V2 primitives. It should reach
    hardware here, even though what comes back is the V2 result shape rather
    than the old qiskit.result.Result — which the docstring says plainly rather
    than faking a second container.
    """
    _wire_up(http)
    backend = provider.backend("ibm_brisbane")

    job = backend.run(_bell(), shots=1024, optimization_level=3)

    assert http.calls_to("POST", "/api/hardware/submit")[0].json["shots"] == 1024
    assert job.counts() == {"00": 2050, "11": 2046}


def test_backend_run_refuses_a_list_of_circuits(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches one run() call quietly spending several allowance units.

    Each circuit is a separate submission. A caller passing five circuits to
    the legacy entry point almost certainly expects one job, so this refuses
    and says why rather than enqueueing five.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    backend = provider.backend("ibm_brisbane")

    with pytest.raises(ValueError, match="one circuit"):
        backend.run([_bell(), _bell()])
    assert http.calls_to("POST", "/api/hardware/submit") == []


def test_a_numpy_shot_count_is_accepted(provider: Qubit16Provider, http: FakeHTTP) -> None:
    """Catches ordinary scientific code being refused at the door.

    `shots=n_shots[i]` out of a numpy array is a numpy integer, which is not an
    `int`. Refusing it would break exactly the code this package exists to run
    unchanged — while `shots=4096.0` stays refused, because rounding somebody's
    arithmetic for them is a different decision.
    """
    import numpy as np

    _wire_up(http)
    backend = provider.backend("ibm_brisbane")

    SamplerV2(mode=backend).run([_bell()], shots=np.int64(1024))
    assert http.calls_to("POST", "/api/hardware/submit")[0].json["shots"] == 1024

    with pytest.raises(InvalidRequestError, match="positive integer"):
        SamplerV2(mode=backend).run([_bell()], shots=1024.0)


def test_a_foreign_backend_is_refused_at_the_line_that_is_wrong(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a qiskit-ibm-runtime backend being duck-typed into working.

    An IBMBackend has both `.name` and `.service`, so a check for those two
    attributes accepts it — and the script then fails with an AttributeError
    from inside the submission path, long after the reader has concluded the
    swap worked. The refusal has to land on the backend line.
    """

    class _LooksLikeAnIBMBackend:
        name = "ibm_brisbane"
        service = object()

    with pytest.raises(ValueError, match="qiskit-ibm-runtime"):
        SamplerV2(mode=_LooksLikeAnIBMBackend())  # type: ignore[arg-type]
