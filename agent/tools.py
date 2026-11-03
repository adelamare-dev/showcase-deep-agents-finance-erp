"""ERP tools: query and analyze finance data.

Every figure comes from the ERP store (`erp_store.get_store()`); this module
holds no data of its own. Query tools return the store's records as JSON.
"""

from __future__ import annotations

import json

from langchain_core.tools import tool

import erp_datasets
from erp_store import get_store

MAX_FORECAST_QUARTERS = erp_datasets.MAX_QUARTERS


def _snapshot() -> dict:
    return get_store().snapshot()


# ---------------------------------------------------------------------------
# Invoice and bill tools
# ---------------------------------------------------------------------------


@tool
def query_invoices(status: str | None = None) -> str:
    """Query client invoices (money owed to us) as JSON. Optionally filter by status (paid, pending, overdue, draft)."""
    invoices = _snapshot()["invoices"]
    if status:
        invoices = [inv for inv in invoices if inv["status"] == status]
    return json.dumps(invoices, indent=2)


@tool
def query_bills(status: str | None = None) -> str:
    """Query supplier bills (money we owe) as JSON. Optionally filter by status (paid, pending, overdue)."""
    bills = _snapshot()["bills"]
    if status:
        bills = [b for b in bills if b["status"] == status]
    return json.dumps(bills, indent=2)


# ---------------------------------------------------------------------------
# Account tools
# ---------------------------------------------------------------------------


@tool
def query_accounts(account_type: str | None = None) -> str:
    """Query the chart of accounts as JSON. Optionally filter by type (asset, liability, equity, revenue, expense)."""
    accounts = _snapshot()["accounts"]
    if account_type:
        accounts = [a for a in accounts if a["type"] == account_type]
    return json.dumps(accounts, indent=2)


@tool
def query_transactions(limit: int = 10) -> str:
    """Query recent financial transactions from the ledger as JSON, most recent first."""
    return json.dumps(_snapshot()["transactions"][: max(limit, 0)], indent=2)


# ---------------------------------------------------------------------------
# Inventory tools
# ---------------------------------------------------------------------------


@tool
def query_inventory(status: str | None = None) -> str:
    """Query inventory items as JSON. Optionally filter by status (in-stock, low-stock, out-of-stock)."""
    items = _snapshot()["inventoryItems"]
    if status:
        items = [i for i in items if i["status"] == status]
    return json.dumps(items, indent=2)


# ---------------------------------------------------------------------------
# HR tools
# ---------------------------------------------------------------------------


@tool
def query_employees(department: str | None = None) -> str:
    """Query the employee directory as JSON. Optionally filter by department."""
    employees = _snapshot()["employees"]
    if department:
        employees = [e for e in employees if e["department"].lower() == department.lower()]
    return json.dumps(employees, indent=2)


# ---------------------------------------------------------------------------
# Analytics tools (data-driven)
# ---------------------------------------------------------------------------


@tool
def generate_financial_report(report_type: str = "summary") -> str:
    """Generate a financial report. Types: summary, balance_sheet, income_statement, cash_flow."""
    store = get_store()
    snap = store.snapshot()
    accounts, totals = snap["accounts"], snap["totals"]
    as_of = store.as_of.strftime("%B %d, %Y")

    if report_type == "balance_sheet":
        lines = [f"BALANCE SHEET — As of {as_of}\n"]
        for title, kind, total in [
            ("ASSETS", "asset", totals["assets"]),
            ("LIABILITIES", "liability", totals["liabilities"]),
            ("EQUITY", "equity", totals["equity"]),
        ]:
            lines.append(title)
            for a in accounts:
                if a["type"] == kind:
                    lines.append(f"  {a['name']:30s} ${a['balance']:>12,.0f}")
            lines.append(f"{'TOTAL ' + title:30s}   ${total:>12,.0f}\n")
        return "\n".join(lines).rstrip("\n")

    elif report_type == "income_statement":
        rev, total_exp, net_income = totals["revenue"], totals["expenses"], totals["netProfit"]
        margin = (net_income / rev * 100) if rev else 0

        lines = [
            f"INCOME STATEMENT — Trailing 12 months to {as_of}\n",
            "REVENUE",
            f"  Service Revenue             ${rev:>12,.0f}\n",
            "EXPENSES",
        ]
        for a in accounts:
            if a["type"] == "expense":
                lines.append(f"  {a['name']:30s} ${a['balance']:>12,.0f}")
        lines.append(f"{'TOTAL EXPENSES':30s}   ${total_exp:>12,.0f}\n")
        lines.append(f"NET INCOME                    ${net_income:>12,.0f}")
        lines.append(f"Profit Margin                    {margin:.1f}%")
        return "\n".join(lines)

    elif report_type == "cash_flow":
        # Use the latest quarter's cash flow as representative
        latest = snap["cashFlowData"][-1]
        return f"""CASH FLOW STATEMENT — {latest["quarter"]}

OPERATING ACTIVITIES
  Net Cash from Operations      ${latest["operating"]:>12,.0f}

INVESTING ACTIVITIES
  Net Cash from Investing       ${latest["investing"]:>12,.0f}

FINANCING ACTIVITIES
  Net Cash from Financing       ${latest["financing"]:>12,.0f}

NET CHANGE IN CASH              ${latest["net"]:>12,.0f}
"""

    else:
        rev, net_profit = totals["revenue"], totals["netProfit"]
        debt = totals["liabilities"]
        overdue = [i for i in snap["invoices"] if i["status"] == "overdue"]
        low_stock = [
            i for i in snap["inventoryItems"] if i["status"] in ("low-stock", "out-of-stock")
        ]
        active_payroll = sum(e["salary"] for e in snap["employees"] if e["status"] == "active")

        return f"""FINANCIAL SUMMARY — {as_of}

Key Metrics (trailing 12 months):
  • Revenue: ${rev:,.0f}
  • Net Profit: ${net_profit:,.0f} ({net_profit / rev * 100:.1f}% margin)
  • Cash Position: ${totals["cash"]:,.0f}
  • Accounts Receivable: ${totals["accountsReceivable"]:,.0f}
  • Accounts Payable: ${totals["accountsPayable"]:,.0f}
  • Total Debt: ${debt:,.0f}

Highlights:
  {"⚠️" if overdue else "✅"} {len(overdue)} overdue invoice(s) totaling ${sum(i["amount"] for i in overdue):,.0f}
  {"⚠️" if low_stock else "✅"} {len(low_stock)} inventory item(s) at or below reorder level
  ✅ Active payroll: ${active_payroll:,.0f}/yr
"""


@tool
def analyze_cash_flow(months: int = 3) -> str:
    """Analyze cash flow trends. Uses quarterly historical data to compute trends and runway."""
    snap = _snapshot()
    cash_flow = snap["cashFlowData"]
    # Use the last N quarters (approximate months/3)
    num_quarters = max(1, min(len(cash_flow), (months + 2) // 3))
    recent = cash_flow[-num_quarters:]

    lines = [f"CASH FLOW ANALYSIS — Last {num_quarters} quarter(s)\n"]
    lines.append("Quarter     | Operating   | Investing   | Financing   | Net")
    lines.append("------------|-------------|-------------|-------------|----------")
    for q in recent:
        lines.append(
            f"{q['quarter']:12s}| ${q['operating']:>9,.0f} | ${q['investing']:>9,.0f} | "
            f"${q['financing']:>9,.0f} | ${q['net']:>9,.0f}"
        )

    avg_net = sum(q["net"] for q in recent) / len(recent)
    first_net, last_net = recent[0]["net"], recent[-1]["net"]
    trend_pct = ((last_net - first_net) / abs(first_net) * 100) if first_net else 0
    trend = (
        "Improving" if trend_pct > 5 else "Declining" if trend_pct < -5 else "Stable"
    )

    cash_balance = snap["totals"]["cash"]
    avg_monthly_burn = snap["totals"]["expenses"] / 12
    runway = cash_balance / avg_monthly_burn if avg_monthly_burn else float("inf")

    lines.append(f"\nSummary:")
    lines.append(f"  • Average quarterly net cash flow: ${avg_net:,.0f}")
    lines.append(f"  • Trend: {trend} ({trend_pct:+.0f}% over period)")
    lines.append(f"  • Cash runway at current burn: {runway:.1f} months")
    lines.append(f"  • AR collection rate: {snap['arAging']['collectionRate'] * 100:.0f}%")

    return "\n".join(lines)


@tool
def forecast_revenue(quarters: int = 4) -> str:
    """Forecast revenue for upcoming quarters based on historical growth trends."""
    snap = _snapshot()
    outlook = erp_datasets.revenue_outlook(snap, get_store().as_of, quarters)
    avg_growth, volatility = outlook["avg_growth"], outlook["volatility"]
    projections = outlook["projections"]

    lines = [f"REVENUE FORECAST — Next {len(projections)} Quarters\n"]
    lines.append(
        f"Methodology: Average QoQ growth rate of {avg_growth * 100:.1f}% "
        f"computed from last 4 quarters (volatility: {volatility * 100:.1f}%)\n"
    )
    lines.append("Quarter     | Projected   | Confidence")
    lines.append("------------|-------------|----------")
    for p in projections:
        lines.append(
            f"{p['quarter']:12s}| ${p['projected']:>9,.0f} | {p['confidence']}"
        )

    lines.append(f"\nProjected Total: ${outlook['total']:,.0f} ({outlook['change_pct']:+.1f}% vs the last 4 quarters)")
    lines.append(f"\nKey Assumptions:")
    lines.append(
        f"  • Based on {avg_growth * 100:.1f}% average QoQ growth from recent quarters"
    )
    lines.append(f"  • Last quarter revenue: ${outlook['last_revenue']:,.0f}")
    drafts = [i for i in snap["invoices"] if i["status"] == "draft"]
    if drafts:
        pipeline = ", ".join(f"{i['client']} (${i['amount']:,.0f})" for i in drafts)
        lines.append(f"  • Draft invoices in the pipeline: {pipeline}")

    overdue = [i for i in snap["invoices"] if i["status"] == "overdue"]
    if overdue:
        lines.append(f"\nRisks:")
        for inv in overdue:
            lines.append(
                f"  ⚠️ {inv['client']} has ${inv['amount']:,.0f} overdue — churn risk"
            )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Data query tools (return raw data for projections agent)
# ---------------------------------------------------------------------------


@tool
def query_quarterly_financials(last_n: int = 8) -> str:
    """Return raw quarterly financial data (revenue, expenses, profit) as JSON for analysis."""
    data = _snapshot()["quarterlyRevenue"][-last_n:]
    return json.dumps(data, indent=2)


@tool
def query_cash_flow_components(last_n: int = 8) -> str:
    """Return raw quarterly cash flow component data (operating, investing, financing, net) as JSON."""
    data = _snapshot()["cashFlowData"][-last_n:]
    return json.dumps(data, indent=2)


@tool
def query_budget_vs_actual() -> str:
    """Return budget vs actual data for the current quarter as JSON (favorable variance is positive)."""
    return json.dumps(_snapshot()["budgetVsActual"], indent=2)


@tool
def query_ar_aging() -> str:
    """Return accounts receivable aging breakdown as JSON."""
    return json.dumps(_snapshot()["arAging"], indent=2)


@tool
def query_monthly_expenses(category: str | None = None) -> str:
    """Return monthly expense data for the current fiscal year as JSON.

    Each entry has month plus expense amounts by category.
    Optionally filter to a single category: payroll, operations, marketing,
    infrastructure, rnd, other.
    """
    monthly = _snapshot()["monthlyExpenseByCategory"]
    if category:
        cat = category.lower().replace("&", "").replace(" ", "")
        if cat == "rd":
            cat = "rnd"
        data = [
            {"month": row["month"], category: row.get(cat, 0)}
            for row in monthly
        ]
    else:
        data = monthly
    return json.dumps(data, indent=2)


# ---------------------------------------------------------------------------
# Projection tools (the calculations live in erp_datasets, shared with the charts)
# ---------------------------------------------------------------------------


@tool
def compute_revenue_forecast(quarters: int = 4, method: str = "linear") -> str:
    """Project revenue for future quarters using historical growth rates.

    Args:
        quarters: Number of quarters to project (1-8).
        method: "linear" (average growth rate) or "seasonal" (accounts for seasonal patterns).

    Returns JSON with projected quarterly revenue, growth rate used, and confidence metrics.
    """
    result = erp_datasets.project_revenue(_snapshot(), get_store().as_of, quarters, method)
    return json.dumps(result, indent=2)


@tool
def compute_cash_flow_forecast(quarters: int = 4) -> str:
    """Project cash flow components (operating, investing, financing) for future quarters.

    Args:
        quarters: Number of quarters to project (1-8).

    Returns JSON with projected quarterly cash flow by component.
    """
    result = erp_datasets.project_cash_flow(_snapshot(), get_store().as_of, quarters)
    return json.dumps(result, indent=2)


@tool
def run_scenario_analysis(metric: str = "revenue", quarters: int = 4) -> str:
    """Run best/base/worst case scenario analysis for a financial metric.

    Args:
        metric: "revenue", "profit", or "cash_flow"
        quarters: Number of quarters to project (1-8)

    Returns JSON with three scenarios (optimistic, base, conservative) each containing
    quarterly projections.
    """
    try:
        result = erp_datasets.scenario_analysis(_snapshot(), get_store().as_of, metric, quarters)
    except ValueError as exc:
        return json.dumps({"error": str(exc)})
    return json.dumps(result, indent=2)


@tool
def compute_trend_analysis(metric: str = "revenue") -> str:
    """Analyze historical growth rates, YoY comparisons, and seasonal patterns.

    Args:
        metric: "revenue", "expenses", "profit", "operating_cash_flow", or "net_cash_flow"

    Returns JSON with QoQ growth rates, YoY comparisons, and trend summary.
    """
    try:
        result = erp_datasets.trend_analysis(_snapshot(), metric)
    except ValueError as exc:
        return json.dumps({"error": str(exc)})
    return json.dumps(result, indent=2)


# ---------------------------------------------------------------------------
# Exported tool lists
# ---------------------------------------------------------------------------

research_tools = [
    query_invoices,
    query_bills,
    query_accounts,
    query_transactions,
    query_inventory,
    query_employees,
    generate_financial_report,
    analyze_cash_flow,
    forecast_revenue,
    query_quarterly_financials,
    query_cash_flow_components,
    query_budget_vs_actual,
    query_ar_aging,
    query_monthly_expenses,
]

projections_tools = [
    compute_revenue_forecast,
    compute_cash_flow_forecast,
    run_scenario_analysis,
    compute_trend_analysis,
    query_quarterly_financials,
    query_cash_flow_components,
]
