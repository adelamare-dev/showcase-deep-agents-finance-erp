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


def test_a_dashboard_comment_is_about_the_widgets_placed_and_has_no_stock_sentence():
    assert "insight about the widgets you actually placed" in ORCHESTRATOR_PROMPT
    assert "Watch the overdue receivables" not in ORCHESTRATOR_PROMPT
    assert "Your dashboard is ready." not in ORCHESTRATOR_PROMPT


def test_paying_suppliers_always_ends_with_an_approval_request():
    assert "never a substitute" in ORCHESTRATOR_PROMPT


def test_a_request_listing_its_widgets_is_built_not_loaded_from_a_template():
    lines = ORCHESTRATOR_PROMPT.splitlines()
    build = next(i for i, line in enumerate(lines) if line.startswith("- Dashboard / overview"))
    themed = next(i for i, line in enumerate(lines) if line.startswith("- Themed dashboard"))
    templates = next(i for i, line in enumerate(lines) if line.startswith("- Map natural-language intent"))
    # The widget-list rule comes first and forbids the template and save/reset routes.
    assert build < themed and build < templates
    assert "lists the widgets it wants" in lines[build]
    assert "never answer it with load_dashboard, save_dashboard or manage_dashboard" in lines[build]
    assert "lists no widgets" in lines[themed]
    assert "without listing the widgets" in lines[templates]
