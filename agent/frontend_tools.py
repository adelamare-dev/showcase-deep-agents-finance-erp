"""Frontend tools (7 tools: 6 UI renderers and 1 human-in-the-loop).

These tools are registered at agent creation time so the model can call them
via function calling. The AG-UI adapter streams ToolCall events, which the
CopilotKit frontend matches to useFrontendTool renderers by name.

Rendering tools return a simple confirmation string.
HITL tools use copilotkit_interrupt() to pause the graph for user approval.
"""

import json
import logging
from typing import Literal, Optional, TypedDict

from langchain_core.callbacks.manager import dispatch_custom_event
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from copilotkit.langgraph import copilotkit_interrupt

from erp_datasets import DATASET_IDS, build_dataset
from erp_store import AlreadyPaid, ErpError, get_store

logger = logging.getLogger(__name__)

# Sent after an approved action changed the books; the web app reloads its data.
ERP_DATA_CHANGED_EVENT = "erp_data_changed"


def _usd(amount: int) -> str:
    return f"${amount:,}"


# ---------------------------------------------------------------------------
# 1. render_chat_visual — inline visuals in the chat
# ---------------------------------------------------------------------------


@tool
def render_chat_visual(
    dataset: str,
    quarters: int = 4,
    growth_pct: float = 0,
    metric: str = "revenue",
    chartType: Optional[str] = None,
) -> str:
    """Render a chart or the cash position card inline in the chat, filled from the ERP data.

    You choose a dataset; the figures are supplied by the system, never by you.

    Args:
        dataset: One of 'cash_position' (cash summary card), 'revenue_by_quarter',
            'cash_flow_by_quarter', 'expense_breakdown', 'ar_aging', 'budget_variance',
            'revenue_forecast', 'cash_flow_forecast', 'scenario_analysis'.
        quarters: Quarters shown, 1-8: the last N for history, the next N for forecasts. Default 4.
        growth_pct: Forecasts only. Percentage points added to the growth rate, -50 to 50. Default 0.
        metric: scenario_analysis only: 'revenue', 'profit' or 'cash_flow'. Default 'revenue'.
        chartType: Optional override: 'area' for trends, 'bar' for comparisons, 'line' for trajectories.
    """
    try:
        built = build_dataset(
            get_store(), dataset, quarters=quarters, growth_pct=growth_pct, metric=metric
        )
    except ValueError as exc:
        return f"Cannot render: {exc}"
    if dataset == "cash_position":
        figures = {k: built[k] for k in ("accounts", "totalCash", "totalLiabilities", "netPosition")}
    else:
        figures = {"series": [s["label"] for s in built["series"]], "rows": built["data"]}
    return f"Rendered '{built['title']}'. Figures: {json.dumps(figures)}"


# ---------------------------------------------------------------------------
# 2. navigate_and_filter — SPA navigation
# ---------------------------------------------------------------------------


@tool
def navigate_and_filter(page: str, filter: Optional[str] = None) -> str:
    """Navigate to an ERP page and optionally apply a filter.

    Args:
        page: Page to navigate to — dashboard, invoices, accounts, inventory, or hr.
        filter: Optional filter. Client invoices: paid|pending|overdue|draft. Supplier bills: supplier, or supplier-paid|supplier-pending|supplier-overdue. Inventory: in-stock|low-stock|out-of-stock.
    """
    msg = f"Navigated to {page}"
    if filter:
        msg += f" with filter '{filter}'"
    return msg


# ---------------------------------------------------------------------------
# 3. request_approval — human-in-the-loop
# ---------------------------------------------------------------------------


class ReorderLine(TypedDict):
    sku: str
    quantity: int


def _was_approved(response: object) -> bool:
    """True only for an explicit `approved: true`; anything unreadable counts as a refusal."""
    if isinstance(response, str):
        try:
            response = json.loads(response)
        except ValueError:
            return False
    return isinstance(response, dict) and response.get("approved") is True


def _announce_change(changes: list[dict], config: RunnableConfig) -> None:
    """Tell the web app the books changed. The change is already applied, so a failed send is only logged."""
    try:
        dispatch_custom_event(ERP_DATA_CHANGED_EVENT, {"changes": changes}, config=config)
    except Exception:
        logger.warning("could not send %s", ERP_DATA_CHANGED_EVENT, exc_info=True)


@tool
def request_approval(
    type: Literal["supplier_payment", "inventory_reorder"],
    bill_ids: Optional[list[str]] = None,
    items: Optional[list[ReorderLine]] = None,
    action: Optional[str] = None,
    *,
    config: RunnableConfig,
) -> str:
    """Ask the user to approve a supplier payment or an inventory reorder, and carry it out if approved.

    MANDATORY before paying bills or reordering stock. You pass identifiers only: the
    system loads the records, computes the total, shows the card and applies the decision.
    The user approves or rejects the whole batch. Find the bill ids with query_bills first.

    Args:
        type: 'supplier_payment' to pay supplier bills, or 'inventory_reorder' to reorder stock.
        bill_ids: (supplier_payment only) Ids of the unpaid supplier bills, e.g. 'bill-001'.
        items: (inventory_reorder only) Items to reorder. Each has sku and quantity.
        action: Optional one-line description shown on the card.
    """
    store = get_store()
    try:
        if type == "supplier_payment":
            preview = store.preview_bill_payment(bill_ids or [])
            card = {
                "type": type,
                "bills": preview["bills"],
                "totalAmount": preview["totalAmount"],
                "action": action or f"Pay {len(preview['bills'])} supplier bill(s)",
            }
        else:
            lines = [dict(line) for line in items or []]
            preview = store.preview_reorder(lines)
            card = {
                "type": type,
                "items": preview["items"],
                "estimatedTotal": preview["estimatedTotal"],
                "supplier": preview["supplier"],
            }
    except AlreadyPaid as exc:
        return f"{exc} These bills are already settled, so there is nothing to approve and nothing was changed."
    except ErpError as exc:
        return f"Not sent for approval: {exc}"

    # The graph re-runs this body on resume, so nothing is written before the
    # interrupt returns.
    _, response = copilotkit_interrupt(action="request_approval", args=card)
    if not _was_approved(response):
        return "Rejected by the user. Nothing was changed."

    try:
        if type == "supplier_payment":
            done = store.pay_bills(bill_ids or [])
            if not done["paidBillIds"]:
                return "Approved, but these bills were already paid. Nothing more was applied."
            summary = (
                f"Approved. Paid {len(done['paidBillIds'])} bill(s) totalling {_usd(done['totalPaid'])}; "
                "cash and accounts payable each fell by that amount."
            )
        else:
            done = store.reorder(lines)
            if not done["orderedSkus"]:
                return "Approved, but these items were already on order. Nothing more was applied."
            summary = (
                f"Approved. Placed an order for {len(done['orderedSkus'])} item(s), estimated "
                f"{_usd(preview['estimatedTotal'])}. Items are marked on order; cash and payables are unchanged."
            )
    except ErpError as exc:
        return f"Approved, but not applied: {exc}"
    _announce_change(done["changes"], config)
    return summary


# ---------------------------------------------------------------------------
# 4. update_dashboard — add/update dashboard widgets (batch)
# ---------------------------------------------------------------------------


@tool
def update_dashboard(widgets: list) -> str:
    """Add or update one or more dashboard widgets in a single call.

    Args:
        widgets: Array of widget configs. Each widget has:
            - type (str): Widget type — 'kpi_cards', 'revenue_chart', 'expense_breakdown',
              'transactions', 'invoices', 'custom_chart', 'cash_waterfall', 'ar_aging_gauge',
              'budget_variance', 'spend_heatmap', 'revenue_forecast' or 'metric_cards'.
            - colSpan (int, optional): Grid column span 1-4. Defaults vary by type.
            - config (dict, optional): Type-specific configuration:
              * kpi_cards: { metrics?: string[] } — KPI labels to show.
              * revenue_chart: { showProfit?: bool, showExpenses?: bool }
              * expense_breakdown: { categories?: string[] }
              * transactions: { limit?: int }
              * invoices: { kind?: 'receivable'|'payable', statuses?: ['pending', 'overdue'] }
                ('payable' lists the supplier bills we owe; the default lists client invoices.)
              * custom_chart: { dataset: str, title?: str, subtitle?: str,
                  chartType?: 'area'|'bar'|'line', quarters?: int 1-8,
                  growth_pct?: float -50 to 50, metric?: 'revenue'|'profit'|'cash_flow' }.
                The dataset is one of the render_chat_visual datasets except 'cash_position'.
                Never send figures: the chart is filled from the ERP data.
              * cash_waterfall: { mode?: 'waterfall'|'flow-comparison', quarters?: int, showNetLine?: bool,
                  title?: str, subtitle?: str } (quarterly cash flow; 'waterfall' builds up the net position)
              * ar_aging_gauge: { title?: str, warningThreshold?: float 0-1, criticalThreshold?: float 0-1 }
                (receivables by lateness with the collection rate)
              * budget_variance: { title?: str, subtitle?: str, showPercentage?: bool, categories?: string[] }
              * spend_heatmap: { title?: str, subtitle?: str, colorScale?: 'purple'|'blue'|'red',
                  categories?: ['payroll'|'operations'|'marketing'|'infrastructure'|'rnd'|'other'] }
              * revenue_forecast: { mode?: 'forecast'|'quarterly', title?: str, subtitle?: str,
                  trailingQuarters?: int, showMarginLine?: bool } ('forecast' is the three scenarios)
              * metric_cards: { metrics?: string[], stacked?: bool } — the same KPI labels as kpi_cards,
                shown as compact cards (all of them when metrics is omitted).
                None of these takes figures: never send scenarios or comparisonData.
    """
    problems = []
    for w in widgets:
        config = w.get("config") or {}
        if w.get("type") != "custom_chart":
            if "scenarios" in config or "comparisonData" in config:
                problems.append("widgets must not carry figures")
            continue
        if config.get("dataset") not in DATASET_IDS or config.get("dataset") == "cash_position":
            problems.append("custom_chart needs a dataset from the catalog")
        if "data" in config:
            problems.append("custom_chart must not carry figures")
    if problems:
        return f"Dashboard not updated: {'; '.join(sorted(set(problems)))}."
    types = [w.get("type", "widget") for w in widgets]
    return f"Dashboard updated: {', '.join(types)}"


# ---------------------------------------------------------------------------
# 5. manage_dashboard — remove, reorder, or reset
# ---------------------------------------------------------------------------


@tool
def manage_dashboard(
    action: str, widgetId: Optional[str] = None, updates: Optional[list] = None
) -> str:
    """Manage the dashboard layout.

    Args:
        action: Action to perform — 'remove' (delete a widget), 'reorder' (resize/reorder widgets),
                or 'reset' (restore default layout).
        widgetId: (remove only) ID of the widget to remove.
        updates: (reorder only) Array of updates. Each has widgetId (str), optional colSpan (1-4), optional order (int).
    """
    if action == "reset":
        return "Dashboard reset to defaults."
    if action == "remove":
        return f"Widget '{widgetId}' removed."
    if action == "reorder" and updates:
        return f"Updated {len(updates)} widget(s)."
    return f"Dashboard action '{action}' completed."


# ---------------------------------------------------------------------------
# 6. save_dashboard — persist current dashboard layout
# ---------------------------------------------------------------------------


@tool
def save_dashboard(name: str) -> str:
    """Save the current dashboard layout with a name for later retrieval.

    Args:
        name: A descriptive name for this dashboard configuration (e.g. 'Q1 Cash Flow Review').
    """
    return f"Dashboard saved as '{name}'."


# ---------------------------------------------------------------------------
# 7. load_dashboard — restore a previously saved dashboard
# ---------------------------------------------------------------------------


@tool
def load_dashboard(name: str) -> str:
    """Load a previously saved dashboard by name (fuzzy match).

    Args:
        name: Name of the saved dashboard to load.
    """
    return f"Dashboard '{name}' loaded."


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

# Tools whose execution is intercepted by CopilotKitMiddleware and forwarded to
# the frontend for rendering via useFrontendTool.
ui_tools = [
    render_chat_visual,
    navigate_and_filter,
    update_dashboard,
    manage_dashboard,
    save_dashboard,
    load_dashboard,
]

# Human-in-the-loop tools — execute on the backend via copilotkit_interrupt().
hitl_tools = [
    request_approval,
]

# All frontend tools
frontend_tools = [*ui_tools, *hitl_tools]
