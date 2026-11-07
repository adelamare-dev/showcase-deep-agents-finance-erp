from __future__ import annotations

import json
from pathlib import Path

import pytest

from figure_guard import (
    CORRECTION,
    allowed_values,
    extract_figures,
    mark,
    unverified,
)

CASES = json.loads(
    (Path(__file__).parent / "data" / "figure_cases.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_cases(case):
    allowed = allowed_values(case["tools"], case.get("snapshot", {}), case["userText"])
    found = unverified(case["text"], allowed)
    assert [f.raw for f in found] == case["expectUnverified"]


def test_extract_kinds_and_values():
    figs = extract_figures("$1.1M, 12.5% and 42 employees, ($1,850)")
    assert [(f.raw, f.kind, f.value) for f in figs] == [
        ("$1.1M", "money", 1_100_000),
        ("12.5%", "percent", 12.5),
        ("42 employees", "count", 42),
        ("($1,850)", "money", 1850),
    ]


def test_mark_wraps_only_the_given_figures():
    text = "Cash is $43,000 and $430,000."
    figs = [f for f in extract_figures(text) if f.raw == "$43,000"]
    assert mark(text, figs) == "Cash is ⟦unverified:$43,000⟧ and $430,000."


def test_mark_is_stable_on_a_marked_text():
    text = "Cash is ⟦unverified:$43,000⟧."
    assert mark(text, extract_figures(text)) == text


def test_correction_names_the_figures():
    assert "$43,000, 12%" in CORRECTION.format(raws="$43,000, 12%")
