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

Two kinds of client exist. `orchestrator_chat_model` builds the client of the
main graph, which re-chunks streamed tool calls so the chat can show a step
while the tool runs. `subagent_chat_model` builds a plain client for the
thread-isolated subagents.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun
from langchain_core.messages import AIMessageChunk, BaseMessage
from langchain_core.messages.tool import tool_call_chunk
from langchain_core.outputs import ChatGenerationChunk
from langchain_mistralai import ChatMistralAI

ORCHESTRATOR_MODEL = "ministral-14b-2512"
SUBAGENT_MODEL = "ministral-14b-2512"

REQUEST_TIMEOUT_S = 45
MAX_RETRIES = 1

# LangGraph supersteps allowed per turn. The orchestrator makes a model call and
# a tool call per step, so it needs more room than a subagent, which only loops
# over data tools.
ORCHESTRATOR_RECURSION_LIMIT = 100
SUBAGENT_RECURSION_LIMIT = 25


class _StreamingToolCallMistral(ChatMistralAI):
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
    )


def subagent_chat_model() -> ChatMistralAI:
    """Build the plain client used inside the thread-isolated subagents."""
    return ChatMistralAI(
        model_name=SUBAGENT_MODEL,
        temperature=0,
        max_retries=MAX_RETRIES,
        timeout=REQUEST_TIMEOUT_S,
    )
