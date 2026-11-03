"""Dataset catalog and the forecast calculations behind it.

Every chart or card the UI draws from a model request is built here, from the
store, at read time: the model picks a dataset identifier and a few bounded
parameters, the code supplies every figure. The calculations are pure
functions of a snapshot and the store date, so the agent tools, the REST route
and the snapshot's `revenueScenarios` all share them.

This module does not import `erp_store` (the store imports it), only the
calendar helpers.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Callable

from erp_calendar import quarter_label

MIN_QUARTERS = 1
MAX_QUARTERS = 8
GROWTH_PCT_LIMIT = 50
METRICS = ("revenue", "profit", "cash_flow")

# Quarterly growth assumed by each fixed-rate revenue scenario. The projections
# start from the last actual quarter and are never stored.
FORECAST_SCENARIOS = [
    ("Optimistic", "#22c55e", 0.10),
    ("Base", "#3b82f6", 0.05),
    ("Conservative", "#ef4444", 0.02),
]
FORECAST_QUARTERS = 4

# Multipliers applied to the historical growth rate by the scenario analysis.
ANALYSIS_SCENARIOS = [
    ("optimistic", "Optimistic", "#22c55e", 1.5),
    ("base", "Base", "#3b82f6", 1.0),
    ("conservative", "Conservative", "#ef4444", 0.5),
]

DATASET_IDS = (
    "cash_position",
    "revenue_by_quarter",
    "cash_flow_by_quarter",
    "expense_breakdown",
    "ar_aging",
    "budget_variance",
    "revenue_forecast",
    "cash_flow_forecast",
    "scenario_analysis",
)


def clamp_quarters(quarters: int) -> int:
    return max(MIN_QUARTERS, min(quarters, MAX_QUARTERS))


# ---------------------------------------------------------------------------
# Calculations
# ---------------------------------------------------------------------------


def growth_rates(values: list[float]) -> list[float]:
    """Period-over-period growth rates."""
    rates = []
    for i in range(1, len(values)):
        if values[i - 1] != 0:
            rates.append((values[i] - values[i - 1]) / abs(values[i - 1]))
    return rates


def project_forward(
    last_value: float, avg_growth: float, periods: int, optimistic_mult: float = 1.0
) -> list[int]:
    """Project values forward using compound growth."""
    result = []
    current = last_value
    for _ in range(periods):
        current = current * (1 + avg_growth * optimistic_mult)
        result.append(round(current))
    return result


def _recent_average(rates: list[float]) -> float:
    return sum(rates[-4:]) / min(4, len(rates)) if rates else 0


def revenue_scenarios(
    latest_revenue: int, as_of: date, quarters: int = FORECAST_QUARTERS, growth_pct: float = 0
) -> list[dict]:
    """Fixed-rate revenue scenarios from the last actual quarter.

    `growth_pct` shifts every scenario's quarterly growth, in percentage points.
    """
    return [
        {
            "label": label,
            "color": color,
            "values": [
                {
                    "quarter": quarter_label(as_of, k),
                    "value": round(latest_revenue * (1 + growth + growth_pct / 100) ** k),
                }
                for k in range(1, quarters + 1)
            ],
        }
        for label, color, growth in FORECAST_SCENARIOS
    ]


def revenue_outlook(snap: dict, as_of: date, quarters: int) -> dict:
    """Revenue projected from the average growth of the last four quarters."""
    quarterly = snap["quarterlyRevenue"]
    recent = quarterly[-4:]
    rates = [
        (recent[i]["revenue"] - recent[i - 1]["revenue"]) / recent[i - 1]["revenue"]
        for i in range(1, len(recent))
    ]
    avg_growth = sum(rates) / len(rates) if rates else 0
    if len(rates) > 1:
        volatility = (sum((r - avg_growth) ** 2 for r in rates) / len(rates)) ** 0.5
    else:
        volatility = 0.1

    last_rev = quarterly[-1]["revenue"]
    quarters = clamp_quarters(quarters)
    projections = []
    current = last_rev
    for i in range(quarters):
        current = int(current * (1 + avg_growth))
        confidence = "High" if i == 0 else "Medium" if i < 3 else "Low"
        if volatility > 0.08:
            confidence = "Medium" if i == 0 else "Low"
        projections.append(
            {"quarter": quarter_label(as_of, i + 1), "projected": current, "confidence": confidence}
        )

    total = sum(p["projected"] for p in projections)
    trailing_total = sum(q["revenue"] for q in recent)
    return {
        "avg_growth": avg_growth,
        "volatility": volatility,
        "last_revenue": last_rev,
        "projections": projections,
        "total": total,
        "change_pct": ((total - trailing_total) / trailing_total * 100) if trailing_total else 0,
    }


def project_revenue(snap: dict, as_of: date, quarters: int = 4, method: str = "linear") -> dict:
    """Quarterly revenue, expenses and profit projected from history."""
    data = snap["quarterlyRevenue"]
    revenues = [q["revenue"] for q in data]
    expenses = [q["expenses"] for q in data]
    horizon = clamp_quarters(quarters)

    if method == "seasonal" and len(data) >= 8:
        projections = []
        for i in range(horizon):
            # Same calendar quarter, one year before the quarter being projected.
            hist_idx = 4 + i % 4
            base_idx = hist_idx - 4
            yoy_growth = (data[hist_idx]["revenue"] - data[base_idx]["revenue"]) / data[base_idx]["revenue"]
            projected_rev = int(data[hist_idx]["revenue"] * (1 + yoy_growth))
            projected_exp = int(data[hist_idx]["expenses"] * (1 + yoy_growth * 0.7))
            projections.append(
                {
                    "quarter": quarter_label(as_of, i + 1),
                    "revenue": projected_rev,
                    "expenses": projected_exp,
                    "profit": projected_rev - projected_exp,
                    "yoy_growth_pct": round(yoy_growth * 100, 1),
                }
            )
    else:
        avg_growth = _recent_average(growth_rates(revenues))
        avg_exp_growth = _recent_average(growth_rates(expenses))
        projected_rev = project_forward(revenues[-1], avg_growth, horizon)
        projected_exp = project_forward(expenses[-1], avg_exp_growth, horizon)
        projections = [
            {
                "quarter": quarter_label(as_of, i + 1),
                "revenue": projected_rev[i],
                "expenses": projected_exp[i],
                "profit": projected_rev[i] - projected_exp[i],
                "qoq_growth_pct": round(avg_growth * 100, 1),
            }
            for i in range(horizon)
        ]

    recent_growth = growth_rates(revenues[-4:])
    if len(recent_growth) > 1:
        mean_g = sum(recent_growth) / len(recent_growth)
        std_g = (sum((r - mean_g) ** 2 for r in recent_growth) / len(recent_growth)) ** 0.5
    else:
        mean_g = recent_growth[0] if recent_growth else 0
        std_g = 0

    return {
        "method": method,
        "historical_quarters_used": len(data),
        "avg_quarterly_growth_pct": round(mean_g * 100, 1),
        "growth_volatility_pct": round(std_g * 100, 1),
        "projections": projections,
    }


def project_cash_flow(snap: dict, as_of: date, quarters: int = 4, growth_pct: float = 0) -> dict:
    """Operating, investing and financing cash flow, and the cash balance, for coming quarters.

    `growth_pct` shifts the operating growth rate, in percentage points.
    """
    cash_flow = snap["cashFlowData"]
    operating = [q["operating"] for q in cash_flow]
    investing = [q["investing"] for q in cash_flow]
    financing = [q["financing"] for q in cash_flow]

    avg_op = _recent_average(growth_rates(operating)) + growth_pct / 100
    # Investing and financing are typically negative: use their recent average.
    avg_inv = sum(investing[-4:]) / 4
    avg_fin = sum(financing[-4:]) / 4

    horizon = clamp_quarters(quarters)
    proj_op = project_forward(operating[-1], avg_op, horizon)
    cash_balance = snap["totals"]["cash"]
    cumulative = cash_balance
    projections = []
    for i in range(horizon):
        inv = round(avg_inv * (1 + 0.05 * i))  # slight increase in investment
        fin = round(avg_fin)
        net = proj_op[i] + inv + fin
        cumulative += net
        projections.append(
            {
                "quarter": quarter_label(as_of, i + 1),
                "operating": proj_op[i],
                "investing": inv,
                "financing": fin,
                "net": net,
                "projected_cash_balance": cumulative,
            }
        )

    return {
        "current_cash": cash_balance,
        "operating_growth_pct": round(avg_op * 100, 1),
        "projections": projections,
    }


def scenario_analysis(
    snap: dict, as_of: date, metric: str = "revenue", quarters: int = 4, growth_pct: float = 0
) -> dict:
    """Optimistic, base and conservative projections of a metric.

    `growth_pct` shifts the historical growth rate, in percentage points, before
    the scenario multipliers apply. An unknown metric raises `ValueError`.
    """
    quarters = clamp_quarters(quarters)
    if metric == "revenue":
        values = [q["revenue"] for q in snap["quarterlyRevenue"]]
    elif metric == "profit":
        values = [q["profit"] for q in snap["quarterlyRevenue"]]
    elif metric == "cash_flow":
        values = [q["net"] for q in snap["cashFlowData"]]
    else:
        raise ValueError(f"Unknown metric: {metric}. Use revenue, profit, or cash_flow.")

    avg_growth = _recent_average(growth_rates(values)) + growth_pct / 100
    last_val = values[-1]
    scenarios = {}
    for key, _, _, mult in ANALYSIS_SCENARIOS:
        projected = project_forward(last_val, avg_growth, quarters, optimistic_mult=mult)
        scenarios[key] = [
            {"quarter": quarter_label(as_of, i + 1), "value": projected[i]} for i in range(quarters)
        ]
    return {
        "metric": metric,
        "base_growth_rate_pct": round(avg_growth * 100, 1),
        "last_actual_value": last_val,
        "scenarios": scenarios,
    }


def trend_analysis(snap: dict, metric: str = "revenue") -> dict:
    """Growth rates, year-over-year comparisons and trend direction of a metric.

    An unknown metric raises `ValueError`.
    """
    if metric in ("revenue", "expenses", "profit"):
        data = snap["quarterlyRevenue"]
        values = [q[metric] for q in data]
    elif metric == "operating_cash_flow":
        data = snap["cashFlowData"]
        values = [q["operating"] for q in data]
    elif metric == "net_cash_flow":
        data = snap["cashFlowData"]
        values = [q["net"] for q in data]
    else:
        raise ValueError(f"Unknown metric: {metric}")
    labels = [q["quarter"] for q in data]

    rates = growth_rates(values)
    qoq = [
        {
            "from": labels[i - 1],
            "to": labels[i],
            "value": values[i],
            "growth_pct": round(rates[i - 1] * 100, 1),
        }
        for i in range(1, len(values))
    ]

    # Year-over-year comparisons (Q1 vs Q1, etc.).
    yoy = []
    if len(values) >= 8:
        for i in range(4):
            prev_yr, curr_yr = values[i], values[i + 4]
            change = ((curr_yr - prev_yr) / abs(prev_yr) * 100) if prev_yr else 0
            yoy.append(
                {
                    "quarter_pair": f"{labels[i]} → {labels[i + 4]}",
                    "previous": prev_yr,
                    "current": curr_yr,
                    "yoy_change_pct": round(change, 1),
                }
            )

    avg_growth = sum(rates) / len(rates) if rates else 0
    recent_avg = _recent_average(rates)
    return {
        "metric": metric,
        "periods": len(values),
        "min": min(values),
        "max": max(values),
        "latest": values[-1],
        "overall_avg_growth_pct": round(avg_growth * 100, 1),
        "recent_avg_growth_pct": round(recent_avg * 100, 1),
        "trend": "accelerating" if recent_avg > avg_growth else "decelerating",
        "qoq_detail": qoq,
        "yoy_comparisons": yoy,
    }


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Request:
    store: object
    snap: dict
    as_of: date
    quarters: int
    growth_pct: float
    metric: str


def _chart(title: str, chart_type: str, labels: list[str], columns: list[tuple[str, str, list]]) -> dict:
    """A chart payload: one column per series, named `value`, `value2`, ..."""
    keys = ["value"] + [f"value{n}" for n in range(2, len(columns) + 1)]
    return {
        "title": title,
        "chartType": chart_type,
        "data": [
            {"label": label, **{key: column[2][i] for key, column in zip(keys, columns)}}
            for i, label in enumerate(labels)
        ],
        "series": [{"key": key, "color": color, "label": name} for key, (name, color, _) in zip(keys, columns)],
        "formatValues": "currency",
    }


def _cash_position(r: _Request) -> dict:
    accounts = [{"name": a["name"], "balance": a["balance"]} for a in r.store.cash_accounts()]
    totals = r.snap["totals"]
    return {
        "title": "Cash Position Summary",
        "accounts": accounts,
        "totalCash": totals["cash"],
        "totalLiabilities": totals["liabilities"],
        "netPosition": totals["cash"] - totals["liabilities"],
    }


def _revenue_by_quarter(r: _Request) -> dict:
    rows = r.snap["quarterlyRevenue"][-r.quarters :]
    return _chart(
        "Revenue by quarter",
        "bar",
        [q["quarter"] for q in rows],
        [
            ("Revenue", "#3b82f6", [q["revenue"] for q in rows]),
            ("Expenses", "#f97316", [q["expenses"] for q in rows]),
            ("Profit", "#22c55e", [q["profit"] for q in rows]),
        ],
    )


def _cash_flow_by_quarter(r: _Request) -> dict:
    rows = r.snap["cashFlowData"][-r.quarters :]
    return _chart(
        "Cash flow by quarter",
        "bar",
        [q["quarter"] for q in rows],
        [
            ("Operating", "#3b82f6", [q["operating"] for q in rows]),
            ("Investing", "#f97316", [q["investing"] for q in rows]),
            ("Financing", "#a855f7", [q["financing"] for q in rows]),
            ("Net", "#22c55e", [q["net"] for q in rows]),
        ],
    )


def _expense_breakdown(r: _Request) -> dict:
    rows = r.snap["expenseBreakdown"]
    return _chart(
        "Expense breakdown, trailing 12 months",
        "bar",
        [e["category"] for e in rows],
        [("Expenses", "#2563eb", [e["amount"] for e in rows])],
    )


def _ar_aging(r: _Request) -> dict:
    aging = r.snap["arAging"]
    return _chart(
        "Receivables aging",
        "bar",
        ["Current", "1-30 days late", "31-60 days late", "Over 60 days late"],
        [("Receivables", "#3b82f6", [aging["current"], aging["thirtyDay"], aging["sixtyDay"], aging["ninetyPlus"]])],
    )


def _budget_variance(r: _Request) -> dict:
    rows = r.snap["budgetVsActual"]
    return _chart(
        "Budget vs actual, current quarter",
        "bar",
        [b["category"] for b in rows],
        [
            ("Budget", "#94a3b8", [b["budget"] for b in rows]),
            ("Actual", "#3b82f6", [b["actual"] for b in rows]),
        ],
    )


def _revenue_forecast(r: _Request) -> dict:
    scenarios = revenue_scenarios(
        r.snap["quarterlyRevenue"][-1]["revenue"], r.as_of, r.quarters, r.growth_pct
    )
    return _chart(
        "Revenue forecast",
        "line",
        [v["quarter"] for v in scenarios[0]["values"]],
        [(s["label"], s["color"], [v["value"] for v in s["values"]]) for s in scenarios],
    )


def _cash_flow_forecast(r: _Request) -> dict:
    rows = project_cash_flow(r.snap, r.as_of, r.quarters, r.growth_pct)["projections"]
    return _chart(
        "Cash flow forecast",
        "line",
        [p["quarter"] for p in rows],
        [
            ("Net cash flow", "#3b82f6", [p["net"] for p in rows]),
            ("Projected cash balance", "#22c55e", [p["projected_cash_balance"] for p in rows]),
        ],
    )


def _scenario_analysis(r: _Request) -> dict:
    result = scenario_analysis(r.snap, r.as_of, r.metric, r.quarters, r.growth_pct)
    scenarios = result["scenarios"]
    return _chart(
        f"{r.metric.replace('_', ' ').capitalize()} scenarios",
        "line",
        [p["quarter"] for p in scenarios["base"]],
        [(name, color, [p["value"] for p in scenarios[key]]) for key, name, color, _ in ANALYSIS_SCENARIOS],
    )


_BUILDERS: dict[str, Callable[[_Request], dict]] = {
    "cash_position": _cash_position,
    "revenue_by_quarter": _revenue_by_quarter,
    "cash_flow_by_quarter": _cash_flow_by_quarter,
    "expense_breakdown": _expense_breakdown,
    "ar_aging": _ar_aging,
    "budget_variance": _budget_variance,
    "revenue_forecast": _revenue_forecast,
    "cash_flow_forecast": _cash_flow_forecast,
    "scenario_analysis": _scenario_analysis,
}


def build_dataset(
    store,
    dataset_id: str,
    *,
    quarters: int = 4,
    growth_pct: float = 0,
    metric: str = "revenue",
) -> dict:
    """Build one dataset from the store.

    Charts come back as `{title, chartType, data, series, formatValues}`; the cash
    position as `{title, accounts, totalCash, totalLiabilities, netPosition}`.
    `quarters` is 1 to 8, `growth_pct` -50 to 50 (percentage points added to the
    growth rate of the forecasts), `metric` one of revenue, profit, cash_flow
    (scenario analysis only). An unknown identifier or an out-of-range parameter
    raises `ValueError`.
    """
    builder = _BUILDERS.get(dataset_id)
    if builder is None:
        raise ValueError(f"Unknown dataset: {dataset_id}. Use one of: {', '.join(DATASET_IDS)}.")
    if isinstance(quarters, bool) or not isinstance(quarters, int) or not MIN_QUARTERS <= quarters <= MAX_QUARTERS:
        raise ValueError(f"quarters must be a whole number from {MIN_QUARTERS} to {MAX_QUARTERS}.")
    if isinstance(growth_pct, bool) or not -GROWTH_PCT_LIMIT <= growth_pct <= GROWTH_PCT_LIMIT:
        raise ValueError(f"growth_pct must be between -{GROWTH_PCT_LIMIT} and {GROWTH_PCT_LIMIT}.")
    if metric not in METRICS:
        raise ValueError(f"metric must be one of: {', '.join(METRICS)}.")
    return builder(_Request(store, store.snapshot(), store.as_of, quarters, growth_pct, metric))
