"""Submission and polling for real quantum hardware.

Real QPUs are shared, queued resources. A job you submit now may start in
thirty seconds or in six hours depending on the provider's queue, and a single
HTTP request cannot sit and wait for that: the client times out, the worker is
blocked, and a dropped connection loses the job handle. So every provider here
is modelled as **submit then poll**:

* ``submit_*_job`` transpiles, enqueues, and immediately returns a job id plus
  the queue position when the provider reports one. It never waits for results.
* ``poll_*_job`` looks up that id and returns a status, with counts attached
  only once the status is ``done``.

That split is also what makes the hardware path testable offline: submission and
polling are two small, independently mockable functions, and every vendor SDK is
imported lazily inside the function that needs it so the service still starts
with nothing but qiskit installed.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.quantum.calibration import braket_calibration, ibm_calibration, static_calibration
from app.quantum.credentials import BraketCredentials, IbmCredentials, ProviderCredentials
from app.quantum.transpile import transpile_for

# Provider ids used by the routes and the job records.
PROVIDER_IBM = "ibm"
PROVIDER_BRAKET = "braket"
PROVIDER_AZURE = "azure"

# Braket device ARNs for the hardware we expose. ARNs are stable identifiers
# published by AWS; the device may still be offline or unavailable in a region.
BRAKET_DEVICE_ARNS: dict[str, str] = {
    "ionq_aria": "arn:aws:braket:us-east-1::device/qpu/ionq/Aria-1",
    "ionq_forte": "arn:aws:braket:us-east-1::device/qpu/ionq/Forte-1",
    "rigetti_ankaa": "arn:aws:braket:us-west-1::device/qpu/rigetti/Ankaa-3",
}

# Static catalogue of real devices, used whenever we cannot ask the provider.
# Qubit counts and technologies are the vendors' published specifications.
KNOWN_DEVICES: list[dict[str, Any]] = [
    {
        "id": "ibm_brisbane",
        "name": "ibm_brisbane",
        "provider": "ibm",
        "qubits": 127,
        "technology": "superconducting",
        "note": "IBM Eagle r3 processor. Open-plan access is free but heavily queued.",
    },
    {
        "id": "ibm_kyiv",
        "name": "ibm_kyiv",
        "provider": "ibm",
        "qubits": 127,
        "technology": "superconducting",
        "note": "IBM Eagle r3 processor. Queue times of minutes to hours are normal.",
    },
    {
        "id": "ibm_sherbrooke",
        "name": "ibm_sherbrooke",
        "provider": "ibm",
        "qubits": 127,
        "technology": "superconducting",
        "note": "IBM Eagle r3 processor. Native basis is sx / rz / x / ecr.",
    },
    {
        "id": "ionq_aria",
        "name": "IonQ Aria-1",
        "provider": "ionq",
        "qubits": 25,
        "technology": "trapped-ion",
        "note": "All-to-all connectivity via Amazon Braket. Billed per shot plus a task fee.",
    },
    {
        "id": "ionq_forte",
        "name": "IonQ Forte-1",
        "provider": "ionq",
        "qubits": 36,
        "technology": "trapped-ion",
        "note": "IonQ's largest trapped-ion system on Braket. Paid device, availability windows apply.",
    },
    {
        "id": "rigetti_ankaa",
        "name": "Rigetti Ankaa-3",
        "provider": "rigetti",
        "qubits": 84,
        "technology": "superconducting",
        "note": "Square lattice via Amazon Braket. Fast gates, higher per-shot price than IonQ.",
    },
]

# Which backend ids route to which provider submission function.
#
# The azure_* entries were missing until August 2026, and their absence was not
# harmless: app/quantum/backends.py has advertised `azure_quantinuum_h1` and
# `azure_ionq_aria` in the device picker since Azure support was added, so a
# caller could select a backend that provider_for() then refused with "not a
# hardware backend". app/quantum/azure.py's submit/poll/list functions had ZERO
# callers — 485 lines reachable only through azure_available(), which
# backends.py used to decide whether to grey the entry out. The catalogue said
# yes and every other code path said no.
BACKEND_PROVIDER: dict[str, str] = {
    "ibm_quantum": PROVIDER_IBM,
    "ibm_brisbane": PROVIDER_IBM,
    "ibm_kyiv": PROVIDER_IBM,
    "ibm_sherbrooke": PROVIDER_IBM,
    "ionq_aria": PROVIDER_BRAKET,
    "ionq_forte": PROVIDER_BRAKET,
    "rigetti_ankaa": PROVIDER_BRAKET,
    "azure_quantinuum_h1": PROVIDER_AZURE,
    "azure_ionq_aria": PROVIDER_AZURE,
}

# Registry backend id -> the target name Azure Quantum itself uses. The registry
# ids are ours and stable; the target strings are Microsoft's and change when a
# provider retires hardware.
AZURE_BACKEND_TARGETS: dict[str, str] = {
    "azure_quantinuum_h1": "quantinuum.qpu.h1-1",
    "azure_ionq_aria": "ionq.qpu.aria-1",
}

#: Longest a runtime session may be opened for, in seconds.
#:
#: A session RESERVES the device and bills for the window whether or not jobs
#: are running, so an unbounded one that a caller forgets about is a bill with
#: no work attached. Eight hours is longer than any interactive session and
#: short enough that the worst case is bounded.
MAX_SESSION_SECONDS = 8 * 60 * 60

_IBM_PIP = "pip install qiskit-ibm-runtime"
_BRAKET_PIP = "pip install amazon-braket-sdk"


class MissingDependency(ValueError):
    """A vendor SDK or credential needed for this operation is not present.

    It subclasses :class:`ValueError` so existing callers that only guard
    against ``ValueError`` keep working, while routes that want to answer 503
    instead of 400 can check for this type specifically.
    """

    def __init__(self, message: str, remedy: str) -> None:
        """Record the human message and the exact remedy.

        Args:
            message: What went wrong, in full sentences.
            remedy: The literal command to run or env var to set.
        """
        super().__init__(message)
        self.remedy = remedy


def _now() -> str:
    """Return the current UTC time as an ISO 8601 string.

    Returns:
        A timezone-aware timestamp, e.g. ``"2026-08-16T09:30:00+00:00"``.
    """
    return datetime.now(timezone.utc).isoformat()


def _module_importable(name: str) -> bool:
    """Report whether a module can be located without importing it.

    Args:
        name: Top-level module name, e.g. ``"braket"``.

    Returns:
        True when the module is installed.
    """
    import importlib.util

    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, ModuleNotFoundError):
        return False


def _aws_credentials_present() -> bool:
    """Report whether AWS credentials appear to be configured.

    Returns:
        True when an access key is set through settings or the environment, or
        when a named profile / role session is configured.
    """
    return bool(
        settings.aws_access_key_id
        or os.environ.get("AWS_ACCESS_KEY_ID")
        or os.environ.get("AWS_PROFILE")
        or os.environ.get("AWS_ROLE_ARN")
    )


def provider_for(backend_id: str) -> str:
    """Map a hardware backend id onto its provider.

    Args:
        backend_id: A backend identifier from the registry.

    Returns:
        ``"ibm"`` or ``"braket"``.

    Raises:
        ValueError: When the backend is not a known hardware target.
    """
    provider = BACKEND_PROVIDER.get(backend_id)
    if provider is None:
        valid = ", ".join(sorted(BACKEND_PROVIDER))
        raise ValueError(
            f"'{backend_id}' is not a hardware backend. Hardware backends are: {valid}."
        )
    return provider


def is_hardware_available(backend_id: str) -> tuple[bool, str]:
    """Check whether a hardware backend could actually accept a job right now.

    Both halves are checked: the vendor SDK must be importable and the
    credential must be configured. No network call is made.

    Args:
        backend_id: A hardware backend id, e.g. ``"ibm_brisbane"``.

    Returns:
        ``(available, reason)``. ``reason`` names exactly what to install or
        set when unavailable, and is a short confirmation when available.
    """
    try:
        provider = provider_for(backend_id)
    except ValueError as exc:
        return False, str(exc)

    if provider == PROVIDER_AZURE:
        from app.quantum.azure import azure_available

        return azure_available()

    if provider == PROVIDER_IBM:
        sdk_ok = _module_importable("qiskit_ibm_runtime")
        token_ok = bool(settings.ibm_quantum_token)
        missing: list[str] = []
        if not sdk_ok:
            missing.append(f"the qiskit-ibm-runtime SDK ({_IBM_PIP})")
        if not token_ok:
            missing.append("an IBM Quantum API token (set IBM_QUANTUM_TOKEN)")
        if missing:
            return False, f"IBM hardware needs {' and '.join(missing)}."
        return True, "qiskit-ibm-runtime is installed and IBM_QUANTUM_TOKEN is set."

    sdk_ok = _module_importable("braket")
    creds_ok = _aws_credentials_present()
    missing = []
    if not sdk_ok:
        missing.append(f"the Amazon Braket SDK ({_BRAKET_PIP})")
    if not creds_ok:
        missing.append("AWS credentials (set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)")
    if missing:
        return False, f"Braket hardware needs {' and '.join(missing)}."
    return True, "amazon-braket-sdk is installed and AWS credentials are configured."


def _require_ibm(credentials: IbmCredentials | None = None) -> tuple[Any, Any]:
    """Import the IBM Runtime SDK and verify a token is available.

    Args:
        credentials: A credential presented on THIS request (BYOK). When given,
            it is the token that must be present and the operator's
            configuration is not consulted at all — a user who supplied their
            own token must not silently fall through to the operator's account
            because theirs was rejected.

    Returns:
        The ``(QiskitRuntimeService, SamplerV2)`` pair.

    Raises:
        MissingDependency: When the SDK is not installed or no token is
            available from either source.
    """
    try:
        from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
    except ImportError as exc:
        raise MissingDependency(
            "Submitting to IBM Quantum requires the qiskit-ibm-runtime SDK, which is "
            f"not installed. Install it with '{_IBM_PIP}'. (import error: {exc})",
            remedy=_IBM_PIP,
        ) from exc

    if credentials is not None:
        # A presented credential is validated at the edge (app/quantum/
        # credentials.py) and again here, because this function is the last
        # point before an empty token would be handed to the SDK and turned
        # into an opaque authentication error from IBM.
        if not credentials.token:
            raise MissingDependency(
                "The credential presented with this request carries no IBM API token.",
                remedy="re-enter your IBM Quantum token",
            )
        return QiskitRuntimeService, SamplerV2

    if not settings.ibm_quantum_token:
        raise MissingDependency(
            "Submitting to IBM Quantum requires an API token. Create one at "
            "https://quantum.ibm.com and set IBM_QUANTUM_TOKEN in the environment "
            "or in services/api/.env.",
            remedy="set IBM_QUANTUM_TOKEN",
        )

    return QiskitRuntimeService, SamplerV2


# One authenticated service per process, keyed by the configuration that
# produced it.
#
# Constructing QiskitRuntimeService is not free: it authenticates against IBM
# Cloud and, with no `instance` set, additionally enumerates every instance the
# token can see. The previous code built a fresh one inside submit, inside poll
# and inside the device listing — and JobMonitor polls a running job for its
# whole lifetime, which on a six-hour queue is hundreds of logins to read one
# status field. Caching also means a token that has been revoked fails at the
# first call rather than intermittently, which is easier to diagnose.
#
# The key includes every input, so changing a setting in a test (monkeypatching
# `settings.ibm_quantum_token`) builds a new service instead of handing back one
# authenticated with the old token.
_IBM_SERVICE_CACHE: dict[tuple[str | None, ...], Any] = {}

#: How many authenticated services to keep.
#:
#: BYOK made this cache's key space unbounded: it used to hold at most a
#: handful of entries because every one of them came from the operator's own
#: settings, and it now holds one per DISTINCT USER TOKEN presented. Without a
#: ceiling that is both a slow memory leak and a pile of live vendor
#: credentials retained in process memory for as long as the process lives.
#:
#: 32 is chosen to keep the thing the cache was built for — a JobMonitor
#: polling one job for hours without re-authenticating on every poll — working
#: for a realistic number of concurrent users, while bounding the worst case.
#: Eviction is oldest-inserted-first; the cost of evicting a still-active entry
#: is one extra login, not an error.
_IBM_SERVICE_CACHE_MAX = 32


def _ibm_service(credentials: IbmCredentials | None = None) -> Any:
    """Return a cached, instance-addressed ``QiskitRuntimeService``.

    Reuses one authenticated service per (channel, token, instance, region)
    tuple for the life of the process. ``instance`` and ``region`` are omitted
    from the call entirely when unset, so a single-instance account that only
    sets a token behaves exactly as it did before.

    THE CACHE KEY INCLUDES THE PRESENTED TOKEN, and that is load-bearing rather
    than incidental. With BYOK, two requests differing only in whose credential
    they carry must not share an authenticated service: handing a cached
    operator service to a user's submission would enqueue their job on the
    operator's account, and the reverse would enqueue somebody's job on a
    stranger's. Because the token is part of the key, that cannot happen by
    construction rather than by anyone remembering to check.

    Args:
        credentials: A credential presented on THIS request. When given it is
            used INSTEAD of ``settings`` — never merged with it, and never
            written back into it (see app/quantum/credentials.py for why a
            process-global write here would be the worst bug this feature can
            have).

    Returns:
        An authenticated ``QiskitRuntimeService``.

    Raises:
        MissingDependency: When the SDK or the token is missing.
        ValueError: When IBM refuses the credentials.
    """
    service_cls, _ = _require_ibm(credentials)

    channel = settings.ibm_quantum_channel or "ibm_quantum_platform"
    if credentials is not None:
        token = credentials.token
        instance = credentials.instance or None
        # NOT settings.ibm_quantum_region. That is the region of the
        # OPERATOR's instance; applying it to somebody else's account would
        # address a region their instance may not live in. Omitted, which
        # means the SDK resolves it from the account — the same thing an
        # operator who has not set the variable gets.
        region = None
    else:
        token = settings.ibm_quantum_token
        instance = settings.ibm_quantum_instance or None
        region = settings.ibm_quantum_region or None
    key = (channel, token, instance, region)

    cached = _IBM_SERVICE_CACHE.get(key)
    if cached is not None:
        return cached

    kwargs: dict[str, Any] = {"channel": channel, "token": token}
    # Passing instance=None is NOT the same as omitting it on every SDK
    # version, and an explicit None has been read as "no instance is
    # acceptable" rather than "choose for me". Omit rather than nullify.
    if instance:
        kwargs["instance"] = instance
    if region:
        kwargs["region"] = region

    try:
        service = service_cls(**kwargs)
    except Exception as exc:  # noqa: BLE001 - auth/network failures become 400s
        hint = ""
        if not instance:
            hint = (
                " If this account has more than one service instance, set "
                "IBM_QUANTUM_INSTANCE to the CRN of the one to use."
            )
        if credentials is not None:
            # Do not tell a BYOK user to set an environment variable they have
            # no access to. Their fix is their own token or their own CRN.
            hint = (
                " If your IBM account has more than one service instance, add its CRN"
                " beside the token in your account settings."
                if not instance
                else ""
            )
            raise ValueError(
                f"Could not authenticate with IBM Quantum using your saved token: {exc}.{hint}"
            ) from exc
        raise ValueError(f"Could not authenticate with IBM Quantum: {exc}.{hint}") from exc

    # Bound the cache BEFORE inserting, so it never exceeds the ceiling even
    # momentarily. Oldest-inserted first: `dict` preserves insertion order, and
    # a true LRU would need a touch on every read for a benefit (keeping the
    # hottest token) that is worth less here than the simplicity.
    while len(_IBM_SERVICE_CACHE) >= _IBM_SERVICE_CACHE_MAX:
        _IBM_SERVICE_CACHE.pop(next(iter(_IBM_SERVICE_CACHE)))

    _IBM_SERVICE_CACHE[key] = service
    return service


def _ibm_job_tags(owner: str | None) -> list[str]:
    """Build the tag list stamped onto an IBM job at submission.

    Tags are the only handle we get on IBM's side. They are what makes a job
    recognisable in IBM's own console as ours rather than an anonymous id, and
    ``service.jobs(job_tags=...)`` is how a job can be recovered when our own
    record of it is lost — see :func:`list_ibm_jobs`.

    Args:
        owner: An opaque per-account identifier, or None for an unattributed
            submission.

    Returns:
        The tags to attach. Always includes the platform marker.
    """
    tags = ["qubit16"]
    if owner:
        # IBM's tags are visible in the account's console, so this must not be
        # an email or anything else identifying; callers pass an opaque id.
        tags.append(f"owner:{owner}")
    return tags


def _braket_session(credentials: BraketCredentials) -> Any:
    """Build an explicit Braket ``AwsSession`` for one user's AWS credentials.

    ── WHY THIS IS NOT DONE THROUGH THE ENVIRONMENT ────────────────────────

    boto3 reads ``AWS_ACCESS_KEY_ID`` and friends from ``os.environ``, so the
    tempting implementation is to set them for the duration of the call. That
    works perfectly in a single-threaded test and corrupts under concurrency:
    ``os.environ`` is process-global, this service serves requests in a thread
    pool, and two simultaneous submissions would race to define whose AWS
    account pays. The loser's job is billed to the winner's account, silently.

    So the credential is threaded as an explicit ``boto3.Session`` all the way
    to the device object. Nothing here touches ambient configuration.

    ── No cache, deliberately ──────────────────────────────────────────────

    Unlike ``QiskitRuntimeService``, constructing a boto3 session performs no
    authentication and no network call — it is a local object holding keys, so
    there is nothing to amortise. Not caching also means there is no
    process-global structure holding user AWS credentials between requests.

    Args:
        credentials: The user's AWS credential for this request.

    Returns:
        A ``braket.aws.AwsSession`` bound to those credentials.

    Raises:
        MissingDependency: When boto3 or the Braket SDK is not installed.
        ValueError: When the session cannot be constructed.
    """
    try:
        import boto3
        from braket.aws import AwsSession
    except ImportError as exc:
        raise MissingDependency(
            "Submitting to Amazon Braket with your own AWS credentials requires the "
            f"Braket SDK and boto3. Install them with '{_BRAKET_PIP}'. (import error: {exc})",
            remedy=_BRAKET_PIP,
        ) from exc

    try:
        boto_session = boto3.Session(
            aws_access_key_id=credentials.access_key_id,
            aws_secret_access_key=credentials.secret_access_key,
            # None is correct for a permanent key pair; boto3 treats it as
            # absent rather than as an empty token.
            aws_session_token=credentials.session_token,
            region_name=credentials.region,
        )
        return AwsSession(boto_session=boto_session)
    except Exception as exc:  # noqa: BLE001 - config errors become 400s
        raise ValueError(
            f"Could not build an AWS session from your saved credentials: {exc}"
        ) from exc


def _require_braket(
    credentials: BraketCredentials | None = None,
) -> tuple[Any, str, str, Any]:
    """Import the Braket SDK and resolve credentials and the S3 result location.

    Args:
        credentials: The submitter's OWN AWS credential (BYOK), when they
            supplied one. When given, the returned bucket and prefix are
            THEIRS — ours is not writable by their keys — and the returned
            session is bound to their account. The operator's environment is
            not consulted at all.

    Returns:
        ``(AwsDevice, s3_bucket, s3_prefix, aws_session)``. ``aws_session`` is
        None on the operator path, which means "let boto3 resolve it from the
        environment" — exactly the behaviour that predates BYOK.

    Raises:
        MissingDependency: When the SDK, the credentials or the S3 result
            location are missing.
    """
    try:
        from braket.aws import AwsDevice
    except ImportError as exc:
        raise MissingDependency(
            "Submitting to Amazon Braket requires the Braket SDK, which is not "
            f"installed. Install it with '{_BRAKET_PIP}'. (import error: {exc})",
            remedy=_BRAKET_PIP,
        ) from exc

    if credentials is not None:
        # Every field was validated at the edge; the bucket is re-checked here
        # because it is the one whose absence Braket reports as an opaque
        # rejection minutes later rather than as a clear refusal now.
        if not credentials.s3_bucket:
            raise MissingDependency(
                "Braket writes every task result to S3, and with your own AWS credentials "
                "it has to be a bucket in your account. Add one to your saved Braket "
                "credential.",
                remedy="add an S3 bucket to your saved Braket credential",
            )
        return (
            AwsDevice,
            credentials.s3_bucket,
            credentials.s3_prefix or "quantum-lab",
            _braket_session(credentials),
        )

    if not _aws_credentials_present():
        raise MissingDependency(
            "Submitting to Amazon Braket requires AWS credentials. Set "
            "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (and AWS_DEFAULT_REGION), "
            "or configure AWS_PROFILE.",
            remedy="set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY",
        )

    bucket = os.environ.get("BRAKET_S3_BUCKET", "")
    if not bucket:
        raise MissingDependency(
            "Braket writes every task result to S3. Set BRAKET_S3_BUCKET to a bucket "
            "you own (and optionally BRAKET_S3_PREFIX, default 'quantum-lab').",
            remedy="set BRAKET_S3_BUCKET",
        )

    return AwsDevice, bucket, os.environ.get("BRAKET_S3_PREFIX", "quantum-lab"), None


def _validate_shots(shots: int) -> int:
    """Check a shot count against the configured maximum.

    Args:
        shots: Requested repetitions.

    Returns:
        The validated shot count.

    Raises:
        ValueError: When the value is out of range.
    """
    if not isinstance(shots, int) or isinstance(shots, bool):
        raise ValueError(f"shots must be an integer, got {shots!r}.")
    if shots < 1 or shots > settings.max_shots:
        raise ValueError(f"shots must be between 1 and {settings.max_shots}, got {shots}.")
    return shots


def submit_ibm_job(
    qasm: str,
    backend_name: str,
    shots: int = 1024,
    optimization_level: int = 1,
    owner: str | None = None,
    dynamical_decoupling: bool = False,
    measurement_twirling: bool = False,
    session_id: str | None = None,
    sweep: dict[str, Any] | None = None,
    credentials: IbmCredentials | None = None,
) -> dict[str, Any]:
    """Enqueue a circuit on IBM Quantum hardware and return immediately.

    Args:
        qasm: OpenQASM 3 (or 2) circuit source.
        backend_name: An IBM device name, e.g. ``"ibm_brisbane"``.
        shots: Number of repetitions.
        optimization_level: Qiskit preset pass-manager level, 0-3. This is the
            level the caller previewed through ``/api/hardware/transpile``;
            submitting at a different one is how a preview stops describing the
            circuit that actually ran.
        owner: Opaque account id, stamped onto the job as an IBM tag so the job
            is attributable in IBM's console and recoverable through
            :func:`list_ibm_jobs`.
        dynamical_decoupling: Insert an XY4 dynamical-decoupling sequence into
            idle qubit time. Free at the vendor — it changes the pulse schedule,
            not the shot count — and on superconducting hardware it measurably
            reduces decoherence on circuits with idle periods.
        measurement_twirling: Randomise a Pauli frame around each measurement
            and undo it classically. Also free — the same total shots are split
            across randomisations rather than added to — and it converts a
            *biased* readout error (a device that mistakes 1 for 0 more often
            than the reverse) into a symmetric one, which is the difference
            between a systematic shift in your histogram and extra variance.
        session_id: An open runtime session to run inside. Sampling usually
            does not need one, but a caller alternating sampler and estimator
            calls in a loop wants them in the same reserved window.
        sweep: A sweep specification (``{"points": [...]}`` or
            ``{"ranges": [...]}``) for a circuit carrying free parameters. When
            present the circuit is run at every point in ONE job — one queue
            position, one quota unit — instead of one submission per point.
        credentials: The submitter's OWN IBM credential (BYOK), when they
            supplied one. None means the operator's configured credentials —
            the behaviour every caller had before BYOK existed.

    Returns:
        ``{job_id, backend, status, submitted_at, provider, shots,
        queue_position, transpiled_depth, transpiled_two_qubit_gates,
        optimization_level, tags, estimated_qpu_seconds}``.

    Raises:
        MissingDependency: When qiskit-ibm-runtime or IBM_QUANTUM_TOKEN is missing.
        ValueError: On bad shots, unparseable QASM, or a submission failure.
    """
    _validate_shots(shots)
    _, sampler_cls = _require_ibm(credentials)
    optimization_level = _validate_optimization_level(optimization_level)
    service = _ibm_service(credentials)

    try:
        backend = service.backend(backend_name)
    except Exception as exc:  # noqa: BLE001 - network/auth errors become 400s
        raise ValueError(
            f"Could not reach IBM Quantum backend '{backend_name}': {exc}"
        ) from exc

    # Transpile against the device's real coupling map and basis, not our
    # generic one: IBM rejects circuits that are not ISA-compliant.
    from qiskit import transpile as qiskit_transpile

    from app.quantum.runner import _ensure_measured, parse_qasm

    # A sweep needs the parameters left FREE, so it goes through the
    # parameterised parser; parse_qasm would either refuse the source or bind
    # the angles to numbers, and a "sweep" over already-bound angles is one
    # point repeated.
    if sweep is not None:
        from app.quantum.parameters import parse_parameterised_qasm

        circuit = _ensure_measured(parse_parameterised_qasm(qasm)["circuit"])
    else:
        circuit = _ensure_measured(parse_qasm(qasm))

    try:
        isa_circuit = qiskit_transpile(
            circuit, backend=backend, optimization_level=optimization_level
        )
    except Exception as exc:  # noqa: BLE001
        raise ValueError(
            f"Could not transpile the circuit for '{backend_name}': {exc}"
        ) from exc

    # Built from the TRANSPILED circuit, never the source one. `binding_order`
    # exists for exactly this: QuantumCircuit.parameters is sorted
    # alphabetically, so a value array assembled in declaration order produces
    # a job that succeeds and a landscape belonging to a different pair of
    # angles, with nothing in the result revealing it.
    sweep_points: list[dict[str, float]] = []
    sweep_rows: list[list[float]] = []
    if sweep is not None:
        from app.quantum.parameters import binding_order, parse_sweep, sweep_values

        names = binding_order(isa_circuit)
        sweep_points = parse_sweep(sweep, names)
        sweep_rows = sweep_values(sweep_points, names)
        _validate_sweep_shots(len(sweep_points), shots)

    tags = _ibm_job_tags(owner)
    options: dict[str, Any] = {"environment": {"job_tags": tags}}
    # Both of these are ERROR SUPPRESSION, not error mitigation: they change
    # how the circuit is executed rather than post-processing the result, so
    # neither costs an extra shot and neither biases the estimate. They are
    # off by default only because a run should be reproducible by default —
    # a user comparing two runs must be the one who decides they differ.
    if dynamical_decoupling:
        options["dynamical_decoupling"] = {"enable": True, "sequence_type": "XY4"}
    if measurement_twirling:
        options["twirling"] = {"enable_measure": True}

    try:
        sampler = sampler_cls(mode=_execution_mode(service, backend, session_id), options=options)
        # Fire and forget on purpose. Real jobs take minutes to hours in the
        # queue, so we never call job.result() here — the caller polls
        # poll_ibm_job() with the returned id.
        # A swept pub is (circuit, values); an unswept one is just the
        # circuit. Passing an empty value array for the unswept case is not
        # equivalent — it is a pub with zero points.
        pub = (isa_circuit, sweep_rows) if sweep_rows else isa_circuit
        job = sampler.run([pub], shots=shots)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"IBM Quantum rejected the job: {exc}") from exc

    return {
        "job_id": str(job.job_id()),
        "backend": backend_name,
        "status": _normalise_ibm_status(_safe_status(job)),
        "submitted_at": _now(),
        "provider": PROVIDER_IBM,
        "shots": shots,
        "queue_position": _ibm_queue_position(job),
        # What actually went to the device, so the record is of the circuit
        # that ran rather than of the one that was written.
        "transpiled_depth": int(isa_circuit.depth()),
        "transpiled_two_qubit_gates": _two_qubit_count(isa_circuit),
        "optimization_level": optimization_level,
        "tags": tags,
        "estimated_qpu_seconds": _ibm_usage_estimate(job),
        # Echoed back so the stored record says what was actually asked for.
        # Two runs of the same circuit with different suppression are different
        # experiments and the history has to be able to tell them apart.
        "dynamical_decoupling": dynamical_decoupling,
        "measurement_twirling": measurement_twirling,
        "primitive": "sampler",
        "session_id": session_id,
        # Echoed so the poll can read the result back per point. Without the
        # count, `result[0].data.<creg>.get_counts()` MERGES every point into
        # one histogram with no error — a plausible, wrong answer.
        "sweep_points": len(sweep_points) or None,
        "sweep_parameters": sorted(sweep_points[0]) if sweep_points else None,
        "total_shots": shots * len(sweep_points) if sweep_points else shots,
    }


def _validate_sweep_shots(points: int, shots: int) -> None:
    """Refuse a sweep whose total shot count is unreasonable.

    ``parse_sweep`` bounds the number of POINTS and ``_validate_shots`` bounds
    the shots per point, but neither sees the product — and the product is what
    the device actually runs and what the vendor actually charges for. 256
    points at 20,000 shots is 5.1 million shots in one job, which on a paid
    device is a four-figure bill from a request that passed both individual
    checks.

    Args:
        points: Number of sweep points.
        shots: Shots per point.

    Raises:
        ValueError: When the product exceeds the module's ceiling.
    """
    from app.quantum.parameters import MAX_SWEEP_TOTAL_SHOTS

    total = points * shots
    if total > MAX_SWEEP_TOTAL_SHOTS:
        raise ValueError(
            f"This sweep would run {total:,} shots in total ({points:,} points x {shots:,} "
            f"shots), above the {MAX_SWEEP_TOTAL_SHOTS:,} ceiling. Reduce the shots per point "
            "or the number of points."
        )


def _validate_optimization_level(level: int) -> int:
    """Check a Qiskit preset pass-manager level.

    Args:
        level: The requested level.

    Returns:
        The validated level.

    Raises:
        ValueError: When the value is outside Qiskit's 0-3.
    """
    if not isinstance(level, int) or isinstance(level, bool):
        raise ValueError(f"optimization_level must be an integer, got {level!r}.")
    if level < 0 or level > 3:
        raise ValueError(f"optimization_level must be between 0 and 3, got {level}.")
    return level


def _two_qubit_count(circuit: Any) -> int:
    """Count two-qubit operations in a transpiled circuit.

    Two-qubit gate count is the single best predictor of how much of the
    result survives the noise, which is why it is reported next to depth
    rather than left for the caller to derive.

    Args:
        circuit: A Qiskit ``QuantumCircuit``.

    Returns:
        The number of operations acting on exactly two qubits, or 0 when the
        circuit cannot be inspected.
    """
    try:
        return sum(1 for instruction in circuit.data if len(instruction.qubits) == 2)
    except Exception:  # noqa: BLE001
        return 0


def _ibm_usage_estimate(job: Any) -> float | None:
    """Read IBM's own estimate of the QPU seconds this job will consume.

    This is the unit IBM bills and rations in, so it is worth surfacing: a
    caller who sees "0.4s" before a six-hour queue learns more about the cost
    of the run than any shot count tells them.

    Args:
        job: A ``RuntimeJobV2`` handle.

    Returns:
        Estimated QPU seconds, or None when the SDK does not report it.
    """
    try:
        estimation = job.usage_estimation
        if callable(estimation):
            estimation = estimation()
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(estimation, dict):
        return None
    raw = estimation.get("quantum_seconds")
    try:
        return float(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _safe_status(job: Any) -> str:
    """Read a job's status without letting SDK errors escape.

    Args:
        job: A provider job handle.

    Returns:
        The raw status string, or ``"unknown"`` when it cannot be read.
    """
    try:
        status = job.status()
    except Exception:  # noqa: BLE001
        return "unknown"
    return str(getattr(status, "name", status))


def _ibm_queue_position(job: Any) -> int | None:
    """Read the queue position from an IBM job when the SDK exposes one.

    Args:
        job: A ``RuntimeJobV2`` handle.

    Returns:
        The position, or None when unknown (recent SDKs no longer report it).
    """
    getter = getattr(job, "queue_position", None)
    if getter is None:
        return None
    try:
        position = getter()
    except Exception:  # noqa: BLE001
        return None
    return int(position) if isinstance(position, int) else None


def _normalise_ibm_status(raw: str) -> str:
    """Map an IBM status string onto the API's status vocabulary.

    Args:
        raw: The SDK's status name, e.g. ``"QUEUED"`` or ``"DONE"``.

    Returns:
        One of ``queued``, ``running``, ``done``, ``error``, ``cancelled``.
    """
    value = raw.strip().upper()
    if value in ("DONE", "COMPLETED"):
        return "done"
    if value in ("RUNNING", "VALIDATING"):
        return "running"
    if value in ("CANCELLED", "CANCELED"):
        return "cancelled"
    if value in ("ERROR", "FAILED"):
        return "error"
    return "queued"


def _counts_from_ibm_result(result: Any) -> dict[str, int]:
    """Extract bitstring counts from a SamplerV2 result.

    Args:
        result: The object returned by ``job.result()``.

    Returns:
        Counts keyed by bitstring; empty when the shape is unrecognised.
    """
    try:
        pub_result = result[0]
        data = pub_result.data
        for field in dir(data):
            if field.startswith("_"):
                continue
            candidate = getattr(data, field)
            get_counts = getattr(candidate, "get_counts", None)
            if callable(get_counts):
                return {str(k).replace(" ", ""): int(v) for k, v in get_counts().items()}
    except Exception:  # noqa: BLE001
        return {}
    return {}


def poll_ibm_job(
    job_id: str,
    sweep_points: int | None = None,
    credentials: IbmCredentials | None = None,
) -> dict[str, Any]:
    """Look up the current state of an IBM Quantum job.

    Args:
        job_id: The id returned by :func:`submit_ibm_job`.
        sweep_points: How many points the job swept, from the submission
            record. REQUIRED for a swept job: without it the result is read as
            a single histogram and every point's shots are MERGED into one,
            with no error anywhere — a plausible distribution that is the
            average of the sweep rather than any point in it.
        credentials: The submitter's OWN IBM credential (BYOK), when they
            supplied one. None means the operator's configured credentials —
            the behaviour every caller had before BYOK existed.

    Returns:
        ``{job_id, provider, status}`` plus ``counts`` when done (or
        ``counts_per_point`` for a sweep), ``error``
        when the job failed, and ``queue_position`` / ``qpu_seconds`` /
        ``backend`` / ``created_at`` whenever the SDK reports them.

    Raises:
        MissingDependency: When qiskit-ibm-runtime or IBM_QUANTUM_TOKEN is missing.
        ValueError: When the job cannot be retrieved.
    """
    service = _ibm_service(credentials)

    try:
        job = service.job(job_id)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Could not retrieve IBM job '{job_id}': {exc}") from exc

    status = _normalise_ibm_status(_safe_status(job))
    payload: dict[str, Any] = {"job_id": job_id, "provider": PROVIDER_IBM, "status": status}

    # Every field below is best-effort and omitted rather than guessed: a
    # missing queue position must not read as position 0, and an unreported
    # QPU time must not read as a free job.
    backend_name = _ibm_backend_name(job)
    if backend_name:
        payload["backend"] = backend_name
    created = _ibm_created_at(job)
    if created:
        payload["created_at"] = created

    if status in ("queued", "running"):
        position = _ibm_queue_position(job)
        if position is not None:
            payload["queue_position"] = position

    if status == "done":
        try:
            result = job.result()
            if sweep_points and sweep_points > 1:
                payload["counts_per_point"] = _counts_per_point_from_ibm(result, sweep_points)
                payload["sweep_points"] = sweep_points
            else:
                payload["counts"] = _counts_from_ibm_result(result)
        except Exception as exc:  # noqa: BLE001
            payload["status"] = "error"
            payload["error"] = f"The job finished but its result could not be read: {exc}"
        # Read AFTER the result: IBM only settles usage once the job completes.
        seconds = _ibm_usage_seconds(job)
        if seconds is not None:
            payload["qpu_seconds"] = seconds
    elif status == "error":
        payload["error"] = str(getattr(job, "error_message", lambda: "IBM reported an error")())

    return payload


def _counts_per_point_from_ibm(result: Any, num_points: int) -> list[dict[str, int]]:
    """Split a swept SamplerV2 result into one histogram per point.

    The un-swept reader calls ``get_counts()`` on the classical register, which
    for a swept job returns every point's shots merged into a single histogram
    — no exception, just the average of the sweep presented as a measurement.
    :func:`app.quantum.parameters.per_point_counts` is the reader that keeps
    them apart.

    Args:
        result: The object returned by ``job.result()``.
        num_points: How many points were submitted.

    Returns:
        One histogram per point, in submission order. Empty when the result
        shape is unrecognised — never a merged histogram, because a wrong
        answer here is indistinguishable from a right one.

    Raises:
        ValueError: When the data field cannot be located at all.
    """
    from app.quantum.parameters import per_point_counts

    pub_result = result[0]
    data = pub_result.data
    for field in dir(data):
        if field.startswith("_"):
            continue
        candidate = getattr(data, field)
        if callable(getattr(candidate, "get_counts", None)):
            return per_point_counts(candidate, num_points)
    raise ValueError("The swept result carried no classical register to read counts from.")


def _ibm_backend_name(job: Any) -> str | None:
    """Read the device a job actually ran on.

    Worth reading back rather than trusting the submission record: IBM can
    move a job when the named device is retired mid-queue, and the honest
    answer to "where did this run" is the one the job reports.

    Args:
        job: A ``RuntimeJobV2`` handle.

    Returns:
        The backend name, or None when it cannot be read.
    """
    try:
        backend = job.backend()
    except Exception:  # noqa: BLE001
        return None
    name = getattr(backend, "name", backend)
    text = str(name).strip()
    return text or None


def _ibm_created_at(job: Any) -> str | None:
    """Read a job's creation timestamp as an ISO 8601 string.

    Args:
        job: A ``RuntimeJobV2`` handle.

    Returns:
        The timestamp, or None when unavailable.
    """
    try:
        created = job.creation_date
        if callable(created):
            created = created()
    except Exception:  # noqa: BLE001
        return None
    if created is None:
        return None
    isoformat = getattr(created, "isoformat", None)
    return isoformat() if callable(isoformat) else str(created)


def _ibm_usage_seconds(job: Any) -> float | None:
    """Read the QPU seconds a finished job consumed.

    This is what IBM meters. Reporting it is the difference between a user who
    can see their allowance draining and one who finds out from an invoice.

    Args:
        job: A ``RuntimeJobV2`` handle.

    Returns:
        Seconds of QPU time, or None when the SDK does not report it.
    """
    try:
        usage = job.usage()
    except Exception:  # noqa: BLE001
        return None
    if isinstance(usage, (int, float)):
        return float(usage)
    if isinstance(usage, dict):
        for field in ("quantum_seconds", "seconds", "usage"):
            raw = usage.get(field)
            if raw is not None:
                try:
                    return float(raw)
                except (TypeError, ValueError):
                    continue
    return None


# ── Estimator: expectation values rather than histograms ────────────────────


def _require_ibm_estimator() -> Any:
    """Import ``EstimatorV2``, with the same failure shape as ``_require_ibm``.

    Returns:
        The ``EstimatorV2`` class.

    Raises:
        MissingDependency: When qiskit-ibm-runtime is not installed.
    """
    try:
        from qiskit_ibm_runtime import EstimatorV2
    except ImportError as exc:
        raise MissingDependency(
            "Running an Estimator job requires the qiskit-ibm-runtime SDK, which is not "
            f"installed. Install it with '{_IBM_PIP}'. (import error: {exc})",
            remedy=_IBM_PIP,
        ) from exc
    return EstimatorV2


def _validate_resilience_level(level: int) -> int:
    """Check an IBM resilience level.

    0 is no mitigation, 1 adds readout error mitigation (TREX), 2 adds
    zero-noise extrapolation. Levels above 2 exist in IBM's documentation but
    are not generally available, and accepting one here would produce a vendor
    rejection after the quota has already been spent.

    Args:
        level: The requested level.

    Returns:
        The validated level.

    Raises:
        ValueError: When the value is outside 0-2.
    """
    if not isinstance(level, int) or isinstance(level, bool):
        raise ValueError(f"resilience_level must be an integer, got {level!r}.")
    if level < 0 or level > 2:
        raise ValueError(
            f"resilience_level must be 0 (none), 1 (readout mitigation) or 2 "
            f"(readout mitigation + zero-noise extrapolation), got {level}."
        )
    return level


def _execution_mode(service: Any, backend: Any, session_id: str | None) -> Any:
    """Resolve what a primitive should run against: a session, or the backend.

    A bare backend means every job queues independently. A session means IBM
    reserves the device for this account for a window and runs the session's
    jobs back to back — which for a variational loop is the difference between
    a 200-iteration optimisation taking an hour and taking days, because each
    iteration would otherwise re-enter a shared queue from the back.

    An unusable session id is a HARD FAILURE rather than a silent fall back to
    the bare backend. Falling back would "work" — the job runs — while quietly
    throwing away the reserved window the caller opened and is being charged
    for, and the only symptom would be that their optimisation is mysteriously
    slow.

    Args:
        service: The authenticated runtime service.
        backend: The resolved backend.
        session_id: An open session's id, or None.

    Returns:
        A ``Session`` when one was asked for, else the backend.

    Raises:
        ValueError: When the session id cannot be attached to.
    """
    if not session_id:
        return backend

    from qiskit_ibm_runtime import Session

    try:
        return Session.from_id(session_id, service)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(
            f"Could not join runtime session '{session_id}': {exc}. A session expires after its "
            "maximum time and cannot be rejoined once closed; open a new one."
        ) from exc


def open_ibm_session(backend_name: str, max_time_seconds: int = 3600) -> dict[str, Any]:
    """Open an IBM Runtime session and return its id.

    A session is a reservation: IBM holds the device for this account and runs
    the session's jobs consecutively instead of returning each to the shared
    queue. It is what makes an iterative workload — VQE, QAOA, any
    optimiser-in-the-loop — practical on real hardware.

    IT COSTS MONEY WHILE IT IS OPEN, whether or not jobs are running, which is
    why ``max_time_seconds`` is required rather than unbounded: an abandoned
    session with no cap bills for its whole maximum window. Callers should
    close it explicitly with :func:`close_ibm_session`.

    Args:
        backend_name: The device to reserve.
        max_time_seconds: Hard ceiling on the session's life.

    Returns:
        ``{session_id, backend, max_time_seconds, opened_at}``.

    Raises:
        MissingDependency: When the SDK or the token is missing.
        ValueError: When the backend or the session cannot be opened.
    """
    if not isinstance(max_time_seconds, int) or isinstance(max_time_seconds, bool):
        raise ValueError(f"max_time_seconds must be an integer, got {max_time_seconds!r}.")
    if max_time_seconds < 60 or max_time_seconds > MAX_SESSION_SECONDS:
        raise ValueError(
            f"max_time_seconds must be between 60 and {MAX_SESSION_SECONDS}, "
            f"got {max_time_seconds}."
        )

    _require_ibm()
    service = _ibm_service()

    from qiskit_ibm_runtime import Session

    try:
        backend = service.backend(backend_name)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Could not reach IBM Quantum backend '{backend_name}': {exc}") from exc

    try:
        session = Session(backend=backend, max_time=max_time_seconds)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"IBM Quantum refused to open a session on '{backend_name}': {exc}") from exc

    return {
        "session_id": str(session.session_id),
        "backend": backend_name,
        "max_time_seconds": max_time_seconds,
        "opened_at": _now(),
        "provider": PROVIDER_IBM,
    }


def close_ibm_session(session_id: str) -> dict[str, Any]:
    """Close an open session so it stops holding the device.

    Closing does NOT cancel jobs already submitted into the session; it stops
    the session accepting new ones and releases the reservation once the
    queued work drains. That distinction matters: a caller closing a session
    to stop the meter must not find their last iteration cancelled.

    Args:
        session_id: The id from :func:`open_ibm_session`.

    Returns:
        ``{session_id, closed}``.

    Raises:
        MissingDependency: When the SDK or the token is missing.
        ValueError: When the session cannot be reached.
    """
    _require_ibm()
    service = _ibm_service()

    from qiskit_ibm_runtime import Session

    try:
        session = Session.from_id(session_id, service)
        session.close()
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Could not close runtime session '{session_id}': {exc}") from exc

    return {"session_id": session_id, "closed": True, "closed_at": _now()}


def submit_ibm_estimator_job(
    qasm: str,
    backend_name: str,
    observables: list[dict[str, Any]],
    shots: int = 4096,
    optimization_level: int = 1,
    owner: str | None = None,
    resilience_level: int = 1,
    dynamical_decoupling: bool = False,
    session_id: str | None = None,
    sweep: dict[str, Any] | None = None,
    credentials: IbmCredentials | None = None,
) -> dict[str, Any]:
    """Enqueue an expectation-value job on IBM hardware and return immediately.

    The counterpart to :func:`submit_ibm_job`, which samples. This one measures
    ⟨ψ|H|ψ⟩ for each observable, which is what every variational algorithm
    actually needs and what this service could not do at all before.

    Args:
        qasm: OpenQASM 3 (or 2) circuit source. Measurements are NOT added —
            see below.
        backend_name: An IBM device name.
        observables: Parsed observables from
            ``app.quantum.observables.parse_observables``.
        shots: Repetitions used to estimate each expectation value.
        optimization_level: Qiskit preset pass-manager level, 0-3.
        owner: Opaque account id, stamped as a vendor job tag.
        resilience_level: 0 none, 1 readout mitigation, 2 + zero-noise
            extrapolation. Defaults to 1 because readout mitigation is close to
            free and an unmitigated expectation value on current hardware is
            biased in a way that is easy to mistake for physics.
        dynamical_decoupling: Idle-time XY4 decoupling.
        session_id: An open session to run inside.
        sweep: A sweep specification for a circuit carrying free parameters.
            Every observable is evaluated at every point in one job — which is
            exactly the shape a VQE or QAOA energy landscape needs.

        credentials: The submitter's OWN IBM credential (BYOK), when they
            supplied one. None means the operator's configured credentials —
            the behaviour every caller had before BYOK existed.

    Returns:
        The submission record, with ``primitive: 'estimator'`` and the
        observable labels echoed back so a poll can pair values to names.

    Raises:
        MissingDependency: When the SDK or the token is missing.
        ValueError: On bad input or a submission failure.
    """
    _validate_shots(shots)
    optimization_level = _validate_optimization_level(optimization_level)
    resilience_level = _validate_resilience_level(resilience_level)

    _require_ibm()
    estimator_cls = _require_ibm_estimator()
    service = _ibm_service(credentials)

    try:
        backend = service.backend(backend_name)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Could not reach IBM Quantum backend '{backend_name}': {exc}") from exc

    from qiskit import transpile as qiskit_transpile

    from app.quantum.observables import observables_for_circuit
    from app.quantum.runner import parse_qasm

    # NOT `_ensure_measured`. The Sampler path appends measurements because a
    # histogram of nothing is nothing; the Estimator is the opposite — it needs
    # the un-measured state, and a terminal measurement collapses it before the
    # observable is ever applied. A circuit that arrives WITH measurements is
    # refused rather than silently stripped, because stripping would change the
    # caller's circuit and hand back a number for something they did not run.
    if sweep is not None:
        from app.quantum.parameters import parse_parameterised_qasm

        circuit = parse_parameterised_qasm(qasm)["circuit"]
    else:
        circuit = parse_qasm(qasm)
    if _has_measurements(circuit):
        raise ValueError(
            "An Estimator circuit must not contain measurements: the observable is measured "
            "for you, and a terminal measurement collapses the state before that happens. "
            "Remove the measure instructions, or use the sampler primitive if you want a "
            "bitstring histogram."
        )

    try:
        isa_circuit = qiskit_transpile(
            circuit, backend=backend, optimization_level=optimization_level
        )
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Could not transpile the circuit for '{backend_name}': {exc}") from exc

    # Layout-corrected. See app/quantum/observables.py — an un-mapped
    # observable measures the wrong physical qubits and returns a plausible
    # number for a question nobody asked.
    operators = observables_for_circuit(observables, isa_circuit)

    sweep_points: list[dict[str, float]] = []
    sweep_rows: list[list[float]] = []
    if sweep is not None:
        from app.quantum.parameters import binding_order, parse_sweep, sweep_values

        names = binding_order(isa_circuit)
        sweep_points = parse_sweep(sweep, names)
        sweep_rows = sweep_values(sweep_points, names)
        _validate_sweep_shots(len(sweep_points), shots)

    tags = _ibm_job_tags(owner)
    options: dict[str, Any] = {
        "environment": {"job_tags": tags},
        "resilience_level": resilience_level,
        "default_shots": shots,
    }
    if dynamical_decoupling:
        options["dynamical_decoupling"] = {"enable": True, "sequence_type": "XY4"}

    mode = _execution_mode(service, backend, session_id)

    try:
        estimator = estimator_cls(mode=mode, options=options)
        # ONE pub carrying an ARRAY of observables, not one pub each: the
        # Estimator can then group commuting terms across all of them and
        # spend less QPU time. app/quantum/observables.py::expectation_values
        # reads the result in the shape this produces.
        if sweep_rows:
            # A COLUMN of observables against a ROW of points, so the pub
            # broadcasts to the full outer product (N observables x P points).
            # Submitting both flat is the trap `estimator_pub_arrays` exists
            # for: Qiskit raises when N != P, and when they happen to be EQUAL
            # it broadcasts element-wise and silently returns the diagonal —
            # P numbers that look like a sweep and are observable i at point i.
            from app.quantum.parameters import estimator_pub_arrays

            column, row = estimator_pub_arrays(operators, sweep_rows)
            job = estimator.run([(isa_circuit, column, row)])
        else:
            job = estimator.run([(isa_circuit, operators)])
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"IBM Quantum rejected the Estimator job: {exc}") from exc

    return {
        "job_id": str(job.job_id()),
        "backend": backend_name,
        "status": _normalise_ibm_status(_safe_status(job)),
        "submitted_at": _now(),
        "provider": PROVIDER_IBM,
        "shots": shots,
        "queue_position": _ibm_queue_position(job),
        "primitive": "estimator",
        # Echoed so a poll can pair values back to names without re-reading the
        # submission, and so the stored record says what was measured.
        "observable_labels": [o["label"] for o in observables],
        "sweep_points": len(sweep_points) or None,
        "sweep_parameters": sorted(sweep_points[0]) if sweep_points else None,
        "sweep_point_values": [
            [point[name] for name in sorted(point)] for point in sweep_points
        ]
        or None,
        "total_shots": shots * len(sweep_points) if sweep_points else shots,
        "resilience_level": resilience_level,
        "optimization_level": optimization_level,
        "transpiled_depth": int(isa_circuit.depth()),
        "transpiled_two_qubit_gates": _two_qubit_count(isa_circuit),
        "session_id": session_id,
        "tags": tags,
        "estimated_qpu_seconds": _ibm_usage_estimate(job),
    }


def _has_measurements(circuit: Any) -> bool:
    """Report whether a circuit contains any measure instruction.

    Args:
        circuit: A Qiskit ``QuantumCircuit``.

    Returns:
        True when at least one measurement is present.
    """
    try:
        return any(
            getattr(instruction.operation, "name", "") == "measure" for instruction in circuit.data
        )
    except Exception:  # noqa: BLE001
        return False


def poll_ibm_estimator_job(
    job_id: str,
    labels: list[str] | None = None,
    sweep_points: int | None = None,
    credentials: IbmCredentials | None = None,
) -> dict[str, Any]:
    """Look up an Estimator job and return its expectation values when done.

    Args:
        job_id: The id returned by :func:`submit_ibm_estimator_job`.
        labels: The observable labels, in submission order. When omitted the
            values come back labelled positionally — the caller's own record is
            the only place the names live, since IBM does not store them.

        credentials: The submitter's OWN IBM credential (BYOK), when they
            supplied one. None means the operator's configured credentials —
            the behaviour every caller had before BYOK existed.

    Returns:
        ``{job_id, provider, status, primitive}`` plus ``expectation_values``
        when done and ``error`` when the job failed.

    Raises:
        MissingDependency: When the SDK or the token is missing.
        ValueError: When the job cannot be retrieved.
    """
    service = _ibm_service(credentials)

    try:
        job = service.job(job_id)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Could not retrieve IBM job '{job_id}': {exc}") from exc

    status = _normalise_ibm_status(_safe_status(job))
    payload: dict[str, Any] = {
        "job_id": job_id,
        "provider": PROVIDER_IBM,
        "status": status,
        "primitive": "estimator",
    }

    backend_name = _ibm_backend_name(job)
    if backend_name:
        payload["backend"] = backend_name
    created = _ibm_created_at(job)
    if created:
        payload["created_at"] = created

    if status in ("queued", "running"):
        position = _ibm_queue_position(job)
        if position is not None:
            payload["queue_position"] = position

    if status == "done":
        from app.quantum.observables import expectation_values, swept_expectation_values

        named = [{"label": label} for label in (labels or [])]
        try:
            result = job.result()
            if not named:
                # No labels recorded. Positional names are honest about that
                # rather than inventing a meaning for each number.
                count = len(_as_values(result))
                named = [{"label": f"obs{i}"} for i in range(count)]
            if sweep_points and sweep_points > 1:
                # evs is (n_observables, n_points) here, not 1-D. The flat
                # reader would take the first row and report it as every
                # observable's single value.
                payload["expectation_values"] = swept_expectation_values(
                    result, named, sweep_points
                )
                payload["sweep_points"] = sweep_points
            else:
                payload["expectation_values"] = expectation_values(result, named)
        except Exception as exc:  # noqa: BLE001
            payload["status"] = "error"
            payload["error"] = f"The job finished but its result could not be read: {exc}"
        seconds = _ibm_usage_seconds(job)
        if seconds is not None:
            payload["qpu_seconds"] = seconds
    elif status == "error":
        payload["error"] = str(getattr(job, "error_message", lambda: "IBM reported an error")())

    return payload


def _as_values(result: Any) -> list[Any]:
    """How many expectation values a result carries, for unlabelled polls.

    Args:
        result: An Estimator result.

    Returns:
        The values as a list, or an empty list when unreadable.
    """
    try:
        evs = result[0].data.evs
        tolist = getattr(evs, "tolist", None)
        listed = tolist() if callable(tolist) else evs
        return list(listed) if isinstance(listed, (list, tuple)) else [listed]
    except Exception:  # noqa: BLE001
        return []


def submit_braket_job(
    qasm: str,
    backend_name: str,
    shots: int = 1024,
    optimization_level: int = 1,
    credentials: BraketCredentials | None = None,
) -> dict[str, Any]:
    """Enqueue a circuit on an Amazon Braket QPU and return immediately.

    Args:
        qasm: OpenQASM 3 (or 2) circuit source.
        backend_name: A backend id from :data:`BRAKET_DEVICE_ARNS`, or a full
            device ARN.
        shots: Number of repetitions.
        optimization_level: Qiskit preset pass-manager level, 0-3, matching the
            level the caller previewed through ``/api/hardware/transpile``.
        credentials: The submitter's OWN AWS credential (BYOK), when they
            supplied one. The task is then created in THEIR account, billed to
            them, and written to THEIR S3 bucket. None means the operator's
            credentials — the behaviour every caller had before BYOK.

    Returns:
        ``{job_id, backend, status, submitted_at, provider, shots,
        queue_position}``; ``job_id`` is the Braket quantum task ARN.

    Raises:
        MissingDependency: When the Braket SDK, AWS credentials or
            BRAKET_S3_BUCKET are missing.
        ValueError: On bad shots, unparseable QASM, or a submission failure.
    """
    _validate_shots(shots)
    optimization_level = _validate_optimization_level(optimization_level)
    device_cls, bucket, prefix, aws_session = _require_braket(credentials)

    arn = BRAKET_DEVICE_ARNS.get(backend_name, backend_name)
    if not arn.startswith("arn:aws:braket"):
        valid = ", ".join(sorted(BRAKET_DEVICE_ARNS))
        raise ValueError(
            f"'{backend_name}' is not a Braket device. Use a device ARN or one of: {valid}."
        )

    prepared = transpile_for(qasm, backend_name, optimization_level=optimization_level)

    try:
        from braket.ir.openqasm import Program

        # The session is passed EXPLICITLY rather than left to boto3's ambient
        # resolution, so a BYOK task is created in the submitter's account even
        # while another request is in flight for somebody else. `aws_session` is
        # None on the operator path, which is exactly the default lookup this
        # call used before BYOK.
        device = device_cls(arn, aws_session=aws_session) if aws_session else device_cls(arn)
        # Asynchronous by design: run() returns a task handle straight away.
        # QPU queues are measured in minutes to hours, so we never call
        # task.result(), which would block until the device finishes.
        task = device.run(
            Program(source=prepared["qasm"]),
            s3_destination_folder=(bucket, prefix),
            shots=shots,
        )
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Amazon Braket rejected the task on '{arn}': {exc}") from exc

    return {
        "job_id": str(task.id),
        "backend": backend_name,
        "status": _normalise_braket_status(_safe_status(task)),
        "submitted_at": _now(),
        "provider": PROVIDER_BRAKET,
        "shots": shots,
        "queue_position": _braket_queue_position(task),
        "transpiled_depth": int(prepared.get("depth_after", 0) or 0),
        "transpiled_two_qubit_gates": int(prepared.get("two_qubit_gates_after", 0) or 0),
        "optimization_level": optimization_level,
    }


def _braket_queue_position(task: Any) -> int | None:
    """Read the queue position from a Braket quantum task when available.

    Args:
        task: An ``AwsQuantumTask`` handle.

    Returns:
        The integer position, or None when Braket reports it as unavailable.
    """
    getter = getattr(task, "queue_position", None)
    if getter is None:
        return None
    try:
        info = getter()
    except Exception:  # noqa: BLE001
        return None
    raw = getattr(info, "queue_position", info)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _normalise_braket_status(raw: str) -> str:
    """Map a Braket task state onto the API's status vocabulary.

    Args:
        raw: A Braket state such as ``"QUEUED"`` or ``"COMPLETED"``.

    Returns:
        One of ``queued``, ``running``, ``done``, ``error``, ``cancelled``.
    """
    value = raw.strip().upper()
    if value == "COMPLETED":
        return "done"
    if value == "RUNNING":
        return "running"
    if value in ("CANCELLED", "CANCELLING", "CANCELED"):
        return "cancelled"
    if value == "FAILED":
        return "error"
    return "queued"


def poll_braket_job(
    job_id: str, credentials: BraketCredentials | None = None
) -> dict[str, Any]:
    """Look up the current state of an Amazon Braket quantum task.

    Args:
        job_id: The quantum task ARN returned by :func:`submit_braket_job`.
        credentials: The credential the task was SUBMITTED with, when that was
            the user's own. A task created in one AWS account is not visible to
            another, and its results live in that account's S3 bucket, so
            polling with the wrong credential reads as "could not retrieve".

    Returns:
        ``{job_id, provider, status}`` plus ``counts`` when done and ``error``
        when the task failed.

    Raises:
        MissingDependency: When the Braket SDK or AWS credentials are missing.
        ValueError: When the task cannot be retrieved.
    """
    try:
        from braket.aws import AwsQuantumTask
    except ImportError as exc:
        raise MissingDependency(
            "Polling an Amazon Braket task requires the Braket SDK, which is not "
            f"installed. Install it with '{_BRAKET_PIP}'. (import error: {exc})",
            remedy=_BRAKET_PIP,
        ) from exc

    aws_session = None
    if credentials is not None:
        aws_session = _braket_session(credentials)
    elif not _aws_credentials_present():
        raise MissingDependency(
            "Polling an Amazon Braket task requires AWS credentials. Set "
            "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
            remedy="set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY",
        )

    try:
        task = (
            AwsQuantumTask(arn=job_id, aws_session=aws_session)
            if aws_session
            else AwsQuantumTask(arn=job_id)
        )
        status = _normalise_braket_status(_safe_status(task))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Could not retrieve Braket task '{job_id}': {exc}") from exc

    payload: dict[str, Any] = {"job_id": job_id, "provider": PROVIDER_BRAKET, "status": status}

    if status == "done":
        try:
            result = task.result()
            payload["counts"] = {
                str(k).replace(" ", ""): int(v) for k, v in result.measurement_counts.items()
            }
        except Exception as exc:  # noqa: BLE001
            payload["status"] = "error"
            payload["error"] = f"The task completed but its result could not be read: {exc}"
    elif status == "error":
        payload["error"] = str(getattr(task, "metadata", lambda: {})().get("failureReason", "")) or (
            "Braket reported the task as FAILED."
        )

    return payload


def _catalogue_entry(device: dict[str, Any], reason: str) -> dict[str, Any]:
    """Build an unavailable catalogue row for a known device.

    Args:
        device: An entry from :data:`KNOWN_DEVICES`.
        reason: Why the device cannot be used right now.

    Returns:
        A device dictionary with ``source='catalogue'`` and ``available=False``.
    """
    entry = dict(device)
    entry.update({"available": False, "source": "catalogue", "reason": reason})
    # Catalogue rows never carry live numbers, so the calibration summary is
    # the typical-values table, labelled 'static' (or 'unavailable' when the
    # device is not in the table) — never 'live'.
    entry["calibration"] = static_calibration(str(device.get("id", "")))
    return entry


def _live_ibm_devices() -> list[dict[str, Any]]:
    """Query IBM for the devices this account can actually use.

    Returns:
        Live device rows with ``source='live'``.

    Raises:
        Exception: Any SDK or network error, handled by the caller.
    """
    service = _ibm_service()
    devices: list[dict[str, Any]] = []
    for backend in service.backends(simulator=False, operational=True):
        name = str(backend.name)
        pending = None
        try:
            pending = int(backend.status().pending_jobs)
        except Exception:  # noqa: BLE001
            pending = None
        devices.append(
            {
                "id": name,
                "name": name,
                "provider": "ibm",
                "qubits": int(getattr(backend, "num_qubits", 0) or 0),
                "technology": "superconducting",
                "note": (
                    f"Live IBM device; {pending} job(s) pending."
                    if pending is not None
                    else "Live IBM device."
                ),
                "available": True,
                "source": "live",
                "reason": None,
                "pending_jobs": pending,
                # ibm_calibration returns None when the target holds no usable
                # figures; the row then degrades to the typical-values table
                # rather than wearing a 'live' label it did not earn.
                "calibration": ibm_calibration(backend, queue_depth=pending)
                or static_calibration(name),
            }
        )
    return devices


def _live_braket_devices() -> list[dict[str, Any]]:
    """Query AWS Braket for the QPUs visible to this account.

    Returns:
        Live device rows with ``source='live'``.

    Raises:
        Exception: Any SDK or network error, handled by the caller.
    """
    from braket.aws import AwsDevice
    from braket.device_schema import DeviceActionType  # noqa: F401  (import check)

    devices: list[dict[str, Any]] = []
    # Live rows are keyed by ARN, but the typical-values fallback table is
    # keyed by our stable ids — map back so the fallback still lands.
    arn_to_id = {arn: dev_id for dev_id, arn in BRAKET_DEVICE_ARNS.items()}
    for device in AwsDevice.get_devices(types=["QPU"]):
        provider = str(getattr(device, "provider_name", "")).lower() or "unknown"
        technology = "trapped-ion" if "ionq" in provider else "superconducting"
        qubits = 0
        try:
            qubits = int(device.properties.paradigm.qubitCount)
        except Exception:  # noqa: BLE001
            qubits = 0
        status = str(getattr(device, "status", "")).upper()
        devices.append(
            {
                "id": str(device.arn),
                "name": str(device.name),
                "provider": provider,
                "qubits": qubits,
                "technology": technology,
                "note": f"Live Braket device, status {status or 'UNKNOWN'}. Paid per shot.",
                "available": status == "ONLINE",
                "source": "live",
                "reason": None if status == "ONLINE" else f"Device status is {status}.",
                # None from braket_calibration means the vendor schema held no
                # usable figures; serve the typical-values table instead of a
                # hollow 'live' summary.
                "calibration": braket_calibration(device)
                or static_calibration(arn_to_id.get(str(device.arn), str(device.arn))),
            }
        )
    return devices


def list_hardware_devices() -> list[dict[str, Any]]:
    """List every hardware device, live when possible and catalogued otherwise.

    Each provider is tried independently: an IBM token with no AWS credentials
    yields live IBM rows next to catalogued IonQ and Rigetti rows. Every row
    carries ``provider``, ``qubits``, ``technology``, ``available``, ``reason``
    and ``source`` (``'live'`` or ``'catalogue'``) so a caller can always tell
    whether it is looking at reality or at the shipped specification sheet.

    Returns:
        The device list; never raises, since an unreachable provider simply
        degrades to its catalogue entries.
    """
    devices: list[dict[str, Any]] = []

    ibm_known = [d for d in KNOWN_DEVICES if d["provider"] == "ibm"]
    ibm_ok, ibm_reason = is_hardware_available("ibm_brisbane")
    if ibm_ok:
        try:
            devices.extend(_live_ibm_devices())
        except Exception as exc:  # noqa: BLE001
            devices.extend(
                _catalogue_entry(d, f"Could not reach IBM Quantum: {exc}") for d in ibm_known
            )
    else:
        devices.extend(_catalogue_entry(d, ibm_reason) for d in ibm_known)

    braket_known = [d for d in KNOWN_DEVICES if d["provider"] in ("ionq", "rigetti")]
    braket_ok, braket_reason = is_hardware_available("ionq_aria")
    if braket_ok:
        try:
            devices.extend(_live_braket_devices())
        except Exception as exc:  # noqa: BLE001
            devices.extend(
                _catalogue_entry(d, f"Could not reach Amazon Braket: {exc}") for d in braket_known
            )
    else:
        devices.extend(_catalogue_entry(d, braket_reason) for d in braket_known)

    # Azure targets used to be absent from this list entirely, while
    # list_backends() advertised two of them. list_azure_targets() already
    # returns rows in the same shape and degrades to its own catalogue, so this
    # is one line rather than a fourth copy of the try/except above.
    from app.quantum.azure import list_azure_targets

    # Azure rows arrive keyed by MICROSOFT'S target string
    # ("quantinuum.qpu.h1-1"), and every route downstream — provider_for,
    # estimate_cost, transpile_for, submit_job — is keyed by OUR registry id
    # ("azure_quantinuum_h1"). Publishing the vendor's spelling here is the
    # same defect §3b of docs/HARDWARE.md describes, surviving in the one
    # direction that was not fixed: selecting a Quantinuum card from the picker
    # produced "'quantinuum.qpu.h1-1' is not a hardware backend" for a device
    # the service had just offered.
    #
    # Translate on the way out, so the catalogue speaks the same language as
    # the routes. `name` keeps the vendor's own wording, and `vendor_target`
    # carries the vendor string for anyone who needs to find the job in
    # Microsoft's portal.
    target_to_id = {target: backend_id for backend_id, target in AZURE_BACKEND_TARGETS.items()}
    azure_rows = list_azure_targets()
    for row in azure_rows:
        vendor_target = str(row.get("id", ""))
        registry_id = target_to_id.get(vendor_target)
        if registry_id:
            row["id"] = registry_id
            row["vendor_target"] = vendor_target
        else:
            # A target the workspace offers that this service has never wired
            # up — today the two simulators. Listing it is useful (it tells an
            # operator what their workspace holds); letting it be SELECTED is
            # not, because nothing downstream can dispatch it. So it is shown
            # and refused with the reason, rather than shown and then failing
            # at submission with a message about an unknown backend.
            row["available"] = False
            row["vendor_target"] = vendor_target
            row["reason"] = (
                f"'{vendor_target}' is visible in your Azure workspace but is not wired "
                "into this service. Add it to AZURE_BACKEND_TARGETS and the backend "
                "registry to make it selectable."
            )
        # Azure's SDK does not expose calibration cheaply, so its rows are
        # labelled from the typical-values table even when the workspace is
        # live — 'static' means typical, and typical is all we honestly have.
        row.setdefault("calibration", static_calibration(str(row.get("id", ""))))
    devices.extend(azure_rows)

    return devices


def _credentials_for(provider: str, credentials: ProviderCredentials | None) -> Any:
    """Return the credential when it belongs to this provider, else refuse.

    WHY A MISMATCH IS AN ERROR AND NOT A SHRUG
    ------------------------------------------

    The web layer resolves a credential by looking up the provider it derived
    from the backend id, so a mismatch here means those two derivations
    disagree. Ignoring the credential and running on the operator's account
    would be the quiet option, and it is the wrong one: the submitter arranged
    to pay for this themselves and would have no way to discover that they had
    not. Refusing costs them an error message; ignoring costs us a bill and
    them a surprise.

    Args:
        provider: The provider this job is actually going to.
        credentials: Whatever was presented, or None.

    Returns:
        The credential when it matches, or None when nothing was presented.

    Raises:
        ValueError: When a credential for a different provider was presented.
    """
    if credentials is None:
        return None
    if getattr(credentials, "provider", None) != provider:
        raise ValueError(
            f"A credential for '{getattr(credentials, 'provider', 'unknown')}' was presented "
            f"for a '{provider}' device. Nothing was submitted."
        )
    return credentials


def submit_job(
    qasm: str,
    backend_name: str,
    shots: int,
    provider: str,
    optimization_level: int = 1,
    owner: str | None = None,
    dynamical_decoupling: bool = False,
    measurement_twirling: bool = False,
    observables: list[dict[str, Any]] | None = None,
    resilience_level: int = 1,
    session_id: str | None = None,
    sweep: dict[str, Any] | None = None,
    credentials: ProviderCredentials | None = None,
) -> dict[str, Any]:
    """Dispatch a submission to the right provider and primitive.

    Args:
        qasm: OpenQASM 3 (or 2) circuit source.
        backend_name: The device id or name for that provider.
        shots: Number of repetitions.
        provider: ``"ibm"``, ``"braket"`` or ``"azure"``.
        optimization_level: Qiskit preset pass-manager level, 0-3. Defaults to
            1, which is what this function used unconditionally before the
            parameter existed, so an omitting caller is unaffected.
        owner: Opaque account id attached to the vendor job where the vendor
            supports tagging (IBM only today).
        dynamical_decoupling: Request idle-time decoupling where the vendor
            supports it (IBM only today). Ignored elsewhere rather than
            refused, so a caller need not branch on provider to ask for it.
        measurement_twirling: Request readout twirling where the vendor
            supports it (IBM only today). Ignored elsewhere, same reasoning.
        observables: When present, run the ESTIMATOR rather than the sampler
            and return expectation values instead of a histogram. Parsed by
            ``app.quantum.observables.parse_observables``. IBM only.
        resilience_level: Estimator error mitigation, 0-2. Ignored by the
            sampler, which has no equivalent.
        session_id: An open IBM runtime session to run inside, so an iterative
            workload does not re-enter the shared queue every iteration.
        sweep: A sweep over a circuit's free parameters. One job, one queue
            position, one quota unit, every point. IBM only.
        credentials: The submitter's OWN vendor credential (BYOK), when they
            supplied one — an IBM token, an AWS key pair for Braket, or an
            Azure service principal. It must belong to the provider this job is
            going to; a mismatch is refused rather than ignored. None means the
            operator's credentials, which is what every caller did before BYOK.

    Returns:
        The provider's submission record.

    Raises:
        ValueError: When the provider is unknown, or a BYOK submission asks for
            something this service cannot do on a user's own credential.
        MissingDependency: When the provider's SDK or credentials are missing.
    """
    credentials = _credentials_for(provider, credentials)

    if provider == PROVIDER_IBM:
        if credentials is not None and session_id:
            # A runtime session is OPENED on the operator's credentials
            # (open_ibm_session does not take a credential — sessions reserve
            # and bill a device for their whole window, and handing that
            # control to a per-request credential is a separate decision with
            # its own cost model). A job submitted on a DIFFERENT account's
            # token cannot join it: IBM would either refuse the session id or,
            # worse, silently run the job outside the reserved window while the
            # caller believes they are inside it. Refuse, and say which half to
            # drop.
            raise ValueError(
                "A runtime session cannot be shared with a job submitted on your own IBM "
                "credential, because the session was opened on this platform's account. "
                "Submit without a session, or remove your saved credential to run inside one."
            )
        if observables:
            # The Estimator path. Not an option on Braket or Azure: neither
            # vendor exposes an expectation-value primitive through the SDKs
            # this service uses, and computing one client-side from a
            # histogram would silently discard the error mitigation that is
            # the entire reason to use an Estimator on hardware.
            return submit_ibm_estimator_job(
                qasm,
                backend_name,
                observables,
                shots=shots,
                optimization_level=optimization_level,
                owner=owner,
                resilience_level=resilience_level,
                dynamical_decoupling=dynamical_decoupling,
                session_id=session_id,
                sweep=sweep,
                credentials=credentials,
            )
        return submit_ibm_job(
            qasm,
            backend_name,
            shots,
            optimization_level=optimization_level,
            owner=owner,
            dynamical_decoupling=dynamical_decoupling,
            measurement_twirling=measurement_twirling,
            session_id=session_id,
            sweep=sweep,
            credentials=credentials,
        )
    if observables:
        raise ValueError(
            f"Expectation values are only available on IBM devices; '{backend_name}' is a "
            f"{provider} device. Submit without observables to sample a histogram, or pick an "
            "IBM backend."
        )
    if session_id:
        raise ValueError(
            f"Runtime sessions are an IBM feature; '{backend_name}' is a {provider} device."
        )
    if sweep:
        raise ValueError(
            f"Parameter sweeps run through IBM's V2 primitives; '{backend_name}' is a "
            f"{provider} device. Submit one point at a time, or pick an IBM backend."
        )
    if provider == PROVIDER_BRAKET:
        return submit_braket_job(
            qasm,
            backend_name,
            shots,
            optimization_level=optimization_level,
            credentials=credentials,
        )
    if provider == PROVIDER_AZURE:
        # Imported here rather than at module scope: app.quantum.azure imports
        # MissingDependency from this module, so a top-level import is a cycle.
        from app.quantum.azure import submit_azure_job

        return submit_azure_job(
            qasm,
            AZURE_BACKEND_TARGETS.get(backend_name, backend_name),
            shots,
            credentials=credentials,
        )
    raise ValueError(f"Unknown provider '{provider}'. Use 'ibm', 'braket' or 'azure'.")


def poll_job(
    provider: str,
    job_id: str,
    observable_labels: list[str] | None = None,
    sweep_points: int | None = None,
    credentials: ProviderCredentials | None = None,
) -> dict[str, Any]:
    """Dispatch a status lookup to the right provider.

    Args:
        provider: ``"ibm"``, ``"braket"`` or ``"azure"``.
        job_id: The provider's job id or task ARN.
        observable_labels: When present, poll the job as an ESTIMATOR job and
            label its expectation values with these. The labels are the
            caller's own record — IBM stores the observables but not our names
            for them — so passing them is what turns an array of floats back
            into ⟨Z0⟩, ⟨Z1⟩, ⟨Z0Z1⟩.
        sweep_points: How many points the job swept, from the submission
            record. REQUIRED for a swept job: without it a sampler result is
            read as one merged histogram and an estimator result is read at the
            wrong rank, both silently.
        credentials: The credential the job was SUBMITTED with, when that was
            the user's own. This matters on every provider, not just IBM: a job
            is invisible outside the account that created it, an IBM poll with
            the wrong token answers "no such job", a Braket task ARN cannot be
            read from another AWS account, and an Azure job lives in exactly
            one workspace. The web layer therefore keys this on the stored
            usage row rather than on whatever the caller has attached now.

    Returns:
        The provider's status record.

    Raises:
        ValueError: When the provider is unknown.
        MissingDependency: When the provider's SDK or credentials are missing.
    """
    credentials = _credentials_for(provider, credentials)

    if provider == PROVIDER_IBM:
        if observable_labels is not None:
            return poll_ibm_estimator_job(
                job_id, observable_labels, sweep_points, credentials=credentials
            )
        return poll_ibm_job(job_id, sweep_points, credentials=credentials)
    if provider == PROVIDER_BRAKET:
        return poll_braket_job(job_id, credentials=credentials)
    if provider == PROVIDER_AZURE:
        from app.quantum.azure import poll_azure_job

        return poll_azure_job(job_id, credentials=credentials)
    raise ValueError(f"Unknown provider '{provider}'. Use 'ibm', 'braket' or 'azure'.")
