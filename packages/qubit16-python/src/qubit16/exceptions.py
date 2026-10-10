"""Exceptions that say what to do about them.

WHY THIS FILE IS NOT JUST ``class Qubit16Error(Exception)``
-----------------------------------------------------------
The API this package wraps refuses in five materially different ways, and the
right reaction to each is different enough that collapsing them into one
exception would make every caller re-parse a string to decide whether to retry:

* **401** — the credential is absent or wrong. Retrying cannot help.
* **402** — the plan does not include hardware, or the monthly allowance is
  spent. Retrying cannot help either, but the fix is a billing one, not a
  credential one, and telling somebody to "check your token" when their
  allowance ran out sends them to the wrong page.
* **403** — the key authenticated and lacks a scope. The body names the scope.
  A script that catches this and retries with the same key will never succeed.
* **429** — rate limited, ``Retry-After`` is set. Retry.
* **503** — a meter or a credential store could not answer. The service
  **fails closed on purpose**: an unknown answer on a spending path is a
  refusal, not permission. This is the one that is most often mistaken for an
  auth failure, and it is the one you should retry with backoff.

Every exception below therefore carries ``status``, the server's own ``detail``
string, and a ``retryable`` flag, so a caller can branch on the flag instead of
on prose.
"""

from __future__ import annotations

from typing import Any, Mapping


class Qubit16Error(RuntimeError):
    """Base class for everything this package raises.

    Attributes:
        status: The HTTP status, or None when the failure happened before a
            request was made (a missing token, an unusable circuit).
        detail: The server's own explanation, when it sent one. This is the
            string worth showing a user — it is written for them, not for us.
        retryable: True when retrying the identical call can plausibly succeed.
            Never a promise, only a signal: a retryable error retried forever
            is still a hang.
        body: The decoded response body, when there was one. Kept so a caller
            can read fields this package does not model (``upgradeUrl``,
            ``requiredPlan``) without re-issuing the request.
    """

    retryable: bool = False

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        detail: str | None = None,
        body: Mapping[str, Any] | None = None,
    ) -> None:
        """Build the error.

        Args:
            message: What went wrong, in this package's own words.
            status: HTTP status, when the failure came from a response.
            detail: The server's explanation, when it sent one.
            body: The decoded response body, when there was one.
        """
        super().__init__(message)
        self.status = status
        self.detail = detail
        self.body = dict(body) if body else {}


class MissingCredentialsError(Qubit16Error):
    """No token was given and none of the environment variables held one.

    Raised locally, before any request, because a token that is absent is a
    configuration mistake and not a server answer — issuing the request first
    would turn an obvious local problem into a confusing 401.
    """


class AuthenticationError(Qubit16Error):
    """401: no credential, or one the server does not accept.

    Do not retry. Either the key is revoked, mistyped, or was issued against a
    different deployment than ``base_url`` points at.
    """


class PlanLimitError(Qubit16Error):
    """402: the plan does not include hardware, or the allowance is spent.

    The monthly allowance runs on the subscription anniversary, not the
    calendar month, so "it worked last week" and "it is the 1st" are both
    consistent with this error. Do not retry.
    """


class ScopeError(Qubit16Error):
    """403: the key authenticated but does not carry the scope this needs.

    Attributes:
        scope: The scope the server named, when it named one. Submitting and
            opening sessions need ``hardware:submit``; reading needs
            ``hardware:read``.

    Do not retry with the same key — issue a new one with the scope.
    """

    def __init__(self, message: str, *, scope: str | None = None, **kwargs: Any) -> None:
        """Build the error.

        Args:
            message: What went wrong.
            scope: The scope named in the response body, when present.
            **kwargs: Passed to :class:`Qubit16Error`.
        """
        super().__init__(message, **kwargs)
        self.scope = scope


class JobNotFoundError(Qubit16Error):
    """404 from a job poll: no such job, or not this account's job.

    The API answers both cases identically and on purpose — a distinguishable
    "exists but not yours" would turn the poll route into an oracle for which
    job ids are real. So this exception cannot tell you which of the two it is
    either, and pretending otherwise would be a guess.
    """


class InvalidRequestError(Qubit16Error):
    """400 or 422: the request was refused as malformed, and will stay refused.

    Usually one of: a circuit with measurements sent to the Estimator, a Pauli
    string whose length does not match the circuit width, shots above the
    per-job ceiling, or a backend id that is not a hardware device.
    """


class RateLimitError(Qubit16Error):
    """429: too many calls. Retry after ``retry_after`` seconds.

    Attributes:
        retry_after: Seconds the server asked us to wait, when it said.
    """

    retryable = True

    def __init__(self, message: str, *, retry_after: float | None = None, **kwargs: Any) -> None:
        """Build the error.

        Args:
            message: What went wrong.
            retry_after: The ``Retry-After`` header in seconds, when present.
            **kwargs: Passed to :class:`Qubit16Error`.
        """
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


class ServiceUnavailableError(Qubit16Error):
    """503: the service refused because it could not verify something.

    THIS IS NOT AN AUTH FAILURE, and mistaking it for one is the single most
    likely misreading in this file. The platform fails closed: when the usage
    meter or the credential store cannot answer, a request that would spend
    money is refused rather than allowed. Your key is almost certainly fine.
    Retry with backoff.
    """

    retryable = True


class ConnectionFailure(Qubit16Error):
    """The request never got an answer: DNS, TLS, connect or read timeout.

    Retryable for reads. For a submission it is genuinely ambiguous — the job
    may have been enqueued before the connection died — which is why this
    package never retries a POST automatically. See ``client.py``.
    """

    retryable = True


class ServerError(Qubit16Error):
    """A 5xx that is not a 503. A bug on the server, not in your call.

    Retried once or twice it may pass; if it does not, the request is not
    going to start working, and the response body is worth reporting.
    """

    retryable = True


class JobFailedError(Qubit16Error):
    """The job reached a terminal state that is not ``done``.

    Attributes:
        job_id: The vendor's job handle, so the job can be looked up in the
            vendor's own console.
        provider: ``ibm``, ``braket`` or ``azure``.
        job_status: The terminal status: ``error`` or ``cancelled``.
    """

    def __init__(
        self,
        message: str,
        *,
        job_id: str,
        provider: str,
        job_status: str,
        **kwargs: Any,
    ) -> None:
        """Build the error.

        Args:
            message: The provider's error text, when there was one.
            job_id: The vendor job handle.
            provider: The vendor.
            job_status: ``error`` or ``cancelled``.
            **kwargs: Passed to :class:`Qubit16Error`.
        """
        super().__init__(message, **kwargs)
        self.job_id = job_id
        self.provider = provider
        self.job_status = job_status


class JobTimeoutError(Qubit16Error):
    """``result()`` gave up waiting. THE JOB IS UNAFFECTED.

    A hardware queue is measured in minutes to hours, so a timeout here says
    something about your patience and nothing about the job: it is still at the
    vendor, it will still finish, and it has already been counted against your
    allowance. Re-poll it later with ``provider.job_status(provider, job_id)``.

    Attributes:
        job_ids: Every handle that had not reached a terminal state.
    """

    retryable = True

    def __init__(self, message: str, *, job_ids: list[str], **kwargs: Any) -> None:
        """Build the error.

        Args:
            message: What was still pending and for how long.
            job_ids: The handles still in flight.
            **kwargs: Passed to :class:`Qubit16Error`.
        """
        super().__init__(message, **kwargs)
        self.job_ids = list(job_ids)


class UnpollableJobError(Qubit16Error):
    """502 from a SUBMISSION: the vendor took the circuit and returned no handle.

    The submission has been counted against the allowance because it may be
    running — refunding spend that cannot be ruled out is the expensive
    direction. The job cannot be tracked from here; look in the vendor's own
    console, or contact support with the submission time.

    ONLY a submission raises this, and the distinction is load-bearing: a 502
    from a gateway, a CDN or a proxy in front of the API carries none of that
    meaning, and telling somebody their allowance was spent when a load
    balancer hiccuped on a *read* would be a fabrication. Every other 502 is a
    :class:`ServerError`. See :func:`error_for_status`.
    """


#: Maps a status code to the class that describes what to do about it.
#: 404 and 502 are deliberately absent — both mean something specific on one
#: route and something ordinary everywhere else, and :func:`error_for_status`
#: takes the path and the body into account for them.
_BY_STATUS: dict[int, type[Qubit16Error]] = {
    400: InvalidRequestError,
    401: AuthenticationError,
    402: PlanLimitError,
    403: ScopeError,
    422: InvalidRequestError,
    429: RateLimitError,
    503: ServiceUnavailableError,
}

#: The one route whose 502 means "accepted and unpollable" rather than
#: "something between you and the API broke". apps/web/app/api/hardware/submit
#: returns it with ``unpollable: true`` in the body.
_SUBMIT_PATH = "/api/hardware/submit"


def error_for_status(
    status: int,
    body: Mapping[str, Any] | None,
    *,
    path: str,
    retry_after: float | None = None,
) -> Qubit16Error:
    """Turn a refusing response into the exception that explains it.

    Args:
        status: The HTTP status.
        body: The decoded JSON body, when it decoded. The API uses ``detail``
            for the human-facing sentence and ``error`` for the same text on
            some routes, so both are read, in that order.
        path: The request path. Used to tell a job 404 from any other, and a
            submission's 502 (a real, billed, untrackable job) from a gateway's
            502 (nothing of the sort).
        retry_after: Parsed ``Retry-After`` seconds, for 429.

    Returns:
        An exception carrying the status, the server's detail and a retry hint.
        Never raises — a caller that cannot build an error is worse off than
        one holding a vague one.
    """
    body = body or {}
    detail = body.get("detail") or body.get("error")
    detail = detail if isinstance(detail, str) else None

    if status == 404:
        return JobNotFoundError(
            detail
            or (
                "No such job. The API answers 'unknown job' and 'not your job' identically, "
                "so this means one of the two and cannot say which."
            ),
            status=status,
            detail=detail,
            body=body,
        )

    if status == 502:
        # A 502 is only the "the vendor took it and gave us no handle" case on
        # the submit route, where the proxy marks it `unpollable`. Anywhere
        # else — a poll, a device listing, a gateway between the caller and the
        # API — it is an ordinary bad gateway, and raising UnpollableJobError
        # for it would tell somebody their allowance had been spent on a read
        # that spends nothing. The body is trusted first because it is the
        # server's own marker; the path is the fallback for a deployment that
        # does not set it.
        unpollable = bool(body.get("unpollable")) or path.endswith(_SUBMIT_PATH)
        cls = UnpollableJobError if unpollable else ServerError
    else:
        cls = _BY_STATUS.get(status)
        if cls is None:
            cls = ServerError if status >= 500 else Qubit16Error

    message = detail or f"{path} answered {status}."

    if cls is RateLimitError:
        return RateLimitError(
            message, retry_after=retry_after, status=status, detail=detail, body=body
        )
    if cls is ScopeError:
        return ScopeError(
            message,
            scope=_scope_from_detail(detail),
            status=status,
            detail=detail,
            body=body,
        )
    return cls(message, status=status, detail=detail, body=body)


def _scope_from_detail(detail: str | None) -> str | None:
    """Pull the scope name out of the server's 403 sentence.

    The server writes "This API key does not have the 'hardware:submit' scope."
    and there is no machine-readable field for it, so this reads the quoted
    name rather than inventing one. A parse that fails returns None instead of
    guessing: a wrong scope name in an error message sends somebody to issue
    the wrong key.

    Args:
        detail: The server's 403 text, if any.

    Returns:
        The quoted scope, or None when it cannot be read.
    """
    if not detail:
        return None
    for quote in ("'", '"'):
        parts = detail.split(quote)
        if len(parts) >= 3 and parts[1].startswith("hardware:"):
            return parts[1]
    return None
