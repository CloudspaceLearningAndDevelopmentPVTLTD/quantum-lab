"""Offline tests for the submission path's provider-facing behaviour.

Nothing here reaches a network. Every vendor object is a fake injected into
the module under test, which is the only way to assert on things that are
otherwise invisible until a real job has been billed for: which instance the
service was addressed to, which optimisation level the circuit was compiled
at, and which tags were stamped on the job.

These are the assertions that would have caught the four defects this file was
written alongside - a service built without an instance, a service rebuilt on
every poll, a submission hardcoded to optimisation level 1 while the preview
ran at another, and an untagged job that nobody could attribute in IBM's own
console.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.core.config import settings
from app.quantum import hardware

BELL_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c = measure q;
"""


def _fake_backend() -> Any:
    """Build an offline stand-in for an IBM device.

    Qiskit's ``GenericBackendV2`` rather than a hand-rolled object with a
    ``name`` attribute: ``qiskit.transpile(circuit, backend=...)`` reads the
    backend's ``Target`` — its coupling map, basis and instruction durations —
    so a duck-typed fake cannot exercise the transpile step at all, which is
    precisely the step these tests need to run for the depth and two-qubit
    assertions to mean anything. Five qubits and a fixed seed keep it fast and
    deterministic.

    Returns:
        A real ``BackendV2`` that never touches the network.
    """
    from qiskit.providers.fake_provider import GenericBackendV2

    return GenericBackendV2(num_qubits=5, seed=7)


class FakeJob:
    """Stands in for a ``RuntimeJobV2``."""

    def __init__(self, job_id: str = "fake-job-1") -> None:
        """Record the id this fake will report.

        Args:
            job_id: The id ``job_id()`` returns.
        """
        self._job_id = job_id
        self.usage_estimation = {"quantum_seconds": 1.5}

    def job_id(self) -> str:
        """Return the fake job id.

        Returns:
            The recorded id.
        """
        return self._job_id

    def status(self) -> str:
        """Report the job as queued.

        Returns:
            The raw vendor status string.
        """
        return "QUEUED"


class FakeService:
    """Stands in for ``QiskitRuntimeService`` and records how it was built."""

    #: Every construction, in order, as the kwargs it was given. Class-level
    #: so a test can assert on constructions that happened inside the module.
    constructions: list[dict[str, Any]] = []

    def __init__(self, **kwargs: Any) -> None:
        """Record the construction kwargs.

        Args:
            **kwargs: Whatever the module passed.
        """
        FakeService.constructions.append(kwargs)

    def backend(self, name: str) -> Any:
        """Return a fake backend regardless of the name asked for.

        Args:
            name: Ignored.

        Returns:
            The fake backend.
        """
        return _fake_backend()


class FakeSampler:
    """Stands in for ``SamplerV2`` and records the options it was given."""

    #: Every ``(mode, options)`` pair the module constructed, in order.
    constructions: list[dict[str, Any]] = []
    #: Every ``run`` call's shot count, in order.
    runs: list[int] = []

    def __init__(self, mode: Any = None, options: Any = None) -> None:
        """Record the construction.

        Args:
            mode: The backend or session.
            options: The primitive options dictionary.
        """
        FakeSampler.constructions.append({"mode": mode, "options": options})

    def run(self, pubs: Any, shots: int | None = None) -> FakeJob:
        """Record the run and return a fake job.

        Args:
            pubs: The transpiled circuits.
            shots: Requested repetitions.

        Returns:
            A fake job handle.
        """
        FakeSampler.runs.append(int(shots or 0))
        return FakeJob()


@pytest.fixture(autouse=True)
def _fake_ibm(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point the module at the fakes and give it a token to find.

    Args:
        monkeypatch: pytest's environment and attribute patcher.
    """
    FakeService.constructions = []
    FakeSampler.constructions = []
    FakeSampler.runs = []
    # The service cache is keyed on the token, but it is module state and a
    # leftover entry from another test would hide a construction this test is
    # asserting on. Clear it rather than relying on the key.
    hardware._IBM_SERVICE_CACHE.clear()
    monkeypatch.setattr(settings, "ibm_quantum_token", "test-token", raising=False)
    monkeypatch.setattr(settings, "ibm_quantum_instance", None, raising=False)
    monkeypatch.setattr(settings, "ibm_quantum_region", None, raising=False)
    monkeypatch.setattr(settings, "ibm_quantum_channel", "ibm_quantum_platform", raising=False)
    # Takes the optional `credentials` argument the real one grew for BYOK, so
    # this double keeps matching the signature it stands in for.
    monkeypatch.setattr(
        hardware, "_require_ibm", lambda credentials=None: (FakeService, FakeSampler)
    )


def test_submit_addresses_the_configured_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    """A configured CRN is passed to the service rather than left to the SDK.

    Without it the SDK enumerates every instance the token can see and picks
    one, so a submission meant for a paid instance can land on an Open-plan
    queue with a different allowance and a different bill.

    Args:
        monkeypatch: pytest's attribute patcher.
    """
    crn = "crn:v1:bluemix:public:quantum-computing:us-east:a/acct:guid::"
    monkeypatch.setattr(settings, "ibm_quantum_instance", crn, raising=False)

    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100)

    assert FakeService.constructions[0]["instance"] == crn


def test_instance_is_omitted_when_unset() -> None:
    """With no CRN configured the key is absent, not present-and-None.

    An explicit ``instance=None`` has been read by the SDK as "no instance is
    acceptable" rather than "choose for me", which would break exactly the
    single-instance accounts this default exists to keep working.
    """
    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100)

    assert "instance" not in FakeService.constructions[0]
    assert FakeService.constructions[0]["token"] == "test-token"


def test_the_service_is_built_once_and_reused() -> None:
    """Submitting twice authenticates once.

    JobMonitor polls a running job for its whole lifetime; on a six-hour queue
    a per-call service meant hundreds of logins to read one status field.
    """
    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100)
    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100)

    assert len(FakeService.constructions) == 1


def test_a_changed_token_builds_a_new_service(monkeypatch: pytest.MonkeyPatch) -> None:
    """The cache is keyed on the credentials, so a rotated token takes effect.

    Args:
        monkeypatch: pytest's attribute patcher.
    """
    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100)
    monkeypatch.setattr(settings, "ibm_quantum_token", "rotated-token", raising=False)
    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100)

    assert [c["token"] for c in FakeService.constructions] == ["test-token", "rotated-token"]


def test_the_job_is_tagged_with_the_platform_and_the_owner() -> None:
    """Tags are the only handle on the vendor's side.

    They are what makes a job attributable in IBM's console and recoverable
    through ``service.jobs(job_tags=...)`` when our own record of it is lost.
    """
    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100, owner="abc123")

    tags = FakeSampler.constructions[0]["options"]["environment"]["job_tags"]
    assert tags == ["qubit16", "owner:abc123"]


def test_an_unattributed_submission_still_carries_the_platform_tag() -> None:
    """No owner is not a reason to submit an anonymous job."""
    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100)

    tags = FakeSampler.constructions[0]["options"]["environment"]["job_tags"]
    assert tags == ["qubit16"]


def test_dynamical_decoupling_is_off_unless_asked_for() -> None:
    """The default submission carries no pulse-level options at all."""
    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100)

    assert "dynamical_decoupling" not in FakeSampler.constructions[0]["options"]


def test_dynamical_decoupling_is_requested_as_xy4_when_asked_for() -> None:
    """Asking for decoupling sends a concrete sequence, not just a flag."""
    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100, dynamical_decoupling=True)

    options = FakeSampler.constructions[0]["options"]["dynamical_decoupling"]
    assert options == {"enable": True, "sequence_type": "XY4"}


def test_the_submission_reports_the_level_it_compiled_at() -> None:
    """The record says which level ran, so a preview can be checked against it."""
    result = hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100, optimization_level=3)

    assert result["optimization_level"] == 3


def test_the_submission_reports_what_was_actually_sent() -> None:
    """Depth and two-qubit count describe the transpiled circuit, not the source.

    A Bell pair is two qubits and one entangling gate however it is compiled,
    so the two-qubit count is exact; the depth only has to be real.
    """
    result = hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100)

    assert result["transpiled_two_qubit_gates"] == 1
    assert result["transpiled_depth"] >= 2


def test_the_vendors_own_qpu_estimate_is_passed_through() -> None:
    """QPU seconds is the unit IBM bills in, so it is surfaced before the queue."""
    result = hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100)

    assert result["estimated_qpu_seconds"] == pytest.approx(1.5)


@pytest.mark.parametrize("level", [-1, 4, 99])
def test_an_out_of_range_optimisation_level_is_refused(level: int) -> None:
    """Qiskit's levels are 0-3; anything else fails here, not inside Qiskit.

    Args:
        level: The invalid level under test.
    """
    with pytest.raises(ValueError, match="optimization_level"):
        hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100, optimization_level=level)


def test_a_boolean_optimisation_level_is_refused() -> None:
    """``True`` is an int in Python and would silently mean level 1."""
    with pytest.raises(ValueError, match="optimization_level"):
        hardware.submit_ibm_job(
            BELL_QASM,
            "ibm_brisbane",
            shots=100,
            optimization_level=True,  # type: ignore[arg-type]
        )


def test_submit_job_passes_the_level_through_to_the_provider() -> None:
    """The dispatcher must not quietly re-default what the caller asked for."""
    result = hardware.submit_job(
        BELL_QASM, "ibm_brisbane", 100, hardware.PROVIDER_IBM, optimization_level=2
    )

    assert result["optimization_level"] == 2


def test_submit_job_defaults_to_level_one() -> None:
    """A caller that omits the level gets the behaviour that predated it."""
    result = hardware.submit_job(BELL_QASM, "ibm_brisbane", 100, hardware.PROVIDER_IBM)

    assert result["optimization_level"] == 1


def test_measurement_twirling_is_off_unless_asked_for() -> None:
    """The default submission requests no twirling at all."""
    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100)

    assert "twirling" not in FakeSampler.constructions[0]["options"]


def test_measurement_twirling_enables_only_measurement_twirling() -> None:
    """Readout twirling, not gate twirling.

    ``enable_gates`` multiplies circuit variants and is a different trade; this
    control is specifically the free one that symmetrises readout bias.
    """
    hardware.submit_ibm_job(BELL_QASM, "ibm_brisbane", shots=100, measurement_twirling=True)

    assert FakeSampler.constructions[0]["options"]["twirling"] == {"enable_measure": True}


def test_the_record_says_which_suppression_ran() -> None:
    """Two runs with different suppression are different experiments.

    The stored record has to be able to tell them apart, so the flags are
    echoed back rather than left for the caller to remember what it asked for.
    """
    result = hardware.submit_ibm_job(
        BELL_QASM,
        "ibm_brisbane",
        shots=100,
        dynamical_decoupling=True,
        measurement_twirling=False,
    )

    assert result["dynamical_decoupling"] is True
    assert result["measurement_twirling"] is False


def test_submit_job_passes_suppression_through_to_the_provider() -> None:
    """The dispatcher must not drop what the caller asked for."""
    hardware.submit_job(
        BELL_QASM,
        "ibm_brisbane",
        100,
        hardware.PROVIDER_IBM,
        dynamical_decoupling=True,
        measurement_twirling=True,
    )

    options = FakeSampler.constructions[0]["options"]
    assert options["dynamical_decoupling"] == {"enable": True, "sequence_type": "XY4"}
    assert options["twirling"] == {"enable_measure": True}


# ── Estimator ───────────────────────────────────────────────────────────────


class FakeEstimator:
    """Stands in for ``EstimatorV2`` and records what it was asked to run."""

    #: Every ``(mode, options)`` pair, in order.
    constructions: list[dict[str, Any]] = []
    #: Every ``run`` call's pub list, in order.
    runs: list[Any] = []

    def __init__(self, mode: Any = None, options: Any = None) -> None:
        """Record the construction.

        Args:
            mode: The backend or session.
            options: The primitive options dictionary.
        """
        FakeEstimator.constructions.append({"mode": mode, "options": options})

    def run(self, pubs: Any, precision: float | None = None) -> FakeJob:
        """Record the run and return a fake job.

        Args:
            pubs: The estimator pubs.
            precision: Ignored.

        Returns:
            A fake job handle.
        """
        FakeEstimator.runs.append(pubs)
        return FakeJob()


@pytest.fixture(autouse=True)
def _fake_estimator(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point the estimator path at the fake too.

    Args:
        monkeypatch: pytest's attribute patcher.
    """
    FakeEstimator.constructions = []
    FakeEstimator.runs = []
    monkeypatch.setattr(hardware, "_require_ibm_estimator", lambda: FakeEstimator)


#: The same Bell pair with the measurement removed. An Estimator needs the
#: un-measured state: a terminal measurement collapses it before the observable
#: is ever applied.
BELL_NO_MEASURE = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
h q[0];
cx q[0], q[1];
"""


def _zz() -> list[dict[str, Any]]:
    """Return a parsed single-observable list for a 2-qubit circuit.

    Returns:
        One observable measuring ZZ.
    """
    from app.quantum.observables import parse_observables

    return parse_observables([{"label": "zz", "terms": [{"pauli": "ZZ"}]}], 2)


def test_an_estimator_circuit_with_measurements_is_refused() -> None:
    """A terminal measurement collapses the state before the observable runs.

    Refused rather than silently stripped: stripping would edit the caller's
    circuit and hand back a number for something they did not submit.
    """
    with pytest.raises(ValueError, match="must not contain measurements"):
        hardware.submit_ibm_estimator_job(BELL_QASM, "ibm_brisbane", _zz(), shots=100)


def test_the_estimator_runs_one_pub_with_an_observable_array() -> None:
    """One pub, not one per observable, so commuting terms can be grouped.

    ``expectation_values`` reads the result in the shape this produces, so the
    two have to agree — and this is the assertion that keeps them agreeing.
    """
    from app.quantum.observables import parse_observables

    observables = parse_observables(
        [
            {"label": "a", "terms": [{"pauli": "ZZ"}]},
            {"label": "b", "terms": [{"pauli": "XX"}]},
        ],
        2,
    )
    hardware.submit_ibm_estimator_job(BELL_NO_MEASURE, "ibm_brisbane", observables, shots=100)

    pubs = FakeEstimator.runs[0]
    assert len(pubs) == 1
    circuit, operators = pubs[0]
    assert len(operators) == 2
    # Widened to the device, which is the whole point of apply_layout.
    assert operators[0].num_qubits == circuit.num_qubits


def test_the_estimator_defaults_to_readout_mitigation() -> None:
    """An unmitigated expectation value is biased in a way that reads as physics.

    Level 1 is close to free, so the default that costs a user nothing and
    misleads them least is the one that is on.
    """
    hardware.submit_ibm_estimator_job(BELL_NO_MEASURE, "ibm_brisbane", _zz(), shots=100)

    assert FakeEstimator.constructions[0]["options"]["resilience_level"] == 1


@pytest.mark.parametrize("level", [-1, 3, 99])
def test_an_out_of_range_resilience_level_is_refused(level: int) -> None:
    """Levels above 2 are documented but not generally available.

    Accepting one would produce a vendor rejection AFTER the quota was spent.

    Args:
        level: The invalid level under test.
    """
    with pytest.raises(ValueError, match="resilience_level"):
        hardware.submit_ibm_estimator_job(
            BELL_NO_MEASURE, "ibm_brisbane", _zz(), shots=100, resilience_level=level
        )


def test_the_estimator_record_names_the_observables() -> None:
    """IBM stores the observables but not our names for them.

    The labels have to travel in our own record or a poll gets an array of
    floats with no way to say which is which.
    """
    result = hardware.submit_ibm_estimator_job(
        BELL_NO_MEASURE, "ibm_brisbane", _zz(), shots=100
    )

    assert result["primitive"] == "estimator"
    assert result["observable_labels"] == ["zz"]


def test_submit_job_routes_to_the_estimator_when_observables_are_present() -> None:
    """The presence of observables is what selects the primitive."""
    result = hardware.submit_job(
        BELL_NO_MEASURE, "ibm_brisbane", 100, hardware.PROVIDER_IBM, observables=_zz()
    )

    assert result["primitive"] == "estimator"
    assert FakeSampler.constructions == []


def test_submit_job_routes_to_the_sampler_without_observables() -> None:
    """And the sampler stays the default, unchanged."""
    result = hardware.submit_job(BELL_QASM, "ibm_brisbane", 100, hardware.PROVIDER_IBM)

    assert result["primitive"] == "sampler"
    assert FakeEstimator.constructions == []


def test_a_braket_backend_refuses_observables_rather_than_sampling() -> None:
    """Silently sampling instead would answer a different question.

    A caller who asked for ⟨ZZ⟩ and received a histogram has been given
    something they did not ask for, in a shape their code will not read.
    """
    with pytest.raises(ValueError, match="only available on IBM"):
        hardware.submit_job(
            BELL_NO_MEASURE, "ionq_aria", 100, hardware.PROVIDER_BRAKET, observables=_zz()
        )


def test_a_braket_backend_refuses_a_session() -> None:
    """Sessions are an IBM reservation; there is no Braket equivalent to join."""
    with pytest.raises(ValueError, match="IBM feature"):
        hardware.submit_job(
            BELL_QASM, "ionq_aria", 100, hardware.PROVIDER_BRAKET, session_id="s-1"
        )
