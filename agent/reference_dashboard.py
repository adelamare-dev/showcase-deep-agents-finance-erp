"""The reference dashboard, built from the books by rules alone.

When the model is saturated the code composes the dashboard the reference
request asks for: it reads the store, lists the steps it really ran, and hands
back the widgets for `update_dashboard`. No figure is written here; the widgets
carry options only, and the web fills them from the store.
"""

from __future__ import annotations

from typing import Any

from erp_aggregates import cash_and_payables
from erp_datasets import build_dataset

# The context entry the web sends with the text of the reference suggestion.
REFERENCE_CONTEXT_DESCRIPTION = "Reference dashboard request"

# The widgets the Dashboard rule of the prompt asks for, with the options its
# text and the `update_dashboard` description name.
REFERENCE_WIDGETS: list[dict[str, Any]] = [
    {"type": "metric_cards", "config": {"metrics": ["Cash", "Accounts Payable"]}},
    {"type": "ar_aging_gauge"},
    {"type": "invoices", "config": {"kind": "payable"}},
    {
        "type": "custom_chart",
        "config": {"dataset": "cash_flow_forecast", "quarters": 4, "title": "Cash Flow Forecast"},
    },
]

# The supplier bills the dashboard lists: due within a week, overdue included.
BILLS_DUE_WITHIN_DAYS = 7
FORECAST_QUARTERS = 4


def _normal(text: str) -> str:
    return " ".join(text.split()).lower()


def is_reference_request(user_text: str, reference_text: str | None) -> bool:
    """True when the user's text is the reference request, typed or clicked.

    Both texts are compared after trimming, collapsing white space and
    lower-casing.
    """
    if not user_text or not reference_text:
        return False
    return _normal(user_text) == _normal(reference_text)


def build_reference_dashboard(store) -> dict[str, Any]:
    """Run the steps that back the reference dashboard and return it.

    Each step reads the store; `steps` lists them in order with the arguments
    shown to the user and the result they produced.
    """
    snap = store.snapshot()
    steps = [
        {"tool": "cash_and_payables", "args": "", "result": cash_and_payables(snap)},
        {"tool": "query_ar_aging", "args": "", "result": snap["arAging"]},
        {
            "tool": "bills_for_approval",
            "args": f"due_within_days={BILLS_DUE_WITHIN_DAYS}, include_overdue=true",
            "result": store.bills_for_approval(BILLS_DUE_WITHIN_DAYS, True),
        },
        {
            "tool": "build_dataset",
            "args": f"cash_flow_forecast, quarters={FORECAST_QUARTERS}",
            "result": build_dataset(store, "cash_flow_forecast", quarters=FORECAST_QUARTERS),
        },
    ]
    return {"widgets": REFERENCE_WIDGETS, "steps": steps}
