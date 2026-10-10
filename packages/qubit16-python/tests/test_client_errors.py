"""Every refusing status maps to the exception that says what to do about it.

The failure this file exists to catch is the one that wastes an afternoon: a
503 — which this platform returns when it fails closed on a spending path, and
which means "retry shortly" — being reported to the user as an authentication
problem, sending them to rotate a key that was never wrong.
"""

from __future__ import annotations

import pytest

from qubit16.client import Qubit16Client
from qubit16.exceptions import (
    AuthenticationError,
    ConnectionFailure,
    InvalidRequestError,
    JobNotFoundError,
    PlanLimitError,
    RateLimitError,
    ScopeError,
    ServerError,
    ServiceUnavailableError,
    UnpollableJobError,
)

from conftest import FakeHTTP


def _client(http: FakeHTTP, **kwargs: object) -> Qubit16Client:
    """Build a client on the fake transport with sleeping disabled.

    Args:
        http: The fake transport.
        **kwargs: Overrides such as ``max_retries``.

    Returns:
        The client.
    """
    options: dict[str, object] = {
        "http": http,
        "sleep": lambda _seconds: None,
        "env": {},
        "max_retries": 0,
    }
    options.update(kwargs)
    return Qubit16Client("qb16_sk_test", "https://example.test", **options)  # type: ignore[arg-type]


def test_401_is_an_authentication_error_and_not_retryable(http: FakeHTTP) -> None:
    """Catches a bad credential being retried in a loop that can never pass."""
    http.route("GET", "/api/hardware/jobs", 401, {"error": "Sign-in required."})

    with pytest.raises(AuthenticationError) as caught:
        _client(http).get("/api/hardware/jobs")
    assert caught.value.retryable is False
    assert caught.value.status == 401


def test_402_is_a_plan_limit_not_an_auth_problem(http: FakeHTTP) -> None:
    """Catches a spent allowance being reported as a credential problem.

    The fix for a 402 is billing, not a new key, and telling somebody to check
    their token sends them to the wrong page entirely.
    """
    http.route(
        "POST",
        "/api/hardware/submit",
        402,
        {"detail": "You have used every hardware job included in your plan this month.",
         "upgradeUrl": "/pricing"},
    )

    with pytest.raises(PlanLimitError) as caught:
        _client(http).post("/api/hardware/submit", {})
    assert caught.value.retryable is False
    assert caught.value.body["upgradeUrl"] == "/pricing"


def test_403_names_the_missing_scope(http: FakeHTTP) -> None:
    """Catches a scope refusal that does not say which scope is missing.

    A read-only key submitting a job is the single most likely 403 here, and
    'forbidden' alone leaves the caller unable to issue the right replacement.
    """
    http.route(
        "POST",
        "/api/hardware/submit",
        403,
        {"error": "This API key does not have the 'hardware:submit' scope.",
         "detail": "This API key authenticated successfully but does not carry the "
                   "'hardware:submit' scope, so it may not perform this action."},
    )

    with pytest.raises(ScopeError) as caught:
        _client(http).post("/api/hardware/submit", {})
    assert caught.value.scope == "hardware:submit"
    assert caught.value.retryable is False


def test_429_carries_retry_after(http: FakeHTTP) -> None:
    """Catches Retry-After being dropped, which turns backoff into guesswork."""
    http.route(
        "GET", "/api/hardware/jobs", 429, {"detail": "Too many requests."},
        headers={"retry-after": "7"},
    )

    with pytest.raises(RateLimitError) as caught:
        _client(http).get("/api/hardware/jobs")
    assert caught.value.retry_after == 7.0
    assert caught.value.retryable is True


def test_503_is_fail_closed_and_retryable_not_an_auth_failure(http: FakeHTTP) -> None:
    """Catches the misreading this whole file exists for.

    This service refuses when its meter or credential store cannot answer,
    because an unknown answer on a spending path is a refusal rather than
    permission. The key is fine; the call should be retried.
    """
    http.route(
        "GET", "/api/hardware/jobs", 503,
        {"detail": "Hardware submission is temporarily unavailable because usage cannot be "
                   "metered. Nothing was submitted."},
    )

    with pytest.raises(ServiceUnavailableError) as caught:
        _client(http).get("/api/hardware/jobs")
    assert caught.value.retryable is True
    assert not isinstance(caught.value, AuthenticationError)


def test_503_on_a_read_is_retried_automatically(http: FakeHTTP) -> None:
    """Catches a transient fail-closed read surfacing to the caller anyway.

    Polling is free and idempotent, so the client absorbs this rather than
    making every caller write the same retry loop.
    """
    http.route("GET", "/api/hardware/jobs", 503, {"detail": "meter unavailable"})
    http.route("GET", "/api/hardware/jobs", 200, {"jobs": []})

    assert _client(http, max_retries=2).get("/api/hardware/jobs") == {"jobs": []}
    assert len(http.calls_to("GET", "/api/hardware/jobs")) == 2


def test_a_submission_is_never_retried_automatically(http: FakeHTTP) -> None:
    """Catches the bug that would double somebody's bill.

    A 503 from the proxy's fail-closed branch means nothing was submitted, but
    a 503 from a gateway does not — the job may already be at the vendor.
    Retrying enqueues a second billable job and returns one id, so the second
    is invisible and still costs. The caller decides, not the client.
    """
    http.route("POST", "/api/hardware/submit", 503, {"detail": "meter unavailable"}, times=None)

    with pytest.raises(ServiceUnavailableError):
        _client(http, max_retries=5).post("/api/hardware/submit", {"qasm": "x"})
    assert len(http.calls_to("POST", "/api/hardware/submit")) == 1


def test_404_on_a_job_does_not_claim_to_know_which_kind(http: FakeHTTP) -> None:
    """Catches an over-confident message about somebody else's job.

    The API answers 'unknown job' and 'not your job' identically on purpose, so
    a distinguishable client-side message would be a fabrication.
    """
    http.route("GET", "/api/hardware/job/ibm/abc", 404, {"detail": "No such job."})

    with pytest.raises(JobNotFoundError):
        _client(http).get("/api/hardware/job/ibm/abc")


def test_400_is_an_invalid_request(http: FakeHTTP) -> None:
    """Catches a malformed body being reported as something retryable."""
    http.route("POST", "/api/hardware/submit", 400, {"detail": "shots must be at most 20000."})

    with pytest.raises(InvalidRequestError) as caught:
        _client(http).post("/api/hardware/submit", {})
    assert caught.value.retryable is False


def test_500_is_a_server_error_with_the_body_kept(http: FakeHTTP) -> None:
    """Catches a 5xx being swallowed into a message with no detail to report."""
    http.route("GET", "/api/hardware/jobs", 500, {"detail": "boom"})

    with pytest.raises(ServerError) as caught:
        _client(http).get("/api/hardware/jobs")
    assert caught.value.detail == "boom"


def test_an_html_error_page_does_not_become_a_json_decode_error(http: FakeHTTP) -> None:
    """Catches a proxy's HTML 502 surfacing as JSONDecodeError from inside us.

    The caller's problem is the status; an encoding exception from a library
    they did not call hides it.
    """
    http.route("GET", "/api/hardware/jobs", 502, None)

    with pytest.raises(Exception) as caught:
        _client(http).get("/api/hardware/jobs")
    assert caught.value.status == 502  # type: ignore[attr-defined]


def test_a_dead_connection_is_a_connection_failure(http: FakeHTTP, monkeypatch) -> None:
    """Catches a transport error escaping as a raw requests exception.

    A caller catching Qubit16Error should not also have to catch
    requests.ConnectionError to write a robust loop.
    """
    import requests

    def explode(*_args: object, **_kwargs: object) -> None:
        raise requests.ConnectionError("no route to host")

    monkeypatch.setattr(http, "request", explode)

    with pytest.raises(ConnectionFailure) as caught:
        _client(http).get("/api/hardware/jobs")
    assert caught.value.retryable is True


def test_a_gateway_502_is_not_reported_as_a_spent_unpollable_job(http: FakeHTTP) -> None:
    """Catches a proxy hiccup being announced as a billed, untrackable job.

    UnpollableJobError says the vendor took the circuit and the allowance has
    been spent. On a READ — a poll, a device listing, anything a CDN can 502 on
    its own — that claim is a fabrication, and it is the kind that sends
    somebody to support convinced they have been charged for a job that never
    existed.
    """
    http.route("GET", "/api/hardware/jobs", 502, {"detail": "Bad gateway"})

    with pytest.raises(ServerError) as caught:
        _client(http).get("/api/hardware/jobs")
    assert not isinstance(caught.value, UnpollableJobError)
    assert caught.value.status == 502


def test_a_502_from_submit_is_the_unpollable_job(http: FakeHTTP) -> None:
    """Catches the real unpollable case being downgraded to a generic 5xx.

    This is the one 502 that means the circuit may be RUNNING and the allowance
    has already been counted, so the exception has to keep saying so — the
    caller must not re-submit on it.
    """
    http.route(
        "POST", "/api/hardware/submit", 502,
        {"detail": "The provider accepted the circuit but did not return a job id.",
         "unpollable": True},
    )

    with pytest.raises(UnpollableJobError) as caught:
        _client(http).post("/api/hardware/submit", {"qasm": "x"})
    assert caught.value.status == 502


def test_a_plaintext_base_url_warns_that_the_key_is_exposed(http: FakeHTTP) -> None:
    """Catches a token being sent in clear text with nothing said about it.

    base_url is overridable by argument and by QUBIT16_BASE_URL, so a copied
    staging URL can downgrade every request to http. The key is shown once and
    has to be revoked if it leaks, so this must not be silent.
    """
    with pytest.warns(UserWarning, match="clear text"):
        Qubit16Client("qb16_sk_test", "http://staging.example", http=http, env={})


def test_localhost_over_http_does_not_warn(http: FakeHTTP) -> None:
    """Catches the plaintext warning nagging at a normal local deployment.

    A warning that fires on every `http://localhost:3000` run is one people
    learn to filter out, which is how the real one gets missed.
    """
    import warnings as _warnings

    with _warnings.catch_warnings():
        _warnings.simplefilter("error")
        Qubit16Client("qb16_sk_test", "http://localhost:3000", http=http, env={})
