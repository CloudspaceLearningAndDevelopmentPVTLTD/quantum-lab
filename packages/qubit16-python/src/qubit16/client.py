"""The HTTP layer: one place that knows the wire, the auth header and retries.

Everything else in this package builds dictionaries and reads dictionaries.
This module is the only thing that touches ``requests``, which is what makes
the transport swappable and the tests network-free.

THE RETRY DECISION, AND WHY POST IS EXCLUDED
--------------------------------------------
``GET`` and ``DELETE`` here are idempotent — polling a job costs nothing and
closing a session twice is closing a session — so a 429 or a 503 on those is
retried automatically with backoff. ``POST`` is not retried, ever, and the
reason is worth stating because "retry everything transient" is the obvious
default:

``POST /api/hardware/submit`` spends money. A 503 from the proxy's fail-closed
branch does mean nothing was submitted, but a 503 from a gateway, a load
balancer or a dead connection **does not** — the job may already be enqueued at
IBM. A client that retries those bills twice for one circuit and returns one
job id, so the second job is invisible and still costs. Surfacing a retryable
exception and letting the caller decide is the honest trade: it costs one line
in the caller and it cannot silently double a bill.

The rejected alternative was an idempotency key. That is the right fix and it
needs a server-side change (a dedupe window keyed on the header), so it is a
gap to close rather than something to pretend at here.
"""

from __future__ import annotations

import os
import time
import warnings
from typing import Any, Callable, Mapping

import requests

from .exceptions import (
    ConnectionFailure,
    MissingCredentialsError,
    Qubit16Error,
    error_for_status,
)

#: The hosted deployment. Overridable so a self-hosted or preview deployment
#: works without a code change.
DEFAULT_BASE_URL = "https://qubit16.ai"

#: Environment variables checked for a token, in order.
#:
#: ``QUBIT16_TOKEN`` is this package's documented name. The other two are here
#: because ``docs/API.md`` writes its curl examples with ``$QUBIT16_KEY`` and
#: because ``QUBIT16_API_KEY`` is what people type by habit — a token that is
#: present under a near-miss name and ignored is an unpleasant ten minutes.
TOKEN_ENV_VARS = ("QUBIT16_TOKEN", "QUBIT16_API_KEY", "QUBIT16_KEY")

#: Environment override for the deployment.
BASE_URL_ENV_VAR = "QUBIT16_BASE_URL"

#: Prefix every issued key carries. Used only to warn, never to refuse: the
#: server is the authority on what a valid credential looks like, and a client
#: that hard-refuses an unfamiliar shape would break the day the prefix changes
#: or a browser session token is passed deliberately.
KEY_PREFIX = "qb16_sk_"

_VERSION = "0.1.0"


def resolve_token(token: str | None = None, *, env: Mapping[str, str] | None = None) -> str | None:
    """Find the API token: the argument first, then the environment.

    The argument wins because an explicitly passed token is an explicit
    decision, and a stale ``QUBIT16_TOKEN`` in a shell silently overriding it
    would be a genuinely hard bug to see.

    Args:
        token: A token passed by the caller, or None.
        env: Environment mapping to read. Defaults to ``os.environ``; injected
            in tests so they never depend on the developer's own shell.

    Returns:
        The token, or None when neither source held one.
    """
    if token:
        return token.strip()
    source = os.environ if env is None else env
    for name in TOKEN_ENV_VARS:
        value = source.get(name)
        if value and value.strip():
            return value.strip()
    return None


def resolve_base_url(base_url: str | None = None, *, env: Mapping[str, str] | None = None) -> str:
    """Find the deployment URL: the argument, then the environment, then live.

    Args:
        base_url: A URL passed by the caller, or None.
        env: Environment mapping to read. Defaults to ``os.environ``.

    Returns:
        The base URL with any trailing slash removed, so joining a path that
        starts with ``/`` cannot produce a double slash.
    """
    if not base_url:
        source = os.environ if env is None else env
        base_url = source.get(BASE_URL_ENV_VAR) or DEFAULT_BASE_URL
    return base_url.rstrip("/")


class Qubit16Client:
    """A thin, retrying JSON client for the qubit16 hardware API.

    This class holds the only credential in the package. It is deliberately
    boring: no caching of responses, no connection pooling beyond what
    ``requests.Session`` already does, and no interpretation of payloads. Every
    domain decision lives in the modules above it.

    Attributes:
        base_url: The deployment, without a trailing slash.
        timeout: Per-request timeout in seconds.
    """

    def __init__(
        self,
        token: str | None = None,
        base_url: str | None = None,
        *,
        timeout: float = 30.0,
        max_retries: int = 2,
        backoff: float = 1.0,
        http: requests.Session | None = None,
        sleep: Callable[[float], None] = time.sleep,
        env: Mapping[str, str] | None = None,
    ) -> None:
        """Build a client.

        Args:
            token: The API token. Resolved through :func:`resolve_token`, so
                None falls through to the environment.
            base_url: The deployment. Resolved through :func:`resolve_base_url`.
            timeout: Seconds before one request is abandoned. This bounds a
                single HTTP call, NOT a job — a job is polled, and waiting for
                a queue is governed by ``result(timeout=…)`` instead.
            max_retries: Extra attempts for retryable statuses on idempotent
                methods. Zero disables retrying.
            backoff: Base seconds for exponential backoff, doubled per attempt.
                Overridden by ``Retry-After`` when the server sends one.
            http: A ``requests.Session`` to use. Injected in tests.
            sleep: The sleep function, injected so tests do not wait.
            env: Environment mapping, injected in tests.
        """
        self._token = resolve_token(token, env=env)
        self.base_url = resolve_base_url(base_url, env=env)
        self.timeout = timeout
        self._max_retries = max(0, int(max_retries))
        self._backoff = max(0.0, float(backoff))
        self._http = http or requests.Session()
        self._sleep = sleep
        _warn_if_plaintext(self.base_url, self._token)

    @property
    def has_token(self) -> bool:
        """Whether a credential was resolved.

        Returns:
            True when a token is held. Used by the provider to decide whether
            to refuse at construction rather than at the first billable call.
        """
        return bool(self._token)

    @property
    def token_prefix(self) -> str | None:
        """The first few characters of the token, safe to show in a message.

        Returns:
            The visible prefix, or None when there is no token. Never the whole
            token: this string ends up in exception text, which ends up in logs
            and screenshots.
        """
        if not self._token:
            return None
        return self._token[: len(KEY_PREFIX) + 4]

    # ── requests ────────────────────────────────────────────────────────────

    def get(self, path: str, params: Mapping[str, Any] | None = None, *, auth: bool = True) -> Any:
        """GET a path.

        Args:
            path: An absolute path such as ``/api/hardware/devices``.
            params: Query parameters.
            auth: Whether to send the Authorization header. ``/devices``,
                ``/estimate`` and ``/transpile`` are public, so a token-less
                client can still browse the catalogue.

        Returns:
            The decoded JSON body: a dict or a list, depending on the route.

        Raises:
            Qubit16Error: On any non-2xx response or transport failure.
        """
        return self._request("GET", path, params=params, auth=auth)

    def post(
        self,
        path: str,
        payload: Mapping[str, Any],
        *,
        auth: bool = True,
        retry: bool = False,
    ) -> Any:
        """POST a JSON body. Not retried by default — see the module docstring.

        Args:
            path: An absolute path such as ``/api/hardware/submit``.
            payload: The request body.
            auth: Whether to send the Authorization header. ``/estimate`` and
                ``/transpile`` are public POSTs (the circuit source does not
                belong in a query string), so they pass False.
            retry: Whether retryable statuses are retried. Only ever True for a
                POST that spends nothing; it MUST stay False for ``/submit``,
                where a retry can double a bill.

        Returns:
            The decoded JSON body.

        Raises:
            Qubit16Error: On any non-2xx response or transport failure. A
                retryable one on a submission is genuinely ambiguous about
                whether the job was enqueued; read ``retryable`` and decide.
        """
        return self._request("POST", path, json=payload, auth=auth, retry=retry)

    def delete(self, path: str) -> Any:
        """DELETE a path.

        Args:
            path: An absolute path such as ``/api/hardware/session/abc``.

        Returns:
            The decoded JSON body.

        Raises:
            Qubit16Error: On any non-2xx response or transport failure.
        """
        return self._request("DELETE", path, auth=True)

    # ── the one place that talks to the network ─────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Mapping[str, Any] | None = None,
        params: Mapping[str, Any] | None = None,
        auth: bool = True,
        retry: bool = True,
    ) -> Any:
        """Issue one request, with bounded retries for idempotent methods.

        Args:
            method: HTTP method.
            path: Absolute path.
            json: Request body, for POST.
            params: Query parameters.
            auth: Whether a credential is required and sent.
            retry: Whether retryable statuses are retried. False for POST.

        Returns:
            The decoded JSON body, or ``{}`` for a 2xx with no body.

        Raises:
            MissingCredentialsError: When the route needs a token and none was
                resolved. Raised before the request, so the failure names the
                configuration rather than arriving as a 401.
            Qubit16Error: For every other failure.
        """
        if auth and not self._token:
            raise MissingCredentialsError(
                "No qubit16 API token. Pass token=… to Qubit16Provider, or set "
                f"{TOKEN_ENV_VARS[0]}. Create a key at {self.base_url}/account under "
                "'API keys'; submitting needs the 'hardware:submit' scope."
            )

        url = f"{self.base_url}{path}"
        headers = {
            "accept": "application/json",
            "user-agent": f"qubit16-python/{_VERSION}",
        }
        if auth:
            headers["authorization"] = f"Bearer {self._token}"
        if json is not None:
            headers["content-type"] = "application/json"

        attempt = 0
        while True:
            try:
                response = self._http.request(
                    method,
                    url,
                    json=json,
                    params=params,
                    headers=headers,
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                failure = ConnectionFailure(f"{method} {path} could not be completed: {exc}")
                if retry and attempt < self._max_retries:
                    attempt += 1
                    self._sleep(self._backoff * (2 ** (attempt - 1)))
                    continue
                raise failure from exc

            status = int(response.status_code)
            body = _decode(response)

            if 200 <= status < 300:
                return body if body is not None else {}

            retry_after = _retry_after(response)
            error = error_for_status(status, body, path=path, retry_after=retry_after)

            if retry and error.retryable and attempt < self._max_retries:
                attempt += 1
                wait = retry_after if retry_after is not None else self._backoff * (2 ** (attempt - 1))
                self._sleep(wait)
                continue

            raise error


def _warn_if_plaintext(base_url: str, token: str | None) -> None:
    """Warn when a credential is about to travel over plain HTTP.

    ``base_url`` is overridable — by an argument and by ``QUBIT16_BASE_URL`` —
    so a typo or a copied staging URL can send ``Authorization: Bearer
    qb16_sk_…`` in clear text over somebody's network. The key cannot be shown
    again once issued, and a leaked one has to be revoked, so a silent
    downgrade is the wrong default.

    A warning rather than a refusal: a developer pointing at a local deployment
    over ``http://localhost`` is doing something reasonable, and those hosts are
    exempted outright rather than nagged.

    Args:
        base_url: The resolved deployment URL.
        token: The resolved token, or None. No token, no exposure, no warning.
    """
    if not token or not base_url.lower().startswith("http://"):
        return
    host = base_url[len("http://") :].split("/", 1)[0].split(":", 1)[0].lower()
    if host in ("localhost", "127.0.0.1", "::1", "[::1]") or host.endswith(".localhost"):
        return
    warnings.warn(
        f"qubit16 is configured with a plain-HTTP base_url ({base_url}), so your API key will "
        "be sent in clear text and anyone on the path can read it. Use https, or revoke the key "
        "if it has already travelled this way.",
        stacklevel=3,
    )


def _decode(response: requests.Response) -> Any:
    """Decode a JSON body without trusting that there is one.

    An error page from a proxy in front of the API is HTML, and a 204 has no
    body at all. Neither should surface as a ``JSONDecodeError`` from inside
    this package — the caller's problem is the status, not the encoding.

    Args:
        response: The response.

    Returns:
        The decoded body, or None when it was absent or not JSON.
    """
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError:
        return None


def _retry_after(response: requests.Response) -> float | None:
    """Read ``Retry-After`` as seconds.

    Only the numeric form is handled. The HTTP-date form is legal and this API
    does not send it; parsing it on the chance it might would be untested code
    on an error path, which is the worst place to have some.

    Args:
        response: The response.

    Returns:
        Seconds to wait, or None when the header is absent or not a number.
    """
    raw = response.headers.get("retry-after") if response.headers else None
    if not raw:
        return None
    try:
        seconds = float(raw)
    except (TypeError, ValueError):
        return None
    return seconds if seconds >= 0 else None


__all__ = [
    "DEFAULT_BASE_URL",
    "KEY_PREFIX",
    "Qubit16Client",
    "Qubit16Error",
    "TOKEN_ENV_VARS",
    "resolve_base_url",
    "resolve_token",
]
