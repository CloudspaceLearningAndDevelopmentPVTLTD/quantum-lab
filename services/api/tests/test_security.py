"""CORS hardening and the optional shared-secret gate.

Covers audit findings CORS-1 and PY-3. The important property in both cases is
that the DEFAULT behaviour is unchanged — this service is unauthenticated by
design and local development must keep working with an empty environment — while
the dangerous configurations are refused loudly.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, settings
from app.core.security import SHARED_SECRET_HEADER
from app.main import app

BELL_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c = measure q;
"""


@pytest.fixture()
def client() -> TestClient:
    """A test client over the real app."""
    return TestClient(app)


# --------------------------------------------------------------------------- #
# CORS-1 — the wildcard footgun
# --------------------------------------------------------------------------- #


def test_wildcard_origin_is_refused() -> None:
    """`ALLOWED_ORIGINS=*` with allow_credentials=True must not start."""
    with pytest.raises(ValueError) as excinfo:
        Settings(allowed_origins="*").origins_list
    assert "ALLOWED_ORIGINS" in str(excinfo.value)


def test_wildcard_is_refused_even_alongside_a_real_origin() -> None:
    """One wildcard in the list makes the whole list permissive; refuse it."""
    with pytest.raises(ValueError):
        Settings(allowed_origins="https://app.example,*").origins_list


def test_a_real_origin_list_is_accepted() -> None:
    """The configuration an operator is meant to use."""
    parsed = Settings(allowed_origins="https://app.example, https://staging.example").origins_list
    assert parsed == ["https://app.example", "https://staging.example"]


def test_unset_defaults_to_localhost_only() -> None:
    """Unset is 'local development', never 'anything goes'."""
    assert Settings().origins_list == ["http://localhost:3000"]


def test_cors_allows_the_configured_origin(client: TestClient) -> None:
    """A preflight from the configured origin is answered for it, not for '*'."""
    response = client.options(
        "/api/circuits/run",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.headers.get("access-control-allow-credentials") == "true"


def test_cors_refuses_an_unconfigured_origin(client: TestClient) -> None:
    """The browser is told nothing that would let evil.example read a response."""
    response = client.options(
        "/api/circuits/run",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.headers.get("access-control-allow-origin") != "https://evil.example"
    assert response.headers.get("access-control-allow-origin") != "*"


# --------------------------------------------------------------------------- #
# PY-3 — the optional shared secret
# --------------------------------------------------------------------------- #


def test_unset_secret_leaves_the_service_wide_open(client: TestClient) -> None:
    """The default is unchanged: unauthenticated, by design.

    This is asserted rather than assumed, because "we added auth and quietly
    broke every existing caller" is the failure mode this design avoids.
    """
    assert not settings.api_shared_secret
    assert client.get("/api/health").status_code == 200
    assert client.get("/").status_code == 200
    assert client.post("/api/circuits/run", json={"qasm": BELL_QASM, "shots": 8}).status_code == 200


def test_a_configured_secret_is_required(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With the secret set, an unauthenticated call is refused before the route."""
    monkeypatch.setattr(settings, "api_shared_secret", "s3cret")
    response = client.post("/api/circuits/run", json={"qasm": BELL_QASM, "shots": 8})
    assert response.status_code == 401
    assert SHARED_SECRET_HEADER.lower() in response.json()["detail"].lower()


def test_the_right_secret_is_accepted(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The Next server, holding the secret, is served normally."""
    monkeypatch.setattr(settings, "api_shared_secret", "s3cret")
    response = client.post(
        "/api/circuits/run",
        json={"qasm": BELL_QASM, "shots": 8},
        headers={SHARED_SECRET_HEADER: "s3cret"},
    )
    assert response.status_code == 200


def test_a_wrong_secret_is_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A near miss is still a miss."""
    monkeypatch.setattr(settings, "api_shared_secret", "s3cret")
    for attempt in ("", "s3cre", "s3cret ", "S3CRET"):
        response = client.post(
            "/api/circuits/run",
            json={"qasm": BELL_QASM, "shots": 8},
            headers={SHARED_SECRET_HEADER: attempt},
        )
        assert response.status_code == 401, attempt


def test_health_stays_reachable_for_probes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A liveness probe cannot be given a secret, and a failing probe is an outage."""
    monkeypatch.setattr(settings, "api_shared_secret", "s3cret")
    assert client.get("/api/health").status_code == 200
    # …and nothing else is exempt, including the index.
    assert client.get("/").status_code == 401


def test_hardware_submit_is_covered(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The endpoint that spends real money is behind the gate too."""
    monkeypatch.setattr(settings, "api_shared_secret", "s3cret")
    response = client.post(
        "/api/hardware/submit",
        json={"qasm": BELL_QASM, "shots": 100, "device_id": "ibm_brisbane"},
    )
    assert response.status_code == 401


# --------------------------------------------------------------------------- #
# Rotation — accepting more than one secret during the overlap window
#
# `infra/azure/deploy.sh` regenerated this secret on EVERY deploy and updated
# the api before the web container, so every deploy spent several minutes with
# web presenting a value the api no longer accepted and every proxied hardware
# call returning 401. Accepting a list is what makes a gapless rotation
# possible: teach the api both values, move web to the new one, retire the old.
# --------------------------------------------------------------------------- #


def test_both_secrets_work_during_an_overlap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mid-rotation, the old and the new value are both served.

    This is the whole point of the list. If either were refused there would be
    a window in which a correctly-configured caller is turned away, which is
    the outage this replaced.
    """
    monkeypatch.setattr(settings, "api_shared_secret", "old-value,new-value")
    for presented in ("old-value", "new-value"):
        response = client.post(
            "/api/circuits/run",
            json={"qasm": BELL_QASM, "shots": 8},
            headers={SHARED_SECRET_HEADER: presented},
        )
        assert response.status_code == 200, f"{presented} was refused mid-rotation"


def test_retiring_the_old_secret_actually_retires_it(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """After step 3 narrows the list, the previous value stops working.

    An overlap left in place forever would mean the secret being rotated away
    from is still accepted, which defeats the entire point of rotating.
    """
    monkeypatch.setattr(settings, "api_shared_secret", "new-value")
    response = client.post(
        "/api/circuits/run",
        json={"qasm": BELL_QASM, "shots": 8},
        headers={SHARED_SECRET_HEADER: "old-value"},
    )
    assert response.status_code == 401


def test_a_blank_list_entry_never_authenticates(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """THE DANGEROUS ONE, and the reason accepted_secrets() filters blanks.

    A trailing comma, or a shell that expanded an unset variable to nothing,
    puts an empty string in the list. A request with no header presents an
    empty string too — so if blanks were accepted, the gate would authenticate
    every anonymous caller on the internet while looking perfectly configured
    in the portal. There is no error, no log line, and the only symptom is that
    the lock silently is not one.
    """
    # Each of these carries a REAL secret alongside a blank. An all-blank value
    # is a different case — it means "unconfigured", and
    # test_a_list_of_only_blanks_is_no_configuration_at_all covers it.
    for configured in ("s3cret,", ",s3cret", "s3cret, ,", "s3cret,,"):
        monkeypatch.setattr(settings, "api_shared_secret", configured)
        unauthenticated = client.post("/api/circuits/run", json={"qasm": BELL_QASM, "shots": 8})
        assert unauthenticated.status_code == 401, (
            f"{configured!r} left the service open to callers with no header"
        )
        empty_header = client.post(
            "/api/circuits/run",
            json={"qasm": BELL_QASM, "shots": 8},
            headers={SHARED_SECRET_HEADER: ""},
        )
        assert empty_header.status_code == 401, f"{configured!r} accepted an empty header"


def test_a_list_of_only_blanks_is_no_configuration_at_all(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """",," means unconfigured, not "accept anything".

    Degrading to the documented open default is right here: the alternative is
    a service that refuses every caller including its own liveness probe,
    because of a stray comma.
    """
    monkeypatch.setattr(settings, "api_shared_secret", " , , ")
    assert client.post("/api/circuits/run", json={"qasm": BELL_QASM, "shots": 8}).status_code == 200


def test_whitespace_around_a_rotating_value_is_tolerated(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`"old, new"` is what a human types; both halves must still work."""
    monkeypatch.setattr(settings, "api_shared_secret", " old-value , new-value ")
    for presented in ("old-value", "new-value"):
        response = client.post(
            "/api/circuits/run",
            json={"qasm": BELL_QASM, "shots": 8},
            headers={SHARED_SECRET_HEADER: presented},
        )
        assert response.status_code == 200


def test_accepted_secrets_parses_the_configured_value() -> None:
    """The parser, directly, including the cases the routes cannot reach."""
    from app.core.security import accepted_secrets

    cases = [
        ("one", ("one",)),
        ("one,two", ("one", "two")),
        (" one , two ", ("one", "two")),
        ("one,", ("one",)),
        (",", ()),
        ("", ()),
        (None, ()),
    ]
    original = settings.api_shared_secret
    try:
        for configured, expected in cases:
            settings.api_shared_secret = configured
            assert accepted_secrets() == expected, f"{configured!r}"
    finally:
        settings.api_shared_secret = original
