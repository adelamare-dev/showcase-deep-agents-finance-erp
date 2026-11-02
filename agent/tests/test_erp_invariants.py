from __future__ import annotations

from datetime import date, timedelta

from erp_store import ErpStore, get_store, quarter_label

BRANDS = {"Stark", "Wayne", "Umbrella", "Acme", "Globex", "Initech", "Cyberdyne", "Soylent", "Massive Dynamic"}


def names_in(value) -> set[str]:
    """Every brand name found in any string of a nested structure."""
    found, stack = set(), [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            found |= {b for b in BRANDS if b.lower() in item.lower()}
        elif isinstance(item, dict):
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return found


def test_balance_sheet_balances(store):
    t = store.totals()
    assert t["assets"] == t["liabilities"] + t["equity"]


def test_retained_earnings_is_not_negative(store):
    assert next(a for a in store.snapshot()["accounts"] if a["code"] == "3100")["balance"] > 0


def test_receivables_equal_open_client_invoices(store):
    snap = store.snapshot()
    open_total = sum(i["amount"] for i in snap["invoices"] if i["status"] in ("pending", "overdue"))
    assert snap["totals"]["accountsReceivable"] == open_total == snap["arAging"]["total"]


def test_payables_equal_unpaid_bills(store):
    snap = store.snapshot()
    unpaid = sum(b["amount"] for b in snap["bills"] if b["status"] != "paid")
    assert snap["totals"]["accountsPayable"] == unpaid


def test_cash_equals_cash_accounts(store):
    snap = store.snapshot()
    cash = sum(a["balance"] for a in snap["accounts"] if a["code"].startswith("10"))
    assert snap["totals"]["cash"] == cash


def test_inventory_account_equals_stock_value(store):
    snap = store.snapshot()
    stock = sum(i["quantity"] * i["unitCost"] for i in snap["inventoryItems"])
    assert next(a for a in snap["accounts"] if a["code"] == "1200")["balance"] == stock


def test_net_profit_is_revenue_minus_expenses(store):
    t = store.totals()
    assert t["netProfit"] == t["revenue"] - t["expenses"]
    assert all(isinstance(v, int) for v in t.values())


def test_monthly_revenue_sums_to_quarterly_revenue(store):
    snap = store.snapshot()
    months, quarters = snap["revenueData"], snap["quarterlyRevenue"][-4:]
    for k, quarter in enumerate(quarters):
        chunk = months[3 * k : 3 * k + 3]
        for field in ("revenue", "expenses", "profit"):
            assert sum(m[field] for m in chunk) == quarter[field]
    assert sum(q["revenue"] for q in quarters) == store.totals()["revenue"]


def test_expense_breakdown_sums_to_expenses(store):
    snap = store.snapshot()
    assert sum(e["amount"] for e in snap["expenseBreakdown"]) == snap["totals"]["expenses"]
    monthly = sum(v for row in snap["monthlyExpenseByCategory"] for k, v in row.items() if k != "month")
    assert monthly == snap["totals"]["expenses"]


def test_budget_actuals_match_the_current_quarter(store):
    snap = store.snapshot()
    rows = {r["category"]: r for r in snap["budgetVsActual"]}
    assert rows["Revenue"]["actual"] == snap["quarterlyRevenue"][-1]["revenue"]
    quarter_expenses = sum(r["actual"] for c, r in rows.items() if c != "Revenue")
    assert quarter_expenses == snap["quarterlyRevenue"][-1]["expenses"]


def test_quarter_labels_follow_as_of(store):
    snap = store.snapshot()
    labels = [q["quarter"] for q in snap["quarterlyRevenue"]]
    expected = [quarter_label(store.as_of, n - 7) for n in range(8)]
    assert labels == expected == [q["quarter"] for q in snap["cashFlowData"]]
    assert len(set(labels)) == 8
    assert labels[-1] == f"Q{(store.as_of.month - 1) // 3 + 1} {store.as_of.year}"
    month_names = [m["month"] for m in snap["revenueData"]]
    assert len(set(month_names)) == 12


def test_quarter_label_crosses_year_boundaries():
    assert quarter_label(date(2027, 1, 1), -1) == "Q4 2026"
    assert quarter_label(date(2026, 12, 31), 1) == "Q1 2027"
    assert quarter_label(date(2028, 2, 29), -7) == "Q2 2026"


def test_overdue_status_follows_as_of(store):
    snap = store.snapshot()
    today = store.as_of.isoformat()
    for record in snap["invoices"] + snap["bills"]:
        if record["status"] == "overdue":
            assert record["dueDate"] < today
        if record["status"] == "pending":
            assert record["dueDate"] >= today
    assert any(i["status"] == "overdue" for i in snap["invoices"])
    assert all(i["issuedDate"] <= i["dueDate"] for i in snap["invoices"] + snap["bills"])


def test_at_least_three_bills_fall_due_within_a_week(store):
    horizon = (store.as_of + timedelta(days=7)).isoformat()
    due = [
        b for b in store.snapshot()["bills"]
        if b["status"] == "pending" and store.as_of.isoformat() <= b["dueDate"] <= horizon
    ]
    assert len(due) >= 3


def test_bills_follow_the_bill_type(store):
    keys = {"id", "number", "supplier", "amount", "currency", "status", "issuedDate", "dueDate"}
    for bill in store.snapshot()["bills"]:
        assert keys <= bill.keys()
        assert bill["status"] in ("paid", "pending", "overdue")
        assert bill["currency"] == "USD"


def test_snapshot_has_the_agreed_keys(store):
    assert set(store.snapshot()) == {
        "kpis", "revenueData", "expenseBreakdown", "invoices", "bills", "accounts", "transactions",
        "inventoryItems", "employees", "quarterlyRevenue", "cashFlowData", "arAging",
        "budgetVsActual", "monthlyExpenseByCategory", "totals",
    }
    assert set(store.totals()) == {
        "cash", "accountsReceivable", "accountsPayable", "assets", "liabilities", "equity",
        "revenue", "expenses", "netProfit",
    }
    assert store.snapshot()["totals"] == store.totals()
    assert [k["label"] for k in store.snapshot()["kpis"]][-2:] == ["Cash", "Accounts Payable"]


def test_no_known_brand_names(store):
    assert not BRANDS & names_in(store.snapshot())
    assert names_in({"a": ["Wayne Enterprises"]}) == {"Wayne"}


def test_snapshot_is_a_copy(store):
    store.snapshot()["invoices"][0]["amount"] = -1
    assert store.snapshot()["invoices"][0]["amount"] > 0


def test_reset_restores_the_seed(store):
    before = store.snapshot()
    store._data["bills"][0]["status"] = "paid"
    assert store.snapshot() != before
    store.reset()
    assert store.snapshot() == before


def test_get_store_is_a_singleton():
    assert get_store() is get_store()
    assert isinstance(get_store(), ErpStore)
