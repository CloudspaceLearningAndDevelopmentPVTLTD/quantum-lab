"""Test fixtures: a fake HTTP transport, so no test can reach the network.

WHY A HAND-ROLLED FAKE RATHER THAN ``responses`` OR ``requests-mock``
----------------------------------------------------------------------
Two reasons, both about what the tests are for. First, the fake **fails loudly
on an unexpected request** — an unrouted call raises with the method and path
rather than returning a default — so a test that accidentally starts polling a
URL nobody meant it to poll fails instead of passing quietly. Second, it
records every request body, which is what the round-trip tests actually assert
on: the value of this package is that it puts the right fields on the wire, and
a mock that only asserts on the response shape would not catch a submission
that forgot ``optimization_level`` or dropped the session id.

It also keeps the test dependencies at pytest, which matters for a package that
scientific users will install into an already-crowded environment.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from qubit16 import Qubit16Provider
from qubit16.client import Qubit16Client

#: A device row shaped exactly like one from GET /api/hardware/devices.
BRISBANE = {
    "id": "ibm_brisbane",
    "name": "ibm_brisbane",
    "provider": "ibm",
    "qubits": 127,
    "technology": "superconducting",
    "note": "IBM Eagle r3 processor.",
    "available": True,
    "source": "live",
    "pending_jobs": 12,
    "calibration": {"source": "live", "qubits": 127, "median_2q_error": 0.008},
}

ARIA = {
    "id": "ionq_aria",
    "name": "IonQ Aria-1",
    "provider": "ionq",
    "qubits": 25,
    "technology": "trapped-ion",
    "available": True,
    "source": "catalogue",
    "pending_jobs": None,
}


@dataclass
class Call:
    """One request the client made.

    Attributes:
        method: HTTP method.
        url: Full URL.
        path: Path only, which is what assertions care about.
        json: The request body, when there was one.
        params: Query parameters, when there were any.
        headers: Request headers, so auth can be asserted on.
    """

    method: str
    url: str
    path: str
    json: dict[str, Any] | None
    params: dict[str, Any] | None
    headers: dict[str, str]


@dataclass
class _Rule:
    """A programmed response.

    Attributes:
        method: HTTP method to match.
        path: Substring of the path to match.
        status: Status to answer with.
        payload: JSON body to answer with.
        headers: Response headers.
        times: How many times this rule may be used; None means unlimited.
    """

    method: str
    path: str
    status: int
    payload: Any
    headers: dict[str, str] = field(default_factory=dict)
    times: int | None = 1


class _FakeResponse:
    """The slice of ``requests.Response`` the client actually touches."""

    def __init__(self, status: int, payload: Any, headers: dict[str, str]) -> None:
        """Build a response.

        Args:
            status: HTTP status.
            payload: Decoded JSON body, or None for an empty body.
            headers: Response headers.
        """
        self.status_code = status
        self._payload = payload
        self.headers = headers
        self.content = b"" if payload is None else b"{}"

    def json(self) -> Any:
        """Return the decoded body.

        Returns:
            The payload.

        Raises:
            ValueError: When there is no body, matching requests' behaviour so
                the client's own guard is exercised.
        """
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class FakeHTTP:
    """A ``requests.Session`` stand-in that answers from programmed rules.

    Attributes:
        calls: Every request made, in order.
    """

    def __init__(self) -> None:
        """Start with no rules and no recorded calls."""
        self.calls: list[Call] = []
        self._rules: list[_Rule] = []

    def route(
        self,
        method: str,
        path: str,
        status: int = 200,
        payload: Any = None,
        *,
        headers: dict[str, str] | None = None,
        times: int | None = 1,
    ) -> FakeHTTP:
        """Program one answer.

        Rules are matched in order and consumed, so programming two rules for
        the same path makes the first call get the first answer — which is how
        a queued-then-done poll sequence is expressed.

        Args:
            method: HTTP method.
            path: Substring of the request path.
            status: Status to answer with.
            payload: JSON body.
            headers: Response headers, e.g. ``Retry-After``.
            times: Uses before the rule is spent; None for unlimited.

        Returns:
            Itself, so routes chain.
        """
        self._rules.append(
            _Rule(method.upper(), path, status, payload, dict(headers or {}), times)
        )
        return self

    def request(
        self,
        method: str,
        url: str,
        json: Any = None,
        params: Any = None,
        headers: Any = None,
        timeout: Any = None,
    ) -> _FakeResponse:
        """Answer a request from the rules, recording it.

        Args:
            method: HTTP method.
            url: Full URL.
            json: Request body.
            params: Query parameters.
            headers: Request headers.
            timeout: Ignored; recorded only by being accepted.

        Returns:
            The programmed response.

        Raises:
            AssertionError: When no rule matches. An unexpected request is a
                test failure — silently defaulting would let a bug in the
                polling loop pass as a green test.
        """
        path = url.split("://", 1)[-1]
        path = "/" + path.split("/", 1)[1] if "/" in path else "/"
        self.calls.append(
            Call(method.upper(), url, path, json, dict(params or {}) or None, dict(headers or {}))
        )

        for rule in self._rules:
            if rule.method != method.upper() or rule.path not in path:
                continue
            if rule.times is not None:
                if rule.times <= 0:
                    continue
                rule.times -= 1
            return _FakeResponse(rule.status, rule.payload, rule.headers)

        raise AssertionError(f"No rule for {method.upper()} {path}. Routed: {self._rules!r}")

    # ── assertions helpers ──────────────────────────────────────────────────

    def calls_to(self, method: str, path: str) -> list[Call]:
        """Every recorded call matching a method and path substring.

        Args:
            method: HTTP method.
            path: Substring of the path.

        Returns:
            The matching calls, in order.
        """
        return [c for c in self.calls if c.method == method.upper() and path in c.path]


@pytest.fixture
def http() -> FakeHTTP:
    """A fresh fake transport.

    Returns:
        The transport, with no rules programmed.
    """
    return FakeHTTP()


@pytest.fixture
def provider(http: FakeHTTP) -> Qubit16Provider:
    """A provider wired to the fake transport, with sleeping disabled.

    Returns:
        A provider whose token is a plausible test key and whose poll interval
        is zero, so the polling loop runs at full speed and a test that hangs
        is a real bug rather than a slow fixture.
    """
    client = Qubit16Client(
        "qb16_sk_test",
        "https://example.test",
        http=http,  # type: ignore[arg-type]
        sleep=lambda _seconds: None,
        env={},
    )
    return Qubit16Provider(client=client, poll_interval=0.0)
