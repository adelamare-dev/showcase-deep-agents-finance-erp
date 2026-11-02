from __future__ import annotations

import json
import re

import pytest

import erp_store
import tools


@pytest.fixture
def tool_store(store, monkeypatch):
    """Point the shared store the tools read at the parametrized one."""
    monkeypatch.setattr(erp_store, "_store", store)
    return store


def test_query_tools_read_the_store(tool_store):
    snap = tool_store.snapshot()
    assert json.loads(tools.query_invoices.invoke({})) == snap["invoices"]
    assert json.loads(tools.query_bills.invoke({})) == snap["bills"]
    assert json.loads(tools.query_accounts.invoke({})) == snap["accounts"]
    assert json.loads(tools.query_inventory.invoke({})) == snap["inventoryItems"]
    assert json.loads(tools.query_employees.invoke({})) == snap["employees"]
    assert json.loads(tools.query_transactions.invoke({"limit": 3})) == snap["transactions"][:3]
    assert json.loads(tools.query_ar_aging.invoke({})) == snap["arAging"]
    assert json.loads(tools.query_budget_vs_actual.invoke({})) == snap["budgetVsActual"]


def test_query_bills_filters_by_status(tool_store):
    for status in ("paid", "pending", "overdue"):
        rows = json.loads(tools.query_bills.invoke({"status": status}))
        assert rows == [b for b in tool_store.snapshot()["bills"] if b["status"] == status]
    assert json.loads(tools.query_bills.invoke({"status": "paid"}))


def test_query_filters_on_other_datasets(tool_store):
    snap = tool_store.snapshot()
    overdue = json.loads(tools.query_invoices.invoke({"status": "overdue"}))
    assert overdue and all(i["status"] == "overdue" for i in overdue)
    dept = json.loads(tools.query_employees.invoke({"department": "finance"}))
    assert dept == [e for e in snap["employees"] if e["department"] == "Finance"]
    low = json.loads(tools.query_inventory.invoke({"status": "low-stock"}))
    assert low and all(i["status"] == "low-stock" for i in low)


def test_tools_follow_a_mutation_of_the_store(tool_store):
    with tool_store._lock:
        tool_store._data["bills"][0]["status"] = "paid"
    rows = json.loads(tools.query_bills.invoke({"status": "paid"}))
    assert tool_store._data["bills"][0]["id"] in {b["id"] for b in rows}


@pytest.mark.parametrize("quarters", [1, 4, 5, 6, 8, 12])
def test_scenario_analysis_accepts_more_than_four_quarters(tool_store, quarters):
    for metric in ("revenue", "profit", "cash_flow"):
        out = json.loads(tools.run_scenario_analysis.invoke({"metric": metric, "quarters": quarters}))
        expected = min(quarters, tools.MAX_FORECAST_QUARTERS)
        for scenario in out["scenarios"].values():
            assert len(scenario) == expected
        labels = [p["quarter"] for p in out["scenarios"]["base"]]
        assert labels[0] == erp_store.quarter_label(tool_store.as_of, 1)
        assert labels == [erp_store.quarter_label(tool_store.as_of, n + 1) for n in range(expected)]


def test_forecasts_label_quarters_after_as_of(tool_store):
    first = erp_store.quarter_label(tool_store.as_of, 1)
    for method in ("linear", "seasonal"):
        out = json.loads(tools.compute_revenue_forecast.invoke({"quarters": 6, "method": method}))
        assert out["projections"][0]["quarter"] == first
        assert len(out["projections"]) == 6
    cash = json.loads(tools.compute_cash_flow_forecast.invoke({"quarters": 4}))
    assert cash["projections"][0]["quarter"] == first
    assert cash["current_cash"] == tool_store.totals()["cash"]
    assert first in tools.forecast_revenue.invoke({})


def test_reports_quote_store_figures(tool_store):
    totals = tool_store.totals()
    summary = tools.generate_financial_report.invoke({"report_type": "summary"})
    assert f"${totals['cash']:,.0f}" in summary
    assert f"${totals['revenue']:,.0f}" in summary
    # Columns are right-aligned with padding after the dollar sign.
    def squeeze(text):
        return re.sub(r"\$\s+", "$", text)

    sheet = squeeze(tools.generate_financial_report.invoke({"report_type": "balance_sheet"}))
    assert f"${totals['assets']:,.0f}" in sheet
    income = squeeze(tools.generate_financial_report.invoke({"report_type": "income_statement"}))
    assert f"${totals['netProfit']:,.0f}" in income


def test_every_exported_tool_runs_on_the_store(tool_store):
    for tool in {t.name: t for t in tools.research_tools + tools.projections_tools}.values():
        assert isinstance(tool.invoke({}), str)


def test_tools_module_holds_no_data():
    assert not [n for n in vars(tools) if n.startswith("_") and n.isupper()]
