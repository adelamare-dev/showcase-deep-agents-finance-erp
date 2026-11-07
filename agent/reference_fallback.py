"""Fallback that builds the reference dashboard from rules when Mistral is saturated.

A 429 that survives the one retry of `models.py` ends a run, and on the
reference request that run is the demo. This middleware catches that 429, on
the orchestrator or inside a subagent tool, and from then on replaces every
model call of the turn, with no network call, by the next step of a fixed
recipe: a `build_reference_dashboard` call, an `update_dashboard` call with the
reference widgets, then a closing sentence that carries no figure. Any other
request, status or failure goes up unchanged, so the Retry notice stays as it
was.

The turn's own messages say where the recipe stands, so the middleware keeps no
state of its own: a model call is replaced when the turn holds a marker tool
result (a subagent refused) or a recipe call already made.
"""

from __future__ import annotations

import json
import uuid
from typing import Annotated, Any

import httpx
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelResponse
from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId, tool

from erp_store import get_store
from figure_guard_middleware import CORRECTION_ID_PREFIX
from isolated_subagents import SUBAGENT_STEP_EVENT, logger
from reference_dashboard import (
    REFERENCE_CONTEXT_DESCRIPTION,
    REFERENCE_WIDGETS,
    build_reference_dashboard,
    is_reference_request,
)

BUILD_TOOL_NAME = "build_reference_dashboard"
UPDATE_TOOL_NAME = "update_dashboard"
SUBAGENT_TOOL_NAMES = ("do_research", "do_projections")

FALLBACK_REPLY = (
    "The model is unavailable right now, so this dashboard was built from rules. "
    "Its figures come straight from the books."
)
# What a subagent card shows when its model was refused; the model never reads it.
SUBAGENT_UNAVAILABLE = "Unavailable: the model could not be reached."


@tool(BUILD_TOOL_NAME)
async def build_reference_dashboard_tool(
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> str:
    """Build the reference dashboard from the books, with no model call.

    Reads the store, reports each step it runs, and returns the widgets to
    place with update_dashboard.
    """
    built = build_reference_dashboard(get_store())
    for step in built["steps"]:
        logger.info("subagent_step tool=%s", step["tool"])
        await adispatch_custom_event(
            SUBAGENT_STEP_EVENT,
            {"toolCallId": tool_call_id, "tool": step["tool"], "args": step["args"]},
            config=config,
        )
    return json.dumps({"widgets": built["widgets"], "builtFromRules": True})


def _text(message: AnyMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    return "".join(
        part if isinstance(part, str) else part.get("text", "")
        for part in content
        if isinstance(part, str) or (isinstance(part, dict) and part.get("type") == "text")
    )


def _turn(messages: list[AnyMessage]) -> list[AnyMessage]:
    """The messages from the last one the user wrote."""
    start = max(
        (
            i
            for i, m in enumerate(messages)
            if isinstance(m, HumanMessage) and not (m.id or "").startswith(CORRECTION_ID_PREFIX)
        ),
        default=0,
    )
    return messages[start:]


def _reference_text(state: Any) -> str | None:
    """The reference request the web sent, from state["copilotkit"]["context"]."""
    context = ((state or {}).get("copilotkit") or {}).get("context") or []
    for item in context:
        entry = item if isinstance(item, dict) else getattr(item, "model_dump", lambda: {})()
        if entry.get("description") == REFERENCE_CONTEXT_DESCRIPTION:
            return entry.get("value")
    return None


def _is_reference(state: Any, messages: list[AnyMessage]) -> bool:
    turn = _turn(messages)
    user = turn[0] if turn and isinstance(turn[0], HumanMessage) else None
    return user is not None and is_reference_request(_text(user), _reference_text(state))


def _is_saturated(exc: BaseException) -> bool:
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429


def _recipe_started(turn: list[AnyMessage]) -> bool:
    """True once a subagent was refused or a recipe call was already made."""
    for m in turn:
        if isinstance(m, ToolMessage) and m.content == SUBAGENT_UNAVAILABLE:
            return True
        if isinstance(m, AIMessage) and any(c["name"] == BUILD_TOOL_NAME for c in m.tool_calls):
            return True
    return False


def _call(name: str, args: dict) -> AIMessage:
    # Mistral accepts tool call ids of nine letters or digits only.
    return AIMessage(
        content="", tool_calls=[{"id": uuid.uuid4().hex[:9], "name": name, "args": args}]
    )


def _next_step(messages: list[AnyMessage]) -> ModelResponse:
    """The recipe's next message, from the calls the turn already holds."""
    calls = [
        c["name"]
        for m in _turn(messages)
        if isinstance(m, AIMessage)
        for c in m.tool_calls
    ]
    if BUILD_TOOL_NAME not in calls:
        reply = _call(BUILD_TOOL_NAME, {})
    elif UPDATE_TOOL_NAME not in calls[calls.index(BUILD_TOOL_NAME) :]:
        # The layout becomes exactly the reference widgets, so the recipe can run
        # over a dashboard already partly built and leaves the same result.
        reply = _call(UPDATE_TOOL_NAME, {"widgets": REFERENCE_WIDGETS, "replace": True})
    else:
        reply = AIMessage(content=FALLBACK_REPLY)
    return ModelResponse(result=[reply])


def _unavailable(request: Any) -> ToolMessage:
    call = request.tool_call
    return ToolMessage(content=SUBAGENT_UNAVAILABLE, tool_call_id=call["id"], name=call["name"])


class ReferenceFallbackMiddleware(AgentMiddleware):
    """Build the reference dashboard from rules when a 429 survives the retry."""

    # Registered for the tool node only: the model is never offered it.
    tools = [build_reference_dashboard_tool]

    def _prepare(self, request: Any) -> tuple[Any, ModelResponse | None]:
        request = request.override(
            tools=[t for t in request.tools if getattr(t, "name", None) != BUILD_TOOL_NAME]
        )
        if _recipe_started(_turn(request.messages)):
            return request, _next_step(request.messages)
        return request, None

    def _rescue(self, exc: BaseException, request: Any) -> ModelResponse | None:
        if not _is_saturated(exc) or not _is_reference(request.state, request.messages):
            return None
        logger.warning("Mistral still answers 429: building the reference dashboard from rules")
        return _next_step(request.messages)

    def wrap_model_call(self, request, handler):
        request, replaced = self._prepare(request)
        if replaced is not None:
            return replaced
        try:
            return handler(request)
        except httpx.HTTPStatusError as exc:
            rescued = self._rescue(exc, request)
            if rescued is None:
                raise
            return rescued

    async def awrap_model_call(self, request, handler):
        request, replaced = self._prepare(request)
        if replaced is not None:
            return replaced
        try:
            return await handler(request)
        except httpx.HTTPStatusError as exc:
            rescued = self._rescue(exc, request)
            if rescued is None:
                raise
            return rescued

    def _subagent_refused(self, exc: BaseException, request: Any) -> bool:
        return (
            request.tool_call["name"] in SUBAGENT_TOOL_NAMES
            and _is_saturated(exc)
            and _is_reference(request.state, (request.state or {}).get("messages") or [])
        )

    def wrap_tool_call(self, request, handler):
        try:
            return handler(request)
        except httpx.HTTPStatusError as exc:
            if not self._subagent_refused(exc, request):
                raise
            logger.warning("A subagent met a 429: the reference dashboard is built from rules")
            return _unavailable(request)

    async def awrap_tool_call(self, request, handler):
        try:
            return await handler(request)
        except httpx.HTTPStatusError as exc:
            if not self._subagent_refused(exc, request):
                raise
            logger.warning("A subagent met a 429: the reference dashboard is built from rules")
            return _unavailable(request)
