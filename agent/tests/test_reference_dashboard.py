from __future__ import annotations

import json
import re

from erp_aggregates import cash_and_payables
from erp_datasets import build_dataset
from frontend_tools import update_dashboard
from prompts import ORCHESTRATOR_PROMPT
from reference_dashboard import (
    REFERENCE_CONTEXT_DESCRIPTION,
    REFERENCE_WIDGETS,
    build_reference_dashboard,
    is_reference_request,
)

HERO = (
    "Build me a cash flow risk dashboard: Cash and Accounts Payable KPIs, AR aging, "
    "supplier bills due, and a quarterly cash projection"
)


def _rule() -> str:
    return next(
        line for line in ORCHESTRATOR_PROMPT.splitlines() if line.startswith("- Dashboard / overview")
    )


def test_reference_widgets_match_the_prompt_rule():
    rule = _rule()
    by_type = {w["type"]: w.get("config", {}) for w in REFERENCE_WIDGETS}
    assert list(by_type) == ["metric_cards", "ar_aging_gauge", "invoices", "custom_chart"]

    # Each widget and option is the one the rule names for its element.
    metrics_match = re.search(r"metric_cards \(metrics (\[[^\]]*\])\)", rule)
    assert metrics_match
    metrics = json.loads(metrics_match.group(1))
    assert by_type["metric_cards"] == {"metrics": metrics}
    assert "AR aging in ar_aging_gauge" in rule and by_type["ar_aging_gauge"] == {}
    assert 'invoices with kind "payable"' in rule
    assert by_type["invoices"] == {"kind": "payable"}
    chart = re.search(r"one custom_chart on dataset (\w+) with quarters (\d+)", rule)
    assert chart
    assert by_type["custom_chart"]["dataset"] == chart.group(1)
    assert by_type["custom_chart"]["quarters"] == int(chart.group(2))

    # Every option is one the tool documents, and the tool accepts the whole list.
    doc = update_dashboard.description
    for config in by_type.values():
        for key in config:
            assert key in doc
    answer = json.loads(update_dashboard.invoke({"widgets": REFERENCE_WIDGETS, "replace": True}))
    assert answer["updated"] is True and answer["problems"] == []


def test_steps_read_the_store(store):
    built = build_reference_dashboard(store)
    snap = store.snapshot()
    results = {s["tool"]: s["result"] for s in built["steps"]}
    assert [s["tool"] for s in built["steps"]] == [
        "cash_and_payables",
        "query_ar_aging",
        "bills_for_approval",
        "build_dataset",
    ]
    assert results["cash_and_payables"] == cash_and_payables(snap)
    assert results["query_ar_aging"] == snap["arAging"]
    assert results["bills_for_approval"] == store.bills_for_approval(7, True)
    assert results["build_dataset"] == build_dataset(store, "cash_flow_forecast", quarters=4)
    assert all(isinstance(s["args"], str) for s in built["steps"])
    assert built["widgets"] == REFERENCE_WIDGETS


def test_reference_request_matches_typed_variants():
    assert REFERENCE_CONTEXT_DESCRIPTION == "Reference dashboard request"
    assert is_reference_request(HERO, HERO)
    assert is_reference_request("  build me a CASH flow risk dashboard:\n Cash and Accounts Payable KPIs,  AR aging, supplier bills due, and a quarterly cash projection  ", HERO)
    assert not is_reference_request("Show me all overdue invoices", HERO)
    assert not is_reference_request(HERO + " please", HERO)
    assert not is_reference_request(HERO, None)
    assert not is_reference_request("", "")
