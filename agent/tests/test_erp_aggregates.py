from __future__ import annotations

import json
import re
from collections import defaultdict

import pytest

import erp_store
import tools
from erp_aggregates import cash_and_payables, headcount_and_payroll, receivables_by_client
from erp_datasets import build_dataset


def test_receivables_exclude_drafts_and_paid(store):
    snap = store.snapshot()
    out = receivables_by_client(snap)
    open_invoices = [i for i in snap["invoices"] if i["status"] in ("pending", "overdue")]
    assert {i["status"] for i in snap["invoices"]} >= {"draft", "paid"}
    assert out["total"] == sum(i["amount"] for i in open_invoices)
    assert out["total"] == snap["totals"]["accountsReceivable"]
    assert sum(c["invoiceCount"] for c in out["clients"]) == len(open_invoices)
    overdue = sum(i["amount"] for i in snap["invoices"] if i["status"] == "overdue")
    assert out["overdueTotal"] == overdue
    assert out["overdueSharePct"] == round(overdue / out["total"] * 100, 1)


def test_receivables_are_sorted_and_sum_per_client(store):
    snap = store.snapshot()
    amount, overdue, count = defaultdict(int), defaultdict(int), defaultdict(int)
    for i in snap["invoices"]:
        if i["status"] in ("pending", "overdue"):
            amount[i["client"]] += i["amount"]
            count[i["client"]] += 1
            if i["status"] == "overdue":
                overdue[i["client"]] += i["amount"]
    expected = sorted(amount, key=lambda c: (-amount[c], c))
    clients = receivables_by_client(snap)["clients"]
    assert [c["client"] for c in clients] == expected
    for row in clients:
        assert row["amount"] == amount[row["client"]]
        assert row["invoiceCount"] == count[row["client"]]
        assert row["overdueAmount"] == overdue[row["client"]]


def test_headcount_counts_active_employees_only(store):
    snap = store.snapshot()
    active = [e for e in snap["employees"] if e["status"] == "active"]
    assert len(active) < len(snap["employees"])
    out = headcount_and_payroll(snap)
    assert out["headcount"] == len(active)
    assert out["totalPayroll"] == sum(e["salary"] for e in active)
    assert sum(d["headcount"] for d in out["departments"]) == out["headcount"]
    assert sum(d["payroll"] for d in out["departments"]) == out["totalPayroll"]
    payrolls = [d["payroll"] for d in out["departments"]]
    assert payrolls == sorted(payrolls, reverse=True)
    for d in out["departments"]:
        assert d["payrollSharePct"] == round(d["payroll"] / out["totalPayroll"] * 100, 1)


def test_payroll_matches_the_financial_report(store, monkeypatch):
    monkeypatch.setattr(erp_store, "_store", store)
    report = tools.generate_financial_report.invoke({"report_type": "summary"})
    printed = int(re.search(r"Active payroll: \$([\d,]+)/yr", report).group(1).replace(",", ""))
    assert headcount_and_payroll(store.snapshot())["totalPayroll"] == printed


def _check_cash_and_payables(store):
    snap = store.snapshot()
    totals = store.totals()
    unpaid = [b for b in snap["bills"] if b["status"] != "paid"]
    overdue = [b for b in unpaid if b["status"] == "overdue"]
    out = cash_and_payables(snap)
    assert out == {
        "cash": totals["cash"],
        "accountsPayable": totals["accountsPayable"],
        "openBills": len(unpaid),
        "overdueBills": len(overdue),
        "overdueBillsAmount": sum(b["amount"] for b in overdue),
        "cashAfterPayables": totals["cash"] - totals["accountsPayable"],
    }
    assert out["accountsPayable"] == sum(b["amount"] for b in unpaid)
    return unpaid


def test_cash_and_payables_match_totals_before_and_after_payment(store):
    unpaid = _check_cash_and_payables(store)
    before = cash_and_payables(store.snapshot())
    to_pay = unpaid[:2]
    assert to_pay
    store.pay_bills([b["id"] for b in to_pay])
    after = cash_and_payables(store.snapshot())
    paid = sum(b["amount"] for b in to_pay)
    assert after["accountsPayable"] == before["accountsPayable"] - paid
    assert after["openBills"] == before["openBills"] - len(to_pay)
    _check_cash_and_payables(store)


def test_aggregates_follow_reset(store):
    first = cash_and_payables(store.snapshot())
    store.pay_bills([b["id"] for b in store.snapshot()["bills"] if b["status"] != "paid"][:1])
    assert cash_and_payables(store.snapshot()) != first
    store.reset()
    assert cash_and_payables(store.snapshot()) == first


@pytest.fixture
def tool_store(store, monkeypatch):
    monkeypatch.setattr(erp_store, "_store", store)
    return store


def test_aggregate_tools_return_the_pure_functions(tool_store):
    snap = tool_store.snapshot()
    assert json.loads(tools.get_receivables_by_client.invoke({})) == receivables_by_client(snap)
    assert json.loads(tools.get_headcount_and_payroll.invoke({})) == headcount_and_payroll(snap)
    assert json.loads(tools.get_cash_and_payables.invoke({})) == cash_and_payables(snap)
    assert tools.aggregate_tools == [
        tools.get_receivables_by_client,
        tools.get_headcount_and_payroll,
        tools.get_cash_and_payables,
    ]
    assert all(t in tools.research_tools for t in tools.aggregate_tools)


def _check_expense_totals(store):
    snap = store.snapshot()
    monthly = snap["monthlyExpenseByCategory"]
    keys = ["payroll", "operations", "marketing", "infrastructure", "rnd", "other"]
    expected = {k: sum(row[k] for row in monthly) for k in keys}
    out = json.loads(tools.query_monthly_expenses.invoke({}))
    assert out["months"] == monthly
    rows = out["totals_by_category"]
    assert [r["total"] for r in rows] == sorted((r["total"] for r in rows), reverse=True)
    assert sorted(r["total"] for r in rows) == sorted(expected.values())
    assert out["total"] == sum(expected.values()) == snap["totals"]["expenses"]
    chart = {d["label"]: d["value"] for d in build_dataset(store, "expense_breakdown")["data"]}
    assert {r["category"]: r["total"] for r in rows} == chart
    for r in rows:
        assert r["share_pct"] == round(r["total"] / out["total"] * 100, 1)
    assert abs(sum(r["share_pct"] for r in rows) - 100) < 0.5
    return out


def test_expense_totals_match_the_chart_and_the_monthly_rows(tool_store):
    _check_expense_totals(tool_store)


def test_expense_totals_filter_to_one_category(tool_store):
    full = _check_expense_totals(tool_store)
    out = json.loads(tools.query_monthly_expenses.invoke({"category": "R&D"}))
    row = next(r for r in full["totals_by_category"] if r["category"] == "R&D")
    assert out["total"] == row["total"] == sum(m["R&D"] for m in out["months"])
    assert out["share_pct"] == row["share_pct"]
    assert len(out["months"]) == len(full["months"])


def test_expense_totals_follow_reset(tool_store):
    first = _check_expense_totals(tool_store)
    tool_store.reset()
    assert _check_expense_totals(tool_store) == first
