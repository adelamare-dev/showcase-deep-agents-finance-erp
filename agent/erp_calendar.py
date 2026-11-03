"""Quarter arithmetic shared by the store and the dataset catalog.

A leaf module: it imports nothing from the ERP code, so both can use it
without an import cycle.
"""

from __future__ import annotations

from datetime import date


def quarter_of(day: date) -> tuple[int, int]:
    """Return (year, quarter 1-4) of a date."""
    return day.year, (day.month - 1) // 3 + 1


def shift_quarter(year: int, quarter: int, by: int) -> tuple[int, int]:
    index = year * 4 + (quarter - 1) + by
    return index // 4, index % 4 + 1


def quarter_label(day: date, by: int = 0) -> str:
    """Label of the quarter `by` quarters away from the one containing `day`."""
    year, quarter = shift_quarter(*quarter_of(day), by)
    return f"Q{quarter} {year}"
