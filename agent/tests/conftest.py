from __future__ import annotations

import os
import sys
from pathlib import Path

# Agent modules import flat (`from tools import ...`), so `agent/` must be on
# the path whatever directory pytest starts from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Clients need a key to be constructed; no offline test sends a request.
os.environ.setdefault("MISTRAL_API_KEY", "offline-test-key")

import pytest  # noqa: E402

# Dates that stress the relative arithmetic: today, a year end, a leap day and
# the first day of a year and of a quarter.
AS_OF_DATES = [None, "2026-12-31", "2028-02-29", "2027-01-01", "2027-04-01"]


@pytest.fixture(params=AS_OF_DATES, ids=lambda v: v or "today")
def store(request):
    from datetime import date

    from erp_store import ErpStore

    return ErpStore(date.fromisoformat(request.param) if request.param else None)
