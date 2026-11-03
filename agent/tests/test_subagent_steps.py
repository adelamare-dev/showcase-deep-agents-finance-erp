from __future__ import annotations

import asyncio
import json

import pytest
from langchain.agents import create_agent
from langchain_core.messages import HumanMessage

import isolated_subagents
from isolated_subagents import MAX_STEP_ARGS_CHARS, SUBAGENT_STEP_EVENT
from tests.fakes import ScriptedToolCaller

SUBAGENT_SCRIPT = [
    ("query_invoices", {"status": "overdue"}),
    ("analyze_cash_flow", {"months": 3, "note": "x" * 400}),
]


@pytest.fixture
def parent_events(monkeypatch):
    """Every event of a parent turn in which the orchestrator calls do_research."""
    subagent_model = ScriptedToolCaller(script=SUBAGENT_SCRIPT)
    monkeypatch.setattr(
        isolated_subagents, "subagent_chat_model", lambda: subagent_model
    )
    parent_model = ScriptedToolCaller(
        script=[("do_research", {"query": "cash and overdue invoices"})]
    )
    parent = create_agent(model=parent_model, tools=[isolated_subagents.do_research])

    async def collect():
        return [
            e
            async for e in parent.astream_events(
                {"messages": [HumanMessage(content="hi")]}, version="v2"
            )
        ]

    return asyncio.run(collect())


def _steps(events):
    return [
        e for e in events
        if e["event"] == "on_custom_event" and e["name"] == SUBAGENT_STEP_EVENT
    ]


def test_steps_are_emitted_in_order_while_the_tool_runs(parent_events):
    steps = _steps(parent_events)
    assert [s["data"]["tool"] for s in steps] == ["query_invoices", "analyze_cash_flow"]
    assert all(len(s["data"]["args"]) <= MAX_STEP_ARGS_CHARS for s in steps)
    assert json.loads(steps[0]["data"]["args"]) == {"status": "overdue"}

    # Both steps arrive before the tool's own end event.
    names = [(e["event"], e.get("name")) for e in parent_events]
    tool_end = names.index(("on_tool_end", "do_research"))
    last_step = max(i for i, e in enumerate(parent_events) if e in steps)
    assert last_step < tool_end


def test_steps_carry_the_id_of_the_call_that_started_them(parent_events):
    tool_start = next(
        e for e in parent_events
        if e["event"] == "on_tool_start" and e["name"] == "do_research"
    )
    call_id = tool_start["data"]["input"].get("tool_call_id") or next(
        s["data"]["toolCallId"] for s in _steps(parent_events)
    )
    assert {s["data"]["toolCallId"] for s in _steps(parent_events)} == {call_id}
    assert call_id.startswith("call")


def test_subagent_tokens_do_not_leak_to_the_parent_stream(parent_events):
    started = [e for e in parent_events if e["event"] == "on_chat_model_start"]
    # The orchestrator calls its model twice; the subagent's three calls stay hidden.
    assert len(started) == 2
    leaked = {"query_invoices", "analyze_cash_flow"}
    assert not leaked & {
        e["name"] for e in parent_events if e["event"].startswith("on_tool_")
    }
