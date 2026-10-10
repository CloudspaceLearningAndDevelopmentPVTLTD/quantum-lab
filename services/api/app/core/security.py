"""Optional shared-secret gate in front of the Qubit16 API.

# ############################################################
# #  THIS SERVICE IS UNAUTHENTICATED BY DESIGN               #
# #                                                          #
# #  Nothing here turns that around. `/api/circuits/run`     #
# #  executes user-supplied circuits and `/api/hardware/     #
# #  submit` spends real IBM/Braket credits, and both are    #
# #  reachable by anyone who can reach the port. The audit   #
# #  (docs/SECURITY.md, findings PY-3 and CORS-1) accepted   #
# #  that ONLY on the assumption that the port is private.   #
# #  Nothing in this repository enforces that assumption.    #
# ############################################################

What this module adds is the cheapest mechanism that lets an operator who
*cannot* keep the port private close it anyway, without changing a single
existing caller:

    API_SHARED_SECRET unset (the default)
        No check at all. Byte-identical behaviour to before this file existed:
        `docker compose up`, `uvicorn app.main:app` and the browser calls in
        apps/web/lib/hardware/client.ts all work untouched.

    API_SHARED_SECRET set
        Every request must carry `X-Quantum-Lab-Secret: <the same value>`.
        Anything else is 401 before the route runs.

    API_SHARED_SECRET set to a COMMA-SEPARATED LIST
        Any one of them authenticates. This exists for exactly one purpose —
        rotating the secret without an outage — and is explained under
        "Rotating without an outage" below.

WHO CAN ACTUALLY SEND THAT HEADER matters, and used to be the reason nothing
could be switched on. `lib/hardware/client.ts` called this API **from the
browser**, and a secret a browser holds is not a secret.

That is fixed. The web app now proxies every hardware call it makes through
Next route handlers under `apps/web/app/api/hardware/**`, which attach the
header server-side from `QUANTUM_API_SECRET` (or `API_SHARED_SECRET`). Turning
this gate on no longer breaks the hardware page. See docs/HARDWARE.md for the
proxy and "Exposing services/api safely" in docs/SECURITY.md for the two
supported deployments.

STILL BROKEN WHEN THIS IS ON, and not fixed anywhere:

* `POST /api/hardware/analyse`, `POST /api/jobs` and `GET /api/jobs/{id}` are
  reachable from `client.ts` but are NOT proxied — no page calls them, and
  publishing an endpoint the app does not use would widen the surface for
  nothing. They will 401. If you wire one into a page, add a route handler
  first.
* `services/agent` reaches this API through `QUANTUM_API_URL`
  (`agent/tools.py`, `run_quantum_circuit`) and does not send the header at
  all. It will get a 401, which that function's bare `except Exception` treats
  like any other API problem: it silently falls through to simulating locally.
  The tutor keeps working and nothing is logged, so the only visible symptom is
  that the API stops seeing agent traffic. Fixing it means threading the secret
  through `services/agent`, which was out of scope for the change that added
  the proxy.

ROTATING WITHOUT AN OUTAGE
-------------------------
The secret is held by two independently-deployed services: this one, and the
Next server (as `QUANTUM_API_SECRET`). With a single accepted value there is
no ordering of those two deployments that avoids a gap — whichever you update
first is, for the duration, presenting or expecting a value the other side
does not have, and every proxied hardware call 401s until the second catches
up. `infra/azure/deploy.sh` regenerated the secret on EVERY deploy and updated
the api before the web, so every deploy of this project — including one that
changed nothing but a paragraph of copy — took the hardware surface down for
several minutes. That was observed in production on 2026-09-17.

Accepting a list is what makes the gap avoidable:

    1. Set this service to `API_SHARED_SECRET=<old>,<new>`  → both work
    2. Set the Next server to `QUANTUM_API_SECRET=<new>`    → still fine
    3. Set this service to `API_SHARED_SECRET=<new>`        → old stops working

No step in that sequence has a moment where a correctly-configured caller is
refused. `deploy.sh` implements exactly it, and only when an operator asks for
a rotation — an ordinary deploy now reuses the existing secret and touches
none of this.

The list is an overlap window, NOT a permanent multi-key scheme. Step 3 is not
optional: leaving the old value accepted forever means a leaked secret is
never actually retired, which is the one thing rotation exists to accomplish.

Deliberately not built here: rate limiting, per-user quotas, JWT verification.
This is a door lock, not an identity system. It answers "is this caller the
Next server?" and nothing else.
"""

from __future__ import annotations

import hmac
from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.responses import Response

from app.core.config import settings

__all__ = [
    "SHARED_SECRET_HEADER",
    "EXEMPT_PATHS",
    "accepted_secrets",
    "shared_secret_middleware",
]

#: Header carrying the shared secret. A custom header, not `Authorization`, so
#: it cannot be confused with a Supabase user token: this proves *which
#: service* is calling, never *which person*.
SHARED_SECRET_HEADER = "X-Quantum-Lab-Secret"

#: Paths reachable without the secret even when one is configured.
#: `/api/health` only, and only because a container orchestrator's liveness
#: probe cannot be given a secret and a service that fails its probe is a
#: service that is down. It reports status, version and which backends are
#: available — no user data, and it spends nothing.
EXEMPT_PATHS: frozenset[str] = frozenset({"/api/health"})


def accepted_secrets() -> tuple[str, ...]:
    """Every secret value this service currently accepts.

    ``API_SHARED_SECRET`` is normally one value. During a rotation it is a
    comma-separated pair, and both are accepted so that the two services
    holding it can be updated one at a time — see "Rotating without an outage"
    in the module docstring.

    Blank entries are dropped rather than accepted. Without that, a trailing
    comma (``"secret,"``) or an unset variable that a shell expanded to an
    empty string would put ``""`` in the accepted set, and since a request
    with no header presents ``""`` too, the gate would authenticate every
    anonymous caller while looking configured. That is the single most
    dangerous way this function could be wrong, so it is the first thing
    tests/test_security.py checks.

    Returns:
        The accepted secrets, in configured order, with blanks removed.
        Empty when the gate is not configured at all.
    """
    raw = settings.api_shared_secret or ""
    return tuple(part for part in (piece.strip() for piece in raw.split(",")) if part)


async def shared_secret_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Require ``X-Quantum-Lab-Secret`` when ``API_SHARED_SECRET`` is set.

    Args:
        request: The incoming request.
        call_next: The rest of the middleware stack.

    Returns:
        The downstream response, or a 401 when the secret is configured and the
        request does not carry it.
    """
    secrets = accepted_secrets()

    # Not configured: this middleware does nothing whatsoever.
    if not secrets:
        return await call_next(request)

    # A CORS preflight never carries custom headers — the browser sends it to
    # ask whether it may. Rejecting it would break the preflight rather than the
    # request, producing a confusing browser error instead of a clean 401 on the
    # real call, which CORSMiddleware then answers on its own.
    if request.method == "OPTIONS":
        return await call_next(request)

    if request.url.path in EXEMPT_PATHS:
        return await call_next(request)

    presented = request.headers.get(SHARED_SECRET_HEADER, "")
    # Constant-time compare: a plain `==` leaks the length of the matching
    # prefix through timing, which is enough to recover a secret one byte at a
    # time given enough requests.
    #
    # EVERY candidate is compared, with no early exit on a match. Returning as
    # soon as one matched would make the response time depend on WHICH secret
    # the caller presented, so during a rotation a caller could learn whether
    # it holds the old value or the new one by timing alone. The accumulator
    # costs one extra comparison against a 64-character string and removes
    # that.
    matched = False
    for candidate in secrets:
        if hmac.compare_digest(presented, candidate):
            matched = True
    if not matched:
        return JSONResponse(
            status_code=401,
            content={
                "detail": (
                    "This API requires a shared secret. Send it as the "
                    f"{SHARED_SECRET_HEADER} header."
                )
            },
        )

    return await call_next(request)
