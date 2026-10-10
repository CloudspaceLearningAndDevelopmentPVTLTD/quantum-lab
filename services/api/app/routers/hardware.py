"""HTTP routes for real quantum hardware: devices, analysis, cost and jobs.

Submission is asynchronous everywhere: POST ``/submit`` returns a job id, and
the caller polls GET ``/job/{provider}/{job_id}`` until the status is ``done``.
"""

from __future__ import annotations

from typing import Any, Callable, TypeVar

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings
from app.quantum import hardware, recommend as recommend_mod, transpile as transpile_mod
from app.quantum.credentials import (
    CREDENTIALS_HEADER,
    IbmCredentials,
    parse_credentials_header,
)
from app.quantum.hardware import MissingDependency
from app.quantum.observables import parse_observables

# SECURITY FIX (audit finding PY-1): the same pre-parse resource guard used by
# the circuits router. Every route below hands user-supplied QASM to a parser,
# so every one of them needs the cap applied BEFORE the parse, not after.
from app.routers.circuits import guard_qasm

router = APIRouter(prefix="/api/hardware", tags=["hardware"])

T = TypeVar("T")

#: The BYOK header, declared once and reused by the two routes that can act on
#: somebody else's vendor account.
#:
#: ``include_in_schema=False`` because this is NOT a knob for a public API
#: caller to turn. The header is attached by ``apps/web``, which opens a
#: credential the user stored there; publishing it in the OpenAPI schema would
#: invite people to paste a live IBM token into a curl command and a shell
#: history. A caller who wants to use their own credential stores it once and
#: every route picks it up.
_CREDENTIALS = Header(default=None, alias=CREDENTIALS_HEADER, include_in_schema=False)


def _credentials(raw: str | None) -> IbmCredentials | None:
    """Parse the BYOK header, mapping a malformed one onto a 400.

    A MALFORMED header is refused rather than ignored. Ignoring it would run
    the job on the operator's account while the submitter believed they were
    paying for it themselves — a silent, billable wrong answer, and the exact
    failure this whole path exists to make impossible.

    Args:
        raw: The raw header value, or None when it was not sent.

    Returns:
        The parsed credential, or None to mean the operator's credentials.

    Raises:
        HTTPException: 400 when the header is present and unusable.
    """
    return _guard(parse_credentials_header, raw)


def _guard(operation: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Run a hardware call, mapping its failure modes onto HTTP status codes.

    A missing SDK or credential is a server-configuration problem, so it becomes
    503 with the exact remedy attached; anything else the layer rejects is the
    caller's input, so it becomes 400.

    Args:
        operation: The callable to invoke.
        *args: Positional arguments forwarded to ``operation``.
        **kwargs: Keyword arguments forwarded to ``operation``.

    Returns:
        Whatever ``operation`` returns.

    Raises:
        HTTPException: 503 for :class:`MissingDependency`, 400 for ValueError.
    """
    try:
        return operation(*args, **kwargs)
    except MissingDependency as exc:
        raise HTTPException(status_code=503, detail=f"{exc} (remedy: {exc.remedy})") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class CalibrationSummary(BaseModel):
    """Noise/quality figures for one device, with their provenance attached.

    ``source`` is the honesty marker and is never inferred by the client:
    'live' means read from the vendor SDK during this listing, 'static' means
    the shipped table of vendor-published *typical* values, 'unavailable'
    means we have nothing truthful to show. Built by
    app/quantum/calibration.py; the field names here are the wire contract the
    web app's ``lib/hardware/fitEstimate.ts`` mirrors verbatim.
    """

    source: str = Field(description="'live', 'static' (typical values) or 'unavailable'.")
    qubits: int | None = None
    median_1q_error: float | None = Field(default=None, description="Median 1-qubit gate error.")
    median_2q_error: float | None = Field(default=None, description="Median 2-qubit gate error.")
    median_t1_us: float | None = Field(default=None, description="Median T1, microseconds.")
    median_t2_us: float | None = Field(default=None, description="Median T2, microseconds.")
    queue_depth: int | None = Field(default=None, description="Pending jobs when reported.")
    note: str = Field(default="", description="Provenance sentence shown in the UI.")


class DeviceInfo(BaseModel):
    """One hardware device, either observed live or read from the catalogue."""

    id: str
    name: str
    provider: str
    qubits: int
    technology: str
    note: str = ""
    available: bool
    source: str = Field(description="'live' when queried from the provider, else 'catalogue'.")
    reason: str | None = Field(default=None, description="Why the device is unavailable.")
    pending_jobs: int | None = Field(default=None, description="Queue depth when reported.")
    calibration: CalibrationSummary | None = Field(
        default=None, description="Calibration summary with an explicit source marker."
    )


class QasmRequest(BaseModel):
    """A request carrying only a circuit."""

    qasm: str = Field(description="OpenQASM 3 (or 2) circuit source.")


class AnalyseResponse(BaseModel):
    """Structural properties of a circuit."""

    num_qubits: int
    num_clbits: int
    depth: int
    size: int
    gate_counts: dict[str, int]
    has_measurements: bool
    two_qubit_gates: int


class EstimateRequest(BaseModel):
    """A cost estimate request; the qubit count is derived from the QASM."""

    qasm: str = Field(description="OpenQASM 3 (or 2) circuit source.")
    backend: str = Field(description="Target backend id, e.g. 'ionq_aria'.")
    # SECURITY FIX (audit finding PY-2): was `ge=1` with NO upper bound, so a
    # caller could price an arbitrarily large run. Pydantic rejects NaN/inf for
    # an int field already; the ceiling is what was missing.
    shots: int = Field(1024, ge=1, le=20_000, description="Number of repetitions to price.")


class EstimateResponse(BaseModel):
    """An indicative price for one submission."""

    currency: str
    backend: str
    vendor: str
    shots: int
    num_qubits: int
    per_shot: float
    task_fee: float
    estimated_total: float
    is_free: bool
    note: str


class TranspileRequest(BaseModel):
    """A request to rewrite a circuit into a backend's native gate set."""

    qasm: str = Field(description="OpenQASM 3 (or 2) circuit source.")
    backend: str = Field(description="Target backend id, e.g. 'ibm_brisbane'.")
    optimization_level: int = Field(1, ge=0, le=3, description="Qiskit optimisation level.")


class TranspileResponse(BaseModel):
    """The transpiled circuit plus a before/after comparison."""

    backend: str
    vendor: str
    basis_gates: list[str]
    requested_basis_gates: list[str]
    optimization_level: int
    qasm: str
    num_qubits: int
    depth_before: int
    depth_after: int
    gate_counts_before: dict[str, int]
    gate_counts_after: dict[str, int]
    two_qubit_gates_before: int
    two_qubit_gates_after: int
    notes: str | None = None


class SubmitRequest(BaseModel):
    """A hardware submission request."""

    qasm: str = Field(description="OpenQASM 3 (or 2) circuit source.")
    backend: str = Field(description="Device name or id, e.g. 'ibm_brisbane'.")
    # SECURITY FIX (audit finding PY-2): bounded at the schema level as well as
    # in the handler, so an out-of-range value is a 422 before any work starts.
    shots: int = Field(1024, ge=1, le=20_000, description="Number of repetitions.")
    provider: str | None = Field(
        default=None,
        description="'ibm', 'braket' or 'azure'; inferred from the backend id when omitted.",
    )
    # Defaults to 1, the value submission hardcoded before this field existed,
    # so an older caller that omits it gets byte-identical behaviour. It is
    # here because /transpile already takes a level and shows the caller the
    # resulting depth and gate counts: submitting at a different level made
    # that preview a description of a circuit that never ran.
    optimization_level: int = Field(
        1, ge=0, le=3, description="Qiskit preset pass-manager level, matching /transpile."
    )
    #: Opaque per-account id, stamped onto the vendor job as a tag where the
    #: vendor supports one. NOT trusted for authorisation — the Next proxy
    #: resolves the real identity from a Supabase-verified token and this is
    #: only a label — so it must never be an email or anything else
    #: identifying in the vendor's console.
    owner: str | None = Field(
        default=None, max_length=128, description="Opaque account id used as a vendor job tag."
    )
    #: Idle-time decoupling. Free at the vendor (it changes the pulse schedule,
    #: not the shot count) and ignored by providers that do not support it.
    dynamical_decoupling: bool = Field(
        default=False, description="Insert an XY4 dynamical-decoupling sequence (IBM only)."
    )
    #: Readout twirling. Also free: the same shot budget is split across Pauli
    #: randomisations rather than added to. Turns a biased readout error into a
    #: symmetric one.
    measurement_twirling: bool = Field(
        default=False, description="Randomise the Pauli frame around measurement (IBM only)."
    )
    #: When present this becomes an ESTIMATOR job: the device measures
    #: <psi|H|psi> for each observable instead of returning a histogram. This
    #: is the primitive every variational algorithm needs, and until it existed
    #: a VQE or QAOA could not be run on hardware here at all.
    #:
    #: Left as a loose list rather than a pydantic model on purpose: the shape
    #: has two accepted spellings (an object, or Qiskit's own ["ZZ", 1.0] pair)
    #: and every rule about it — Pauli alphabet, one letter per qubit, term and
    #: observable counts, finite coefficients, unique labels — lives in
    #: app/quantum/observables.py so there is exactly one place it is enforced
    #: and one place the error messages are written.
    observables: list[Any] | None = Field(
        default=None,
        description='Run the estimator, e.g. [{"label": "ZZ", "terms": [{"pauli": "ZZ"}]}].',
    )
    #: Estimator error mitigation: 0 none, 1 readout mitigation (TREX),
    #: 2 + zero-noise extrapolation. Ignored by the sampler.
    resilience_level: int = Field(
        1, ge=0, le=2, description="Estimator error mitigation level (IBM only)."
    )
    #: An open runtime session to run inside, so an iterative workload does not
    #: re-enter the shared queue on every iteration.
    session_id: str | None = Field(
        default=None, max_length=128, description="An open IBM runtime session id."
    )
    #: A sweep over the circuit's free parameters. ONE job, one queue position
    #: and one quota unit for every point — which is the whole reason it exists:
    #: the same sweep as N submissions costs N of the monthly allowance and
    #: enters a shared queue N times.
    #:
    #: Loose like `observables`, and for the same reason: every rule about it
    #: (both QASM spellings, the two sweep shapes, the point and total-shot
    #: ceilings, and the binding ORDER that is the easy thing to get silently
    #: wrong) lives in app/quantum/parameters.py.
    sweep: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Sweep the circuit's free parameters, e.g. "
            '{"ranges": [{"parameter": "theta", "start": 0, "stop": 3.14, "points": 20}]}.'
        ),
    )


class SubmitResponse(BaseModel):
    """The handle returned by an asynchronous hardware submission."""

    job_id: str
    backend: str
    status: str
    submitted_at: str
    provider: str
    shots: int
    queue_position: int | None = None
    # Everything below is additive and optional: a provider that does not
    # report a field omits it rather than sending a zero, because a depth of 0
    # and an unknown depth are different claims.
    transpiled_depth: int | None = Field(
        default=None, description="Depth of the circuit as actually sent to the device."
    )
    transpiled_two_qubit_gates: int | None = Field(
        default=None, description="Two-qubit gate count in the circuit sent to the device."
    )
    optimization_level: int | None = Field(
        default=None, description="The level the submission was transpiled at."
    )
    tags: list[str] | None = Field(default=None, description="Tags attached at the vendor.")
    dynamical_decoupling: bool | None = Field(
        default=None, description="Whether idle-time decoupling was applied."
    )
    measurement_twirling: bool | None = Field(
        default=None, description="Whether readout twirling was applied."
    )
    estimated_qpu_seconds: float | None = Field(
        default=None, description="The vendor's own estimate of QPU time, when it reports one."
    )
    primitive: str | None = Field(
        default=None, description="'sampler' or 'estimator'."
    )
    observable_labels: list[str] | None = Field(
        default=None, description="Echoed back so a poll can name each expectation value."
    )
    resilience_level: int | None = Field(default=None, description="Mitigation level applied.")
    session_id: str | None = Field(default=None, description="The session this ran inside.")
    #: KEEP THIS. Polling a swept job without it reads a sampler result as one
    #: merged histogram — the average of the sweep, presented as a measurement.
    sweep_points: int | None = Field(
        default=None, description="How many points this job swept. Required to poll it."
    )
    sweep_parameters: list[str] | None = Field(
        default=None, description="Parameter names in binding order."
    )
    sweep_point_values: list[list[float]] | None = Field(
        default=None, description="Each point's values, in binding order (estimator only)."
    )
    total_shots: int | None = Field(
        default=None, description="shots x points — what the device actually runs."
    )


class ExpectationValue(BaseModel):
    """One observable's measured value.

    ``value`` is nullable and that is load-bearing: an expectation value of
    0.0 is a real, common answer (it is what ⟨Z⟩ gives for a perfect
    superposition), so a number that could not be read has to be
    distinguishable from it and is reported as null.
    """

    label: str
    value: float | None = None
    std_error: float | None = Field(default=None, description="One standard error, when reported.")
    #: Set instead of `value` for a SWEPT estimator job: one entry per point,
    #: in submission order. A null inside the list is a point whose value could
    #: not be read, which is not the same as a zero.
    values: list[float | None] | None = None
    std_errors: list[float | None] | None = None


class JobStatusResponse(BaseModel):
    """The current state of a submitted hardware job."""

    job_id: str
    provider: str
    status: str = Field(description="queued | running | done | error | cancelled")
    counts: dict[str, int] | None = Field(default=None, description="Set only when done.")
    error: str | None = Field(default=None, description="Set only on error.")
    backend: str | None = Field(
        default=None, description="The device the job actually ran on, when reported."
    )
    created_at: str | None = Field(default=None, description="Vendor-side creation timestamp.")
    queue_position: int | None = Field(
        default=None, description="Set only while queued or running, and only when reported."
    )
    qpu_seconds: float | None = Field(
        default=None, description="Metered QPU time, available only once the job is done."
    )
    primitive: str | None = Field(default=None, description="'sampler' or 'estimator'.")
    #: Set instead of `counts` for an estimator job. A value of None inside one
    #: of these means the number could not be read — NOT zero, which is a real
    #: and common expectation value.
    expectation_values: list[ExpectationValue] | None = Field(
        default=None, description="Set only when an estimator job is done."
    )
    counts_per_point: list[dict[str, int]] | None = Field(
        default=None, description="Set instead of `counts` for a swept sampler job."
    )
    sweep_points: int | None = Field(default=None, description="Points this job swept.")


@router.get("/devices", response_model=list[DeviceInfo])
def devices() -> list[dict[str, Any]]:
    """List real hardware devices, live when credentials allow, else catalogued.

    Returns:
        Every known device with its availability and data source.
    """
    return _guard(hardware.list_hardware_devices)


@router.post("/analyse", response_model=AnalyseResponse)
def analyse(request: QasmRequest) -> dict[str, Any]:
    """Report a circuit's width, depth, gate mix and measurement status.

    Args:
        request: The circuit source.

    Returns:
        The analysis dictionary.
    """
    guard_qasm(request.qasm)  # SECURITY FIX (audit finding PY-1): cap before work.
    return _guard(transpile_mod.analyse_circuit, request.qasm)


@router.post("/estimate", response_model=EstimateResponse)
def estimate(request: EstimateRequest) -> dict[str, Any]:
    """Estimate the cost of running a circuit on a backend.

    Args:
        request: The circuit, backend and shot count.

    Returns:
        The cost breakdown, with the qubit count taken from the circuit.
    """
    guard_qasm(request.qasm)  # SECURITY FIX (audit finding PY-1): cap before work.
    analysis = _guard(transpile_mod.analyse_circuit, request.qasm)
    return _guard(
        transpile_mod.estimate_cost,
        request.backend,
        request.shots,
        int(analysis["num_qubits"]),
    )


class RecommendRequest(BaseModel):
    """Ask which device to run a circuit on.

    The one question a multi-vendor platform can answer and a single-vendor
    console structurally cannot: of the devices we reach, which produces the
    most usable result per dollar for THIS circuit? Answering it needs live
    calibration, real pricing, coupling maps and transpilation across vendors
    at once, and all four already live in this service.
    """

    qasm: str = Field(description="OpenQASM 3 (or 2) circuit source.")
    shots: int = Field(1024, ge=1, le=20_000, description="Shots to price and project for.")
    backends: list[str] | None = Field(
        default=None, description="Restrict to these backend ids; all known hardware when omitted."
    )
    optimization_level: int = Field(
        1, ge=0, le=3, description="Pass-manager level used for the projection."
    )
    objective: str = Field(
        default=recommend_mod.DEFAULT_OBJECTIVE, description="What 'best' means for this ranking."
    )
    include_decoherence: bool = Field(
        default=True, description="Fold idle-time T1/T2 decay into the projection."
    )


@router.post("/recommend")
def recommend(request: RecommendRequest) -> dict[str, Any]:
    """Rank the devices we reach for one circuit.

    EVERY FIGURE IN THE RESPONSE IS A PROJECTION, NOT A MEASUREMENT, and the
    payload is built to make that impossible to miss: each ranked row carries
    the calibration ``source`` it was computed from ('live', 'static' meaning
    vendor-published typical values, or 'unavailable'), and the response
    carries the model's own ``ignores`` list. A device whose calibration cannot
    be obtained is returned under ``unrankable`` with a reason rather than
    given a made-up score — refusing to rank is an answer, and inventing a
    number for a device we know nothing about is the one thing that would make
    this feature worth less than nothing.

    ``devices=`` is passed so the ranking sees LIVE calibration and real queue
    depths where credentials allow. Without it the endpoint still answers,
    entirely from the shipped typical-values tables, every row marked 'static'.

    Args:
        request: The circuit, the shot count and the ranking options.

    Returns:
        ``{ranked, unrankable, objective, model, ...}`` — see
        app/quantum/recommend.py for the row shape.

    Raises:
        HTTPException: 400 on bad input, 503 when a provider SDK is missing.
    """
    guard_qasm(request.qasm)  # SECURITY FIX (audit finding PY-1): cap before work.
    return _guard(
        recommend_mod.recommend_devices,
        request.qasm,
        shots=request.shots,
        backends=request.backends,
        optimization_level=request.optimization_level,
        objective=request.objective,
        include_decoherence=request.include_decoherence,
        devices=hardware.list_hardware_devices(),
    )


@router.post("/transpile", response_model=TranspileResponse)
def transpile_circuit(request: TranspileRequest) -> dict[str, Any]:
    """Rewrite a circuit into a backend's native gate set.

    Args:
        request: The circuit, backend and optimisation level.

    Returns:
        The transpiled QASM with before/after depth and gate counts.
    """
    guard_qasm(request.qasm)  # SECURITY FIX (audit finding PY-1): cap before work.
    return _guard(
        transpile_mod.transpile_for,
        request.qasm,
        request.backend,
        optimization_level=request.optimization_level,
    )


@router.post("/submit", response_model=SubmitResponse)
def submit(
    request: SubmitRequest,
    presented: str | None = _CREDENTIALS,
) -> dict[str, Any]:
    """Enqueue a circuit on real hardware and return its job handle.

    This never waits for a result: poll ``/api/hardware/job/{provider}/{job_id}``
    instead.

    Args:
        request: The circuit, device, shot count and optional provider.
        presented: A BYOK credential for THIS request, as the header
            ``X-Quantum-Lab-Credentials``. When present the job is enqueued on
            the submitter's own vendor account instead of the operator's; the
            value is used for one call and is never stored, logged, or written
            into ``settings``.

    Returns:
        The submission record.

    Raises:
        HTTPException: 400 on bad input, 503 when the SDK or credentials are
            missing.
    """
    if request.shots > settings.max_shots:
        raise HTTPException(
            status_code=400,
            detail=f"shots must be between 1 and {settings.max_shots}, got {request.shots}.",
        )
    guard_qasm(request.qasm)  # SECURITY FIX (audit finding PY-1): cap before work.
    provider = request.provider or _guard(hardware.provider_for, request.backend)

    # Observables are parsed HERE rather than inside submit_job, because the
    # parse needs the circuit's qubit count — every Pauli string must be
    # exactly one letter per qubit — and analysing the circuit is work the
    # route already knows how to guard.
    observables = None
    if request.observables is not None:
        analysis = _guard(transpile_mod.analyse_circuit, request.qasm)
        observables = _guard(
            parse_observables, request.observables, int(analysis["num_qubits"])
        )

    return _guard(
        hardware.submit_job,
        request.qasm,
        request.backend,
        request.shots,
        provider,
        optimization_level=request.optimization_level,
        owner=request.owner,
        dynamical_decoupling=request.dynamical_decoupling,
        measurement_twirling=request.measurement_twirling,
        observables=observables,
        resilience_level=request.resilience_level,
        session_id=request.session_id,
        sweep=request.sweep,
        credentials=_credentials(presented),
    )


@router.get("/job/{provider}/{job_id:path}", response_model=JobStatusResponse)
def job_status(
    provider: str,
    job_id: str,
    observables: str | None = None,
    sweep_points: int | None = None,
    presented: str | None = _CREDENTIALS,
) -> dict[str, Any]:
    """Report the current status of a submitted hardware job.

    Args:
        provider: ``"ibm"``, ``"braket"`` or ``"azure"``.
        job_id: The provider's job id, or a Braket task ARN.
        observables: Comma-separated observable labels, in submission order.
            Their PRESENCE is what makes this an estimator poll — IBM stores
            the observables but not our names for them, so the labels are the
            caller's own record and passing them is what turns an array of
            floats back into named expectation values. A caller that has lost
            them can pass an empty string to get positional names.
        sweep_points: How many points the job swept, from the submission
            record. Without it a swept sampler job's points are merged into one
            histogram and a swept estimator job is read at the wrong rank —
            both silently, both plausible-looking.
        presented: The credential the job was SUBMITTED with, when that was the
            submitter's own. A job on one IBM account is invisible to another,
            so a BYOK job polled with the operator's token reads as "no such
            job" — which is why the web layer resolves this from the stored
            job record rather than from whatever the caller has attached now.

    Returns:
        The status record, with counts (sampler) or expectation values
        (estimator) once the job is done.
    """
    labels: list[str] | None = None
    if observables is not None:
        labels = [part.strip() for part in observables.split(",") if part.strip()]
    return _guard(
        hardware.poll_job,
        provider,
        job_id,
        labels,
        sweep_points,
        credentials=_credentials(presented),
    )


class SessionRequest(BaseModel):
    """A request to open a runtime session."""

    backend: str = Field(description="IBM device name to reserve, e.g. 'ibm_brisbane'.")
    #: A session RESERVES the device and bills for its window whether or not
    #: jobs are running, so this is required rather than unbounded: an
    #: abandoned session with no cap is a bill with no work attached.
    max_time_seconds: int = Field(
        3600, ge=60, le=28_800, description="Hard ceiling on the session's life."
    )


class SessionResponse(BaseModel):
    """An open runtime session."""

    session_id: str
    backend: str
    max_time_seconds: int
    opened_at: str
    provider: str


class SessionClosed(BaseModel):
    """The result of closing a session."""

    session_id: str
    closed: bool
    closed_at: str


@router.post("/session", response_model=SessionResponse)
def open_session(request: SessionRequest) -> dict[str, Any]:
    """Open an IBM runtime session so an iterative workload keeps the device.

    Without one, every iteration of a variational loop re-enters the shared
    queue from the back, which turns a 200-iteration optimisation from an hour
    into days. With one, IBM runs the session's jobs consecutively.

    THIS COSTS MONEY FOR AS LONG AS IT IS OPEN. Close it when the loop ends.

    Args:
        request: The device and the maximum window.

    Returns:
        The session record; pass ``session_id`` on every subsequent submit.
    """
    return _guard(hardware.open_ibm_session, request.backend, request.max_time_seconds)


@router.delete("/session/{session_id}", response_model=SessionClosed)
def close_session(session_id: str) -> dict[str, Any]:
    """Close a runtime session so it stops holding the device.

    Jobs already submitted into the session are NOT cancelled — they drain.
    Somebody closing a session to stop the meter must not lose their last
    iteration.

    Args:
        session_id: The id from ``POST /session``.

    Returns:
        Confirmation.
    """
    return _guard(hardware.close_ibm_session, session_id)
