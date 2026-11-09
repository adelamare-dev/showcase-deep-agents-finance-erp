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
    # The retry saw the wrong reply, then the correction, in that order.
    seen = model.calls[1]
    assert [type(m).__name__ for m in seen] == ["HumanMessage", "AIMessage", "HumanMessage"]
    assert seen[1].content == "Cash is $43,000."
    assert "$43,000" in seen[2].content
    # Neither is left in the final state.
    assert all("$43,000" not in str(m.content) for m in messages)


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
    # The retry thread keeps the wrong text but not its tool call, so no call
    # is left without an answer.
    retry_thread = model.calls[1]
    assert [type(m).__name__ for m in retry_thread] == ["HumanMessage", "AIMessage", "HumanMessage"]
    assert retry_thread[1].tool_calls == []
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
    assert sum("Checking" in str(m.content) for m in messages) == 1
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


@tool
def update_dashboard(widgets: list) -> str:
    """Place widgets."""
    return '{"updated": true, "count": 1, "note": "cash 1092000"}'


def run_dashboard(replies: list[AIMessage], question: str = "Build a dashboard", snapshot=SNAPSHOT):
    model = ScriptedReplies(replies=replies)
    agent = create_agent(
        model,
        tools=[get_balance, update_dashboard],
        middleware=[FigureGuardMiddleware(snapshot=lambda: snapshot)],
    )
    result = asyncio.run(agent.ainvoke({"messages": [HumanMessage(question)]}))
    return model, result["messages"]


def _dashboard_call() -> AIMessage:
    return AIMessage(
        "", tool_calls=[{"id": "dash1", "name": "update_dashboard", "args": {"widgets": []}}]
    )


def test_a_backed_figure_after_the_dashboard_is_retried_with_the_dashboard_correction():
    model, messages = run_dashboard(
        [_dashboard_call(), AIMessage("Cash is $1,092,000."), AIMessage("The dashboard shows cash.")]
    )
    assert len(model.calls) == 3
    correction = model.calls[2][-1]
    assert "widgets already show every figure" in correction.content
    assert "$1,092,000" in correction.content
    assert messages[-1].content == "The dashboard shows cash."
    assert all("$1,092,000" not in str(m.content) for m in messages if isinstance(m, AIMessage))
    assert not any(isinstance(m, HumanMessage) and "widgets already" in str(m.content) for m in messages)


def test_a_figure_after_the_dashboard_that_survives_the_retry_is_marked():
    model, messages = run_dashboard(
        [_dashboard_call(), AIMessage("Cash is $1,092,000."), AIMessage("Cash is $1,092,000.")]
    )
    assert len(model.calls) == 3
    assert messages[-1].content == "Cash is ⟦unverified:$1,092,000⟧."
    assert [type(m).__name__ for m in messages][-1] == "AIMessage"
    assert not any(isinstance(m, HumanMessage) and "widgets already" in str(m.content) for m in messages)


def test_a_dashboard_closing_text_without_figures_passes():
    model, messages = run_dashboard([_dashboard_call(), AIMessage("The dashboard shows cash and bills.")])
    assert len(model.calls) == 2
    assert messages[-1].content == "The dashboard shows cash and bills."


def test_a_figure_before_the_dashboard_call_keeps_the_usual_rule():
    first = AIMessage(
        "Cash is $1,092,000.",
        tool_calls=[{"id": "dash1", "name": "update_dashboard", "args": {"widgets": []}}],
    )
    model, messages = run_dashboard([first, AIMessage("Done.")], snapshot={})
    # The text sits in the same message as the call: it is not after the call.
    # $1,092,000 is not backed (no snapshot, no tool text yet): the usual retry runs.
    assert "figures not returned" in model.calls[1][-1].content


def test_a_figure_backed_by_a_tool_before_the_dashboard_call_is_admitted():
    balance = AIMessage("", tool_calls=[{"id": "c1", "name": "get_balance", "args": {}}])
    before = AIMessage(
        "Cash is $1,092,000.",
        tool_calls=[{"id": "dash1", "name": "update_dashboard", "args": {"widgets": []}}],
    )
    model, messages = run_dashboard([balance, before, AIMessage("Done.")], snapshot={})
    # The text precedes the dashboard call, so today's rule applies: no retry.
    assert len(model.calls) == 3
    assert any(m.content == "Cash is $1,092,000." for m in messages if isinstance(m, AIMessage))
    assert messages[-1].content == "Done."


def test_a_turn_without_the_dashboard_call_is_unchanged():
    call = AIMessage("", tool_calls=[{"id": "call1", "name": "get_balance", "args": {}}])
    model, messages = run_dashboard([call, AIMessage("Cash is $1,092,000.")], snapshot={})
    assert len(model.calls) == 2
    assert messages[-1].content == "Cash is $1,092,000."


def test_a_figure_the_user_typed_is_admitted_in_the_dashboard_closing_text():
    model, messages = run_dashboard(
        [_dashboard_call(), AIMessage("Built with 12% growth.")], "Dashboard with 12% growth"
    )
    assert len(model.calls) == 2
    assert messages[-1].content == "Built with 12% growth."


def test_the_rules_fallback_reply_carries_no_figure():
    from figure_guard import extract_figures
    from reference_fallback import FALLBACK_REPLY

    assert extract_figures(FALLBACK_REPLY) == []
