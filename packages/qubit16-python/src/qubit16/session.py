"""A runtime session: the reservation that makes a variational loop practical.

WHAT A SESSION BUYS
-------------------
Without one, every iteration of an optimisation re-enters the shared queue from
the back, and a 200-iteration VQE takes days. With one, IBM reserves the device
and runs the session's jobs consecutively.

WHAT IT COSTS, AND WHY ``__exit__`` IS THE POINT OF THIS CLASS
---------------------------------------------------------------
**A session bills for the whole time it is open, running jobs or idle.** That
makes "the loop raised and the close never ran" an expensive bug — the meter
keeps running until ``max_time`` expires, which by default is an hour and can
be eight. So :meth:`__exit__` closes unconditionally: on success, on exception,
on ``KeyboardInterrupt``, on ``return`` from inside the block.

``max_time`` is the backstop for when the process dies before ``__exit__`` can
run at all. It is not a substitute for closing.

Closing does **not** cancel jobs already submitted into the session; they
drain. Closing to stop the meter will not lose your last iteration.
"""

from __future__ import annotations

import warnings
from types import TracebackType
from typing import TYPE_CHECKING, Any

from .exceptions import Qubit16Error

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .backend import Qubit16Backend
    from .provider import Qubit16Provider

#: Mirrors MAX_SESSION_SECONDS on the service. Eight hours.
MAX_SESSION_SECONDS = 28_800

#: The service's floor. A session shorter than this is not worth the round trip.
MIN_SESSION_SECONDS = 60


class Session:
    """An open reservation on one device. Use it as a context manager.

    ::

        with Session(backend=backend, max_time=3600) as session:
            sampler = SamplerV2(mode=session)
            for theta in angles:
                job = sampler.run([ansatz(theta)], shots=4096)
                energy = job.result()[0].data.evs

    Attributes:
        backend_name: The device this reserves.
        max_time: The hard ceiling, in seconds.
    """

    def __init__(
        self,
        backend: Qubit16Backend | str,
        *,
        service: Qubit16Provider | None = None,
        max_time: int = 3600,
    ) -> None:
        """Describe a session. **Nothing is opened and nothing bills yet.**

        Opening is deferred to :meth:`__enter__` (or an explicit :meth:`open`)
        on purpose. The rejected alternative was opening in the constructor,
        which reads more simply and means that ``Session(backend=b)`` written
        outside a ``with`` — or written inside a function that raises two lines
        later — starts a meter nobody closes.

        Args:
            backend: A :class:`~qubit16.backend.Qubit16Backend`, or a device id
                together with ``service``.
            service: The provider to open through. Required when ``backend`` is
                a string; otherwise taken from the backend.
            max_time: Seconds, 60 to 28,800.

        Raises:
            ValueError: When ``max_time`` is out of range, or when a device id
                was given with no provider to reach it through.
        """
        if isinstance(backend, str):
            if service is None:
                raise ValueError(
                    "Session(backend='ibm_brisbane') needs service=Qubit16Provider(...) as well. "
                    "Pass the backend object from service.backend(...) to avoid repeating it."
                )
            self.backend_name = backend
            self._backend: Qubit16Backend | None = None
        else:
            self.backend_name = backend.name
            self._backend = backend
            service = service or backend.service

        if not isinstance(max_time, int) or isinstance(max_time, bool):
            raise ValueError(f"max_time must be an integer number of seconds, got {max_time!r}.")
        if not MIN_SESSION_SECONDS <= max_time <= MAX_SESSION_SECONDS:
            raise ValueError(
                f"max_time must be between {MIN_SESSION_SECONDS} and {MAX_SESSION_SECONDS} "
                f"seconds, got {max_time}. It is the backstop for a process that dies before it "
                "can close the session, and a session bills for its whole window."
            )

        self.service = service
        self.max_time = max_time
        self._session_id: str | None = None
        self._closed = False
        self._opened_payload: dict[str, Any] = {}

    # ── lifecycle ───────────────────────────────────────────────────────────

    @property
    def session_id(self) -> str | None:
        """The open session's id, or None when it has not been opened.

        Returns:
            The id, or None. Reading this does not open anything — use
            :meth:`open` or a ``with`` block for that, so that no attribute
            access can start a meter.
        """
        return self._session_id

    @property
    def backend(self) -> Qubit16Backend:
        """The device this session reserves, as a backend object.

        Resolved from the catalogue on first access when the session was built
        from a device id, because a primitive needs a real backend to attach a
        job to. The lookup is a public, free request.

        Returns:
            The backend.

        Raises:
            Qubit16Error: When no device has that name.
        """
        if self._backend is None:
            self._backend = self.service.backend(self.backend_name)
        return self._backend

    @property
    def closed(self) -> bool:
        """Whether this session has been closed.

        Returns:
            True once :meth:`close` has run. A closed session cannot be
            reopened: IBM sessions cannot be rejoined once closed, so
            pretending otherwise here would produce a confusing failure at the
            next submission instead of a clear one now.
        """
        return self._closed

    def open(self) -> str:
        """Open the session. **The meter starts here.**

        Returns:
            The session id.

        Raises:
            Qubit16Error: When the session cannot be opened — a 402 for a plan
                without hardware, a 403 for a key without ``hardware:submit``
                (opening a session reserves a device, so it needs the spending
                scope even though it enqueues nothing), or a 429 for opening
                sessions in a loop, which is not a workflow: a session is meant
                to be opened once *around* a loop.
            RuntimeError: When this session was already closed.
        """
        if self._closed:
            raise RuntimeError(
                "This session has been closed and cannot be reopened — a runtime session cannot "
                "be rejoined once closed. Build a new Session."
            )
        if self._session_id:
            return self._session_id

        payload = self.service.client.post(
            "/api/hardware/session",
            {"backend": self.backend_name, "max_time_seconds": self.max_time},
        )
        session_id = payload.get("session_id") if isinstance(payload, dict) else None
        if not session_id:
            raise Qubit16Error(
                "The service accepted the session request but returned no session id, so there "
                "is nothing to submit into and nothing to close. If a session was in fact "
                "opened it will expire after max_time; check your account before retrying.",
                body=payload if isinstance(payload, dict) else None,
            )

        self._session_id = str(session_id)
        self._opened_payload = dict(payload)
        return self._session_id

    def close(self) -> None:
        """Close the session. Stops the meter. Safe to call twice.

        Idempotent because :meth:`__exit__` calls it and a caller who also
        calls it explicitly should not get an error for being careful.

        Raises:
            Qubit16Error: When the close request itself failed. Worth raising
                rather than swallowing — a session that would not close is
                still billing, and the caller needs to know to close it from
                the account page. :meth:`__exit__` downgrades this to a warning
                when it would otherwise mask an exception from the block.
        """
        if self._closed or not self._session_id:
            self._closed = True
            return
        try:
            self.service.client.delete(f"/api/hardware/session/{self._session_id}")
        finally:
            # Marked closed even when the DELETE failed. Retrying the close in
            # a loop is the wrong reaction: the request that failed may well
            # have closed it, and the session expires at max_time regardless.
            self._closed = True

    # ── context manager ─────────────────────────────────────────────────────

    def __enter__(self) -> Session:
        """Open the session.

        Returns:
            Itself, so ``with Session(...) as session`` binds the session.
        """
        self.open()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        """Close the session, whatever happened inside the block.

        This is the method the class exists for. A session bills for its whole
        open window, so an exception in the body must not leave a device
        reserved.

        Args:
            exc_type: The exception type raised in the block, if any.
            exc: The exception, if any.
            traceback: Its traceback, if any.

        Returns:
            False, always — this never suppresses the caller's exception.

        Raises:
            Qubit16Error: Only when the block itself completed normally and the
                close failed. When an exception is already in flight, a failed
                close is downgraded to a warning instead: replacing the
                caller's real error with a housekeeping one hides the reason
                their loop broke, and the warning still says the meter may be
                running.
        """
        try:
            self.close()
        except Exception as close_error:  # noqa: BLE001 - re-raised or warned below
            if exc is None:
                raise
            warnings.warn(
                f"The qubit16 session {self._session_id} could not be closed while handling "
                f"{exc_type.__name__ if exc_type else 'an exception'}: {close_error}. IT MAY "
                f"STILL BE BILLING until its max_time of {self.max_time}s elapses — close it "
                "from your account page.",
                stacklevel=2,
            )
        return False

    def __repr__(self) -> str:
        """A one-line description of the session's state.

        Returns:
            Something like ``<Session ibm_brisbane open id=cx7… max_time=3600>``.
        """
        if self._closed:
            state = "closed"
        elif self._session_id:
            state = "open"
        else:
            state = "not opened"
        return (
            f"<Session {self.backend_name} {state} id={self._session_id or '-'} "
            f"max_time={self.max_time}>"
        )


__all__ = ["MAX_SESSION_SECONDS", "MIN_SESSION_SECONDS", "Session"]
