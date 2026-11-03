"""Single home for model identifiers and client parameters.

Every Mistral client in the agent is built here, so identifiers and limits
change in one place.

Model IDs are dated snapshots, never a `-latest` alias: an alias can move to a
new model under our feet and change tool-calling behaviour with no code change.

Both roles run on `ministral-14b-2512`. `mistral-small-2603` is the preferred
model, but a probe (`scripts/probe_models.py`) on the free tier answered 429
with a quota of 0 requests per minute, so it is unusable on this account.
`ministral-14b-2512` answered 200 with a tool call, at 30 requests per minute.
Re-run the probe and switch the two constants if the quota changes.

Each call makes one attempt. LangChain's `max_retries` counts attempts, so
`MAX_RETRIES = 1` means no retry, and only transport errors are retried at all:
HTTP status errors such as 429 or 5xx never are. A call that is going to fail
should fail fast so the user is told, instead of watching a spinner.

The one exception is a 429 that arrives before the first streamed chunk. The
call is held and sent once more (`RATE_LIMIT_MAX_RETRIES`): for the
`Retry-After` seconds when the header is a number of at most
`RATE_LIMIT_MAX_WAIT_S`, or for `RATE_LIMIT_DEFAULT_WAIT_S` when the header is
absent or not a number (Mistral's 429 carries none). A longer, negative or
non-finite wait and any other status fail at once, and nothing is retried once
a chunk has been received, since the caller has already seen part of the
answer. The added delay is bounded: one retry per model call, at most 8 s.
Both clients share this behaviour through `_RateLimitRetryMistral`.

Two kinds of client exist. `orchestrator_chat_model` builds the client of the
main graph, which re-chunks streamed tool calls so the chat can show a step
while the tool runs. `subagent_chat_model` builds a plain client for the
thread-isolated subagents.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
from langchain_core.callbacks import (
    AsyncCallbackManagerForLLMRun,
    BaseCallbackHandler,
    CallbackManagerForLLMRun,
)
from langchain_core.messages import AIMessageChunk, BaseMessage
from langchain_core.messages.tool import tool_call_chunk
from langchain_core.outputs import ChatGenerationChunk, ChatResult, LLMResult
from langchain_mistralai import ChatMistralAI

ORCHESTRATOR_MODEL = "ministral-14b-2512"
SUBAGENT_MODEL = "ministral-14b-2512"

REQUEST_TIMEOUT_S = 45
MAX_RETRIES = 1

# A 429 is retried this many times, and only when Mistral asks for a wait of at
# most this many seconds. The cap keeps the added delay small against the
# dashboard time budget. Mistral's 429 usually carries no `Retry-After`, so a
# missing or unusable header waits the default instead.
RATE_LIMIT_MAX_RETRIES = 1
RATE_LIMIT_MAX_WAIT_S = 8
RATE_LIMIT_DEFAULT_WAIT_S = 2

logger = logging.getLogger(__name__)
# Usage lines go to the server's own logger, which prints at INFO.
usage_logger = logging.getLogger("uvicorn.error")

# LangGraph supersteps allowed per turn. The orchestrator makes a model call and
# a tool call per step, so it needs more room than a subagent, which only loops
# over data tools.
ORCHESTRATOR_RECURSION_LIMIT = 100
SUBAGENT_RECURSION_LIMIT = 25


def rate_limit_wait(exc: BaseException) -> float | None:
    """Seconds to wait before retrying `exc`, or None if it must not be retried.

    Only a 429 qualifies. A `Retry-After` that is a number of seconds from 0 to
    `RATE_LIMIT_MAX_WAIT_S` is honoured. A header that is absent or not a
    number (including an HTTP date) gets `RATE_LIMIT_DEFAULT_WAIT_S`. A number
    above the cap, negative or not finite fails, and the user is told.
    """
    if not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code != 429:
        return None
    try:
        wait = float(exc.response.headers.get("Retry-After", ""))
    except ValueError:
        return float(RATE_LIMIT_DEFAULT_WAIT_S)
    if not 0 <= wait <= RATE_LIMIT_MAX_WAIT_S:
        return None
    return wait


class _TokenUsageLog(BaseCallbackHandler):
    """Logs one line per finished model call: model id and token counts, no content."""

    def __init__(self, model: str) -> None:
        self.model = model

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        for generations in response.generations:
            for generation in generations:
                usage = getattr(getattr(generation, "message", None), "usage_metadata", None)
                if usage:
                    usage_logger.info(
                        "model_usage model=%s input=%d output=%d total=%d",
                        self.model,
                        usage.get("input_tokens", 0),
                        usage.get("output_tokens", 0),
                        usage.get("total_tokens", 0),
                    )


def _log_retry(wait: float) -> None:
    logger.warning("Mistral answered 429: retrying once after %.1f s", wait)


class _RateLimitRetryMistral(ChatMistralAI):
    """`ChatMistralAI` that retries a short 429 once, before any chunk arrived.

    The library raises `httpx.HTTPStatusError` for a rejected request on the
    first read of the stream (or on the call itself when not streaming), and
    its own retry never covers status errors, so the two layers do not stack.
    """

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        retries = 0
        while True:
            received = False
            try:
                async for gen in super()._astream(
                    messages, stop, run_manager=run_manager, **kwargs
                ):
                    received = True
                    yield gen
                return
            except httpx.HTTPStatusError as exc:
                wait = None if received else rate_limit_wait(exc)
                if wait is None or retries >= RATE_LIMIT_MAX_RETRIES:
                    raise
                retries += 1
                _log_retry(wait)
                await asyncio.sleep(wait)

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        retries = 0
        while True:
            received = False
            try:
                for gen in super()._stream(
                    messages, stop, run_manager=run_manager, **kwargs
                ):
                    received = True
                    yield gen
                return
            except httpx.HTTPStatusError as exc:
                wait = None if received else rate_limit_wait(exc)
                if wait is None or retries >= RATE_LIMIT_MAX_RETRIES:
                    raise
                retries += 1
                _log_retry(wait)
                time.sleep(wait)

    async def _agenerate(self, *args: Any, **kwargs: Any) -> ChatResult:
        retries = 0
        while True:
            try:
                return await super()._agenerate(*args, **kwargs)
            except httpx.HTTPStatusError as exc:
                wait = rate_limit_wait(exc)
                if wait is None or retries >= RATE_LIMIT_MAX_RETRIES:
                    raise
                retries += 1
                _log_retry(wait)
                await asyncio.sleep(wait)

    def _generate(self, *args: Any, **kwargs: Any) -> ChatResult:
        retries = 0
        while True:
            try:
                return super()._generate(*args, **kwargs)
            except httpx.HTTPStatusError as exc:
                wait = rate_limit_wait(exc)
                if wait is None or retries >= RATE_LIMIT_MAX_RETRIES:
                    raise
                retries += 1
                _log_retry(wait)
                time.sleep(wait)


class _StreamingToolCallMistral(_RateLimitRetryMistral):
    """`ChatMistralAI` that streams a tool call as start, args, end.

    Mistral delivers a tool call whole, in a single streamed chunk that also
    carries `finish_reason`. `ag_ui_langgraph` drops any chunk with a
    finish_reason and, even without that, only emits the tool-call start on
    the first chunk and the arguments on a later one. Nothing is streamed, so
    the client receives the whole call only after the tool has finished and
    the chat step appears too late.

    Each such chunk is re-yielded as: a chunk with name, id and empty args
    (call start), a chunk with the arguments only, an empty chunk (call end),
    then the original chunk minus its tool calls, keeping `finish_reason` and
    `usage_metadata`. Merged, the chunks give the same message as before.
    """

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        async for gen in super()._astream(
            messages, stop, run_manager=run_manager, **kwargs
        ):
            msg = gen.message
            if not (
                isinstance(msg, AIMessageChunk)
                and any(c.get("name") for c in msg.tool_call_chunks)
            ):
                yield gen
                continue
            for call in msg.tool_call_chunks:
                yield _chunk(
                    tool_call_chunk(
                        name=call.get("name"),
                        args="",
                        id=call.get("id"),
                        index=call.get("index"),
                    )
                )
                if call.get("args"):
                    yield _chunk(
                        tool_call_chunk(
                            name=None,
                            args=call["args"],
                            id=None,
                            index=call.get("index"),
                        )
                    )
                yield _chunk()
            rest = msg.model_copy(update={"tool_call_chunks": [], "tool_calls": []})
            yield ChatGenerationChunk(message=rest, generation_info=gen.generation_info)


def _chunk(*calls: Any) -> ChatGenerationChunk:
    return ChatGenerationChunk(
        message=AIMessageChunk(content="", tool_call_chunks=list(calls))
    )


def orchestrator_chat_model() -> ChatMistralAI:
    """Build the orchestrator's client: tool calls re-chunked, one at a time.

    `parallel_tool_calls: false` is a documented Mistral chat-completions
    parameter. It keeps one model message from carrying two tool calls, which
    would render two cards for a single turn.
    """
    return _StreamingToolCallMistral(
        model_name=ORCHESTRATOR_MODEL,
        temperature=0,
        max_retries=MAX_RETRIES,
        timeout=REQUEST_TIMEOUT_S,
        model_kwargs={"parallel_tool_calls": False},
        callbacks=[_TokenUsageLog(ORCHESTRATOR_MODEL)],
    )


def subagent_chat_model() -> ChatMistralAI:
    """Build the plain client used inside the thread-isolated subagents."""
    return _RateLimitRetryMistral(
        model_name=SUBAGENT_MODEL,
        temperature=0,
        max_retries=MAX_RETRIES,
        timeout=REQUEST_TIMEOUT_S,        callbacks=[_TokenUsageLog(SUBAGENT_MODEL)],
    )
