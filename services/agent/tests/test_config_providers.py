"""has_llm_key must recognize all four supported providers, Azure included.

Azure OpenAI is the newest of the four (wired in alongside the Founders Hub
milestone-3 infrastructure — see the internal Azure-credits notes) and is the only one
that needs two env vars, not one, to count as "configured": a key with no
endpoint base is not a usable provider.
"""

from __future__ import annotations

from agent.config import Settings


def test_no_keys_means_not_configured() -> None:
    assert Settings().has_llm_key is False


def test_gemini_key_alone_is_configured() -> None:
    assert Settings(gemini_api_key="k").has_llm_key is True


def test_groq_key_alone_is_configured() -> None:
    assert Settings(groq_api_key="k").has_llm_key is True


def test_anthropic_key_alone_is_configured() -> None:
    assert Settings(anthropic_api_key="k").has_llm_key is True


def test_azure_key_without_base_is_not_configured() -> None:
    assert Settings(azure_api_key="k").has_llm_key is False


def test_azure_base_without_key_is_not_configured() -> None:
    assert Settings(azure_api_base="https://x.openai.azure.com/").has_llm_key is False


def test_azure_key_and_base_together_are_configured() -> None:
    settings = Settings(azure_api_key="k", azure_api_base="https://x.openai.azure.com/")
    assert settings.has_llm_key is True


def test_llm_override_requires_model_and_key():
    """The web app's per-request override is accepted only when complete."""
    from agent.core import _clean_override

    assert _clean_override(None) is None
    assert _clean_override({"model": "gemini/gemini-2.5-flash"}) is None
    assert _clean_override({"api_key": "k"}) is None
    out = _clean_override(
        {"model": " groq/llama-3.3-70b-versatile ", "api_key": "k", "api_base": "", "api_version": None}
    )
    assert out == {"model": "groq/llama-3.3-70b-versatile", "api_key": "k"}
    az = _clean_override(
        {"model": "azure/dep", "api_key": "k", "api_base": "https://x.openai.azure.com", "api_version": "2024-10-21"}
    )
    assert az["api_base"] == "https://x.openai.azure.com" and az["api_version"] == "2024-10-21"


def test_chat_request_accepts_optional_llm_override():
    from agent.server import ChatRequest

    req = ChatRequest(message="hi", llm={"model": "gemini/gemini-2.5-flash", "api_key": "k"})
    assert req.llm is not None and req.llm.model == "gemini/gemini-2.5-flash"
    assert ChatRequest(message="hi").llm is None
