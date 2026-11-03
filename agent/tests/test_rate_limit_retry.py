from __future__ import annotations

import asyncio
import functools
import json
from types import SimpleNamespace

import httpx
import pytest
from langchain_core.messages import HumanMessage

import models
from models import orchestrator_chat_model, subagent_chat_model

BASE_URL = "http://mistral.test/v1"


def _sse(*chunks: dict) -> bytes:
    lines = [f"data: {json.dumps(c)}\n\n" for c in chunks] + ["data: [DONE]\n\n"]
    return "".join(lines).encode()


def _chunk(content: str, finish: str | None = None) -> dict:
    return {
        "id": "c",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "m",
        "choices": [
            {"index": 0, "delta": {"role": "assistant", "content": content},
             "finish_reason": finish}
        ],
    }


def _whole(content: str) -> dict:
    return {
        "id": "c",
        "object": "chat.completion",
        "created": 0,
        "model": "m",
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": content},
             "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


class Transport:
    """Answers the scripted responses in order and counts the requests."""

    def __init__(self, steps: list[httpx.Response]):
        self.steps = list(steps)
        self.requests = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests += 1
        return self.steps.pop(0)


def _error(status: int, retry_after: str | None = None) -> httpx.Response:
    headers = {"Retry-After": retry_after} if retry_after is not None else {}
    return httpx.Response(status, json={"message": "scripted"}, headers=headers)


def _stream_ok(text: str = "hello") -> httpx.Response:
    return httpx.Response(
        200,
        content=_sse(_chunk(text), _chunk("", "stop")),
        headers={"Content-Type": "text/event-stream"},
    )


@pytest.fixture
def mistral_transport(monkeypatch):
    """Builds a transport and wires a client's two httpx clients to it."""
    sleeps: list[float] = []

    async def fake_async_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    # Only the module under test is given the fake clocks.
    monkeypatch.setattr(models, "asyncio", SimpleNamespace(sleep=fake_async_sleep))
    monkeypatch.setattr(models, "time", SimpleNamespace(sleep=sleeps.append))

    def make(client, *steps: httpx.Response) -> Transport:
        transport = Transport(list(steps))
        mock = httpx.MockTransport(transport.handler)
        client.async_client = httpx.AsyncClient(base_url=BASE_URL, transport=mock)
        client.client = httpx.Client(base_url=BASE_URL, transport=mock)
        transport.sleeps = sleeps
        return transport

    return make


def aio(test):
    """Runs an async test body to completion (no async plugin is installed)."""

    @functools.wraps(test)
    def wrapper(*args, **kwargs):
        return asyncio.run(test(*args, **kwargs))

    return wrapper


CLIENTS = [orchestrator_chat_model, subagent_chat_model]
ASK = [HumanMessage("hi")]


async def _collect(client) -> str:
    text = ""
    async for chunk in client.astream(ASK):
        text += chunk.content
    return text


@pytest.mark.parametrize("build", CLIENTS)
@aio
async def test_429_is_retried_once_honouring_retry_after(mistral_transport, build):
    client = build()
    transport = mistral_transport(client, _error(429, "2"), _stream_ok("done"))
    assert await _collect(client) == "done"
    assert transport.requests == 2
    assert transport.sleeps == [2.0]


@pytest.mark.parametrize("build", CLIENTS)
@aio
async def test_non_streaming_call_is_retried_too(mistral_transport, build):
    client = build()
    transport = mistral_transport(
        client, _error(429, "1"), httpx.Response(200, json=_whole("whole"))
    )
    result = await client.ainvoke(ASK)
    assert result.content == "whole"
    assert transport.requests == 2


@pytest.mark.parametrize("build", CLIENTS)
def test_sync_stream_is_retried_once(mistral_transport, build):
    client = build()
    transport = mistral_transport(client, _error(429, "1"), _stream_ok("sync"))
    text = "".join(c.content for c in client.stream(ASK))
    assert text == "sync"
    assert transport.requests == 2
    assert transport.sleeps == [1.0]


@pytest.mark.parametrize("build", CLIENTS)
@aio
async def test_a_second_429_is_raised(mistral_transport, build):
    client = build()
    transport = mistral_transport(client, _error(429, "1"), _error(429, "1"))
    with pytest.raises(httpx.HTTPStatusError) as caught:
        await _collect(client)
    assert caught.value.response.status_code == 429
    assert transport.requests == 2


@pytest.mark.parametrize("build", CLIENTS)
@aio
async def test_retry_after_above_the_cap_fails_fast(mistral_transport, build):
    client = build()
    over = str(models.RATE_LIMIT_MAX_WAIT_S + 1)
    transport = mistral_transport(client, _error(429, over), _stream_ok())
    with pytest.raises(httpx.HTTPStatusError):
        await _collect(client)
    assert transport.requests == 1
    assert transport.sleeps == []


@pytest.mark.parametrize(
    "retry_after", [None, "", "Wed, 21 Oct 2026 07:28:00 GMT", "soon"]
)
@pytest.mark.parametrize("build", CLIENTS)
@aio
async def test_missing_or_non_numeric_retry_after_waits_the_default(
    mistral_transport, build, retry_after
):
    client = build()
    transport = mistral_transport(client, _error(429, retry_after), _stream_ok("ok"))
    assert await _collect(client) == "ok"
    assert transport.requests == 2
    assert transport.sleeps == [float(models.RATE_LIMIT_DEFAULT_WAIT_S)]


@pytest.mark.parametrize("retry_after", ["-1", "nan", "inf"])
@aio
async def test_negative_or_non_finite_retry_after_fails_fast(
    mistral_transport, retry_after
):
    client = orchestrator_chat_model()
    transport = mistral_transport(client, _error(429, retry_after), _stream_ok())
    with pytest.raises(httpx.HTTPStatusError):
        await _collect(client)
    assert transport.requests == 1
    assert transport.sleeps == []


@aio
async def test_a_missing_header_gets_one_retry_only(mistral_transport):
    client = orchestrator_chat_model()
    transport = mistral_transport(client, _error(429), _error(429))
    with pytest.raises(httpx.HTTPStatusError):
        await _collect(client)
    assert transport.requests == 2
    assert transport.sleeps == [float(models.RATE_LIMIT_DEFAULT_WAIT_S)]


@aio
async def test_the_cap_itself_is_still_retried(mistral_transport):
    client = orchestrator_chat_model()
    transport = mistral_transport(
        client, _error(429, str(models.RATE_LIMIT_MAX_WAIT_S)), _stream_ok()
    )
    await _collect(client)
    assert transport.requests == 2


@pytest.mark.parametrize("status", [500, 503, 401, 403])
@pytest.mark.parametrize("build", CLIENTS)
@aio
async def test_500_is_not_retried(mistral_transport, build, status):
    client = build()
    transport = mistral_transport(client, _error(status, "1"), _stream_ok())
    with pytest.raises(httpx.HTTPStatusError) as caught:
        await _collect(client)
    assert caught.value.response.status_code == status
    assert transport.requests == 1


@aio
async def test_no_retry_after_the_first_streamed_chunk(mistral_transport, monkeypatch):
    client = orchestrator_chat_model()
    transport = mistral_transport(client, _stream_ok("first"), _stream_ok("again"))

    # The stream breaks with a 429 after delivering a chunk: the caller has
    # already seen part of the answer, so it must not be asked again.
    original = models.ChatMistralAI._astream

    async def broken(self, *args, **kwargs):
        async for gen in original(self, *args, **kwargs):
            yield gen
            raise httpx.HTTPStatusError(
                "late",
                request=httpx.Request("POST", BASE_URL),
                response=httpx.Response(429, headers={"Retry-After": "1"}),
            )

    monkeypatch.setattr(models.ChatMistralAI, "_astream", broken)
    got = []
    with pytest.raises(httpx.HTTPStatusError):
        async for chunk in client.astream(ASK):
            got.append(chunk.content)
    assert got == ["first"]
    assert transport.requests == 1
    assert transport.sleeps == []


def test_library_retry_does_not_cover_status_errors():
    """The library layer retries transport errors only, so the layers never stack."""
    assert not issubclass(httpx.HTTPStatusError, (httpx.RequestError, httpx.StreamError))
    for client in (orchestrator_chat_model(), subagent_chat_model()):
        assert client.max_retries == models.MAX_RETRIES == 1


def _stream_with_usage() -> httpx.Response:
    last = _chunk("", "stop")
    last["usage"] = {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}
    return httpx.Response(
        200,
        content=_sse(_chunk("hello"), last),
        headers={"Content-Type": "text/event-stream"},
    )


@pytest.mark.parametrize("build", CLIENTS)
@aio
async def test_streamed_call_logs_token_usage_only(mistral_transport, build, caplog):
    client = build()
    mistral_transport(client, _stream_with_usage())
    with caplog.at_level("INFO", logger="uvicorn.error"):
        assert await _collect(client) == "hello"
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("model_usage")]
    assert lines == [f"model_usage model={client.model} input=11 output=7 total=18"]


@pytest.mark.parametrize("build", CLIENTS)
@aio
async def test_whole_call_logs_token_usage_once(mistral_transport, build, caplog):
    client = build()
    mistral_transport(client, httpx.Response(200, json=_whole("whole")))
    with caplog.at_level("INFO", logger="uvicorn.error"):
        await client.ainvoke(ASK)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("model_usage")]
    assert lines == [f"model_usage model={client.model} input=1 output=1 total=2"]
