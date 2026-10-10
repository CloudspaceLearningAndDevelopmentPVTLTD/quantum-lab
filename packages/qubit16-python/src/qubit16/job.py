"""The job handle: polls to a terminal state and builds a Qiskit result.

WHY POLLING AT ALL
------------------
Hardware submission is asynchronous everywhere — IBM, Braket and Azure all
return a handle and nothing else — and the qubit16 API mirrors that honestly.
There is no callback, so ``result()`` is a loop. It backs off, because a queue
is measured in minutes to hours and polling every two seconds for six hours is
21,600 requests against a 60/minute read limit.

THE ONE THING TO KNOW ABOUT ``result()`` TIMING OUT
---------------------------------------------------
A :class:`~qubit16.exceptions.JobTimeoutError` says nothing about the job. The
job is at the vendor, it will finish, and it has already been counted against
the monthly allowance. The handles are on the exception; poll them later with
``provider.job_status(provider, job_id)``.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Mapping, Sequence

from qiskit.providers import JobStatus, JobV1

from .exceptions import JobFailedError, JobTimeoutError, Qubit16Error

if TYPE_CHECKING:  # pragma: no cover - typing only
    from qiskit.primitives import PrimitiveResult

    from .backend import Qubit16Backend
    from .client import Qubit16Client

#: Statuses the API will not move away from.
TERMINAL = frozenset({"done", "error", "cancelled"})

#: Ceiling on the poll interval. Past this the backoff stops growing: a job
#: that finished should be noticed within half a minute, not within however
#: long the exponential had reached.
MAX_POLL_INTERVAL = 30.0

#: Qiskit's own status vocabulary, keyed by ours. Qiskit has no word for the
#: gap between "submitted" and "queued", so both map to QUEUED.
_STATUS = {
    "queued": JobStatus.QUEUED,
    "running": JobStatus.RUNNING,
    "done": JobStatus.DONE,
    "error": JobStatus.ERROR,
    "cancelled": JobStatus.CANCELLED,
}


@dataclass
class Submission:
    """One accepted submission: everything needed to poll it and read it back.

    Attributes:
        job_id: The vendor handle. A Braket handle is an ARN with slashes in
            it; it is used verbatim in the poll path, which is a catch-all
            route for exactly that reason.
        provider: The routing provider — ``ibm``, ``braket`` or ``azure``. NOT
            the vendor name: an IonQ device is reached through ``braket``.
        backend: The device id as submitted. The device the job actually RAN on
            can differ (IBM moves jobs when a device retires mid-queue) and the
            poll reports that one.
        primitive: ``sampler`` or ``estimator``.
        shots: Repetitions requested.
        observable_labels: For an estimator job, the labels in submission
            order. **These must be sent on every poll**: IBM stores the
            observables and not our names for them, so without these the values
            come back as ``obs0``, ``obs1``…
        creg_name: The classical register the sampler counts belong to, so the
            result's ``DataBin`` field is named the way the caller's circuit
            named it.
        num_bits: Width of that register.
        response: The whole submission response, including
            ``transpiled_depth``, ``transpiled_two_qubit_gates`` and
            ``estimated_qpu_seconds`` — an ESTIMATE of QPU time from the
            vendor, not a measurement. The measured figure is ``qpu_seconds``
            on the finished poll.
        last_poll: The most recent status payload, cached once terminal so a
            second ``result()`` costs nothing.
    """

    job_id: str
    provider: str
    backend: str
    primitive: str
    shots: int
    observable_labels: tuple[str, ...] = ()
    creg_name: str | None = None
    num_bits: int | None = None
    response: dict[str, Any] = field(default_factory=dict)
    last_poll: dict[str, Any] | None = None


class Qubit16Job(JobV1):
    """A submitted job, or several when one ``run()`` carried several pubs.

    ONE PUB IS ONE JOB. The wire format carries a single circuit per
    submission, so ``sampler.run([a, b, c])`` makes three submissions — three
    queue positions and **three units of the monthly hardware allowance**. This
    object polls all of them and assembles one ``PrimitiveResult`` in pub
    order, which is what ordinary Qiskit code expects, but the cost is three.
    """

    def __init__(
        self,
        backend: Qubit16Backend,
        submissions: Sequence[Submission],
        client: Qubit16Client,
        *,
        primitive: str,
        poll_interval: float = 2.0,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Build a job handle around accepted submissions.

        Args:
            backend: The device submitted to.
            submissions: One per pub, in pub order.
            client: The HTTP client to poll with.
            primitive: ``sampler`` or ``estimator``.
            poll_interval: Seconds before the first re-poll. Backs off by 1.5×
                per poll up to :data:`MAX_POLL_INTERVAL`.
            sleep: Injected so tests do not wait.
            clock: Injected so tests do not depend on wall time.
        """
        super().__init__(backend, submissions[0].job_id if submissions else "")
        self.submissions = list(submissions)
        self._client = client
        self._primitive = primitive
        self._poll_interval = max(0.0, float(poll_interval))
        self._sleep = sleep
        self._clock = clock

    # ── JobV1 contract ──────────────────────────────────────────────────────

    def submit(self) -> None:
        """Not supported: the job was submitted before this object existed.

        Raises:
            NotImplementedError: Always. ``JobV1`` dates from a time when a job
                could be built and submitted separately; here a job handle only
                exists because a submission was accepted, and re-submitting
                would enqueue a second billable job under the first one's id.
        """
        raise NotImplementedError(
            "This job was already submitted. Call sampler.run(...) again to submit another — "
            "note that it is another job of your monthly allowance."
        )

    def status(self) -> JobStatus:
        """Poll once and report the aggregate state.

        Returns:
            For a single-pub job, that job's state. For several, the worst:
            ERROR, then CANCELLED, then RUNNING, then QUEUED, and DONE only
            when every submission is done. Reporting DONE while one pub is
            still queued would make ``in_final_state()`` lie.
        """
        payloads = self._poll_all()
        statuses = [str(payload.get("status") or "queued") for payload in payloads]
        for name in ("error", "cancelled", "running", "queued"):
            if name in statuses:
                return _STATUS[name]
        return JobStatus.DONE

    def result(
        self,
        timeout: float | None = None,
        poll_interval: float | None = None,
    ) -> PrimitiveResult:
        """Wait for every submission and build the primitive result.

        Args:
            timeout: Seconds to wait before giving up. None waits indefinitely,
                which is the right default for a resource whose queue is
                measured in hours — a default timeout would turn a normal queue
                into an exception.
            poll_interval: Override the starting interval between polls.

        Returns:
            A ``PrimitiveResult``. For the sampler each pub's ``data`` carries
            a ``BitArray`` named after the circuit's classical register, so
            ``result[0].data.meas.get_counts()`` works. For the estimator each
            pub's ``data`` carries ``evs`` and ``stds``.

        Raises:
            JobFailedError: When a submission ended in ``error`` or
                ``cancelled``.
            JobTimeoutError: When ``timeout`` elapsed. **The job is unaffected**
                — the handles are on the exception.
            Qubit16Error: When a finished job carried no readable result.
        """
        payloads = self._wait(timeout=timeout, poll_interval=poll_interval)

        for submission, payload in zip(self.submissions, payloads):
            status = str(payload.get("status") or "")
            if status in ("error", "cancelled"):
                detail = payload.get("error")
                raise JobFailedError(
                    str(detail)
                    or f"The provider reported the job as '{status}' with no further detail.",
                    job_id=submission.job_id,
                    provider=submission.provider,
                    job_status=status,
                )

        if self._primitive == "estimator":
            return _estimator_result(self.submissions, payloads)
        return _sampler_result(self.submissions, payloads)

    def cancel(self) -> None:
        """Not supported: the API exposes no cancel endpoint.

        Raises:
            NotImplementedError: Always, with the two things that actually
                work. Closing a session does NOT cancel its queued jobs — they
                drain on purpose, so that closing to stop the meter cannot lose
                somebody's last iteration.
        """
        raise NotImplementedError(
            "qubit16 does not expose job cancellation. Cancel from the vendor's own console "
            f"(job {self.submissions[0].job_id if self.submissions else '?'}). Note that "
            "closing a runtime session does not cancel jobs already inside it — they drain."
        )

    # ── qubit16 extras ──────────────────────────────────────────────────────

    def job_ids(self) -> list[str]:
        """Every vendor handle this object is waiting on.

        Returns:
            One id per pub, in pub order. ``job_id()`` returns the first, which
            is what ``JobV1`` promises and is the only one for the ordinary
            single-pub case.
        """
        return [submission.job_id for submission in self.submissions]

    def raw_statuses(self) -> list[str]:
        """The API's own status words, unmapped.

        Returns:
            ``queued`` | ``running`` | ``done`` | ``error`` | ``cancelled``,
            one per submission. Worth reading instead of :meth:`status` when
            you care which pub is where.
        """
        return [str(payload.get("status") or "queued") for payload in self._poll_all()]

    def queue_positions(self) -> list[int | None]:
        """Queue position per submission, where the vendor reported one.

        Returns:
            One entry per pub. **None is not position zero** — it means the
            vendor did not say, which is normal for a running job and for
            providers that do not publish a position at all.
        """
        return [payload.get("queue_position") for payload in self._poll_all()]

    def counts(self) -> dict[str, int] | list[dict[str, int]]:
        """The histogram, for code that just wants the numbers.

        A qubit16 convenience, not a Qiskit API — ``result()`` returns the V2
        primitive shape and this is the one-liner over it.

        Returns:
            The counts for a single-pub job, or a list of them.

        Raises:
            Qubit16Error: When this is an estimator job, which has no
                histogram; its numbers are on ``result()[0].data.evs``.
            JobFailedError: When the job failed.
        """
        if self._primitive == "estimator":
            raise Qubit16Error(
                "An estimator job has no histogram — it measured expectation values. Read "
                "job.result()[0].data.evs, or job.expectation_values()."
            )
        result = self.result()
        histograms = [
            getattr(pub.data, name).get_counts()
            for pub, name in zip(result, [s.creg_name or "meas" for s in self.submissions])
        ]
        return histograms[0] if len(histograms) == 1 else histograms

    def expectation_values(self) -> list[dict[str, Any]]:
        """Labelled expectation values, for the first pub.

        Returns:
            ``[{"label", "value", "std_error"}]`` as the API reported it, in
            the API's own order — unlike ``result()``, which realigns the
            ``evs`` array to the order the observables were submitted in.
            Nothing is lost by that difference: every entry here carries its
            own label, so it is self-describing, whereas a bare float array is
            not and has to be put back in the caller's order to mean anything.
            **``value`` can be None and 0.0 is not None** — an expectation value
            of zero is a real, common answer (it is what ⟨Z⟩ gives for a perfect
            superposition), so a number that could not be read is reported as
            None and must not be confused with it. ``result()`` puts NaN in the
            float array for those; this method keeps the None.

        Raises:
            Qubit16Error: When this is a sampler job.
        """
        if self._primitive != "estimator":
            raise Qubit16Error("A sampler job has no expectation values. Use job.counts().")
        payloads = self._wait()
        values = payloads[0].get("expectation_values") or []
        return [dict(entry) for entry in values if isinstance(entry, Mapping)]

    # ── polling ─────────────────────────────────────────────────────────────

    def _poll_one(self, submission: Submission) -> dict[str, Any]:
        """Poll a single submission, reusing a cached terminal answer.

        Args:
            submission: The submission to poll.

        Returns:
            The status payload.

        Raises:
            Qubit16Error: On any refusal from the poll route.
        """
        cached = submission.last_poll
        if cached is not None and str(cached.get("status")) in TERMINAL:
            return cached

        params: dict[str, Any] = {}
        if submission.observable_labels:
            # The labels are the caller's record and the only thing that can
            # turn the result's floats back into named values.
            params["observables"] = ",".join(submission.observable_labels)

        payload = self._client.get(
            f"/api/hardware/job/{submission.provider}/{submission.job_id}",
            params or None,
        )
        payload = dict(payload) if isinstance(payload, Mapping) else {}
        submission.last_poll = payload
        return payload

    def _poll_all(self) -> list[dict[str, Any]]:
        """Poll every submission once.

        Returns:
            One payload per submission, in pub order.
        """
        return [self._poll_one(submission) for submission in self.submissions]

    def _wait(
        self,
        *,
        timeout: float | None = None,
        poll_interval: float | None = None,
    ) -> list[dict[str, Any]]:
        """Poll until every submission is terminal, or until the clock runs out.

        Args:
            timeout: Seconds, or None to wait indefinitely.
            poll_interval: Starting interval, defaulting to the job's.

        Returns:
            The terminal payloads, in pub order.

        Raises:
            JobTimeoutError: When the timeout elapsed. The job is unaffected.
        """
        interval = self._poll_interval if poll_interval is None else max(0.0, float(poll_interval))
        started = self._clock()

        while True:
            payloads = self._poll_all()
            pending = [
                submission.job_id
                for submission, payload in zip(self.submissions, payloads)
                if str(payload.get("status") or "queued") not in TERMINAL
            ]
            if not pending:
                return payloads

            if timeout is not None and (self._clock() - started) >= timeout:
                raise JobTimeoutError(
                    f"Gave up waiting after {timeout:.0f}s with {len(pending)} job(s) not "
                    "finished. THE JOB IS UNAFFECTED — it is queued at the provider, it has "
                    "already been counted against your allowance, and it will finish. Poll it "
                    "later with provider.job_status(provider, job_id).",
                    job_ids=pending,
                )

            self._sleep(interval)
            interval = min(interval * 1.5, MAX_POLL_INTERVAL) if interval else 0.0


def _sampler_result(
    submissions: Sequence[Submission], payloads: Sequence[Mapping[str, Any]]
) -> PrimitiveResult:
    """Build a ``PrimitiveResult`` of ``BitArray``s from histograms.

    HONEST LIMITATION: SHOT ORDER IS LOST. The wire carries an aggregated
    histogram, not a per-shot record, so the ``BitArray`` is reconstructed with
    ``BitArray.from_counts`` and the order of individual shots inside it is
    arbitrary. Everything that reads counts is unaffected; anything that reads
    ``bit_array[i]`` expecting the i-th shot in time order is not, and there is
    no way to recover that from what the API serves.

    HONEST LIMITATION: BIT ORDER IS THE VENDOR'S, NOT NECESSARILY QISKIT'S.
    The bitstrings are passed through exactly as the API served them, and the
    API serves what the vendor's SDK produced. For IBM that is a Qiskit result
    already, so the familiar convention holds: the rightmost character is
    classical bit 0. For a Braket device (``ionq_*``, ``rigetti_*``) the keys
    come from ``result.measurement_counts``, which Braket writes in its own
    qubit order, and this package does NOT reverse them — reversing on a
    convention we have not verified against a live device would be a guess, and
    a guess here silently relabels every outcome. So on a Braket device, treat
    the bit order as unverified until you have run a circuit whose answer you
    know (an X on qubit 0 alone is the one-line check). The fix belongs
    server-side, where the vendor result is in hand.

    Args:
        submissions: The submissions, in pub order.
        payloads: Their terminal status payloads.

    Returns:
        A ``PrimitiveResult`` of ``SamplerPubResult``.

    Raises:
        Qubit16Error: When a finished job carried no counts.
    """
    from qiskit.primitives import BitArray, DataBin, PrimitiveResult, SamplerPubResult

    pubs = []
    for submission, payload in zip(submissions, payloads):
        counts = payload.get("counts")
        if not isinstance(counts, Mapping) or not counts:
            raise Qubit16Error(
                f"Job {submission.job_id} finished with no counts. The provider accepted and ran "
                "it, but its result could not be read back in a shape this client recognises — "
                "check the job in the provider's console before re-submitting, because the "
                "allowance has already been spent.",
                body=dict(payload),
            )

        # The declared register width is the usual answer, but the service
        # strips separators out of the vendor's histogram, so a key can be
        # wider than the register says and the widest key is then the truth.
        #
        # This guard is not cosmetic: BitArray.from_counts does NOT raise on a
        # num_bits that is too small, it TRUNCATES from the left (verified —
        # {"111": 3} at num_bits=2 comes back as {"11": 3}). So taking the
        # declared width on faith would not fail loudly, it would hand back a
        # histogram with the high bits quietly removed.
        widest = max(len(str(key)) for key in counts)
        num_bits = max(widest, submission.num_bits or 0)
        bit_array = BitArray.from_counts(
            {str(key): int(value) for key, value in counts.items()}, num_bits=num_bits
        )
        data = DataBin(**{submission.creg_name or "meas": bit_array})
        pubs.append(SamplerPubResult(data, metadata=_pub_metadata(submission, payload)))

    return PrimitiveResult(pubs, metadata={"version": 2, "provider": "qubit16"})


def _estimator_result(
    submissions: Sequence[Submission], payloads: Sequence[Mapping[str, Any]]
) -> PrimitiveResult:
    """Build a ``PrimitiveResult`` of ``evs``/``stds`` arrays.

    THE VALUES ARE ALIGNED TO THE LABELS WE SUBMITTED, NOT TAKEN POSITIONALLY.
    ``data.evs[i]`` is read by every variational loop as "the i-th observable I
    asked for", so a response that carried the values in another order, or
    carried fewer of them than were submitted, would silently hand an optimiser
    a plausible number for a different operator — the failure mode this package
    is least able to detect after the fact. The service does answer
    positionally today (it zips the labels we send onto the vendor's array),
    which is exactly why the check is cheap: it should never fire, and if it
    ever does, something upstream has changed and a refusal is worth far more
    than an array.

    NULL BECOMES NaN, AND THAT IS DELIBERATE. The API reports a value it could
    not read as ``null``, and ``0.0`` is a real and common expectation value —
    they must not collapse into each other. A float array cannot hold None, so
    an unreadable value becomes NaN, which propagates through arithmetic
    instead of quietly reading as "the state is unpolarised". The untouched
    None is still available from ``job.expectation_values()`` and in each pub's
    metadata.

    Args:
        submissions: The submissions, in pub order.
        payloads: Their terminal status payloads.

    Returns:
        A ``PrimitiveResult`` of ``PubResult``.

    Raises:
        Qubit16Error: When a finished estimator job carried no values at all,
            or carried a set of them that cannot be matched to the observables
            that were submitted.
    """
    import numpy as np
    from qiskit.primitives import DataBin, PrimitiveResult, PubResult

    pubs = []
    for submission, payload in zip(submissions, payloads):
        values = payload.get("expectation_values")
        if not isinstance(values, list) or not values:
            raise Qubit16Error(
                f"Job {submission.job_id} finished with no expectation values. If you polled it "
                "elsewhere without the observable labels, the values exist but could not be "
                "named; the allowance for this job has already been spent either way.",
                body=dict(payload),
            )
        values = _aligned_values(submission, values, payload)

        evs = np.array([_nan_for_none(entry.get("value")) for entry in values], dtype=float)
        stds = np.array([_nan_for_none(entry.get("std_error")) for entry in values], dtype=float)
        metadata = _pub_metadata(submission, payload)
        metadata["expectation_values"] = [dict(entry) for entry in values]
        metadata["labels"] = [str(entry.get("label", "")) for entry in values]
        pubs.append(PubResult(DataBin(evs=evs, stds=stds), metadata=metadata))

    return PrimitiveResult(pubs, metadata={"version": 2, "provider": "qubit16"})


def _aligned_values(
    submission: Submission,
    values: Sequence[Any],
    payload: Mapping[str, Any],
) -> list[Mapping[str, Any]]:
    """Put the returned expectation values in the order they were asked for.

    ``data.evs[i]`` means "the i-th observable of this pub" to every caller, so
    the array must be built in submission order and must have one entry per
    submitted observable. Three cases, and the reasoning for each:

    * The returned labels are a permutation of the submitted ones — reorder to
      submission order. Positional trust would have returned ⟨XX⟩ where the
      caller reads ⟨ZZ⟩, which raises nothing and converges on the wrong
      number.
    * The returned labels are something else (``obs0``, ``obs1`` — what the
      service answers when the labels did not reach it) — keep the order as
      given, because that IS submission order there, and there is nothing else
      to align against.
    * The counts differ — refuse. A short array silently shortens every sum an
      optimiser takes over it.

    Args:
        submission: The submission, carrying the labels that were sent.
        values: The ``expectation_values`` list from the terminal poll.
        payload: The whole payload, kept on the exception for a bug report.

    Returns:
        The values, one per submitted observable, in submission order.

    Raises:
        Qubit16Error: When the response cannot be matched to the submission.
    """
    entries = [entry for entry in values if isinstance(entry, Mapping)]
    expected = list(submission.observable_labels)

    if not expected:
        # An estimator job always records its labels, so this is a Submission
        # built by hand. Nothing to align against; the caller gets what came.
        return entries

    if len(entries) != len(expected):
        raise Qubit16Error(
            f"Job {submission.job_id} returned {len(entries)} expectation value(s) for "
            f"{len(expected)} observable(s) ({', '.join(expected)}). The values cannot be "
            "matched to the observables that were submitted, and returning them positionally "
            "would give an optimiser a number for the wrong operator. The job ran and the "
            "allowance is spent — read job.expectation_values() for the raw response.",
            body=dict(payload),
        )

    returned = [str(entry.get("label", "")) for entry in entries]
    if returned != expected and sorted(returned) == sorted(expected) and len(set(returned)) == len(
        returned
    ):
        by_label = {label: entry for label, entry in zip(returned, entries)}
        return [by_label[label] for label in expected]
    return entries


def _nan_for_none(value: Any) -> float:
    """Map a null expectation value to NaN, keeping 0.0 as 0.0.

    Args:
        value: The reported number, or None.

    Returns:
        The float, or NaN when it could not be read.
    """
    if value is None:
        return float("nan")
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def _pub_metadata(submission: Submission, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Provenance for one pub result.

    Args:
        submission: The submission.
        payload: Its terminal status payload.

    Returns:
        Everything needed to find this run again: the vendor handle, the device
        it actually ran on, the compilation settings it ran under, and the
        metered QPU time. ``estimated_qpu_seconds`` on the submission is the
        vendor's projection; ``qpu_seconds`` here is the measured figure, and
        they are kept under different names for that reason.
    """
    response = submission.response
    return {
        "job_id": submission.job_id,
        "provider": submission.provider,
        "backend": payload.get("backend") or submission.backend,
        "shots": submission.shots,
        "primitive": submission.primitive,
        "qpu_seconds": payload.get("qpu_seconds"),
        "estimated_qpu_seconds": response.get("estimated_qpu_seconds"),
        "optimization_level": response.get("optimization_level"),
        "transpiled_depth": response.get("transpiled_depth"),
        "transpiled_two_qubit_gates": response.get("transpiled_two_qubit_gates"),
        "session_id": response.get("session_id"),
    }


__all__ = ["MAX_POLL_INTERVAL", "Qubit16Job", "Submission", "TERMINAL"]
