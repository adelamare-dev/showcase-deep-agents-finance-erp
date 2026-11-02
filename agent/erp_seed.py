"""Seed data for the ERP store: a fictional company, USD, whole dollars.

Every date is an offset in days from the `as_of` date, so the data stays
current whatever day it is loaded. Amounts are integers: sums are exact and
the balance sheet balances without any rounding. Only records are seeded
here; totals, KPIs, aging and statuses derived from a date are computed by the
store, never typed in.
"""

from __future__ import annotations

from datetime import date, timedelta

COMPANY = "Larkspur Analytics"
EMAIL_DOMAIN = "larkspur.example"

# Months and quarters of the trailing four quarters, oldest first. The last
# quarter is the one that contains `as_of`.
MONTHLY_REVENUE = [
    186000, 205000, 237000,
    273000, 209000, 214000,
    252000, 289000, 310000,
    278000, 325000, 348000,
]  # fmt: skip

EXPENSE_CATEGORIES = ["Payroll", "Operations", "Marketing", "Infrastructure", "R&D", "Other"]
EXPENSE_COLORS = ["#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe", "#dbeafe"]
# One row per month, columns follow EXPENSE_CATEGORIES.
MONTHLY_EXPENSES = [
    [48000, 23000, 12000, 15000, 14000, 7000],
    [48000, 23000, 28000, 15000, 14000, 7000],
    [49000, 24000, 35000, 16000, 14000, 7000],
    [48000, 23000, 22000, 15000, 14000, 7000],
    [48000, 22000, 18000, 15000, 14000, 6000],
    [48000, 23000, 20000, 16000, 14000, 7000],
    [49000, 24000, 21000, 16000, 14000, 7000],
    [48000, 23000, 18000, 15000, 14000, 7000],
    [49000, 24000, 20000, 16000, 14000, 7000],
    [48000, 23000, 17000, 15000, 14000, 6000],
    [49000, 23000, 15000, 16000, 14000, 7000],
    [48000, 22000, 12000, 15000, 14000, 7000],
]  # fmt: skip

# The four quarters before the monthly window: (revenue, expenses).
EARLIER_QUARTERS = [(540000, 330000), (575000, 345000), (590000, 352000), (610000, 360000)]

# Eight quarters, oldest first: (operating, investing, financing). Net is derived.
CASH_FLOW = [
    (118000, -45000, -20000),
    (126000, -30000, -20000),
    (131000, -60000, -20000),
    (140000, -35000, -20000),
    (152000, -50000, -35000),
    (165000, -40000, -35000),
    (171000, -70000, -35000),
    (188000, -55000, -35000),
]

# Budget for the current quarter by line; actuals are derived from the months.
BUDGETS = {
    "Revenue": 980000,
    "Payroll": 147000,
    "Operations": 70000,
    "Marketing": 40000,
    "Infrastructure": 46000,
    "R&D": 42000,
    "Other": 20000,
}

# Change shown on the KPIs that have no history to derive it from.
KPI_CHANGES = {"Accounts Receivable": 15.8, "Cash": 4.1, "Accounts Payable": -3.2}

CASH_ACCOUNTS = [("1000", "Cash: Operating Account", 612000), ("1010", "Cash: Savings Reserve", 480000)]
FIXED_ASSETS = 890000
SHORT_TERM_LOANS = 150000
LONG_TERM_DEBT = 520000
OWNER_EQUITY = 1200000

# (client, [(description, quantity, unit price)], issued offset, due offset, stored status)
_CLIENT_INVOICES = [
    ("Brightwater Logistics", [("Analytics platform, annual licence", 1, 38000), ("Onboarding workshop", 2, 3500)], -75, -45, "paid"),
    ("Cedarline Foods", [("Demand forecasting module", 1, 28500)], -20, 10, "pending"),
    ("Ironbridge Construction", [("Reporting suite, 20 seats", 20, 2400), ("Custom integration", 1, 19200)], -50, -20, "pending"),
    ("Halcyon Medical", [("Data warehouse setup", 1, 18750)], -50, -20, "paid"),
    ("Juniper Retail Group", [("Analytics platform, annual licence", 2, 38000), ("Premium support", 1, 17400)], -10, 20, "pending"),
    ("Norvale Energy", [("Pilot programme, phase two", 1, 124000)], 0, 30, "draft"),
    ("Kestrel Parts", [("Dashboard development", 40, 450), ("Training day", 3, 2200)], -70, -40, "pending"),
    ("Marlowe & Finch", [("Quarterly advisory retainer", 1, 22500)], -5, 25, "pending"),
    ("Brightwater Logistics", [("Add-on connectors", 4, 4200)], -40, -10, "paid"),
    ("Cedarline Foods", [("Legacy data migration", 1, 31800)], -130, -100, "pending"),
    ("Halcyon Medical", [("Compliance reporting pack", 1, 15600)], 0, 30, "draft"),
    ("Juniper Retail Group", [("Seasonal forecasting study", 1, 24000)], -95, -65, "pending"),
]

# (supplier, description, amount, issued offset, due offset, paid)
_BILLS = [
    ("Tallgrass Cloud Hosting", "Hosting, current month", 14800, -26, 2, False),
    ("Redfern Staffing", "Contract analysts, current month", 21400, -24, 4, False),
    ("Sablewood Facilities", "Office lease and services", 12600, -24, 6, False),
    ("Pinecrest Insurance Brokers", "Quarterly liability premium", 9200, -18, 12, False),
    ("Quillon Office Supplies", "Stationery and consumables", 1850, -35, -5, False),
    ("Vantor Telecom", "Connectivity, previous month", 3400, -50, -20, True),
    ("Delmar Hardware Distribution", "Network equipment restock", 17900, -45, -15, True),
    ("Tallgrass Cloud Hosting", "Hosting, previous month", 14200, -56, -26, True),
]

# (description, amount, credit or debit, category, account code, days ago, status)
_TRANSACTIONS = [
    ("Brightwater Logistics, invoice payment", 45000, "credit", "Revenue", "4000", 0, "completed"),
    ("Cloud hosting", 8420, "debit", "Infrastructure", "5100", 1, "completed"),
    ("Payroll, monthly cycle", 49000, "debit", "Payroll", "5000", 2, "completed"),
    ("Halcyon Medical, invoice payment", 18750, "credit", "Revenue", "4000", 4, "completed"),
    ("Marketing campaign, regional events", 15200, "debit", "Marketing", "5100", 5, "completed"),
    ("Office lease", 6300, "debit", "Operations", "5100", 7, "completed"),
    ("Brightwater Logistics, add-on connectors", 16800, "credit", "Revenue", "4000", 10, "completed"),
    ("Contractor payment", 7600, "debit", "R&D", "5100", 11, "pending"),
    ("Software subscriptions", 3150, "debit", "Operations", "5100", 14, "completed"),
    ("Insurance premium", 9200, "debit", "Other", "5100", 16, "failed"),
    ("Ironbridge Construction, deposit", 10000, "credit", "Revenue", "4000", 18, "completed"),
    ("Payroll, monthly cycle", 48000, "debit", "Payroll", "5000", 32, "completed"),
    ("Network equipment", 17900, "debit", "Infrastructure", "5100", 35, "completed"),
    ("Training workshop income", 7000, "credit", "Revenue", "4000", 38, "completed"),
]

# (sku, name, category, quantity, reorder level, unit cost, location)
_INVENTORY = [
    ("HW-SRV-001", "Rack Server 2U", "Servers", 12, 5, 8500, "Warehouse A"),
    ("HW-LAP-001", "Laptop 16-inch", "Laptops", 3, 10, 2499, "Warehouse A"),
    ("HW-LAP-002", "Laptop 14-inch", "Laptops", 18, 8, 1599, "Warehouse A"),
    ("HW-MON-001", "Monitor 27-inch 4K", "Monitors", 25, 10, 649, "Warehouse B"),
    ("HW-MON-002", "Monitor 32-inch Curved", "Monitors", 0, 6, 899, "Warehouse B"),
    ("HW-NET-001", "48-port Switch", "Networking", 4, 5, 3200, "Warehouse A"),
    ("HW-NET-002", "Wireless Access Point", "Networking", 30, 12, 280, "Warehouse B"),
    ("SW-LIC-001", "Analytics Seat Licence", "Software", 150, 40, 120, "Digital"),
    ("SW-LIC-002", "Security Suite Licence", "Software", 35, 40, 95, "Digital"),
    ("HW-STO-001", "Storage Array 24TB", "Servers", 6, 3, 7400, "Warehouse A"),
]

# (name, role, department, start offset, status, salary)
_EMPLOYEES = [
    ("Maren Lindqvist", "Chief Technology Officer", "Engineering", -2400, "active", 210000),
    ("Teodor Valcourt", "Senior Software Engineer", "Engineering", -1700, "active", 165000),
    ("Imani Okafor", "Data Engineer", "Engineering", -820, "active", 142000),
    ("Rafael Quintero", "Chief Financial Officer", "Finance", -2200, "active", 195000),
    ("Sunita Raghavan", "Financial Controller", "Finance", -1300, "active", 128000),
    ("Elodie Marchetti", "Head of People", "Human Resources", -1500, "active", 118000),
    ("Callum Ashby", "Marketing Director", "Marketing", -1100, "active", 135000),
    ("Noor Haddad", "Content Strategist", "Marketing", -430, "on-leave", 86000),
    ("Bjorn Strand", "Product Manager", "Product", -950, "active", 148000),
    ("Lucia Ferreira", "Product Designer", "Product", -610, "active", 112000),
    ("Anders Holm", "Account Executive", "Sales", -380, "active", 98000),
    ("Priya Venkataraman", "Infrastructure Lead", "Infrastructure", -1900, "active", 155000),
    ("Dmitri Kovalenko", "Site Reliability Engineer", "Infrastructure", -700, "active", 138000),
    ("Hana Yoshida", "Operations Analyst", "Operations", -260, "terminated", 79000),
]


def _iso(as_of: date, offset: int) -> str:
    return (as_of + timedelta(days=offset)).isoformat()


def seed(as_of: date) -> dict:
    """Return a fresh dataset of plain dicts, with dates relative to `as_of`."""
    invoices = []
    for n, (client, items, issued, due, state) in enumerate(_CLIENT_INVOICES, 1):
        item_rows = [{"description": d, "quantity": q, "unitPrice": p} for d, q, p in items]
        invoices.append(
            {
                "id": f"inv-{n:03d}",
                "number": f"INV-{n:04d}",
                "client": client,
                "amount": sum(r["quantity"] * r["unitPrice"] for r in item_rows),
                "currency": "USD",
                "status": state,
                "issuedDate": _iso(as_of, issued),
                "dueDate": _iso(as_of, due),
                "items": item_rows,
            }
        )

    bills = [
        {
            "id": f"bill-{n:03d}",
            "number": f"BILL-{n:04d}",
            "supplier": supplier,
            "description": description,
            "amount": amount,
            "currency": "USD",
            "status": "paid" if paid else "pending",
            "issuedDate": _iso(as_of, issued),
            "dueDate": _iso(as_of, due),
        }
        for n, (supplier, description, amount, issued, due, paid) in enumerate(_BILLS, 1)
    ]

    transactions = [
        {
            "id": f"txn-{n:03d}",
            "date": _iso(as_of, -ago),
            "description": description,
            "amount": amount,
            "type": kind,
            "category": category,
            "accountCode": code,
            "status": status,
        }
        for n, (description, amount, kind, category, code, ago, status) in enumerate(_TRANSACTIONS, 1)
    ]

    inventory = [
        {
            "id": f"item-{n:03d}",
            "sku": sku,
            "name": name,
            "category": category,
            "quantity": quantity,
            "reorderLevel": reorder,
            "unitCost": cost,
            "location": location,
        }
        for n, (sku, name, category, quantity, reorder, cost, location) in enumerate(_INVENTORY, 1)
    ]

    employees = [
        {
            "id": f"emp-{n:03d}",
            "name": name,
            "email": name.lower().replace(" ", ".") + "@" + EMAIL_DOMAIN,
            "role": role,
            "department": department,
            "startDate": _iso(as_of, start),
            "status": status,
            "salary": salary,
            "avatar": "".join(part[0] for part in name.split()[:2]),
        }
        for n, (name, role, department, start, status, salary) in enumerate(_EMPLOYEES, 1)
    ]

    # Balance sheet. Receivables, payables and inventory are the sums of the
    # records above; retained earnings is the balancing figure of the seed.
    receivables = sum(i["amount"] for i in invoices if i["status"] == "pending")
    payables = sum(b["amount"] for b in bills if b["status"] == "pending")
    stock = sum(i["quantity"] * i["unitCost"] for i in inventory)
    cash = sum(balance for _, _, balance in CASH_ACCOUNTS)
    assets = cash + receivables + stock + FIXED_ASSETS
    liabilities = payables + SHORT_TERM_LOANS + LONG_TERM_DEBT
    retained = assets - liabilities - OWNER_EQUITY

    revenue_total = sum(MONTHLY_REVENUE)
    by_category = [sum(row[c] for row in MONTHLY_EXPENSES) for c in range(len(EXPENSE_CATEGORIES))]
    account_rows = [
        *[(code, name, "asset", balance) for code, name, balance in CASH_ACCOUNTS],
        ("1100", "Accounts Receivable", "asset", receivables),
        ("1200", "Inventory", "asset", stock),
        ("1500", "Fixed Assets", "asset", FIXED_ASSETS),
        ("2000", "Accounts Payable", "liability", payables),
        ("2100", "Short-term Loans", "liability", SHORT_TERM_LOANS),
        ("2500", "Long-term Debt", "liability", LONG_TERM_DEBT),
        ("3000", "Owner's Equity", "equity", OWNER_EQUITY),
        ("3100", "Retained Earnings", "equity", retained),
        ("4000", "Service Revenue", "revenue", revenue_total),
        *[
            (f"5{n}00", f"{name} Expense", "expense", by_category[n])
            for n, name in enumerate(EXPENSE_CATEGORIES)
        ],
    ]
    accounts = [
        {
            "id": f"acc-{code}",
            "name": name,
            "type": kind,
            "balance": balance,
            "currency": "USD",
            "code": code,
        }
        for code, name, kind, balance in account_rows
    ]

    return {
        "invoices": invoices,
        "bills": bills,
        "accounts": accounts,
        "transactions": transactions,
        "inventoryItems": inventory,
        "employees": employees,
    }
