"""``Qubit16Provider`` — the object you swap ``QiskitRuntimeService`` for.

The whole package exists so that the diff to somebody's working script is two
lines::

    - from qiskit_ibm_runtime import QiskitRuntimeService
    - service = QiskitRuntimeService()
    + from qubit16 import Qubit16Provider
    + service = Qubit16Provider(token="qb16_sk_…")

and everything below it — ``service.backend(…)``, ``SamplerV2(mode=backend)``,
``job.result()[0].data.meas.get_counts()`` — keeps working, now reaching IonQ
and Rigetti as well as IBM, through one credential, with every run recorded.

The interface here mirrors ``QiskitRuntimeService`` rather than Qiskit's old
``ProviderV1`` (removed in Qiskit 2.0) because that is the object modern code
actually holds.
"""

from __future__ import annotations

import warnings
from typing import Any, Iterable, Mapping

from .backend import Qubit16Backend
from .client import KEY_PREFIX, Qubit16Client
from .exceptions import MissingCredentialsError, Qubit16Error


class Qubit16Provider:
    """Access to every device qubit16 can reach, through one token.

    Attributes:
        client: The HTTP client. Exposed so a caller can reach an endpoint this
            class does not wrap (``/estimate``, ``/transpile``) without
            building a second credential path.
    """

    def __init__(
        self,
        token: str | None = None,
        base_url: str | None = None,
        *,
        timeout: float = 30.0,
        poll_interval: float = 2.0,
        allow_anonymous: bool = False,
        client: Qubit16Client | None = None,
        **client_options: Any,
    ) -> None:
        """Resolve a credential and a deployment.

        Token resolution, in order: the ``token`` argument, then
        ``QUBIT16_TOKEN``, then ``QUBIT16_API_KEY``, then ``QUBIT16_KEY``. The
        argument wins so a stale variable in a shell cannot silently override
        an explicit decision.

        Args:
            token: An API key, ``qb16_sk_…``. None falls through to the
                environment.
            base_url: The deployment. Defaults to ``QUBIT16_BASE_URL`` then
                ``https://qubit16.ai``.
            timeout: Seconds for one HTTP call. Not a job timeout — a queue is
                measured in hours and is governed by ``result(timeout=…)``.
            poll_interval: Seconds between the first polls of a running job.
                Backs off from there.
            allow_anonymous: Permit construction with no token. The device
                catalogue, cost estimates and transpilation are public, so a
                token-less provider is genuinely useful for browsing — but
                anything that spends will then fail at the call rather than
                here, which is why it is opt-in.
            client: A pre-built client, injected in tests.
            **client_options: Forwarded to :class:`~qubit16.client.Qubit16Client`
                (``max_retries``, ``backoff``, ``http``, ``sleep``, ``env``).

        Raises:
            MissingCredentialsError: When no token was found and
                ``allow_anonymous`` is False. Raised here, at construction,
                because a missing token is a configuration mistake and the
                stack trace is far more useful at the line that built the
                provider than at the line that submitted a circuit.
        """
        if client is not None and (token or base_url or client_options):
            # Silently ignoring them is how somebody ends up debugging why
            # base_url had no effect. An injected client already carries all of
            # these, so passing both is always a mistake.
            raise ValueError(
                "Pass either client=… or the token/base_url/client options, not both — an "
                "injected client already holds them, and the others would be ignored."
            )
        self.client = client or Qubit16Client(
            token, base_url, timeout=timeout, **client_options
        )
        self.poll_interval = max(0.0, float(poll_interval))

        if not self.client.has_token and not allow_anonymous:
            raise MissingCredentialsError(
                "No qubit16 API token. Pass Qubit16Provider(token='qb16_sk_…') or set "
                "QUBIT16_TOKEN. Create a key under Account → API keys; submitting jobs "
                "needs the 'hardware:submit' scope, reading results needs 'hardware:read'. "
                "Pass allow_anonymous=True if you only want the public device catalogue."
            )

        prefix = self.client.token_prefix
        if prefix and not prefix.startswith(KEY_PREFIX):
            # A warning, not a refusal: the server is the authority on what a
            # credential looks like, and hard-refusing an unfamiliar shape
            # would break the day the prefix changes. But the overwhelmingly
            # common cause is an IBM token pasted into the wrong constructor,
            # and that deserves a sentence before it becomes a confusing 401.
            warnings.warn(
                f"This token does not start with '{KEY_PREFIX}'. qubit16 API keys do — if you "
                "pasted an IBM Quantum or AWS credential here it will be refused with a 401.",
                stacklevel=2,
            )

    # ── devices ─────────────────────────────────────────────────────────────

    def backends(
        self,
        name: str | None = None,
        *,
        min_num_qubits: int | None = None,
        provider: str | None = None,
        available_only: bool = False,
    ) -> list[Qubit16Backend]:
        """List devices, optionally filtered.

        One request to ``GET /api/hardware/devices`` per call, with no caching.
        Caching was rejected: ``available`` and ``pending_jobs`` are the two
        fields anyone filters on and they are the two that go stale fastest, so
        a cached catalogue would answer "available" about a device that is not.

        Args:
            name: Exact device id or display name, e.g. ``ibm_brisbane``.
            min_num_qubits: Keep only devices at least this wide.
            provider: Keep only one vendor: ``ibm``, ``ionq``, ``rigetti``.
            available_only: Keep only devices the catalogue says can take work.

        Returns:
            Matching backends, in the order the API listed them.

        Raises:
            Qubit16Error: When the catalogue cannot be read.
        """
        rows = self.client.get("/api/hardware/devices", auth=False)
        if not isinstance(rows, list):
            raise Qubit16Error(
                "GET /api/hardware/devices did not return a list of devices. The base_url may "
                f"not point at a qubit16 deployment: {self.client.base_url}"
            )

        devices = [Qubit16Backend(row, self) for row in rows if isinstance(row, Mapping)]

        if name is not None:
            devices = [d for d in devices if name in (d.name, d.device.get("name"))]
        if min_num_qubits is not None:
            devices = [d for d in devices if d.num_qubits >= min_num_qubits]
        if provider is not None:
            devices = [d for d in devices if d.provider_name == provider]
        if available_only:
            devices = [d for d in devices if d.available]
        return devices

    def backend(self, name: str) -> Qubit16Backend:
        """Get one device by id.

        Args:
            name: The device id, e.g. ``ibm_brisbane``, ``ionq_aria``,
                ``rigetti_ankaa``.

        Returns:
            The backend.

        Raises:
            Qubit16Error: When no device has that name. The message lists what
                is available, because the most common cause is a name from
                another platform (``ibmq_qasm_simulator``, ``Aria 1``) and a
                bare "not found" leaves the caller guessing at spelling.
        """
        found = self.backends(name=name)
        if found:
            return found[0]
        known = ", ".join(sorted(d.name for d in self.backends())) or "none"
        raise Qubit16Error(f"No device named '{name}'. Available: {known}.")

    def least_busy(self, *, min_num_qubits: int | None = None) -> Qubit16Backend:
        """The available device with the shallowest reported queue.

        Args:
            min_num_qubits: Only consider devices at least this wide.

        Returns:
            The backend with the smallest ``pending_jobs``.

        Raises:
            Qubit16Error: When no device is available, or when not one of them
                reported a queue depth. The second case refuses rather than
                picking arbitrarily: "least busy" with no queue data is a coin
                flip dressed as a recommendation, and a caller who wanted a
                coin flip can call ``backends()[0]``.
        """
        candidates = self.backends(min_num_qubits=min_num_qubits, available_only=True)
        if not candidates:
            raise Qubit16Error("No device is currently available.")
        with_queue = [d for d in candidates if d.pending_jobs is not None]
        if not with_queue:
            raise Qubit16Error(
                "No available device reported a queue depth, so 'least busy' cannot be "
                "answered. This is normal when the catalogue is served without live vendor "
                f"credentials. Pick one explicitly: {', '.join(d.name for d in candidates)}."
            )
        return min(with_queue, key=lambda d: d.pending_jobs or 0)

    # ── jobs ────────────────────────────────────────────────────────────────

    def job_status(
        self,
        provider: str,
        job_id: str,
        *,
        observable_labels: Iterable[str] | None = None,
    ) -> dict[str, Any]:
        """Poll one job once, by handle.

        The way back in after a process died, a ``result()`` timed out, or a
        job was submitted from somewhere else entirely.

        Args:
            provider: ``ibm``, ``braket`` or ``azure`` — the routing provider
                from the submission response, not the vendor name.
            job_id: The handle. A Braket handle is an ARN and contains slashes;
                pass it whole.
            observable_labels: For an estimator job, the labels in submission
                order. **Without them the values come back named ``obs0``,
                ``obs1``…** — IBM stores the observables but not our names for
                them, so the labels are the caller's record and nothing else
                can reconstruct them.

        Returns:
            The job status payload: ``status``, and ``counts`` or
            ``expectation_values`` once it is done.

        Raises:
            Qubit16Error: On any refusal, including a 404 for a job that is not
                this account's.
        """
        params: dict[str, Any] = {}
        labels = [str(label) for label in (observable_labels or [])]
        if labels:
            params["observables"] = ",".join(labels)
        return self.client.get(f"/api/hardware/job/{provider}/{job_id}", params or None)

    def jobs(self, *, limit: int = 20, include_qasm: bool = False) -> list[dict[str, Any]]:
        """The stored history of this account's hardware submissions.

        Args:
            limit: How many rows.
            include_qasm: Include the circuit source with each row. Off by
                default because it is the largest field, and worth turning on
                whenever the export needs to be reproducible — without it you
                have histograms with no provenance.

        Returns:
            The rows, newest first.

        Raises:
            Qubit16Error: On any refusal.

        Note:
            A row's ``status`` is only written when something polls the job. A
            job that was submitted and never polled reads ``null``, which means
            "nobody has checked", **not** "still queued".
        """
        params: dict[str, Any] = {"limit": int(limit)}
        if include_qasm:
            params["include_qasm"] = 1
        payload = self.client.get("/api/hardware/jobs", params)
        if isinstance(payload, Mapping):
            rows = payload.get("jobs", [])
        else:
            rows = payload
        return [dict(row) for row in rows if isinstance(row, Mapping)]

    # ── sessions ────────────────────────────────────────────────────────────

    def session(self, backend: Qubit16Backend | str, *, max_time: int = 3600) -> Any:
        """Build a session over a device. Use it as a context manager.

        Args:
            backend: The device to reserve.
            max_time: Seconds, 60 to 28,800. The backstop for when the process
                dies before the close runs — not a substitute for closing.

        Returns:
            An unopened :class:`~qubit16.session.Session`. It opens on
            ``__enter__`` and always closes on ``__exit__``.
        """
        from .session import Session

        return Session(backend=backend, service=self, max_time=max_time)

    # ── estimates ───────────────────────────────────────────────────────────

    def estimate_cost(
        self, qasm: str, backend: str, *, shots: int = 1024
    ) -> dict[str, Any]:
        """Price a submission before making it.

        Args:
            qasm: The circuit as OpenQASM.
            backend: The target device id.
            shots: Repetitions to price.

        Returns:
            The estimate payload, including ``estimated_total`` and
            ``currency``.

        Raises:
            Qubit16Error: On any refusal.

        Note:
            **This is an indicative price, not a quote.** It is computed from
            published per-shot and per-task rates; the invoice is the vendor's.
            ``/estimate`` is a POST despite being a read, because the circuit
            source does not belong in a query string. It needs no credential.
        """
        return self.client.post(
            "/api/hardware/estimate",
            {"qasm": qasm, "backend": backend, "shots": int(shots)},
            auth=False,
            retry=True,
        )

    def __repr__(self) -> str:
        """A one-line description that never shows the whole token.

        Returns:
            Something like ``<Qubit16Provider https://qubit16.ai token=qb16_sk_3nQ8>``.
        """
        return (
            f"<Qubit16Provider {self.client.base_url} "
            f"token={self.client.token_prefix or 'none'}>"
        )


__all__ = ["Qubit16Provider"]
