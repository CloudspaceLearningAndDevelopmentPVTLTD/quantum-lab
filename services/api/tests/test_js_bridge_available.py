"""Fail CI, rather than skip, when the JS-vs-Qiskit cross-checks cannot run.

The cross-check suites skip themselves when Node or esbuild is missing, which
is right on a laptop without ``npm install`` and wrong in CI. The API job ran
without Node for months, so every comparison of ``apps/web/lib/quantum.ts``
against Qiskit was skipped and CI stayed green while a controlled custom-matrix
export computed the wrong state. This file has no skip marker on purpose.
"""

from __future__ import annotations

import os

import pytest

from tests.test_js_random_crosscheck import _UNAVAILABLE


def test_the_js_bridge_is_available_in_ci() -> None:
    if os.environ.get("CI") and _UNAVAILABLE is not None:
        pytest.fail(f"JS cross-check cannot run in CI: {_UNAVAILABLE}")
