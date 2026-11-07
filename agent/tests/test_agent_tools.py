from __future__ import annotations

import asyncio
import json

import pytest
from ag_ui.core import Context
from copilotkit import CopilotKitMiddleware
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableLambda
from langchain_mistralai import ChatMistralAI

import erp_store
import isolated_subagents
from agent import build_agent
from erp_datasets import build_dataset
from frontend_tools import WIDGET_TYPES, render_chat_visual, update_dashboard
from tests.fakes import ScriptedToolCaller, tool_names

ORIGINAL_DUMPS = json.dumps

DEMO_TOOLS = {
    "render_chat_visual",
    "navigate_and_filter",
    "request_approval",
    "update_dashboard",
    "manage_dashboard",
    "save_dashboard",
    "load_dashboard",
    "get_receivables_by_client",
    "get_headcount_and_payroll",
    "get_cash_and_payables",
    "do_research",
    "do_projections",
}

REMOVED_TOOLS = {
    "ls",
    "read_file",
    "write_file",
    "edit_file",
    "delete",
    "glob",
    "grep",
    "task",
}


class _ModelReached(Exception):
    """Raised by the fake `bind_tools` once the tools are recorded."""


@pytest.fixture
def recorded_bind_tools(monkeypatch):
    """Record the tools bound to the first model call, then stop the run."""
    seen: set[str] = set()

    def fake_bind_tools(self, tools, **kwargs):
        seen.update(tool_names(tools))
        raise _ModelReached

    monkeypatch.setattr(ChatMistralAI, "bind_tools", fake_bind_tools)
    return lambda: seen


def test_orchestrator_exposes_exactly_the_demo_tools(recorded_bind_tools):
    graph = build_agent()
    with pytest.raises(_ModelReached):
        graph.invoke(
            {"messages": [HumanMessage(content="hello")]},
            config={"configurable": {"thread_id": "tools-test"}},
        )
    assert recorded_bind_tools() == DEMO_TOOLS


def test_subagents_expose_data_tools_only(monkeypatch):
    model = ScriptedToolCaller(
        script=[("query_invoices", {"status": "overdue"})]
    )
    monkeypatch.setattr(isolated_subagents, "subagent_chat_model", lambda: model)

    call = {
        "type": "tool_call",
        "id": "call-research",
        "name": "do_research",
        "args": {"query": "overdue invoices"},
    }

    # The tool reports its steps as events, which need a run to belong to.
    async def run_tool(_, config):
        return await isolated_subagents.do_research.ainvoke(call, config)

    asyncio.run(RunnableLambda(run_tool).ainvoke(None))

    assert "query_invoices" in model.bound_tools
    assert not model.bound_tools & REMOVED_TOOLS
    # The second model call saw the tool result of the first.
    assert "ToolMessage" in {type(m).__name__ for m in model.calls[1]}


def test_what_if_renders_six_projected_quarters(store, monkeypatch):
    monkeypatch.setattr(erp_store, "_store", store)
    out = render_chat_visual.invoke({"dataset": "revenue_forecast", "quarters": 6, "growth_pct": 12})
    assert out.startswith("Rendered '")
    figures = json.loads(out.split("Figures: ", 1)[1])
    expected = build_dataset(store, "revenue_forecast", quarters=6, growth_pct=12)
    assert len(figures["rows"]) == 6
    assert figures["rows"] == expected["data"]


def test_do_projections_description_does_not_route_what_if():
    description = isolated_subagents.do_projections.description.lower()
    assert "what-if" not in description and "what if" not in description


def test_what_if_out_of_bounds_is_refused(store, monkeypatch):
    monkeypatch.setattr(erp_store, "_store", store)
    assert render_chat_visual.invoke({"dataset": "revenue_forecast", "quarters": 9}).startswith("Cannot render:")
    assert render_chat_visual.invoke({"dataset": "revenue_forecast", "growth_pct": 51}).startswith("Cannot render:")


def test_context_objects_reach_the_prompt_without_global_patch():
    note = CopilotKitMiddleware()._build_app_context_note(
        {
            "copilotkit": {
                "context": [Context(description="Current page", value="invoices")]
            }
        }
    )
    assert "Current page" in note and "invoices" in note
    assert json.dumps is ORIGINAL_DUMPS


def test_update_dashboard_refuses_an_unknown_widget_type():
    valid = {"type": "metric_cards", "config": {"metrics": ["Cash"]}}
    unknown = {"type": "pie_of_doom"}
    out = json.loads(update_dashboard.invoke({"widgets": [valid, unknown], "replace": True}))
    assert out["updated"] is False
    assert out["problems"] == [{"index": 1, "type": "pie_of_doom", "reason": "unknown widget type"}]


def test_update_dashboard_docstring_lists_the_accepted_widget_types():
    for name in WIDGET_TYPES:
        assert f"'{name}'" in update_dashboard.description
