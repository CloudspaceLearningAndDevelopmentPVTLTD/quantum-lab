"""``SamplerV2`` and ``EstimatorV2`` over ``POST /api/hardware/submit``.

These exist so that the body of somebody's script does not change. The pub
shapes, the ``mode=`` keyword, the ``options`` object and the result containers
are Qiskit's, and the only thing underneath that differs is where the circuit
goes.

WHAT IS FAITHFUL, AND WHAT IS NOT
---------------------------------
Faithful: pub coercion, ``shots`` per-pub and per-run, ``mode=`` taking a
backend or a session, the result containers (a real ``BitArray`` you can call
``get_counts()`` on, real ``evs``/``stds`` arrays).

Not faithful, and deliberately loud about it:

* **One pub is one job.** The wire carries one circuit per submission, so a
  three-pub run is three submissions, three queue positions and three units of
  the monthly allowance. Qiskit's own primitives batch; this cannot.
* **Parameter sweeps are refused**, not expanded. See ``circuits.py``.
* **``precision`` is ignored** by the Estimator, with a warning. Shots is the
  knob the API exposes, and silently converting a requested precision into a
  shot count would be inventing statistics.
"""

from __future__ import annotations

import warnings
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any, Iterable, Mapping, Sequence

from qiskit import QuantumCircuit

from .circuits import assert_no_measurements, bind_parameters, measured_register, to_qasm3
from .exceptions import InvalidRequestError, Qubit16Error
from .job import Qubit16Job, Submission
from .observables import observables_to_wire

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .backend import Qubit16Backend
    from .session import Session

#: The API's per-job ceiling. Checked here so the refusal costs no round trip.
MAX_SHOTS = 20_000


@dataclass
class Options:
    """Submission options, with the API's own defaults.

    Attributes:
        shots: Repetitions per job, at most 20,000.
        optimization_level: Qiskit preset pass-manager level, 0 to 3, applied
            server-side. **This is the setting that matters most**: two-qubit
            gates dominate the error on every device here and level 3 routinely
            removes a third of them, at the cost of compile time — not shots
            and not money. It defaults to 1 only because that is what the API
            does when the field is omitted.
        dynamical_decoupling: Fill idle qubit time with an XY4 echo so a
            waiting qubit dephases less. Free at the vendor: it changes the
            pulse schedule, not the shot count. IBM only.
        measurement_twirling: Randomise the Pauli frame around each
            measurement, turning a biased readout error into ordinary variance.
            Also free: the same shot budget is split across randomisations
            rather than added to. IBM only.
        resilience_level: Estimator mitigation — 0 none, 1 readout mitigation,
            2 readout plus zero-noise extrapolation. Ignored by the Sampler.
            Level 2 costs substantially more QPU time because it runs the
            circuit at several noise amplifications.

    Both free options default to **off**, matching the API, because a run
    should be reproducible by default: the person comparing two runs should be
    the one who decided they differ.
    """

    shots: int = 4096
    optimization_level: int = 1
    dynamical_decoupling: bool = False
    measurement_twirling: bool = False
    resilience_level: int = 1


class _BasePrimitive:
    """Shared plumbing: resolve the mode, build the body, submit, wrap.

    Attributes:
        backend: The device jobs go to.
        session: The session jobs run inside, when there is one.
        options: The submission options.
    """

    #: ``sampler`` or ``estimator``. Set by the subclass.
    _primitive = ""

    def __init__(
        self,
        mode: Qubit16Backend | Session | None = None,
        *,
        backend: Qubit16Backend | None = None,
        options: Options | Mapping[str, Any] | None = None,
    ) -> None:
        """Bind a primitive to a device or a session.

        Args:
            mode: A :class:`~qubit16.backend.Qubit16Backend` or an open
                :class:`~qubit16.session.Session`. This is the keyword Qiskit
                Runtime uses, so ``SamplerV2(mode=backend)`` copied from an IBM
                script works unchanged.
            backend: The device, when not passing ``mode``.
            options: An :class:`Options`, or a mapping of the same fields.

        Raises:
            ValueError: When neither a backend nor a session was given, or when
                ``mode`` is something else entirely.
        """
        from .backend import Qubit16Backend as _Backend
        from .session import Session as _Session

        self.session: _Session | None = None
        resolved = mode if mode is not None else backend

        if resolved is None:
            raise ValueError(
                "A primitive needs a device: SamplerV2(mode=service.backend('ibm_brisbane')), or "
                "SamplerV2(mode=session) to run inside an open session."
            )
        if isinstance(resolved, _Session):
            self.session = resolved
            self.backend = resolved.backend
        elif isinstance(resolved, _Backend):
            self.backend = resolved
        else:
            # Checked by type rather than by duck-typing (``.name`` plus
            # ``.service``), because a qiskit-ibm-runtime IBMBackend has both
            # of those attributes. Accepting one would mean the script that
            # swapped its provider line but not its backend line failed with an
            # AttributeError from inside the submission path, after the user
            # had already believed it was working, instead of at the line that
            # is wrong.
            raise ValueError(
                f"mode must be a Qubit16Backend or a qubit16 Session, got "
                f"{type(resolved).__name__}. A qiskit-ibm-runtime backend or Session will not "
                "work here even though it looks similar — get the backend from "
                "Qubit16Provider.backend(...) and build sessions with qubit16.Session, so both "
                "reach qubit16 rather than IBM directly."
            )

        if options is None:
            self.options = Options()
        elif isinstance(options, Options):
            self.options = options
        elif isinstance(options, Mapping):
            unknown = set(options) - set(asdict(Options()))
            if unknown:
                raise ValueError(
                    f"Unknown option(s): {', '.join(sorted(unknown))}. Accepted: "
                    f"{', '.join(sorted(asdict(Options())))}."
                )
            self.options = Options(**dict(options))
        else:
            raise ValueError(f"options must be an Options or a mapping, got {type(options).__name__}.")

    # ── submission ──────────────────────────────────────────────────────────

    @property
    def _client(self) -> Any:
        """The HTTP client of the provider that produced the backend.

        Returns:
            The client. Reached through the backend rather than stored so that
            a primitive can never hold a credential the backend does not.
        """
        return self.backend.service.client

    def _shots(self, override: int | None) -> int:
        """Resolve and bound the shot count.

        Args:
            override: A per-run or per-pub shot count, or None.

        Returns:
            The shots to submit.

        Raises:
            InvalidRequestError: When the count is not a positive integer at or
                below the API's ceiling.
        """
        shots = self.options.shots if override is None else override
        # ``__index__`` rather than ``isinstance(int)``: a shot count that came
        # out of a numpy computation is a numpy integer, which is NOT an int,
        # and refusing `shots=n_shots[i]` would break exactly the scientific
        # code this package exists to accept. bool is excluded because it
        # indexes as 0/1 and `shots=True` is never a shot count. A float stays
        # refused — 4096.0 is a rounding decision, and this is not the place to
        # make it on somebody's behalf.
        try:
            shots = int(shots.__index__()) if not isinstance(shots, bool) else shots
        except (AttributeError, TypeError, ValueError):
            pass
        if isinstance(shots, bool) or not isinstance(shots, int) or shots < 1:
            raise InvalidRequestError(
                f"shots must be a positive integer, got {shots!r}. A float is refused rather "
                "than rounded: 4096.0 may be a bug in the caller's arithmetic."
            )
        if shots > MAX_SHOTS:
            raise InvalidRequestError(
                f"shots must be at most {MAX_SHOTS} per job, got {shots}. Split the run across "
                "several jobs if you need more — note that each is one unit of your monthly "
                "allowance."
            )
        return shots

    def _submit(self, body: dict[str, Any]) -> dict[str, Any]:
        """POST one submission and return the accepted handle.

        Args:
            body: The request body.

        Returns:
            The submission response.

        Raises:
            Qubit16Error: On any refusal. A retryable failure here is
                deliberately NOT retried — see ``client.py``: a submission that
                may already have been enqueued must not be sent twice.
        """
        if self.session is not None:
            session_id = self.session.session_id
            if self.session.closed or not session_id:
                raise Qubit16Error(
                    "This session is not open, so a job submitted through it would silently "
                    "queue on the bare backend and throw away the window you are paying for. "
                    "Use the session inside a 'with' block."
                )
            body["session_id"] = session_id

        payload = self._client.post("/api/hardware/submit", body)
        if not isinstance(payload, Mapping) or not payload.get("job_id"):
            raise Qubit16Error(
                "The submission was accepted without a job id, so it cannot be tracked from "
                "here. It has been counted against your allowance because it may be running — "
                "look for it in the provider's console.",
                body=payload if isinstance(payload, Mapping) else None,
            )
        return dict(payload)

    def _job(self, submissions: Sequence[Submission]) -> Qubit16Job:
        """Wrap accepted submissions in a job handle.

        Args:
            submissions: One per pub, in pub order.

        Returns:
            The job.
        """
        return Qubit16Job(
            self.backend,
            submissions,
            self._client,
            primitive=self._primitive,
            poll_interval=self.backend.service.poll_interval,
        )


class SamplerV2(_BasePrimitive):
    """Run circuits and get histograms back.

    ::

        sampler = SamplerV2(mode=backend)
        job = sampler.run([circuit], shots=4096)
        counts = job.result()[0].data.meas.get_counts()

    The ``meas`` in that last line is the name of the circuit's classical
    register — ``measure_all()`` calls it ``meas`` — and this package names the
    result field after it for exactly that reason.
    """

    _primitive = "sampler"

    def run(self, pubs: Iterable[Any], *, shots: int | None = None) -> Qubit16Job:
        """Submit one job per pub.

        Args:
            pubs: Sampler pubs: a ``QuantumCircuit``, or ``(circuit,)``,
                ``(circuit, parameter_values)`` or
                ``(circuit, parameter_values, shots)``.
            shots: Shots for every pub that does not name its own.

        Returns:
            A job covering every pub, in order.

        Raises:
            InvalidRequestError: On an unusable circuit — no measurements, more
                than one classical register, an unbindable parameter set, or
                shots out of range.
            Qubit16Error: On any refusal from the API.

        Note:
            **Each pub is a separate job and a separate unit of your monthly
            hardware allowance.** Qiskit's local primitives batch pubs for
            free; this one cannot, because the wire carries one circuit per
            submission.
        """
        submissions: list[Submission] = []
        for index, pub in enumerate(_as_list(pubs)):
            circuit, parameters, pub_shots = _sampler_pub(pub, index)
            circuit = bind_parameters(circuit, parameters)
            creg_name, num_bits = measured_register(circuit)
            resolved_shots = self._shots(pub_shots if pub_shots is not None else shots)

            response = self._submit(
                {
                    "qasm": to_qasm3(circuit),
                    "backend": self.backend.name,
                    "shots": resolved_shots,
                    "optimization_level": self.options.optimization_level,
                    "dynamical_decoupling": self.options.dynamical_decoupling,
                    "measurement_twirling": self.options.measurement_twirling,
                }
            )
            submissions.append(
                Submission(
                    job_id=str(response["job_id"]),
                    provider=str(response.get("provider") or "ibm"),
                    backend=str(response.get("backend") or self.backend.name),
                    primitive="sampler",
                    shots=resolved_shots,
                    creg_name=creg_name,
                    num_bits=num_bits,
                    response=response,
                )
            )
        if not submissions:
            raise InvalidRequestError("run() was given no pubs.")
        return self._job(submissions)


class EstimatorV2(_BasePrimitive):
    """Measure ⟨ψ|H|ψ⟩ instead of returning a histogram.

    ::

        estimator = EstimatorV2(mode=backend)
        job = estimator.run([(circuit, SparsePauliOp.from_list([("ZZ", 1.0)]))])
        energy = job.result()[0].data.evs[0]

    **The circuit must carry no measurements.** The observable is measured for
    you; a terminal measurement collapses the state first. This is checked
    locally and refused by the service as well — neither end strips the
    measurements for you, because that would edit your circuit and hand back a
    number for something you did not submit.
    """

    _primitive = "estimator"

    def run(self, pubs: Iterable[Any], *, shots: int | None = None) -> Qubit16Job:
        """Submit one job per pub.

        Args:
            pubs: Estimator pubs: ``(circuit, observables)``,
                ``(circuit, observables, parameter_values)`` or
                ``(circuit, observables, parameter_values, precision)``.
                Observables may be a ``SparsePauliOp``, a Pauli string, a list
                of either, or a ``{label: observable}`` mapping — the mapping
                being the only shape that lets you name the results.
            shots: Shots for every pub.

        Returns:
            A job covering every pub, in order.

        Raises:
            InvalidRequestError: On a measured circuit, a Pauli string of the
                wrong width, a complex coefficient, or shots out of range.
            Qubit16Error: On any refusal from the API.

        Note:
            ``precision`` is accepted and **ignored**, with a warning. The API
            exposes shots, and turning a requested precision into a shot count
            would be inventing statistics on the caller's behalf.
        """
        submissions: list[Submission] = []
        for index, pub in enumerate(_as_list(pubs)):
            circuit, observables, parameters, precision = _estimator_pub(pub, index)
            if precision is not None:
                warnings.warn(
                    "qubit16 ignores the estimator's `precision`: the API takes a shot count, "
                    "and converting one into the other would be inventing statistics. Set "
                    "shots= instead.",
                    stacklevel=2,
                )
            circuit = bind_parameters(circuit, parameters)
            assert_no_measurements(circuit)
            wire = observables_to_wire(observables, circuit.num_qubits)
            resolved_shots = self._shots(shots)

            response = self._submit(
                {
                    "qasm": to_qasm3(circuit),
                    "backend": self.backend.name,
                    "shots": resolved_shots,
                    "optimization_level": self.options.optimization_level,
                    "dynamical_decoupling": self.options.dynamical_decoupling,
                    "measurement_twirling": self.options.measurement_twirling,
                    "resilience_level": self.options.resilience_level,
                    "observables": wire,
                }
            )
            # The labels the submission response echoes back are authoritative
            # — the service truncates and defaults them — and they are the only
            # thing that can name the values on the poll. Falling back to what
            # we sent keeps an older service working.
            labels = response.get("observable_labels") or [entry["label"] for entry in wire]
            submissions.append(
                Submission(
                    job_id=str(response["job_id"]),
                    provider=str(response.get("provider") or "ibm"),
                    backend=str(response.get("backend") or self.backend.name),
                    primitive="estimator",
                    shots=resolved_shots,
                    observable_labels=tuple(str(label) for label in labels),
                    response=response,
                )
            )
        if not submissions:
            raise InvalidRequestError("run() was given no pubs.")
        return self._job(submissions)


def _as_list(pubs: Iterable[Any]) -> list[Any]:
    """Accept a bare pub as well as an iterable of them.

    ``sampler.run(circuit)`` instead of ``sampler.run([circuit])`` is a
    near-universal typo and the failure it would otherwise produce — iterating
    a ``QuantumCircuit`` — is unhelpful.

    Args:
        pubs: What the caller passed to ``run``.

    Returns:
        A list of pubs.
    """
    if isinstance(pubs, QuantumCircuit):
        return [pubs]
    if isinstance(pubs, tuple):
        # A bare tuple is one pub, e.g. run((circuit, observable)).
        return [pubs]
    return list(pubs)


def _sampler_pub(pub: Any, index: int) -> tuple[QuantumCircuit, Any, int | None]:
    """Unpack a sampler pub.

    Args:
        pub: The pub.
        index: Its position, for error messages.

    Returns:
        ``(circuit, parameter_values, shots)`` with None for the absent parts.

    Raises:
        InvalidRequestError: When the pub is not a recognised shape.
    """
    if isinstance(pub, QuantumCircuit):
        return pub, None, None
    if isinstance(pub, (tuple, list)) and 1 <= len(pub) <= 3:
        circuit = pub[0]
        if not isinstance(circuit, QuantumCircuit):
            raise InvalidRequestError(
                f"pubs[{index}][0] must be a QuantumCircuit, got {type(circuit).__name__}."
            )
        parameters = pub[1] if len(pub) > 1 else None
        shots = pub[2] if len(pub) > 2 else None
        return circuit, parameters, shots
    raise InvalidRequestError(
        f"pubs[{index}] is not a sampler pub. Pass a QuantumCircuit, or a tuple of "
        "(circuit), (circuit, parameter_values) or (circuit, parameter_values, shots)."
    )


def _estimator_pub(pub: Any, index: int) -> tuple[QuantumCircuit, Any, Any, float | None]:
    """Unpack an estimator pub.

    Args:
        pub: The pub.
        index: Its position, for error messages.

    Returns:
        ``(circuit, observables, parameter_values, precision)``.

    Raises:
        InvalidRequestError: When the pub is not a recognised shape, including
            the common case of passing a bare circuit — an estimator cannot
            guess what to measure.
    """
    if isinstance(pub, QuantumCircuit):
        raise InvalidRequestError(
            f"pubs[{index}] is a bare circuit. An estimator pub must also say what to measure: "
            '(circuit, SparsePauliOp.from_list([("ZZ", 1.0)])).'
        )
    if isinstance(pub, (tuple, list)) and 2 <= len(pub) <= 4:
        circuit = pub[0]
        if not isinstance(circuit, QuantumCircuit):
            raise InvalidRequestError(
                f"pubs[{index}][0] must be a QuantumCircuit, got {type(circuit).__name__}."
            )
        observables = pub[1]
        parameters = pub[2] if len(pub) > 2 else None
        precision = pub[3] if len(pub) > 3 else None
        return circuit, observables, parameters, precision
    raise InvalidRequestError(
        f"pubs[{index}] is not an estimator pub. Pass (circuit, observables), "
        "(circuit, observables, parameter_values) or "
        "(circuit, observables, parameter_values, precision)."
    )


#: Aliases, so code written against either spelling works. Qiskit dropped the
#: V1 primitives, so the unversioned names now mean the V2 ones everywhere.
Sampler = SamplerV2
Estimator = EstimatorV2


__all__ = [
    "Estimator",
    "EstimatorV2",
    "MAX_SHOTS",
    "Options",
    "Sampler",
    "SamplerV2",
]
