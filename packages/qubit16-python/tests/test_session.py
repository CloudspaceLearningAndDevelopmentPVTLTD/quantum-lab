"""Sessions, and the one guarantee that matters: ``__exit__`` always closes.

A session bills for its whole open window whether or not jobs run, so a leak
here is not a resource leak — it is an invoice. The test that matters most in
this file is the one where the body raises.
"""

from __future__ import annotations

import pytest
from qiskit import QuantumCircuit

from qubit16 import Qubit16Provider, SamplerV2, Session
from qubit16.exceptions import Qubit16Error, ServiceUnavailableError

from conftest import BRISBANE, FakeHTTP

OPENED = {
    "session_id": "sess123",
    "backend": "ibm_brisbane",
    "max_time_seconds": 3600,
    "opened_at": "2026-09-17T10:00:00Z",
    "provider": "ibm",
}


def _bell() -> QuantumCircuit:
    """A measured Bell circuit.

    Returns:
        The circuit.
    """
    circuit = QuantumCircuit(2)
    circuit.h(0)
    circuit.cx(0, 1)
    circuit.measure_all()
    return circuit


def test_the_session_closes_when_the_block_raises(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """THE test of this file: an exception must not leave the meter running.

    An optimiser that diverges, a KeyboardInterrupt, a bug in the caller's own
    cost function — all of them leave the block by the exception path, and all
    of them must still stop the billing.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/session", 200, OPENED)
    http.route("DELETE", "/api/hardware/session/sess123", 200, {"session_id": "sess123",
                                                                "closed": True})
    backend = provider.backend("ibm_brisbane")

    with pytest.raises(ZeroDivisionError):
        with Session(backend=backend) as session:
            assert session.session_id == "sess123"
            raise ZeroDivisionError("the optimiser diverged")

    assert len(http.calls_to("DELETE", "/api/hardware/session/sess123")) == 1


def test_the_session_closes_on_the_happy_path_too(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a close that only runs in the exception handler."""
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/session", 200, OPENED)
    http.route("DELETE", "/api/hardware/session/sess123", 200, {"closed": True})
    backend = provider.backend("ibm_brisbane")

    with Session(backend=backend):
        pass

    assert len(http.calls_to("DELETE", "/api/hardware/session/sess123")) == 1


def test_nothing_is_opened_until_the_block_is_entered(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches construction starting a meter.

    A Session built in a function that raises two lines later would otherwise
    bill for an hour with no jobs in it.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    backend = provider.backend("ibm_brisbane")

    session = Session(backend=backend)

    assert session.session_id is None
    assert http.calls_to("POST", "/api/hardware/session") == []


def test_a_failed_close_during_an_exception_does_not_mask_it(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a housekeeping error replacing the caller's real one.

    If the DELETE fails while an exception is unwinding, the caller needs to
    see why their loop broke — and still needs to be told the meter may be
    running, which is what the warning is for.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/session", 200, OPENED)
    http.route("DELETE", "/api/hardware/session/sess123", 503, {"detail": "unavailable"},
               times=None)
    backend = provider.backend("ibm_brisbane")

    with pytest.warns(UserWarning, match="STILL BE BILLING"):
        with pytest.raises(ValueError, match="the real problem"):
            with Session(backend=backend):
                raise ValueError("the real problem")


def test_a_failed_close_on_the_happy_path_is_raised(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a failed close being swallowed when nothing else went wrong.

    A session that would not close is still billing; silence here is the
    expensive kind.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/session", 200, OPENED)
    http.route("DELETE", "/api/hardware/session/sess123", 503, {"detail": "unavailable"},
               times=None)
    backend = provider.backend("ibm_brisbane")

    with pytest.raises(ServiceUnavailableError):
        with Session(backend=backend):
            pass


def test_jobs_submitted_inside_a_session_carry_its_id(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches the session id never reaching the submission.

    Without it the job queues on the bare backend and the reserved window is
    paid for and unused — and the only symptom is that the loop is mysteriously
    slow, which is exactly the problem the session was opened to fix.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/session", 200, OPENED)
    http.route("DELETE", "/api/hardware/session/sess123", 200, {"closed": True})
    http.route("POST", "/api/hardware/submit", 200,
               {"job_id": "d1abc", "provider": "ibm", "backend": "ibm_brisbane",
                "status": "queued", "shots": 4096, "submitted_at": "x",
                "session_id": "sess123"},
               times=None)
    backend = provider.backend("ibm_brisbane")

    with Session(backend=backend) as session:
        SamplerV2(mode=session).run([_bell()])

    body = http.calls_to("POST", "/api/hardware/submit")[0].json
    assert body["session_id"] == "sess123"


def test_submitting_through_a_closed_session_is_refused(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a silent fall back to the bare backend.

    Falling back would 'work' — the job runs — while throwing away the window
    the caller opened and is paying for. Refusing is the honest failure.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/session", 200, OPENED)
    http.route("DELETE", "/api/hardware/session/sess123", 200, {"closed": True})
    backend = provider.backend("ibm_brisbane")

    with Session(backend=backend) as session:
        sampler = SamplerV2(mode=session)

    with pytest.raises(Qubit16Error, match="not open"):
        sampler.run([_bell()])


def test_max_time_is_bounded_by_the_service_s_own_range() -> None:
    """Catches an unbounded window reaching the API as a 400 — or worse, not.

    max_time is the backstop for a process that dies before it can close, and
    a session bills for its whole window.
    """
    with pytest.raises(ValueError, match="28800"):
        Session(backend="ibm_brisbane", service=object(), max_time=100_000)  # type: ignore[arg-type]


def test_a_closed_session_cannot_be_reopened(
    provider: Qubit16Provider, http: FakeHTTP
) -> None:
    """Catches a reopen that would fail confusingly at the next submission.

    A runtime session cannot be rejoined once closed, so pretending here would
    move the failure somewhere less obvious.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    http.route("POST", "/api/hardware/session", 200, OPENED)
    http.route("DELETE", "/api/hardware/session/sess123", 200, {"closed": True})
    backend = provider.backend("ibm_brisbane")

    session = Session(backend=backend)
    with session:
        pass

    with pytest.raises(RuntimeError, match="cannot be reopened"):
        session.open()
