from __future__ import annotations

import pytest

from erp_store import AlreadyOnOrder, AlreadyPaid, ErpError, InsufficientCash, UnknownIds


def unpaid_ids(store, count=3):
    bills = [b for b in store.snapshot()["bills"] if b["status"] != "paid"]
    return [b["id"] for b in bills[:count]]


def test_paying_bills_moves_cash_and_payables_equally(store):
    before = store.totals()
    ids = unpaid_ids(store)
    result = store.pay_bills(ids)
    after = store.totals()
    assert result["totalPaid"] > 0
    assert before["cash"] - after["cash"] == result["totalPaid"]
    assert before["accountsPayable"] - after["accountsPayable"] == result["totalPaid"]
    assert before["equity"] == after["equity"]
    assert after["assets"] == after["liabilities"] + after["equity"]
    assert result["changes"] == [
        {"metric": "Cash", "delta": -result["totalPaid"]},
        {"metric": "Accounts Payable", "delta": -result["totalPaid"]},
    ]


def test_paid_bills_are_marked_and_the_payment_is_recorded(store):
    ids = unpaid_ids(store, 2)
    transactions = len(store.snapshot()["transactions"])
    store.pay_bills(ids)
    snap = store.snapshot()
    assert {b["id"]: b["status"] for b in snap["bills"] if b["id"] in ids} == {i: "paid" for i in ids}
    assert len(snap["transactions"]) == transactions + 2
    assert snap["transactions"][0]["type"] == "debit"
    cash = sum(a["balance"] for a in snap["accounts"] if a["code"].startswith("10"))
    assert snap["totals"]["cash"] == cash


def test_paying_twice_applies_once(store):
    ids = unpaid_ids(store)
    first = store.pay_bills(ids)
    after_first = store.totals()
    second = store.pay_bills(ids)
    assert second == {"paidBillIds": [], "totalPaid": 0, "changes": []}
    assert store.totals() == after_first
    assert first["totalPaid"] > 0


def test_a_repeated_id_in_one_request_counts_once(store):
    bill = unpaid_ids(store, 1)[0]
    amount = next(b["amount"] for b in store.snapshot()["bills"] if b["id"] == bill)
    assert store.pay_bills([bill, bill])["totalPaid"] == amount


def test_a_bill_number_is_accepted_like_its_id(store):
    bill = next(b for b in store.snapshot()["bills"] if b["status"] != "paid")
    assert store.preview_bill_payment([bill["number"]])["totalAmount"] == bill["amount"]


def test_preview_changes_nothing_and_sums_the_bills(store):
    ids = unpaid_ids(store)
    before = store.snapshot()
    preview = store.preview_bill_payment(ids)
    assert store.snapshot() == before
    by_id = {b["id"]: b for b in before["bills"]}
    assert preview["totalAmount"] == sum(by_id[i]["amount"] for i in ids)
    assert [b["id"] for b in preview["bills"]] == ids


def test_preview_rejects_unknown_ids(store):
    with pytest.raises(UnknownIds, match="bill-999"):
        store.preview_bill_payment([unpaid_ids(store, 1)[0], "bill-999"])


def test_unknown_id_pays_nothing(store):
    before = store.snapshot()
    with pytest.raises(UnknownIds):
        store.pay_bills([unpaid_ids(store, 1)[0], "bill-999"])
    assert store.snapshot() == before


def test_preview_rejects_paid_bills(store):
    paid = next(b for b in store.snapshot()["bills"] if b["status"] == "paid")
    with pytest.raises(AlreadyPaid, match=paid["number"]):
        store.preview_bill_payment([paid["id"]])


def test_an_empty_request_is_refused(store):
    with pytest.raises(ErpError):
        store.preview_bill_payment([])
    with pytest.raises(ErpError):
        store.preview_reorder([])


def test_payment_beyond_the_operating_account_is_refused(store):
    with store._lock:
        next(a for a in store._data["accounts"] if a["code"] == "1000")["balance"] = 100
    before = store.snapshot()
    with pytest.raises(InsufficientCash):
        store.pay_bills(unpaid_ids(store, 1))
    assert store.snapshot() == before


def test_reset_restores_paid_bills(store):
    initial = store.snapshot()
    store.pay_bills(unpaid_ids(store))
    store.reset()
    assert store.snapshot()["bills"] == initial["bills"]
    assert store.totals() == initial["totals"]


def low_stock_order(store):
    item = next(i for i in store.snapshot()["inventoryItems"] if i["status"] != "in-stock")
    return item, [{"sku": item["sku"], "quantity": 7}]


def test_reorder_marks_on_order_without_touching_cash_or_payables(store):
    item, order = low_stock_order(store)
    before = store.totals()
    result = store.reorder(order)
    snap = store.snapshot()
    marked = next(i for i in snap["inventoryItems"] if i["sku"] == item["sku"])
    assert marked["onOrder"] == 7
    assert marked["quantity"] == item["quantity"]
    assert snap["totals"] == before
    assert result == {"orderedSkus": [item["sku"]], "changes": []}


def test_reorder_preview_prices_from_the_store(store):
    item, order = low_stock_order(store)
    preview = store.preview_reorder(order)
    assert preview["estimatedTotal"] == 7 * item["unitCost"]
    assert preview["items"] == [
        {
            "sku": item["sku"],
            "name": item["name"],
            "currentQty": item["quantity"],
            "reorderQty": 7,
            "unitCost": item["unitCost"],
        }
    ]


def test_reorder_twice_orders_once(store):
    item, order = low_stock_order(store)
    store.reorder(order)
    assert store.reorder([{"sku": item["sku"], "quantity": 99}])["orderedSkus"] == []
    assert next(i for i in store.snapshot()["inventoryItems"] if i["sku"] == item["sku"])["onOrder"] == 7
    with pytest.raises(AlreadyOnOrder):
        store.preview_reorder(order)


def test_reorder_refuses_unknown_sku_and_bad_quantity(store):
    sku = store.snapshot()["inventoryItems"][0]["sku"]
    with pytest.raises(UnknownIds, match="NOPE-1"):
        store.preview_reorder([{"sku": "NOPE-1", "quantity": 1}])
    for quantity in (0, -3, 2.5, "4", True):
        with pytest.raises(ErpError):
            store.preview_reorder([{"sku": sku, "quantity": quantity}])
