from __future__ import annotations

import asyncio

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool

from figure_guard_middleware import FigureGuardMiddleware
from tests.fakes import ScriptedReplies

SNAPSHOT = {"totals": {"cash": 1092000}}


@tool
def get_balance() -> str:
    """Return the cash balance."""
    return '{"cash": 1092000}'


def run(replies: list[AIMessage], question: str = "What is my cash?", snapshot=SNAPSHOT):
    model = ScriptedReplies(replies=replies)
    agent = create_agent(
        model,
        tools=[get_balance],
        middleware=[FigureGuardMiddleware(snapshot=lambda: snapshot)],
    )
    result = asyncio.run(agent.ainvoke({"messages": [HumanMessage(question)]}))
    return model, result["messages"]


def test_wrong_then_right_is_retried_once():
    model, messages = run([AIMessage("Cash is $43,000."), AIMessage("Cash is $1,092,000.")])
    assert messages[-1].content == "Cash is $1,092,000."
    assert len(model.calls) == 2
    # The retry saw the correction; the wrong reply is gone.
    assert "$43,000" in model.calls[1][-1].content
    assert all("Cash is $43,000." != m.content for m in messages)


def test_correction_is_not_left_in_the_thread():
    _, messages = run([AIMessage("Cash is $43,000."), AIMessage("Cash is $1,092,000.")])
    assert [type(m).__name__ for m in messages] == ["HumanMessage", "AIMessage"]


def test_wrong_twice_is_marked():
    model, messages = run([AIMessage("Cash is $43,000."), AIMessage("Cash is $43,000.")])
    assert messages[-1].content == "Cash is ⟦unverified:$43,000⟧."
    assert len(model.calls) == 2
    assert [type(m).__name__ for m in messages] == ["HumanMessage", "AIMessage"]


def test_text_before_a_tool_call_is_checked():
    wrong = AIMessage(
        "Checking $43,000.", tool_calls=[{"id": "call1", "name": "get_balance", "args": {}}]
    )
    right = AIMessage(
        "Checking.", tool_calls=[{"id": "call2", "name": "get_balance", "args": {}}]
    )
    model, messages = run([wrong, right, AIMessage("Cash is $1,092,000.")])
    assert len(model.calls) == 3
    assert messages[-1].content == "Cash is $1,092,000."
    assert not any("$43,000" in str(m.content) for m in messages)
    # The tool ran once, for the accepted call only.
    assert [m.tool_call_id for m in messages if isinstance(m, ToolMessage)] == ["call2"]


def test_text_before_a_tool_call_is_marked_after_two_failures():
    wrong = AIMessage(
        "Checking $43,000.", tool_calls=[{"id": "call1", "name": "get_balance", "args": {}}]
    )
    model, messages = run([wrong, wrong, AIMessage("Done.")])
    assert len(model.calls) == 3
    marked = [m for m in messages if isinstance(m, AIMessage) and m.tool_calls]
    assert marked[0].content == "Checking ⟦unverified:$43,000⟧."
    assert any(isinstance(m, ToolMessage) for m in messages)


def test_correct_text_passes_untouched():
    model, messages = run([AIMessage("Cash is $1,092,000.")])
    assert len(model.calls) == 1
    assert messages[-1].content == "Cash is $1,092,000."


def test_tool_result_of_the_turn_backs_a_figure():
    call = AIMessage("", tool_calls=[{"id": "call1", "name": "get_balance", "args": {}}])
    model, messages = run([call, AIMessage("Cash is $1,092,000.")], snapshot={})
    assert len(model.calls) == 2
    assert messages[-1].content == "Cash is $1,092,000."


def test_a_figure_typed_by_the_user_is_admitted():
    model, messages = run([AIMessage("At 12% growth it rises.")], "What if growth is 12%?")
    assert len(model.calls) == 1
    assert messages[-1].content == "At 12% growth it rises."


def test_the_retry_budget_resets_on_a_new_question():
    model = ScriptedReplies(
        replies=[
            AIMessage("Cash is $43,000."),
            AIMessage("Cash is $1,092,000."),
            AIMessage("Cash is $43,000."),
            AIMessage("Cash is $1,092,000."),
        ]
    )
    agent = create_agent(
        model, tools=[get_balance], middleware=[FigureGuardMiddleware(snapshot=lambda: SNAPSHOT)]
    )
    first = asyncio.run(agent.ainvoke({"messages": [HumanMessage("Cash?")]}))
    second = asyncio.run(
        agent.ainvoke({"messages": [*first["messages"], HumanMessage("And now?")]})
    )
    assert second["messages"][-1].content == "Cash is $1,092,000."
    assert len(model.calls) == 4
