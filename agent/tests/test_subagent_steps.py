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
    # The expected id comes from the parent's own tool result, not from the steps.
    tool_end = next(
        e for e in parent_events
        if e["event"] == "on_tool_end" and e["name"] == "do_research"
    )
    call_id = tool_end["data"]["output"].tool_call_id
    assert call_id.startswith("call")
    steps = _steps(parent_events)
    assert steps
    assert {s["data"]["toolCallId"] for s in steps} == {call_id}


def test_subagent_tokens_do_not_leak_to_the_parent_stream(parent_events):
    started = [e for e in parent_events if e["event"] == "on_chat_model_start"]
    # The orchestrator calls its model twice; the subagent's three calls stay hidden.
    assert len(started) == 2
    leaked = {"query_invoices", "analyze_cash_flow"}
    assert not leaked & {
        e["name"] for e in parent_events if e["event"].startswith("on_tool_")
    }


def _run_parent(monkeypatch, subagent_model):
    monkeypatch.setattr(
        isolated_subagents, "subagent_chat_model", lambda: subagent_model
    )
    parent = create_agent(
        model=ScriptedToolCaller(script=[("do_research", {"query": "q"})]),
        tools=[isolated_subagents.do_research],
    )
    return asyncio.run(parent.ainvoke({"messages": [HumanMessage(content="hi")]}))


def test_a_failing_step_event_does_not_discard_the_result(monkeypatch, caplog):
    baseline = _run_parent(monkeypatch, ScriptedToolCaller(script=SUBAGENT_SCRIPT))

    async def broken_dispatch(*args, **kwargs):
        raise RuntimeError("stream closed")

    monkeypatch.setattr(isolated_subagents, "adispatch_custom_event", broken_dispatch)
    with caplog.at_level("WARNING", logger="uvicorn.error"):
        out = _run_parent(monkeypatch, ScriptedToolCaller(script=SUBAGENT_SCRIPT))
    tool_message = next(m for m in out["messages"] if m.type == "tool")
    expected = next(m for m in baseline["messages"] if m.type == "tool")
    assert tool_message.status != "error"
    assert tool_message.content == expected.content
    assert "stream closed" in caplog.text


def test_sends_are_awaited_when_the_subagent_thread_raises(monkeypatch, recwarn):
    delivered = []

    async def slow_dispatch(name, data, config=None):
        await asyncio.sleep(0.05)
        delivered.append(data["tool"])
        raise RuntimeError("late failure")

    def broken_thread(query, system_prompt, agent_tools, on_tool_call):
        on_tool_call({"name": "query_invoices", "args": {}})
        raise ValueError("subagent crashed")

    monkeypatch.setattr(isolated_subagents, "adispatch_custom_event", slow_dispatch)
    monkeypatch.setattr(isolated_subagents, "_stream_subagent", broken_thread)

    with pytest.raises(ValueError, match="subagent crashed"):
        asyncio.run(
            isolated_subagents._run_subagent("q", "p", [], {}, "call1")
        )
    # The scheduled send ran to the end instead of being abandoned.
    assert delivered == ["query_invoices"]
