from __future__ import annotations

import json
from pathlib import Path

import pytest

from figure_guard import (
    CORRECTION,
    allowed_values,
    extract_figures,
    correction_with_hints,
    mark,
    rounding_hints,
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


def test_corrections_ask_for_exact_figures_and_a_reply_that_reads_as_the_first():
    from figure_guard import DASHBOARD_CORRECTION

    for text in (CORRECTION, DASHBOARD_CORRECTION):
        low = text.format(raws="$1").lower()
        assert "$1" in low
        assert "as if it were the first" in low
        assert "apolog" in low
        assert "this check" in low
    assert "exactly as a tool returned" in CORRECTION.lower()
    assert "no rounding of your own" in CORRECTION.lower()


def test_rounding_hint_names_the_one_tool_value_a_round_amount_comes_from():
    figs = unverified("Revenue is $730,000.", allowed_values(['{"revenue": 729850}'], {}, ""))
    assert rounding_hints(figs, ['{"revenue": 729850}']) == [("$730,000", 729850.0)]
    assert correction_with_hints("$730,000", rounding_hints(figs, ['{"revenue": 729850}'])).endswith(
        "The tools returned $729,850 where you wrote $730,000."
    )


def test_rounding_hint_uses_the_window_of_the_trailing_zeros():
    figs = extract_figures("Rent is $579,000.")
    assert rounding_hints(figs, ['{"rent": 579250}']) == [("$579,000", 579250.0)]
    assert rounding_hints(figs, ['{"rent": 579600}']) == []


def test_no_rounding_hint_when_two_tool_values_fit():
    figs = extract_figures("Revenue is $730,000.")
    assert rounding_hints(figs, ['{"a": 729850, "b": 731000}']) == []


def test_no_rounding_hint_for_an_amount_without_trailing_zeros():
    figs = extract_figures("Revenue is $729,123.")
    assert rounding_hints(figs, ['{"revenue": 729150}']) == []


def test_no_rounding_hint_from_a_value_only_the_snapshot_holds():
    figs = extract_figures("Revenue is $730,000.")
    assert rounding_hints(figs, ['{"other": 12}']) == []


def test_rounding_hint_prints_cents_only_when_not_whole():
    figs = extract_figures("Revenue is $730,000.")
    assert correction_with_hints("$730,000", rounding_hints(figs, ['{"r": 729850.5}'])).endswith(
        "The tools returned $729,850.50 where you wrote $730,000."
    )


def test_hints_are_joined_with_a_semicolon():
    figs = extract_figures("Rent $730,000 and pay $579,000.")
    out = correction_with_hints("x", rounding_hints(figs, ['{"a": 729850, "b": 579250}']))
    assert out.endswith("The tools returned $729,850 where you wrote $730,000; the tools returned $579,250 where you wrote $579,000.")
