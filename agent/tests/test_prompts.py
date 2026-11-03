from __future__ import annotations

from prompts import ORCHESTRATOR_PROMPT, PROJECTIONS_AGENT_PROMPT, RESEARCH_AGENT_PROMPT


def test_a_dashboard_makes_one_research_and_one_projections_call():
    rule = next(line for line in ORCHESTRATOR_PROMPT.splitlines() if line.startswith("- Dashboard / overview"))
    assert "ONE do_research" in rule
    assert "ONE do_projections" in rule
    assert "ONE update_dashboard" in rule


def test_projections_stay_available_to_the_orchestrator():
    assert "do_projections" in ORCHESTRATOR_PROMPT
    assert "compute_cash_flow_forecast" in PROJECTIONS_AGENT_PROMPT
    assert "parallel" in RESEARCH_AGENT_PROMPT


def test_subagents_are_told_to_answer_briefly():
    assert "Be brief" in RESEARCH_AGENT_PROMPT
    assert "Be brief" in PROJECTIONS_AGENT_PROMPT


def test_the_orchestrator_may_only_quote_figures_as_returned():
    assert "Never compute a total, average, difference" in ORCHESTRATOR_PROMPT


def test_a_dashboard_comment_carries_no_dollar_amount():
    assert "no dollar amount and no percentage at all" in ORCHESTRATOR_PROMPT
