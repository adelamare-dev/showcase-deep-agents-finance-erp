from __future__ import annotations

import erp_store
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
    assert refused.startswith("Dashboard not updated")
    inline = {"type": "custom_chart", "config": {"dataset": "ar_aging", "data": [{"label": "a", "value": 1}]}}
    assert update_dashboard.invoke({"widgets": [inline]}).startswith("Dashboard not updated")
    ok = {"type": "custom_chart", "config": {"dataset": "ar_aging"}}
    assert update_dashboard.invoke({"widgets": [ok]}) == "Dashboard updated: custom_chart"


def test_render_chat_visual_reports_the_catalog_figures(store, monkeypatch):
    monkeypatch.setattr(erp_store, "_store", store)
    out = render_chat_visual.invoke({"dataset": "cash_position"})
    assert str(store.totals()["cash"]) in out
    assert render_chat_visual.invoke({"dataset": "nope"}).startswith("Cannot render")
    assert render_chat_visual.invoke({"dataset": "ar_aging", "quarters": 99}).startswith("Cannot render")
