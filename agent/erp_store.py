"""In-memory ERP store: the single source of every figure the app shows.

Tools and REST routes only call this module. Records are plain dicts in the
camelCase shape of `src/types/erp.ts`. Everything that can be derived (totals,
KPIs, aging, statuses that depend on the date) is computed on read.

Money is whole US dollars held as `int`, so sums are exact and the balance
sheet balances with `==`. Only ratios (percentages, rates) are floats, and no
invariant depends on them.
"""

from __future__ import annotations

import copy
import threading
from datetime import date

import erp_seed as sd
from erp_calendar import quarter_label, quarter_of, shift_quarter
from erp_datasets import FORECAST_QUARTERS, revenue_scenarios

MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
CASH_CODE_PREFIX = sd.CASH_CODE_PREFIX
OPERATING_CASH_CODE = "1000"


def _usd(amount: int) -> str:
    return f"${amount:,}"


def _change(current: int, previous: int) -> float:
    return round((current - previous) / abs(previous) * 100, 1) if previous else 0.0


def _trend(change: float) -> str:
    return "up" if change > 0 else "down" if change < 0 else "flat"


class ErpError(ValueError):
    """A request the books refuse; the message is safe to show to the model."""


class UnknownIds(ErpError):
    pass


class AlreadyPaid(ErpError):
    pass


class AlreadyOnOrder(ErpError):
    pass


class InsufficientCash(ErpError):
    pass


class ErpStore:
    """The demo company's books. `as_of` anchors every date and quarter label."""

    def __init__(self, as_of: date | None = None) -> None:
        self._pinned = as_of is not None
        self._as_of = as_of or date.today()
        self._lock = threading.Lock()
        self._data = sd.seed(self._as_of)

    @property
    def as_of(self) -> date:
        return self._as_of

    def reset(self) -> None:
        """Restore the initial data. An unpinned store also moves to today."""
        with self._lock:
            if not self._pinned:
                self._as_of = date.today()
            self._data = sd.seed(self._as_of)

    # -- derived records ----------------------------------------------------

    @staticmethod
    def _with_overdue(records: list[dict], as_of: date) -> list[dict]:
        today = as_of.isoformat()
        out = copy.deepcopy(records)
        for record in out:
            if record["status"] == "pending" and record["dueDate"] < today:
                record["status"] = "overdue"
        return out

    def _inventory(self, items: list[dict]) -> list[dict]:
        out = copy.deepcopy(items)
        for item in out:
            qty = item["quantity"]
            item["status"] = (
                "out-of-stock" if qty == 0 else "low-stock" if qty <= item["reorderLevel"] else "in-stock"
            )
        return out

    @staticmethod
    def _quarters(as_of: date) -> tuple[list[dict], list[dict], list[dict]]:
        """Monthly points, quarterly points and the monthly expense rows of the trailing year."""
        year, quarter = quarter_of(as_of)
        _, first_quarter = shift_quarter(year, quarter, -3)
        start = (first_quarter - 1) * 3
        months, by_category = [], []
        for n in range(12):
            revenue = sd.MONTHLY_REVENUE[n]
            row = dict(zip(sd.EXPENSE_CATEGORIES, sd.MONTHLY_EXPENSES[n]))
            expenses = sum(row.values())
            label = MONTH_NAMES[(start + n) % 12]
            months.append({"month": label, "revenue": revenue, "expenses": expenses, "profit": revenue - expenses})
            by_category.append(
                {
                    "month": label,
                    "payroll": row["Payroll"],
                    "operations": row["Operations"],
                    "marketing": row["Marketing"],
                    "infrastructure": row["Infrastructure"],
                    "rnd": row["R&D"],
                    "other": row["Other"],
                }
            )
        recent = [
            (sum(m["revenue"] for m in months[k : k + 3]), sum(m["expenses"] for m in months[k : k + 3]))
            for k in range(0, 12, 3)
        ]
        quarterly = []
        for n, (revenue, expenses) in enumerate(sd.EARLIER_QUARTERS + recent):
            quarterly.append(
                {
                    "quarter": quarter_label(as_of, n - 7),
                    "revenue": revenue,
                    "expenses": expenses,
                    "profit": revenue - expenses,
                }
            )
        return months, quarterly, by_category

    @staticmethod
    def _aging(invoices: list[dict], as_of: date) -> dict:
        buckets = {"current": 0, "thirtyDay": 0, "sixtyDay": 0, "ninetyPlus": 0}
        paid = 0
        for inv in invoices:
            if inv["status"] == "paid":
                paid += inv["amount"]
            elif inv["status"] in ("pending", "overdue"):
                late = (as_of - date.fromisoformat(inv["dueDate"])).days
                key = "current" if late <= 0 else "thirtyDay" if late <= 30 else "sixtyDay" if late <= 60 else "ninetyPlus"
                buckets[key] += inv["amount"]
        total = sum(buckets.values())
        rate = round(paid / (paid + total), 2) if paid + total else 0
        return {**buckets, "total": total, "collectionRate": rate}

    # -- public reads --------------------------------------------------------

    @staticmethod
    def _accounts(data: dict) -> list[dict]:
        """Chart of accounts with receivables, payables and inventory computed from the records."""
        derived = {
            "1100": sum(i["amount"] for i in data["invoices"] if i["status"] in ("pending", "overdue")),
            "1200": sum(i["quantity"] * i["unitCost"] for i in data["inventoryItems"]),
            "2000": sum(b["amount"] for b in data["bills"] if b["status"] != "paid"),
        }
        return [{**a, "balance": derived.get(a["code"], a["balance"])} for a in data["accounts"]]

    @classmethod
    def _totals(cls, data: dict) -> dict:
        accounts = cls._accounts(data)
        by_type = {kind: sum(a["balance"] for a in accounts if a["type"] == kind) for kind in
                   ("asset", "liability", "equity", "revenue", "expense")}
        by_code = {a["code"]: a["balance"] for a in accounts}
        revenue, expenses = by_type["revenue"], by_type["expense"]
        return {
            "cash": sum(v for code, v in by_code.items() if code.startswith(CASH_CODE_PREFIX)),
            "accountsReceivable": by_code["1100"],
            "accountsPayable": by_code["2000"],
            "assets": by_type["asset"],
            "liabilities": by_type["liability"],
            "equity": by_type["equity"],
            "revenue": revenue,
            "expenses": expenses,
            "netProfit": revenue - expenses,
        }

    def totals(self) -> dict:
        """Balance-sheet and income figures, computed from the records on every call."""
        with self._lock:
            return self._totals(self._data)

    def cash_accounts(self) -> list[dict]:
        """The cash accounts (codes 10xx) whose balances add up to `totals()["cash"]`."""
        with self._lock:
            accounts = self._accounts(self._data)
        return [a for a in accounts if a["code"].startswith(CASH_CODE_PREFIX)]

    # -- mutations -----------------------------------------------------------
    # Every mutation validates first and writes second, under one lock
    # acquisition, so a refused request leaves the books untouched.

    def _resolve_bills(self, bill_ids: list[str]) -> list[dict]:
        """Stored bill records for ids or numbers, deduplicated, in request order."""
        if not bill_ids:
            raise ErpError("No bill given.")
        by_key = {}
        for bill in self._data["bills"]:
            by_key[bill["id"].lower()] = bill
            by_key[bill["number"].lower()] = bill
        found, unknown = [], []
        for raw in bill_ids:
            bill = by_key.get(str(raw).strip().lower())
            if bill is None:
                unknown.append(str(raw))
            elif bill not in found:
                found.append(bill)
        if unknown:
            raise UnknownIds(f"Unknown bill(s): {', '.join(unknown)}.")
        return found

    @staticmethod
    def _bill_row(bill: dict) -> dict:
        return {key: bill[key] for key in ("id", "number", "supplier", "amount", "dueDate")}

    def preview_bill_payment(self, bill_ids: list[str]) -> dict:
        """The bills a payment would settle and their total. Changes nothing.

        Raises `UnknownIds` for an id that matches no bill and `AlreadyPaid` when
        any bill is settled already.
        """
        with self._lock:
            bills = self._resolve_bills(bill_ids)
            paid = [b["number"] for b in bills if b["status"] == "paid"]
            if paid:
                raise AlreadyPaid(f"Already paid: {', '.join(paid)}.")
            rows = [self._bill_row(b) for b in bills]
        return {"bills": rows, "totalAmount": sum(r["amount"] for r in rows)}

    def pay_bills(self, bill_ids: list[str]) -> dict:
        """Pay the unpaid bills among `bill_ids` from the operating account.

        Idempotent: a bill that is already paid is skipped and not counted, so a
        repeated call pays nothing more. Cash and accounts payable both fall by
        `totalPaid`; equity does not move. Returns the ids actually paid, the
        total, and the signed `changes` of the headline figures they moved.
        """
        with self._lock:
            bills = self._resolve_bills(bill_ids)
            due = [b for b in bills if b["status"] != "paid"]
            total = sum(b["amount"] for b in due)
            operating = next(a for a in self._data["accounts"] if a["code"] == OPERATING_CASH_CODE)
            if total > operating["balance"]:
                raise InsufficientCash(
                    f"The operating account holds {_usd(operating['balance'])}, "
                    f"{_usd(total)} are due."
                )
            today = self._as_of.isoformat()
            for bill in due:
                bill["status"] = "paid"
                self._data["transactions"].insert(
                    0,
                    {
                        "id": f"txn-{len(self._data['transactions']) + 1:03d}",
                        "date": today,
                        "description": f"Supplier payment, {bill['supplier']} ({bill['number']})",
                        "amount": bill["amount"],
                        "type": "debit",
                        "category": "Accounts Payable",
                        "accountCode": "2000",
                        "status": "completed",
                    },
                )
            operating["balance"] -= total
        changes = [{"metric": "Cash", "delta": -total}, {"metric": "Accounts Payable", "delta": -total}]
        return {
            "paidBillIds": [b["id"] for b in due],
            "totalPaid": total,
            "changes": changes if total else [],
        }

    def _resolve_items(self, items: list[dict]) -> list[tuple[dict, int]]:
        if not items:
            raise ErpError("No item given.")
        by_sku = {i["sku"].lower(): i for i in self._data["inventoryItems"]}
        lines, unknown = {}, []
        for entry in items:
            sku = str(entry.get("sku", "")).strip()
            quantity = entry.get("quantity")
            if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
                raise ErpError(f"Quantity for {sku or 'an item'} must be a whole number above 0.")
            item = by_sku.get(sku.lower())
            if item is None:
                unknown.append(sku)
            else:
                lines[item["sku"]] = (item, quantity)
        if unknown:
            raise UnknownIds(f"Unknown SKU(s): {', '.join(unknown)}.")
        return list(lines.values())

    def preview_reorder(self, items: list[dict]) -> dict:
        """The purchase order a reorder of `[{sku, quantity}]` would place. Changes nothing.

        Raises `UnknownIds` for an unknown SKU and `AlreadyOnOrder` for an item
        that already has an order open.
        """
        with self._lock:
            lines = self._resolve_items(items)
            open_orders = [item["sku"] for item, _ in lines if item["onOrder"]]
            if open_orders:
                raise AlreadyOnOrder(f"Already on order: {', '.join(open_orders)}.")
            rows = [
                {
                    "sku": item["sku"],
                    "name": item["name"],
                    "currentQty": item["quantity"],
                    "reorderQty": quantity,
                    "unitCost": item["unitCost"],
                }
                for item, quantity in lines
            ]
        # The seed holds no supplier per item, so none is claimed.
        return {"items": rows, "estimatedTotal": sum(r["reorderQty"] * r["unitCost"] for r in rows), "supplier": ""}

    def reorder(self, items: list[dict]) -> dict:
        """Mark the items as on order. Idempotent: an item already on order is left as it is.

        A purchase order is not a debt yet: no account moves, and the stock only
        grows when goods arrive.
        """
        with self._lock:
            lines = self._resolve_items(items)
            placed = []
            for item, quantity in lines:
                if not item["onOrder"]:
                    item["onOrder"] = quantity
                    placed.append(item["sku"])
        return {"orderedSkus": placed, "changes": []}

    def snapshot(self) -> dict:
        """Every dataset in the camelCase shape of `src/types/erp.ts`, plus `totals`."""
        with self._lock:
            data = copy.deepcopy(self._data)
            as_of = self._as_of
        totals = self._totals(data)
        invoices = self._with_overdue(data["invoices"], as_of)
        months, quarterly, by_category = self._quarters(as_of)

        flow = []
        for n, (operating, investing, financing) in enumerate(sd.CASH_FLOW):
            flow.append(
                {
                    "quarter": quarter_label(as_of, n - 7),
                    "operating": operating,
                    "investing": investing,
                    "financing": financing,
                    "net": operating + investing + financing,
                }
            )

        expense_total = sum(sum(sd.MONTHLY_EXPENSES[n]) for n in range(12))
        breakdown = []
        for c, category in enumerate(sd.EXPENSE_CATEGORIES):
            amount = sum(row[c] for row in sd.MONTHLY_EXPENSES)
            breakdown.append(
                {
                    "category": category,
                    "amount": amount,
                    "percentage": round(amount / expense_total * 100, 1),
                    "color": sd.EXPENSE_COLORS[c],
                }
            )

        actual = {"Revenue": quarterly[-1]["revenue"]}
        for c, category in enumerate(sd.EXPENSE_CATEGORIES):
            actual[category] = sum(sd.MONTHLY_EXPENSES[n][c] for n in range(9, 12))
        budget = [
            {
                "category": category,
                "budget": planned,
                "actual": actual[category],
                "variance": actual[category] - planned if category == "Revenue" else planned - actual[category],
            }
            for category, planned in sd.BUDGETS.items()
        ]

        previous, latest = quarterly[-2], quarterly[-1]
        scenarios = revenue_scenarios(latest["revenue"], as_of, FORECAST_QUARTERS)
        # Receivables, cash and payables have no history to compare with: their change is 0.
        kpi_rows = [
            ("Total Revenue", _usd(totals["revenue"]), _change(latest["revenue"], previous["revenue"]), "dollar-sign"),
            ("Net Profit", _usd(totals["netProfit"]), _change(latest["profit"], previous["profit"]), "trending-up"),
            ("Accounts Receivable", _usd(totals["accountsReceivable"]), 0.0, "file-text"),
            ("Operating Expenses", _usd(totals["expenses"]), _change(latest["expenses"], previous["expenses"]), "receipt"),
            ("Cash", _usd(totals["cash"]), 0.0, "wallet"),
            ("Accounts Payable", _usd(totals["accountsPayable"]), 0.0, "credit-card"),
        ]
        kpis = [
            {"label": label, "value": value, "change": change, "trend": _trend(change), "icon": icon}
            for label, value, change, icon in kpi_rows
        ]

        return {
            "kpis": kpis,
            "revenueData": months,
            "expenseBreakdown": breakdown,
            "invoices": invoices,
            "bills": self._with_overdue(data["bills"], as_of),
            "accounts": self._accounts(data),
            "transactions": data["transactions"],
            "inventoryItems": self._inventory(data["inventoryItems"]),
            "employees": data["employees"],
            "quarterlyRevenue": quarterly,
            "revenueScenarios": scenarios,
            "cashFlowData": flow,
            "arAging": self._aging(invoices, as_of),
            "budgetVsActual": budget,
            "monthlyExpenseByCategory": by_category,
            "totals": totals,
        }


_store: ErpStore | None = None
_store_lock = threading.Lock()


def get_store() -> ErpStore:
    """Process-wide store. Tools run off-request and in threads, so it is not tied to the app lifespan."""
    global _store
    with _store_lock:
        if _store is None:
            _store = ErpStore()
        return _store
