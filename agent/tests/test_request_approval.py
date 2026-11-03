from __future__ import annotations

import asyncio
import json

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

    spy = Spy()
    spy.calls = []

    def fake(message=None, action=None, args=None):
        spy.calls.append({"action": action, "args": args})
        return json.dumps(spy.answer), spy.answer

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


def unpaid(store, count=2):
    return [b for b in store.snapshot()["bills"] if b["status"] != "paid"][:count]


def call(**args):
    return request_approval.invoke(args)


def test_card_total_comes_from_the_store(shared_store, interrupt_spy, custom_events):
    bills = unpaid(shared_store, 3)
    call(type="supplier_payment", bill_ids=[b["id"] for b in bills])
    (sent,) = interrupt_spy.calls
    assert sent["action"] == "request_approval"
    assert sent["args"]["type"] == "supplier_payment"
    assert sent["args"]["totalAmount"] == sum(b["amount"] for b in bills)
    assert [row["id"] for row in sent["args"]["bills"]] == [b["id"] for b in bills]
    assert all("supplier" in row and "dueDate" in row for row in sent["args"]["bills"])


def test_the_model_cannot_pass_figures(shared_store):
    assert set(request_approval.args) == {"type", "bill_ids", "items", "action"}


def test_rejection_changes_nothing(shared_store, interrupt_spy, custom_events):
    interrupt_spy.answer = {"approved": False, "message": "no"}
    before = shared_store.snapshot()
    result = call(type="supplier_payment", bill_ids=[b["id"] for b in unpaid(shared_store)])
    assert "Rejected" in result
    assert shared_store.snapshot() == before
    assert custom_events == []


@pytest.mark.parametrize("answer", ["not json", "[]", {"approved": "yes"}, {"message": "ok"}, None])
def test_an_unclear_answer_is_a_refusal(shared_store, interrupt_spy, custom_events, answer):
    interrupt_spy.answer = answer
    before = shared_store.snapshot()
    assert "Rejected" in call(type="supplier_payment", bill_ids=[b["id"] for b in unpaid(shared_store)])
    assert shared_store.snapshot() == before


@pytest.mark.parametrize("encoded", [False, True])
def test_approval_pays_and_emits_changes(shared_store, interrupt_spy, custom_events, encoded):
    bills = unpaid(shared_store)
    total = sum(b["amount"] for b in bills)
    before = shared_store.totals()
    interrupt_spy.answer = json.dumps({"approved": True}) if encoded else {"approved": True}
    result = call(type="supplier_payment", bill_ids=[b["id"] for b in bills])
    after = shared_store.totals()
    assert before["cash"] - after["cash"] == total
    assert before["accountsPayable"] - after["accountsPayable"] == total
    assert f"${total:,}" in result
    assert custom_events == [
        (
            ERP_DATA_CHANGED_EVENT,
            {"changes": [{"metric": "Cash", "delta": -total}, {"metric": "Accounts Payable", "delta": -total}]},
        )
    ]


def test_unknown_bill_returns_an_error_to_the_model_without_interrupt(shared_store, interrupt_spy, custom_events):
    result = call(type="supplier_payment", bill_ids=["bill-999"])
    assert "bill-999" in result and result.startswith("Not sent for approval")
    assert interrupt_spy.calls == []
    assert custom_events == []


def test_paid_bill_returns_an_error_to_the_model_without_interrupt(shared_store, interrupt_spy):
    paid = next(b for b in shared_store.snapshot()["bills"] if b["status"] == "paid")
    result = call(type="supplier_payment", bill_ids=[paid["id"]])
    assert paid["number"] in result and result.startswith("Already paid")
    assert "Not sent for approval" not in result
    assert interrupt_spy.calls == []


def test_a_payment_the_operating_account_cannot_cover_shows_no_card(shared_store, interrupt_spy, custom_events):
    with shared_store._lock:
        next(a for a in shared_store._data["accounts"] if a["code"] == "1000")["balance"] = 100
    before = shared_store.snapshot()
    result = call(type="supplier_payment", bill_ids=[b["id"] for b in unpaid(shared_store, 1)])
    assert result.startswith("Not sent for approval")
    assert "operating account (1000) holds $100" in result
    assert f"${shared_store.totals()['cash']:,}" in result
    assert interrupt_spy.calls == []
    assert custom_events == []
    assert shared_store.snapshot() == before


def test_no_bill_returns_an_error_to_the_model(shared_store, interrupt_spy):
    assert call(type="supplier_payment").startswith("Not sent for approval")
    assert call(type="inventory_reorder").startswith("Not sent for approval")
    assert interrupt_spy.calls == []


def test_reexecution_after_resume_does_not_pay_twice(shared_store, interrupt_spy, custom_events):
    bills = unpaid(shared_store)
    ids = [b["id"] for b in bills]
    call(type="supplier_payment", bill_ids=ids)
    after_first = shared_store.totals()
    # The graph runs the tool body again; the bills are settled, so it stops at the preview.
    again = call(type="supplier_payment", bill_ids=ids)
    assert again.startswith("Already paid") and "Not sent for approval" not in again
    assert shared_store.totals() == after_first
    assert len(custom_events) == 1


def test_a_replayed_run_after_a_graph_resume_pays_once(shared_store, custom_events):
    """Real interrupt and resume on a checkpointed graph, then the same tool call again."""
    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import Command
    from typing_extensions import TypedDict

    class State(TypedDict, total=False):
        result: str

    ids = [b["id"] for b in unpaid(shared_store)]
    total = sum(b["amount"] for b in unpaid(shared_store))

    def pay(state: State, config: RunnableConfig) -> State:
        return {"result": request_approval.invoke({"type": "supplier_payment", "bill_ids": ids}, config)}

    builder = StateGraph(State)
    builder.add_node("pay", pay)
    builder.add_edge(START, "pay")
    builder.add_edge("pay", END)
    graph = builder.compile(checkpointer=MemorySaver())
    thread = {"configurable": {"thread_id": "retry"}}
    cash_before = shared_store.totals()["cash"]

    paused = graph.invoke({}, thread)
    (interrupt,) = paused["__interrupt__"]
    assert interrupt.value["__copilotkit_interrupt_value__"]["args"]["totalAmount"] == total
    assert shared_store.totals()["cash"] == cash_before

    resumed = graph.invoke(Command(resume={"approved": True}), thread)
    assert "__interrupt__" not in resumed
    assert resumed["result"].startswith("Approved.")
    assert shared_store.totals()["cash"] == cash_before - total

    # A retry runs the node body again on the same thread: it stops at the preview.
    replayed = graph.invoke({}, thread)
    assert "__interrupt__" not in replayed
    assert replayed["result"].startswith("Already paid")
    assert "Not sent for approval" not in replayed["result"]
    assert shared_store.totals()["cash"] == cash_before - total
    assert len(custom_events) == 1


def test_a_resume_that_finds_the_bills_paid_in_between_applies_nothing(
    shared_store, monkeypatch, custom_events
):
    ids = [b["id"] for b in unpaid(shared_store)]

    def answer_after_a_concurrent_payment(message=None, action=None, args=None):
        shared_store.pay_bills(ids)
        return "{}", {"approved": True}

    monkeypatch.setattr(frontend_tools, "copilotkit_interrupt", answer_after_a_concurrent_payment)
    result = call(type="supplier_payment", bill_ids=ids)
    assert "already paid" in result
    assert custom_events == []


def test_reorder_marks_items_on_order_and_emits(shared_store, interrupt_spy, custom_events):
    item = next(i for i in shared_store.snapshot()["inventoryItems"] if i["status"] != "in-stock")
    before = shared_store.totals()
    call(type="inventory_reorder", items=[{"sku": item["sku"], "quantity": 5}])
    (sent,) = interrupt_spy.calls
    assert sent["args"]["estimatedTotal"] == 5 * item["unitCost"]
    assert sent["args"]["items"][0]["currentQty"] == item["quantity"]
    marked = next(i for i in shared_store.snapshot()["inventoryItems"] if i["sku"] == item["sku"])
    assert marked["onOrder"] == 5
    assert shared_store.totals() == before
    assert custom_events == [(ERP_DATA_CHANGED_EVENT, {"changes": []})]


def test_reorder_rejection_changes_nothing(shared_store, interrupt_spy, custom_events):
    interrupt_spy.answer = {"approved": False}
    item = shared_store.snapshot()["inventoryItems"][0]
    before = shared_store.snapshot()
    call(type="inventory_reorder", items=[{"sku": item["sku"], "quantity": 5}])
    assert shared_store.snapshot() == before


def test_unknown_sku_returns_an_error_to_the_model(shared_store, interrupt_spy):
    result = call(type="inventory_reorder", items=[{"sku": "NOPE-1", "quantity": 5}])
    assert "NOPE-1" in result and interrupt_spy.calls == []


def test_the_event_reaches_the_event_stream(shared_store, interrupt_spy):
    """Through a real run, the change arrives as a custom event named erp_data_changed."""
    ids = [b["id"] for b in unpaid(shared_store)]
    wrapper = RunnableLambda(
        lambda _, config: request_approval.invoke({"type": "supplier_payment", "bill_ids": ids}, config)
    )

    async def collect():
        return [e async for e in wrapper.astream_events("go", version="v2")]

    events = [
        e for e in asyncio.run(collect())
        if e["event"] == "on_custom_event" and e["name"] == ERP_DATA_CHANGED_EVENT
    ]
    assert len(events) == 1
    assert {c["metric"] for c in events[0]["data"]["changes"]} == {"Cash", "Accounts Payable"}


@pytest.mark.parametrize(
    "bad_bill_ids",
    ["bill-001", ["bill-001", 7], [None]],
    ids=["bare string", "non-string element", "null element"],
)
def test_malformed_bill_ids_reach_the_model_as_a_tool_message(shared_store, interrupt_spy, custom_events, bad_bill_ids):
    """Through the real tool node: a readable error message, a finished run, no card."""
    from langchain.agents import create_agent
    from langchain_core.messages import HumanMessage, ToolMessage

    from tests.fakes import ScriptedToolCaller

    model = ScriptedToolCaller(
        script=[("request_approval", {"type": "supplier_payment", "bill_ids": bad_bill_ids})]
    )
    agent = create_agent(model=model, tools=[request_approval])
    cash = shared_store.totals()["cash"]

    result = agent.invoke({"messages": [HumanMessage(content="pay")]})

    assert "__interrupt__" not in result
    (tool_message,) = [m for m in result["messages"] if isinstance(m, ToolMessage)]
    assert tool_message.status == "error" or "bill_ids" in tool_message.content
    assert "bill_ids" in tool_message.content
    assert interrupt_spy.calls == []
    assert custom_events == []
    assert shared_store.totals()["cash"] == cash
