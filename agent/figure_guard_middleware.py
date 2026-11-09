"""Middleware that checks every figure of the orchestrator's text.

It runs after each model call. A text whose figures no tool result, store
number or user number backs gets one retry with a correction message; a text
that still fails keeps its words, with the unbacked figures marked. The
retry runs on the thread `... tool, ai(wrong), user(correction)`, which keeps
the roles in an order the provider accepts (the wrong message loses its tool
calls, so none is left unanswered). Once the retry has been judged, whether it
passes or is marked, both the wrong message and the correction are removed, so
no snapshot of the thread shows either.

The orchestrator's text is not streamed (the endpoint config turns message
emission off): the checked message reaches the chat in the final messages of
the run, while tool calls still stream.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from langchain.agents.middleware import AgentMiddleware, hook_config
from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    RemoveMessage,
    ToolMessage,
)

from figure_guard import (
    CORRECTION,
    DASHBOARD_CORRECTION,
    allowed_values,
    mark,
    unverified,
)
from frontend_tools import update_dashboard

CORRECTION_ID_PREFIX = "figure-guard-correction-"


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part if isinstance(part, str) else part.get("text", "")
            for part in content
            if isinstance(part, str) or (isinstance(part, dict) and part.get("type") == "text")
        )
    return ""


def _source_texts(message: ToolMessage) -> list[str]:
    """The texts a tool message backs figures with.

    A subagent's reply is its own prose, so it carries the texts of the data
    tools it called as an artifact: those back the figures, not the prose.
    """
    artifact = message.artifact
    if isinstance(artifact, dict) and isinstance(artifact.get("sources"), list):
        return [s for s in artifact["sources"] if isinstance(s, str)]
    return [_text_of(message.content)]


def _is_correction(message: AnyMessage) -> bool:
    return isinstance(message, HumanMessage) and (message.id or "").startswith(
        CORRECTION_ID_PREFIX
    )


def _marked_content(content: Any, figures: list) -> Any:
    if isinstance(content, str):
        return mark(content, figures)
    return [
        {**part, "text": mark(part["text"], figures)}
        if isinstance(part, dict) and part.get("type") == "text"
        else part
        for part in content
    ]


def _without_tool_calls(ai: AIMessage) -> AIMessage:
    """Copy of a message with no tool call left anywhere.

    A streamed message also carries its calls in `additional_kwargs`, and the
    provider client re-sends those when `tool_calls` is empty.
    """
    extra = {k: v for k, v in ai.additional_kwargs.items() if k != "tool_calls"}
    return ai.model_copy(
        update={"tool_calls": [], "invalid_tool_calls": [], "additional_kwargs": extra}
    )


def _called_dashboard(messages: list[AnyMessage]) -> bool:
    return any(
        isinstance(m, AIMessage) and any(c["name"] == update_dashboard.name for c in m.tool_calls)
        for m in messages
    )


def _default_snapshot() -> dict:
    from erp_store import get_store

    return get_store().snapshot()


class FigureGuardMiddleware(AgentMiddleware):
    """Verify the figures of each model text against this turn's data."""

    def __init__(self, snapshot: Callable[[], dict] | None = None) -> None:
        super().__init__()
        self._snapshot = snapshot or _default_snapshot

    def _verdict(self, state: dict) -> dict[str, Any] | None:
        messages: list[AnyMessage] = state["messages"]
        ai = messages[-1] if messages else None
        if not isinstance(ai, AIMessage):
            return None

        # The turn starts at the last message the user wrote.
        start = max(
            (
                i
                for i, m in enumerate(messages)
                if isinstance(m, HumanMessage) and not _is_correction(m)
            ),
            default=0,
        )
        turn = messages[start:]
        corrections = [m for m in turn if _is_correction(m)]
        # The wrong message of a retry sits right before its correction.
        discarded = [
            turn[i - 1]
            for i, m in enumerate(turn)
            if _is_correction(m) and i > 0 and isinstance(turn[i - 1], AIMessage)
        ]
        cleanup = [RemoveMessage(id=m.id) for m in (*discarded, *corrections) if m.id]

        text = _text_of(ai.content)
        if not text.strip():
            return {"messages": cleanup} if cleanup else None

        tool_texts = [
            text for m in turn if isinstance(m, ToolMessage) for text in _source_texts(m)
        ]
        user_text = _text_of(messages[start].content) if messages else ""
        # After update_dashboard the widgets carry the figures: any figure in the
        # closing text is unverified, whatever the tools returned.
        closing = _called_dashboard(turn[:-1])
        if closing:
            allowed = allowed_values([], {}, user_text)
        else:
            allowed = allowed_values(tool_texts, self._snapshot(), user_text)
        bad = unverified(text, allowed)

        if not bad:
            return {"messages": cleanup} if cleanup else None

        if not corrections and ai.id:
            raws = ", ".join(dict.fromkeys(fig.raw for fig in bad))
            return {
                "messages": [
                    _without_tool_calls(ai),
                    HumanMessage(
                        content=(DASHBOARD_CORRECTION if closing else CORRECTION).format(raws=raws),
                        id=f"{CORRECTION_ID_PREFIX}{uuid.uuid4().hex}",
                    ),
                ],
                "jump_to": "model",
            }

        marked = ai.model_copy(update={"content": _marked_content(ai.content, bad)})
        return {"messages": [marked, *cleanup]}

    @hook_config(can_jump_to=["model"])
    def after_model(self, state, runtime) -> dict[str, Any] | None:
        return self._verdict(state)

    @hook_config(can_jump_to=["model"])
    async def aafter_model(self, state, runtime) -> dict[str, Any] | None:
        return self._verdict(state)
