from __future__ import annotations

import json

import erp_store
import tools
from frontend_tools import render_chat_visual, ui_tools, update_dashboard

# Names under which the model used to send figures; none may come back.
FIGURE_ARGUMENTS = {"data", "series", "accounts", "totalCash", "totalLiabilities", "netPosition"}


def test_render_chat_visual_schema_carries_no_figures():
    assert set(render_chat_visual.args) == {"dataset", "quarters", "growth_pct", "metric", "chartType"}


def test_no_rendering_tool_accepts_figures():
    for tool in ui_tools:
        assert not FIGURE_ARGUMENTS & set(tool.args), tool.name


def test_update_dashboard_doc_has_no_inline_chart_data():
    assert "data:" not in update_dashboard.description
    assert "dataset" in update_dashboard.description


def test_update_dashboard_refuses_a_chart_without_a_dataset_or_with_figures():
    refused = update_dashboard.invoke({"widgets": [{"type": "custom_chart", "config": {"title": "x"}}]})
    assert json.loads(refused)["updated"] is False
    inline = {"type": "custom_chart", "config": {"dataset": "ar_aging", "data": [{"label": "a", "value": 1}]}}
    assert json.loads(update_dashboard.invoke({"widgets": [inline]}))["updated"] is False
    ok = {"type": "custom_chart", "config": {"dataset": "ar_aging"}}
    assert json.loads(update_dashboard.invoke({"widgets": [ok]})) == {
        "updated": True, "replace": False, "widgets": ["custom_chart"], "problems": [],
    }


def test_render_chat_visual_reports_the_catalog_figures(store, monkeypatch):
    monkeypatch.setattr(erp_store, "_store", store)
    out = render_chat_visual.invoke({"dataset": "cash_position"})
    assert str(store.totals()["cash"]) in out
    assert render_chat_visual.invoke({"dataset": "nope"}).startswith("Cannot render")
    assert render_chat_visual.invoke({"dataset": "ar_aging", "quarters": 99}).startswith("Cannot render")


def test_update_dashboard_names_every_widget_type_and_refuses_figures_in_them():
    types = [
        "kpi_cards", "revenue_chart", "expense_breakdown", "transactions", "invoices", "custom_chart",
        "cash_waterfall", "ar_aging_gauge", "budget_variance", "spend_heatmap", "revenue_forecast", "metric_cards",
    ]
    for name in types:
        assert name in update_dashboard.description
    assert json.loads(update_dashboard.invoke({"widgets": [{"type": "metric_cards"}]}))["updated"] is True
    own_scenarios = {"type": "revenue_forecast", "config": {"scenarios": [{"label": "Base", "values": []}]}}
    assert json.loads(update_dashboard.invoke({"widgets": [own_scenarios]}))["updated"] is False
    own_flows = {"type": "cash_waterfall", "config": {"comparisonData": []}}
    assert json.loads(update_dashboard.invoke({"widgets": [own_flows]}))["updated"] is False


def test_update_dashboard_refuses_figures_on_a_custom_chart_too():
    for key in ("scenarios", "comparisonData"):
        chart = {"type": "custom_chart", "config": {"dataset": "revenue_forecast", key: []}}
        assert json.loads(update_dashboard.invoke({"widgets": [chart]}))["updated"] is False


def test_aggregate_tools_take_no_argument_and_are_given_to_research():
    assert [t.name for t in tools.aggregate_tools] == [
        "get_receivables_by_client",
        "get_headcount_and_payroll",
        "get_cash_and_payables",
    ]
    for tool in tools.aggregate_tools:
        assert tool.args == {}
        assert tool in tools.research_tools


def test_update_dashboard_lists_each_refused_widget():
    kpis = {"type": "metric_cards", "config": {"metrics": ["Cash"]}}
    unknown = {"type": "custom_chart", "config": {"dataset": "no_such_dataset"}}
    out = json.loads(update_dashboard.invoke({"widgets": [kpis, unknown]}))
    assert out["updated"] is False
    assert out["widgets"] == ["metric_cards", "custom_chart"]
    assert len(out["problems"]) == 1
    problem = out["problems"][0]
    assert problem["index"] == 1
    assert problem["type"] == "custom_chart"
    assert "dataset" in problem["reason"]


def test_update_dashboard_reports_whether_it_replaces_the_layout():
    kpis = {"type": "metric_cards"}
    assert json.loads(update_dashboard.invoke({"widgets": [kpis], "replace": True}))["replace"] is True
    assert json.loads(update_dashboard.invoke({"widgets": [kpis]}))["replace"] is False
    assert "replace" in update_dashboard.description
