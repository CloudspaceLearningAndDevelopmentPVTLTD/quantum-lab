"""qubit16 — run existing Qiskit code on IBM, IonQ and Rigetti through one key.

::

    from qubit16 import Qubit16Provider, SamplerV2

    service = Qubit16Provider(token="qb16_sk_…")   # or QUBIT16_TOKEN
    backend = service.backend("ibm_brisbane")      # or ionq_aria, rigetti_ankaa

    sampler = SamplerV2(mode=backend)
    job = sampler.run([circuit], shots=4096)
    counts = job.result()[0].data.meas.get_counts()

The adoption cost is meant to be the two lines where you build the service.
Everything below them — pubs, ``mode=``, the result containers — is Qiskit's
own API, and the containers are Qiskit's own classes.

Read ``README.md`` for what is faithful and what is not; the short version is
that one pub is one job and one unit of your monthly allowance, parameter
sweeps are refused rather than silently expanded, and this backend is not a
local transpilation target because the API does not serve coupling maps.
"""

from __future__ import annotations

from .backend import Qubit16Backend
from .client import DEFAULT_BASE_URL, Qubit16Client, resolve_base_url, resolve_token
from .exceptions import (
    AuthenticationError,
    ConnectionFailure,
    InvalidRequestError,
    JobFailedError,
    JobNotFoundError,
    JobTimeoutError,
    MissingCredentialsError,
    PlanLimitError,
    Qubit16Error,
    RateLimitError,
    ScopeError,
    ServerError,
    ServiceUnavailableError,
    UnpollableJobError,
)
from .job import Qubit16Job, Submission
from .primitives import Estimator, EstimatorV2, Options, Sampler, SamplerV2
from .provider import Qubit16Provider
from .session import Session

__version__ = "0.1.0"

__all__ = [
    "AuthenticationError",
    "ConnectionFailure",
    "DEFAULT_BASE_URL",
    "Estimator",
    "EstimatorV2",
    "InvalidRequestError",
    "JobFailedError",
    "JobNotFoundError",
    "JobTimeoutError",
    "MissingCredentialsError",
    "Options",
    "PlanLimitError",
    "Qubit16Backend",
    "Qubit16Client",
    "Qubit16Error",
    "Qubit16Job",
    "Qubit16Provider",
    "RateLimitError",
    "Sampler",
    "SamplerV2",
    "ScopeError",
    "ServerError",
    "ServiceUnavailableError",
    "Session",
    "Submission",
    "UnpollableJobError",
    "__version__",
    "resolve_base_url",
    "resolve_token",
]
