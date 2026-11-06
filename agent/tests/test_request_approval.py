from __future__ import annotations

import asyncio
import json
from datetime import timedelta

import pytest
from langchain_core.runnables import RunnableConfig, RunnableLambda

import erp_store
import frontend_tools
from frontend_tools import ERP_DATA_CHANGED_EVENT, request_approval


@pytest.fixture
def shared_store(store, monkeypatch):
    """Point the store the tool reads at the parametrized one."""
    monkeypatch.setattr(erp_store, "_store", store)
    return store


@pytest.fixture
def interrupt_spy(monkeypatch):
    """Stand in for copilotkit_interrupt: records the card and answers with `.answer`."""
    class Spy:
        calls: list = []
        answer: object = {"approved": True, "message": "ok"}
        echo_bill_ids: bool = True

    spy = Spy()
    spy.calls = []

    def fake(message=None, action=None, args=None):
        spy.calls.append({"action": action, "args": args})
        answer = spy.answer
        # The web card sends back the bill ids it was shown; mirror that unless a test opts out.
        if spy.echo_bill_ids and isinstance(answer, dict) and "billIds" in (args or {}):
            answer = {"billIds": args["billIds"], **answer}
        return json.dumps(answer), answer

    monkeypatch.setattr(frontend_tools, "copilotkit_interrupt", fake)
    return spy


@pytest.fixture
def custom_events(monkeypatch):
    sent = []
    monkeypatch.setattr(
        frontend_tools,
        "dispatch_custom_event",
        lambda name, data, config=None: sent.append((name, data)),
    )
    return sent


SCOPE = {"due_within_days": 7, "include_overdue": True}


def in_scope(store, days=7, include_overdue=True):
    """Bills the scope should select, worked out here from the snapshot."""
    today = store.as_of
    limit = (today + timedelta(days=days)).isoformat()
    rows = [
        b
        for b in store.snapshot()["bills"]
        if b["status"] != "paid"
        and (
            (include_overdue and b["dueDate"] < today.isoformat())
            or today.isoformat() <= b["dueDate"] <= limit
        )
    ]
    return sorted(rows, key=lambda b: (b["dueDate"], b["number"]))


def call(**args):
    """The tool's result, decoded: it is always a JSON object."""
    return json.loads(request_approval.invoke(args))


def test_the_seed_has_bills_to_approve(shared_store):
    assert len(in_scope(shared_store)) > 0


def test_card_total_comes_from_the_store(shared_store, interrupt_spy, custom_events):
    bills = in_scope(shared_store)
    call(type="supplier_payment", **SCOPE)
    (sent,) = interrupt_spy.calls
    assert sent["action"] == "request_approval"
    assert sent["args"]["type"] == "supplier_payment"
    assert sent["args"]["totalAmount"] == sum(b["amount"] for b in bills)
    assert [row["id"] for row in sent["args"]["bills"]] == [b["id"] for b in bills]
    assert sent["args"]["billIds"] == [b["id"] for b in bills]
    assert all("supplier" in row and "dueDate" in row for row in sent["args"]["bills"])


def test_the_model_cannot_pass_figures_or_bill_ids(shared_store):
    assert set(request_approval.args) == {"type", "due_within_days", "include_overdue", "items", "action"}


def test_rejection_changes_nothing(shared_store, interrupt_spy, custom_events):
    interrupt_spy.answer = {"approved": False, "message": "no"}
    before = shared_store.snapshot()
    result = call(type="supplier_payment", **SCOPE)
    assert result["outcome"] == "rejected"
    assert result["count"] == len(in_scope(shared_store))
    assert shared_store.snapshot() == before
    assert custom_events == []


@pytest.mark.parametrize("answer", ["not json", "[]", {"approved": "yes"}, {"message": "ok"}, None])
def test_an_unclear_answer_is_a_refusal(shared_store, interrupt_spy, custom_events, answer):
    interrupt_spy.answer = answer
    before = shared_store.snapshot()
    assert call(type="supplier_payment", **SCOPE)["outcome"] == "rejected"
    assert shared_store.snapshot() == before


@pytest.mark.parametrize("encoded", [False, True])
def test_approval_pays_and_emits_changes(shared_store, interrupt_spy, custom_events, encoded):
    bills = in_scope(shared_store)
    total = sum(b["amount"] for b in bills)
    before = shared_store.totals()
    answer = {"approved": True, "billIds": [b["id"] for b in bills]}
    interrupt_spy.answer = json.dumps(answer) if encoded else answer
    interrupt_spy.echo_bill_ids = False
    result = call(type="supplier_payment", **SCOPE)
    after = shared_store.totals()
    assert before["cash"] - after["cash"] == total
    assert before["accountsPayable"] - after["accountsPayable"] == total
    assert result["outcome"] == "approved"
    assert f"${total:,}" in result["message"]
    assert custom_events == [
        (
            ERP_DATA_CHANGED_EVENT,
            {"changes": [{"metric": "Cash", "delta": -total}, {"metric": "Accounts Payable", "delta": -total}]},
        )
    ]


def test_result_is_json_with_count_and_total(shared_store, interrupt_spy, custom_events):
    bills = in_scope(shared_store)
    before = shared_store.totals()
    result = call(type="supplier_payment", **SCOPE)
    paid = before["cash"] - shared_store.totals()["cash"]
    assert set(result) == {"outcome", "type", "count", "total", "message"}
    assert result["outcome"] == "approved" and result["type"] == "supplier_payment"
    assert result["count"] == len(bills)
    assert isinstance(result["total"], int) and result["total"] == paid


def test_selection_includes_overdue_bills_when_asked(shared_store, interrupt_spy, custom_events):
    today = shared_store.as_of.isoformat()
    overdue = [b["id"] for b in shared_store.snapshot()["bills"] if b["status"] == "overdue"]
    assert overdue, "the seed holds an overdue bill"
    interrupt_spy.answer = {"approved": False}
    call(type="supplier_payment", due_within_days=7, include_overdue=True)
    assert set(overdue) <= set(interrupt_spy.calls[-1]["args"]["billIds"])
    call(type="supplier_payment", due_within_days=7, include_overdue=False)
    shown = interrupt_spy.calls[-1]["args"]["bills"]
    assert shown and all(row["dueDate"] >= today for row in shown)
    assert not set(overdue) & {row["id"] for row in shown}


def test_nothing_in_scope_sends_no_card(shared_store, interrupt_spy, custom_events):
    shared_store.pay_bills([b["id"] for b in in_scope(shared_store)])
    before = shared_store.snapshot()
    result = call(type="supplier_payment", **SCOPE)
    assert result["outcome"] == "nothing" and result["count"] == 0 and result["total"] == 0
    assert interrupt_spy.calls == []
    assert custom_events == []
    assert shared_store.snapshot() == before


@pytest.mark.parametrize("days", [-1, 32])
def test_an_out_of_range_window_is_refused_without_a_card(shared_store, interrupt_spy, custom_events, days):
    result = call(type="supplier_payment", due_within_days=days, include_overdue=True)
    assert result["outcome"] == "refused" and "0" in result["message"] and "31" in result["message"]
    assert interrupt_spy.calls == []
    assert custom_events == []


def test_a_payment_the_operating_account_cannot_cover_shows_no_card(shared_store, interrupt_spy, custom_events):
    with shared_store._lock:
        next(a for a in shared_store._data["accounts"] if a["code"] == "1000")["balance"] = 100
    before = shared_store.snapshot()
    result = call(type="supplier_payment", **SCOPE)
    assert result["outcome"] == "refused"
    assert "operating account (1000) holds $100" in result["message"]
    assert f"${shared_store.totals()['cash']:,}" in result["message"]
    assert interrupt_spy.calls == []
    assert custom_events == []
    assert shared_store.snapshot() == before


def test_no_scope_and_no_items_are_refused(shared_store, interrupt_spy):
    assert call(type="supplier_payment")["outcome"] == "refused"
    assert call(type="inventory_reorder")["outcome"] == "refused"
    assert interrupt_spy.calls == []


def test_nothing_is_written_before_the_interrupt(shared_store, monkeypatch, custom_events):
    seen = {}

    def inspect(message=None, action=None, args=None):
        seen["snapshot"] = shared_store.snapshot()
        return "{}", {"approved": False}

    before = shared_store.snapshot()
    monkeypatch.setattr(frontend_tools, "copilotkit_interrupt", inspect)
    call(type="supplier_payment", **SCOPE)
    assert seen["snapshot"] == before
    assert shared_store.snapshot() == before
    assert custom_events == []


def test_reexecution_after_resume_does_not_pay_twice(shared_store, interrupt_spy, custom_events):
    first = call(type="supplier_payment", **SCOPE)
    after_first = shared_store.totals()
    # The graph runs the tool body again; whatever was due is settled, so it stops at the selection.
    again = call(type="supplier_payment", **SCOPE)
    assert first["outcome"] == "approved"
    assert again["outcome"] == "nothing"
    assert shared_store.totals() == after_first
    assert len(custom_events) == 1


def _paused_payment_graph():
    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.graph import END, START, StateGraph
    from typing_extensions import TypedDict

    class State(TypedDict, total=False):
        result: str

    def pay(state: State, config: RunnableConfig) -> State:
        return {"result": request_approval.invoke({"type": "supplier_payment", **SCOPE}, config)}

    builder = StateGraph(State)
    builder.add_node("pay", pay)
    builder.add_edge(START, "pay")
    builder.add_edge("pay", END)
    graph = builder.compile(checkpointer=MemorySaver())
    thread = {"configurable": {"thread_id": "retry"}}
    paused = graph.invoke({}, thread)
    (interrupt,) = paused["__interrupt__"]
    return graph, thread, interrupt.value["__copilotkit_interrupt_value__"]["args"]


def test_a_replayed_run_after_a_graph_resume_pays_once(shared_store, custom_events):
    """Real interrupt and resume on a checkpointed graph, then the same tool call again."""
    from langgraph.types import Command

    total = sum(b["amount"] for b in in_scope(shared_store))
    cash_before = shared_store.totals()["cash"]

    graph, thread, card = _paused_payment_graph()
    assert card["totalAmount"] == total
    assert shared_store.totals()["cash"] == cash_before

    resumed = graph.invoke(Command(resume={"approved": True, "billIds": card["billIds"]}), thread)
    assert "__interrupt__" not in resumed
    result = json.loads(resumed["result"])
    assert result["outcome"] == "approved" and result["total"] == total
    assert shared_store.totals()["cash"] == cash_before - total

    # A retry runs the node body again on the same thread: it stops at the selection.
    replayed = graph.invoke({}, thread)
    assert "__interrupt__" not in replayed
    assert json.loads(replayed["result"])["outcome"] == "nothing"
    assert shared_store.totals()["cash"] == cash_before - total
    assert len(custom_events) == 1


def test_resume_pays_only_the_bills_shown_on_the_card(shared_store, custom_events):
    from langgraph.types import Command

    graph, thread, card = _paused_payment_graph()
    shown = card["billIds"]
    # Part of the shown bills is paid before the answer arrives: only the rest is paid.
    shared_store.pay_bills(shown[:1])
    rest = in_scope(shared_store)
    assert {b["id"] for b in rest} <= set(shown)
    cash_before = shared_store.totals()["cash"]
    resumed = graph.invoke(Command(resume={"approved": True, "billIds": shown}), thread)
    result = json.loads(resumed["result"])
    expected = sum(b["amount"] for b in rest)
    assert result["count"] == len(rest) and result["total"] == expected
    assert shared_store.totals()["cash"] == cash_before - expected


def test_resume_refuses_a_selection_that_grew_since_the_card(shared_store, custom_events):
    from langgraph.types import Command

    graph, thread, card = _paused_payment_graph()
    shown = set(card["billIds"])
    # A bill outside the card falls due before the answer arrives.
    with shared_store._lock:
        stray = next(b for b in shared_store._data["bills"] if b["status"] != "paid" and b["id"] not in shown)
        stray["dueDate"] = shared_store.as_of.isoformat()
    before = shared_store.snapshot()
    resumed = graph.invoke(Command(resume={"approved": True, "billIds": sorted(shown)}), thread)
    result = json.loads(resumed["result"])
    assert result["outcome"] == "nothing"
    assert result["message"] == "The selection changed; nothing was paid. Ask again."
    assert shared_store.snapshot() == before
    assert custom_events == []


def test_an_approval_without_bill_ids_pays_nothing(shared_store, interrupt_spy, custom_events):
    interrupt_spy.echo_bill_ids = False
    before = shared_store.snapshot()
    result = call(type="supplier_payment", **SCOPE)
    assert result["outcome"] == "nothing"
    assert result["message"] == "The selection changed; nothing was paid. Ask again."
    assert shared_store.snapshot() == before
    assert custom_events == []


def test_forged_bill_ids_cannot_widen_the_scope(shared_store, interrupt_spy, custom_events):
    interrupt_spy.echo_bill_ids = False
    selected = [b["id"] for b in in_scope(shared_store)]
    others = [b["id"] for b in shared_store.snapshot()["bills"] if b["status"] != "paid" and b["id"] not in selected]
    interrupt_spy.answer = {"approved": True, "billIds": selected + others}
    result = call(type="supplier_payment", **SCOPE)
    assert result["outcome"] == "approved" and result["count"] == len(selected)
    still_unpaid = {b["id"] for b in shared_store.snapshot()["bills"] if b["status"] != "paid"}
    assert set(others) <= still_unpaid


def test_a_resume_that_finds_the_bills_paid_in_between_applies_nothing(
    shared_store, monkeypatch, custom_events
):
    ids = [b["id"] for b in in_scope(shared_store)]

    def answer_after_a_concurrent_payment(message=None, action=None, args=None):
        shared_store.pay_bills(ids)
        return "{}", {"approved": True, "billIds": ids}

    monkeypatch.setattr(frontend_tools, "copilotkit_interrupt", answer_after_a_concurrent_payment)
    result = call(type="supplier_payment", **SCOPE)
    assert result["outcome"] == "nothing" and "already paid" in result["message"]
    assert custom_events == []


def test_reorder_marks_items_on_order_and_emits(shared_store, interrupt_spy, custom_events):
    item = next(i for i in shared_store.snapshot()["inventoryItems"] if i["status"] != "in-stock")
    before = shared_store.totals()
    result = call(type="inventory_reorder", items=[{"sku": item["sku"], "quantity": 5}])
    (sent,) = interrupt_spy.calls
    assert sent["args"]["estimatedTotal"] == 5 * item["unitCost"]
    assert sent["args"]["items"][0]["currentQty"] == item["quantity"]
    assert result["outcome"] == "approved" and result["type"] == "inventory_reorder"
    assert result["count"] == 1 and result["total"] == 5 * item["unitCost"]
    marked = next(i for i in shared_store.snapshot()["inventoryItems"] if i["sku"] == item["sku"])
    assert marked["onOrder"] == 5
    assert shared_store.totals() == before
    assert custom_events == [(ERP_DATA_CHANGED_EVENT, {"changes": []})]


def test_reorder_rejection_changes_nothing(shared_store, interrupt_spy, custom_events):
    interrupt_spy.answer = {"approved": False}
    item = shared_store.snapshot()["inventoryItems"][0]
    before = shared_store.snapshot()
    result = call(type="inventory_reorder", items=[{"sku": item["sku"], "quantity": 5}])
    assert result["outcome"] == "rejected" and result["count"] == 1
    assert shared_store.snapshot() == before


def test_unknown_sku_is_refused_without_a_card(shared_store, interrupt_spy):
    result = call(type="inventory_reorder", items=[{"sku": "NOPE-1", "quantity": 5}])
    assert result["outcome"] == "refused" and "NOPE-1" in result["message"]
    assert interrupt_spy.calls == []


def test_the_event_reaches_the_event_stream(shared_store, interrupt_spy):
    """Through a real run, the change arrives as a custom event named erp_data_changed."""
    wrapper = RunnableLambda(
        lambda _, config: request_approval.invoke({"type": "supplier_payment", **SCOPE}, config)
    )

    async def collect():
        return [e async for e in wrapper.astream_events("go", version="v2")]

    events = [
        e for e in asyncio.run(collect())
        if e["event"] == "on_custom_event" and e["name"] == ERP_DATA_CHANGED_EVENT
    ]
    assert len(events) == 1
    assert {c["metric"] for c in events[0]["data"]["changes"]} == {"Cash", "Accounts Payable"}


@pytest.mark.parametrize("bad_window", ["soon", [7], 3.5], ids=["text", "list", "fraction"])
def test_a_malformed_window_reaches_the_model_as_a_tool_message(shared_store, interrupt_spy, custom_events, bad_window):
    """Through the real tool node: a readable error message, a finished run, no card."""
    from langchain.agents import create_agent
    from langchain_core.messages import HumanMessage, ToolMessage

    from tests.fakes import ScriptedToolCaller

    model = ScriptedToolCaller(
        script=[("request_approval", {"type": "supplier_payment", "due_within_days": bad_window})]
    )
    agent = create_agent(model=model, tools=[request_approval])
    cash = shared_store.totals()["cash"]

    result = agent.invoke({"messages": [HumanMessage(content="pay")]})

    assert "__interrupt__" not in result
    (tool_message,) = [m for m in result["messages"] if isinstance(m, ToolMessage)]
    assert tool_message.status == "error" or "due_within_days" in tool_message.content
    assert "due_within_days" in tool_message.content
    assert interrupt_spy.calls == []
    assert custom_events == []
    assert shared_store.totals()["cash"] == cash
