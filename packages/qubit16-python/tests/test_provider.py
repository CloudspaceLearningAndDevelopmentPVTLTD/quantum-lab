"""Token resolution and device listing.

The failures these catch are the ones that make the package unusable before a
single circuit is written: a token silently taken from the wrong place, a
device row that does not become a usable backend, and a Target that pretends to
describe hardware it has never seen.
"""

from __future__ import annotations

import pytest

from qubit16 import Qubit16Provider
from qubit16.client import Qubit16Client, resolve_token
from qubit16.exceptions import MissingCredentialsError, Qubit16Error

from conftest import ARIA, BRISBANE, FakeHTTP


def test_explicit_token_beats_the_environment() -> None:
    """Catches a stale QUBIT16_TOKEN silently overriding an explicit argument.

    That is the bug that makes somebody's script run against the wrong account
    with no visible cause, so the precedence is asserted rather than assumed.
    """
    assert resolve_token("qb16_sk_argument", env={"QUBIT16_TOKEN": "qb16_sk_env"}) == (
        "qb16_sk_argument"
    )


def test_token_comes_from_qubit16_token_when_no_argument() -> None:
    """Catches the documented environment variable not actually being read."""
    assert resolve_token(None, env={"QUBIT16_TOKEN": "qb16_sk_env"}) == "qb16_sk_env"


def test_token_falls_back_to_the_names_the_docs_use() -> None:
    """Catches a key under QUBIT16_KEY being ignored.

    docs/API.md writes its curl examples with $QUBIT16_KEY, so a reader who
    exported that name and then used this package would otherwise get a
    'no token' error while looking straight at their token.
    """
    assert resolve_token(None, env={"QUBIT16_KEY": "qb16_sk_docs"}) == "qb16_sk_docs"
    assert resolve_token(None, env={"QUBIT16_API_KEY": "qb16_sk_habit"}) == "qb16_sk_habit"


def test_whitespace_only_token_is_not_a_token() -> None:
    """Catches `export QUBIT16_TOKEN=` producing a Bearer header of nothing."""
    assert resolve_token(None, env={"QUBIT16_TOKEN": "   "}) is None


def test_missing_token_fails_at_construction_not_at_submission() -> None:
    """Catches the diagnosis arriving at the wrong line.

    A missing token is a configuration mistake; discovering it as a 401 from
    inside a polling loop points the reader at the API rather than at the two
    lines they need to change.
    """
    with pytest.raises(MissingCredentialsError) as caught:
        Qubit16Provider(env={})
    assert "QUBIT16_TOKEN" in str(caught.value)


def test_anonymous_provider_is_allowed_for_the_public_catalogue(http: FakeHTTP) -> None:
    """Catches the catalogue being unreachable without a key.

    Devices, estimates and transpilation are public; refusing to construct a
    provider without a token would make browsing impossible for exactly the
    people deciding whether to sign up.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE])
    client = Qubit16Client(None, "https://example.test", http=http, env={})
    anonymous = Qubit16Provider(client=client, allow_anonymous=True)

    assert [b.name for b in anonymous.backends()] == ["ibm_brisbane"]
    assert "authorization" not in http.calls[-1].headers


def test_non_qubit16_token_warns_rather_than_refusing(http: FakeHTTP) -> None:
    """Catches an IBM token pasted here failing later as an opaque 401."""
    client = Qubit16Client("ibm_token_pasted_here", "https://example.test", http=http, env={})
    with pytest.warns(UserWarning, match="qb16_sk_"):
        Qubit16Provider(client=client)


def test_backend_carries_the_row_s_name_and_width(provider: Qubit16Provider, http: FakeHTTP) -> None:
    """Catches num_qubits being invented rather than read from the device row."""
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE, ARIA], times=None)

    backend = provider.backend("ibm_brisbane")
    assert backend.name == "ibm_brisbane"
    assert backend.num_qubits == 127
    assert backend.provider_name == "ibm"
    assert backend.pending_jobs == 12


def test_target_is_width_only_and_says_so(provider: Qubit16Provider, http: FakeHTTP) -> None:
    """Catches a fabricated coupling map appearing in the Target.

    A Target with invented instructions would let transpile() route onto edges
    that do not exist, and the resulting failure would look like a hardware
    problem rather than a client one. The Target must stay empty and must say
    why in its description.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE], times=None)
    target = provider.backend("ibm_brisbane").target

    assert target.num_qubits == 127
    assert len(target.operations) == 0
    assert "transpiled server-side" in (target.description or "")


def test_unknown_backend_lists_what_is_available(provider: Qubit16Provider, http: FakeHTTP) -> None:
    """Catches a bare 'not found' for a name from another platform.

    'ibmq_qasm_simulator' and 'Aria 1' are the names people actually type; the
    error has to show the ones that work.
    """
    http.route("GET", "/api/hardware/devices", 200, [BRISBANE, ARIA], times=None)

    with pytest.raises(Qubit16Error) as caught:
        provider.backend("ibmq_qasm_simulator")
    assert "ibm_brisbane" in str(caught.value)


def test_least_busy_refuses_rather_than_guessing(provider: Qubit16Provider, http: FakeHTTP) -> None:
    """Catches 'least busy' being answered when no queue depth was reported.

    None is not zero. Picking the first device with an unknown queue would be a
    coin flip presented as a recommendation.
    """
    http.route("GET", "/api/hardware/devices", 200, [ARIA], times=None)

    with pytest.raises(Qubit16Error, match="queue depth"):
        provider.least_busy()
