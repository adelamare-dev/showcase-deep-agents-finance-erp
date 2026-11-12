from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest
from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langchain_core.tools import tool
from pydantic import Field

from erp_store import get_store
from figure_guard import unverified
from figure_guard_middleware import FigureGuardMiddleware
from frontend_tools import update_dashboard
from reference_dashboard import REFERENCE_CONTEXT_DESCRIPTION, REFERENCE_WIDGETS
from reference_fallback import FALLBACK_REPLY, ReferenceFallbackMiddleware
from tests.fakes import ScriptedReplies, tool_names

HERO = (
    "Build me a cash flow risk dashboard: Cash and Accounts Payable KPIs, AR aging, "
    "supplier bills due, and a quarterly cash projection"
)
CONTEXT = [{"description": REFERENCE_CONTEXT_DESCRIPTION, "value": HERO}]


def saturated(status: int = 429) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://mistral.test/v1/chat/completions")
    return httpx.HTTPStatusError(
        "rejected", request=request, response=httpx.Response(status, request=request)
    )


class RejectedModel(BaseChatModel):
    """Chat model whose every call is refused by the provider."""

    status: int = 429
    calls: list = Field(default_factory=list)
    bound_tools: set = Field(default_factory=set)

    @property
    def _llm_type(self) -> str:
        return "rejected"

    def bind_tools(self, tools, **kwargs):
        self.bound_tools = tool_names(tools)
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        self.calls.append(messages)
        raise saturated(self.status)


@tool
async def do_research(query: str) -> str:
    """Research the books."""
    raise saturated()


def run(model, question: str = HERO, context=CONTEXT):
    # CopilotKitMiddleware declares its own state schema, which the invariant
    # AgentMiddleware[AgentState] parameter of create_agent does not accept.
    middleware: list[AgentMiddleware[Any, Any, Any]] = [
        CopilotKitMiddleware(),
        ReferenceFallbackMiddleware(),
        FigureGuardMiddleware(snapshot=lambda: get_store().snapshot()),
    ]
    agent = create_agent(model, tools=[update_dashboard, do_research], middleware=middleware)
    # The "copilotkit" key belongs to the state schema CopilotKitMiddleware adds,
    # which the Any-typed middleware list above hides from the type checker.
    state: Any = {"messages": [HumanMessage(question)], "copilotkit": {"context": context, "actions": []}}
    return asyncio.run(agent.ainvoke(state))["messages"]


def assert_built_from_rules(messages):
    kinds = [type(m).__name__ for m in messages]
    assert kinds == ["HumanMessage", "AIMessage", "ToolMessage", "AIMessage", "ToolMessage", "AIMessage"]
    build, built, update, updated, reply = messages[1:]
    assert [c["name"] for c in build.tool_calls] == ["build_reference_dashboard"]
    assert json.loads(built.content) == {"widgets": REFERENCE_WIDGETS, "builtFromRules": True}
    assert [c["name"] for c in update.tool_calls] == ["update_dashboard"]
    assert update.tool_calls[0]["args"] == {"widgets": REFERENCE_WIDGETS, "replace": True}
    assert json.loads(updated.content)["updated"] is True
    assert reply.content == FALLBACK_REPLY and not reply.tool_calls
    # Mistral accepts tool call ids of nine letters or digits only.
    for ai in (build, update):
        assert all(len(c["id"]) == 9 and c["id"].isalnum() for c in ai.tool_calls)


def test_429_on_the_orchestrator_switches_to_rules():
    model = RejectedModel()
    messages = run(model)
    assert_built_from_rules(messages)
    # Only the first call reached the provider; the later ones were replaced.
    assert len(model.calls) == 1


def test_429_in_a_subagent_switches_to_rules():
    model = ScriptedReplies(
        replies=[
            AIMessage("", tool_calls=[{"id": "abc123xyz", "name": "do_research", "args": {"query": "q"}}]),
            AIMessage("This model reply must never be asked for."),
        ]
    )
    messages = run(model)
    kinds = [type(m).__name__ for m in messages]
    assert kinds[:3] == ["HumanMessage", "AIMessage", "ToolMessage"]
    assert messages[2].name == "do_research" and "unavailable" in messages[2].content.lower()
    assert_built_from_rules([messages[0], *messages[3:]])
    assert len(model.calls) == 1


def test_429_on_another_request_propagates():
    with pytest.raises(httpx.HTTPStatusError):
        run(RejectedModel(), question="Show me all overdue invoices")


def test_429_in_a_subagent_on_another_request_propagates():
    model = ScriptedReplies(
        replies=[AIMessage("", tool_calls=[{"id": "abc123xyz", "name": "do_research", "args": {"query": "q"}}])]
    )
    with pytest.raises(httpx.HTTPStatusError):
        run(model, question="Show me all overdue invoices")


def test_a_request_with_no_reference_context_propagates():
    with pytest.raises(httpx.HTTPStatusError):
        run(RejectedModel(), context=[])


def test_another_failure_on_the_reference_request_propagates():
    with pytest.raises(httpx.HTTPStatusError):
        run(RejectedModel(status=500))


def test_the_model_is_not_offered_the_recipe_tool():
    model = RejectedModel()
    with pytest.raises(httpx.HTTPStatusError):
        run(model, question="Show me all overdue invoices")
    assert "build_reference_dashboard" not in model.bound_tools
    assert "update_dashboard" in model.bound_tools


def test_the_reply_carries_no_figure():
    assert unverified(FALLBACK_REPLY, set()) == []
