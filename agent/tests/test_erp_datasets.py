from __future__ import annotations

import json

import pytest

import erp_datasets
import erp_store
import tools
from erp_calendar import quarter_label
from erp_datasets import DATASET_IDS, METRICS, build_dataset

CHART_KEYS = {"title", "chartType", "data", "series", "formatValues"}
CASH_KEYS = {"title", "accounts", "totalCash", "totalLiabilities", "netPosition"}


@pytest.mark.parametrize("dataset_id", DATASET_IDS)
def test_every_dataset_builds(store, dataset_id):
    built = build_dataset(store, dataset_id)
    assert built
    if dataset_id == "cash_position":
        assert set(built) == CASH_KEYS
    else:
        assert set(built) == CHART_KEYS
        assert built["data"]
        assert built["chartType"] in ("area", "bar", "line")
        series_keys = [s["key"] for s in built["series"]]
        for row in built["data"]:
            assert isinstance(row["label"], str)
            assert set(row) == {"label", *series_keys}
            assert all(type(row[k]) is int for k in series_keys)


def test_cash_position_matches_totals(store):
    built = build_dataset(store, "cash_position")
    totals = store.totals()
    assert built["totalCash"] == totals["cash"]
    assert built["totalLiabilities"] == totals["liabilities"]
    assert built["netPosition"] == totals["cash"] - totals["liabilities"]
    assert sum(a["balance"] for a in built["accounts"]) == totals["cash"]


def test_cash_position_follows_a_mutation_of_the_store(store):
    before = build_dataset(store, "cash_position")["totalLiabilities"]
    bill = next(b for b in store._data["bills"] if b["status"] == "pending")
    with store._lock:
        bill["status"] = "paid"
    after = build_dataset(store, "cash_position")["totalLiabilities"]
    assert after == before - bill["amount"]


def test_history_datasets_come_from_the_snapshot(store):
    snap = store.snapshot()
    revenue = build_dataset(store, "revenue_by_quarter", quarters=3)
    assert [r["label"] for r in revenue["data"]] == [q["quarter"] for q in snap["quarterlyRevenue"][-3:]]
    assert [r["value"] for r in revenue["data"]] == [q["revenue"] for q in snap["quarterlyRevenue"][-3:]]
    flow = build_dataset(store, "cash_flow_by_quarter", quarters=8)
    assert [r["value4"] for r in flow["data"]] == [q["net"] for q in snap["cashFlowData"]]
    expenses = build_dataset(store, "expense_breakdown")
    assert [r["value"] for r in expenses["data"]] == [e["amount"] for e in snap["expenseBreakdown"]]
    aging = build_dataset(store, "ar_aging")
    assert sum(r["value"] for r in aging["data"]) == snap["arAging"]["total"]
    budget = build_dataset(store, "budget_variance")
    assert [r["value2"] for r in budget["data"]] == [b["actual"] for b in snap["budgetVsActual"]]


@pytest.mark.parametrize("quarters", [1, 4, 8])
def test_forecast_datasets_label_quarters_after_as_of(store, quarters):
    expected = [quarter_label(store.as_of, n + 1) for n in range(quarters)]
    for dataset_id in ("revenue_forecast", "cash_flow_forecast", "scenario_analysis"):
        built = build_dataset(store, dataset_id, quarters=quarters)
        assert [r["label"] for r in built["data"]] == expected


def test_revenue_forecast_is_what_the_snapshot_serves(store):
    snap = store.snapshot()
    built = build_dataset(store, "revenue_forecast", quarters=erp_datasets.FORECAST_QUARTERS)
    for scenario, key in zip(snap["revenueScenarios"], ("value", "value2", "value3")):
        assert [r[key] for r in built["data"]] == [v["value"] for v in scenario["values"]]
        assert scenario["color"] in {s["color"] for s in built["series"]}


def test_growth_pct_moves_the_forecasts(store):
    for dataset_id in ("revenue_forecast", "cash_flow_forecast", "scenario_analysis"):
        flat = build_dataset(store, dataset_id, quarters=4)
        up = build_dataset(store, dataset_id, quarters=4, growth_pct=10)
        down = build_dataset(store, dataset_id, quarters=4, growth_pct=-10)
        last = lambda built: built["data"][-1]["value"]  # noqa: E731
        assert last(down) < last(flat) < last(up)


@pytest.mark.parametrize("metric", METRICS)
def test_scenario_analysis_handles_eight_quarters(store, metric):
    built = build_dataset(store, "scenario_analysis", quarters=8, metric=metric)
    assert len(built["data"]) == 8
    assert [s["label"] for s in built["series"]] == ["Optimistic", "Base", "Conservative"]


def test_projection_tools_return_what_the_catalog_computes(store, monkeypatch):
    monkeypatch.setattr(erp_store, "_store", store)
    snap = store.snapshot()
    scenario = json.loads(tools.run_scenario_analysis.invoke({"metric": "profit", "quarters": 6}))
    built = build_dataset(store, "scenario_analysis", quarters=6, metric="profit")
    assert [r["value2"] for r in built["data"]] == [p["value"] for p in scenario["scenarios"]["base"]]
    cash = json.loads(tools.compute_cash_flow_forecast.invoke({"quarters": 6}))
    built = build_dataset(store, "cash_flow_forecast", quarters=6)
    assert [r["value"] for r in built["data"]] == [p["net"] for p in cash["projections"]]
    assert [r["value2"] for r in built["data"]] == [p["projected_cash_balance"] for p in cash["projections"]]
    assert cash["current_cash"] == snap["totals"]["cash"]


@pytest.mark.parametrize("kw", [{"quarters": 0}, {"quarters": 9}, {"quarters": -1}, {"quarters": 2.5}])
def test_quarters_out_of_range_are_rejected(store, kw):
    with pytest.raises(ValueError, match="quarters"):
        build_dataset(store, "revenue_by_quarter", **kw)


@pytest.mark.parametrize("kw", [{"growth_pct": 51}, {"growth_pct": -50.5}, {"growth_pct": float("nan")}])
def test_growth_pct_out_of_range_is_rejected(store, kw):
    with pytest.raises(ValueError, match="growth_pct"):
        build_dataset(store, "revenue_forecast", **kw)


def test_bounds_are_inclusive(store):
    for kw in ({"quarters": 1}, {"quarters": 8}, {"growth_pct": 50}, {"growth_pct": -50}):
        assert build_dataset(store, "revenue_forecast", **kw)


def test_unknown_dataset_and_metric_are_rejected(store):
    with pytest.raises(ValueError, match="Unknown dataset"):
        build_dataset(store, "payroll_secrets")
    with pytest.raises(ValueError, match="metric"):
        build_dataset(store, "scenario_analysis", metric="headcount")


def test_cash_position_is_built_from_one_snapshot(store, monkeypatch):
    # Accounts and totals must come from the same read: a second read of the
    # store could see a payment the first one did not.
    def refuse(*args, **kwargs):
        raise AssertionError("cash_position must not read the store a second time")

    monkeypatch.setattr(store, "cash_accounts", refuse)
    built = build_dataset(store, "cash_position")
    assert sum(a["balance"] for a in built["accounts"]) == built["totalCash"]
