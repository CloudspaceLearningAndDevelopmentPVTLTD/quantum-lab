"""FastAPI application entrypoint for the Qubit16 API."""

from __future__ import annotations

import warnings
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.core.config import settings
from app.core.env_check import check_env
from app.core.security import SHARED_SECRET_HEADER, shared_secret_middleware
from app.routers import circuits, hardware, health, jobs

# Fail before the first request rather than during it. check_env() raises only
# on a misconfiguration that would otherwise fail silently (a '*' in
# ALLOWED_ORIGINS, an unknown DEFAULT_BACKEND); an empty environment is a valid
# configuration here and produces warnings at most. See app/core/env_check.py.
check_env()

app = FastAPI(
    title="Qubit16 API",
    version=__version__,
    description=(
        "Executes OpenQASM 3 circuits on simulators and, when configured, real "
        "quantum hardware. Returns measurement counts, probabilities and exact "
        "statevectors, plus a library of example circuits."
    ),
)

# ── CORS ────────────────────────────────────────────────────────────────────
#
# SECURITY FIX (audit finding CORS-1). Three changes, all for the same reason:
# `allow_credentials=True` means a browser will attach the visitor's cookies to
# a cross-origin call and hand the response body back to the calling page, so
# every wildcard here is a wildcard on WHO MAY READ THIS API AS SOMEBODY ELSE.
#
#   · the origin wildcard is refused in Settings.origins_list, which raises
#     rather than starting up permissive (see the note there);
#   · allow_methods and allow_headers are now the explicit sets this API
#     actually uses instead of ["*"];
#   · an unset ALLOWED_ORIGINS is treated as "local development", not as
#     "anything goes" — see the warning below.
#
# If the deployed web app gets CORS errors, that is this setting doing its job:
# set ALLOWED_ORIGINS to the app's real origin.
if settings.origins_list == ["http://localhost:3000"]:
    warnings.warn(
        "ALLOWED_ORIGINS is unset, so CORS allows only http://localhost:3000. "
        "A deployed web app on any other origin will be refused by the browser "
        "until ALLOWED_ORIGINS names it.",
        RuntimeWarning,
        stacklevel=1,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "Authorization", SHARED_SECRET_HEADER],
)

# OPT-IN authentication. Does nothing unless API_SHARED_SECRET is set; read the
# header of app/core/security.py before setting it. Registered AFTER the CORS
# middleware so that Starlette runs it INSIDE the CORS layer — a 401 from here
# still carries the right CORS headers instead of surfacing in the browser as an
# unexplained network error.
app.middleware("http")(shared_secret_middleware)

app.include_router(health.router)
app.include_router(circuits.router)
app.include_router(hardware.router)
app.include_router(jobs.router)


@app.get("/")
def index() -> dict[str, Any]:
    """Return a JSON index of the available endpoints.

    Returns:
        Service metadata and a map of endpoint paths.
    """
    return {
        "service": "Qubit16 API",
        "version": __version__,
        "docs": "/docs",
        "endpoints": {
            "health": "GET /api/health",
            "run": "POST /api/circuits/run",
            "statevector": "POST /api/circuits/statevector",
            "backends": "GET /api/circuits/backends",
            "presets": "GET /api/circuits/presets",
            "preset": "GET /api/circuits/presets/{preset_id}",
        },
    }


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
