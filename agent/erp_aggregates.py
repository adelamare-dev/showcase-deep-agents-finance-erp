"""Exact aggregates over a store snapshot.

Each function is pure on `snap = store.snapshot()`: the code sums, the model
only quotes. One definition per notion: a receivable is an issued unpaid
invoice (drafts excluded), headcount counts active employees, and payroll is
the sum of their annual salaries.
"""

from __future__ import annotations

from collections import defaultdict


def _pct(part: int, whole: int) -> float:
    return round(part / whole * 100, 1) if whole else 0.0


def receivables_by_client(snap: dict) -> dict:
    """Open receivables (pending and overdue invoices) grouped by client, largest first."""
    amount: dict[str, int] = defaultdict(int)
    overdue: dict[str, int] = defaultdict(int)
    count: dict[str, int] = defaultdict(int)
    for invoice in snap["invoices"]:
        if invoice["status"] not in ("pending", "overdue"):
            continue
        client = invoice["client"]
        amount[client] += invoice["amount"]
        count[client] += 1
        if invoice["status"] == "overdue":
            overdue[client] += invoice["amount"]
    clients = [
        {
            "client": client,
            "amount": amount[client],
            "invoiceCount": count[client],
            "overdueAmount": overdue[client],
        }
        for client in sorted(amount, key=lambda c: (-amount[c], c))
    ]
    total = sum(amount.values())
    overdue_total = sum(overdue.values())
    return {
        "clients": clients,
        "total": total,
        "overdueTotal": overdue_total,
        "overdueSharePct": _pct(overdue_total, total),
    }


def headcount_and_payroll(snap: dict) -> dict:
    """Active headcount and annual payroll, in total and per department (largest payroll first)."""
    headcount: dict[str, int] = defaultdict(int)
    payroll: dict[str, int] = defaultdict(int)
    for employee in snap["employees"]:
        if employee["status"] != "active":
            continue
        headcount[employee["department"]] += 1
        payroll[employee["department"]] += employee["salary"]
    total = sum(payroll.values())
    departments = [
        {
            "department": department,
            "headcount": headcount[department],
            "payroll": payroll[department],
            "payrollSharePct": _pct(payroll[department], total),
        }
        for department in sorted(payroll, key=lambda d: (-payroll[d], d))
    ]
    return {
        "headcount": sum(headcount.values()),
        "totalPayroll": total,
        "departments": departments,
    }


def cash_and_payables(snap: dict) -> dict:
    """Cash, accounts payable, unpaid and overdue supplier bills, and cash left after paying them all."""
    totals = snap["totals"]
    unpaid = [b for b in snap["bills"] if b["status"] != "paid"]
    overdue = [b for b in unpaid if b["status"] == "overdue"]
    return {
        "cash": totals["cash"],
        "accountsPayable": totals["accountsPayable"],
        "openBills": len(unpaid),
        "overdueBills": len(overdue),
        "overdueBillsAmount": sum(b["amount"] for b in overdue),
        "cashAfterPayables": totals["cash"] - totals["accountsPayable"],
    }
