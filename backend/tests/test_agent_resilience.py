import asyncio
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main  # noqa: E402


class _UnavailableGmgn:
    def __init__(self, _settings):
        pass

    async def trending(self, **_kwargs):
        raise TimeoutError("upstream timed out")


class _BrokenGmgn:
    def __init__(self, _settings):
        raise RuntimeError("market client initialization failed")


async def _unavailable_llm(*_args, **_kwargs):
    raise TimeoutError("LLM timed out")


class _SlowGmgn:
    def __init__(self, _settings):
        pass

    async def trending(self, **_kwargs):
        await asyncio.sleep(0.05)
        return []


async def _successful_llm(*_args, **_kwargs):
    return {"ok": True, "content": "analysis"}


def test_agent_get_replay_executes_research(monkeypatch) -> None:
    """A paid GET replay with a body must execute research, not return probe metadata."""
    import app.services.gmgn as gmgn

    monkeypatch.setattr(gmgn, "GmgnClient", _SlowGmgn)
    monkeypatch.setattr(main, "freeform_chat", _successful_llm)

    response = TestClient(main.app).request(
        "GET",
        "/api/agent",
        json={"message": "Analyze current meme coin narratives", "lang": "en"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert response.json()["content"] == "analysis"
    assert TestClient(main.app).options("/api/agent").status_code == 200


def test_agent_get_probe_returns_free_service_metadata() -> None:
    response = TestClient(main.app).get("/api/agent")

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "method": "POST",
        "payment": "free",
    }


def test_agent_returns_json_fallback_when_upstreams_timeout(monkeypatch) -> None:
    """A paid A2MCP replay must receive JSON, not an unhandled 500/timeout."""
    import app.services.gmgn as gmgn

    monkeypatch.setattr(gmgn, "GmgnClient", _UnavailableGmgn)
    monkeypatch.setattr(main, "freeform_chat", _unavailable_llm)

    response = TestClient(main.app, raise_server_exceptions=False).post(
        "/api/agent",
        json={"message": "Analyze current meme coin narratives", "lang": "en"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["source"] == "agent_fallback"
    assert body["content"]


def test_agent_handles_market_client_initialization_failure(monkeypatch) -> None:
    import app.services.gmgn as gmgn

    monkeypatch.setattr(gmgn, "GmgnClient", _BrokenGmgn)
    monkeypatch.setattr(main, "freeform_chat", _successful_llm)

    response = TestClient(main.app, raise_server_exceptions=False).post(
        "/api/agent",
        json={"message": "Analyze current meme coin narratives", "lang": "en"},
    )

    assert response.status_code == 200
    assert response.json()["content"] == "analysis"
    assert response.json()["data_sources"]["gmgn"] is False


def test_agent_fetches_market_data_concurrently(monkeypatch) -> None:
    """Five chain lookups must not multiply marketplace response latency."""
    import app.services.gmgn as gmgn

    monkeypatch.setattr(gmgn, "GmgnClient", _SlowGmgn)
    monkeypatch.setattr(main, "freeform_chat", _successful_llm)

    started = time.monotonic()
    result = asyncio.run(
        main.agent_endpoint(
            main.ChatBody(message="Analyze current meme coin narratives", lang="en")
        )
    )

    assert time.monotonic() - started < 0.15
    assert result["ok"] is True
