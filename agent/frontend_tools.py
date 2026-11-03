"""Frontend tools (7 tools: 6 UI renderers and 1 human-in-the-loop).

These tools are registered at agent creation time so the model can call them
via function calling. The AG-UI adapter streams ToolCall events, which the
CopilotKit frontend matches to useFrontendTool renderers by name.

Rendering tools return a simple confirmation string.
HITL tools use copilotkit_interrupt() to pause the graph for user approval.
"""

import json
from typing import Optional

from langchain_core.tools import tool
from copilotkit.langgraph import copilotkit_interrupt

from erp_datasets import DATASET_IDS, build_dataset
from erp_store import get_store


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
        filter: Optional filter. Invoices: paid|pending|overdue|draft. Inventory: in-stock|low-stock|out-of-stock.
    """
    msg = f"Navigated to {page}"
    if filter:
        msg += f" with filter '{filter}'"
    return msg


# ---------------------------------------------------------------------------
# 3. request_approval — human-in-the-loop
# ---------------------------------------------------------------------------


@tool
def request_approval(
    type: str,
    invoices: Optional[list] = None,
    totalAmount: Optional[float] = None,
    action: Optional[str] = None,
    items: Optional[list] = None,
    estimatedTotal: Optional[float] = None,
    supplier: Optional[str] = None,
) -> str:
    """Request human approval for a financial action. MANDATORY before processing payments or reorders.

    Args:
        type: Approval type — 'invoice_payment' or 'inventory_reorder'.
        invoices: (invoice_payment only) Invoices to approve. Each has number, client, amount, dueDate.
        totalAmount: (invoice_payment only) Sum of all invoice amounts.
        action: (invoice_payment only) Description, e.g. 'Process payment for 3 overdue invoices'.
        items: (inventory_reorder only) Items to reorder. Each has sku, name, currentQty, reorderQty, unitCost.
        estimatedTotal: (inventory_reorder only) Total estimated cost of the purchase order.
        supplier: (inventory_reorder only) Supplier name, if known.
    """
    if type == "invoice_payment":
        answer, _ = copilotkit_interrupt(
            action="request_approval",
            args={
                "type": "invoice_payment",
                "invoices": invoices,
                "totalAmount": totalAmount,
                "action": action,
            },
        )
    else:
        answer, _ = copilotkit_interrupt(
            action="request_approval",
            args={
                "type": "inventory_reorder",
                "items": items,
                "estimatedTotal": estimatedTotal,
                "supplier": supplier or "",
            },
        )
    return answer


# ---------------------------------------------------------------------------
# 4. update_dashboard — add/update dashboard widgets (batch)
# ---------------------------------------------------------------------------


@tool
def update_dashboard(widgets: list) -> str:
    """Add or update one or more dashboard widgets in a single call.

    Args:
        widgets: Array of widget configs. Each widget has:
            - type (str): Widget type — 'kpi_cards', 'revenue_chart', 'expense_breakdown',
              'transactions', 'invoices', or 'custom_chart'.
            - colSpan (int, optional): Grid column span 1-4. Defaults vary by type.
            - config (dict, optional): Type-specific configuration:
              * kpi_cards: { metrics?: string[] } — KPI labels to show.
              * revenue_chart: { showProfit?: bool, showExpenses?: bool }
              * expense_breakdown: { categories?: string[] }
              * transactions: { limit?: int }
              * invoices: { statuses?: ['pending', 'overdue'] }
              * custom_chart: { dataset: str, title?: str, subtitle?: str,
                  chartType?: 'area'|'bar'|'line', quarters?: int 1-8,
                  growth_pct?: float -50 to 50, metric?: 'revenue'|'profit'|'cash_flow' }.
                The dataset is one of the render_chat_visual datasets except 'cash_position'.
                Never send figures: the chart is filled from the ERP data.
    """
    problems = []
    for w in widgets:
        if w.get("type") != "custom_chart":
            continue
        config = w.get("config") or {}
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
