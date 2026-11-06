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


def test_a_figure_is_read_from_a_fresh_tool_and_never_computed():
    assert "Call a fresh tool for every question about a current figure" in ORCHESTRATOR_PROMPT
    assert "Never add figures yourself" in ORCHESTRATOR_PROMPT
    assert "Never add up, average or subtract figures yourself" in RESEARCH_AGENT_PROMPT


def test_missing_data_is_answered_with_the_exact_words():
    assert 'start the reply with the exact words "I don\'t have this data"' in ORCHESTRATOR_PROMPT


def test_a_question_about_matching_records_shows_them():
    assert "Never write \"here are\" without showing them" in ORCHESTRATOR_PROMPT


def test_payments_pass_a_scope_and_reorders_name_the_right_records():
    rule = next(line for line in ORCHESTRATOR_PROMPT.splitlines() if line.startswith("- Pay supplier bills"))
    assert 'due_within_days=<days asked, 7 for "this week">' in rule
    assert "include_overdue=true unless the user excludes overdue bills" in rule
    assert "Never pass bill ids" in rule
    assert "bill_ids" not in ORCHESTRATOR_PROMPT
    assert "never for an in-stock item" in ORCHESTRATOR_PROMPT


def test_each_dashboard_element_has_its_widget():
    rule = next(line for line in ORCHESTRATOR_PROMPT.splitlines() if line.startswith("- Dashboard / overview"))
    assert 'metric_cards (metrics ["Cash", "Accounts Payable"])' in rule
    assert 'invoices with kind "payable"' in rule


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


def test_the_quarterly_cash_projection_goes_on_the_forecast_chart_not_the_waterfall():
    rule = next(line for line in ORCHESTRATOR_PROMPT.splitlines() if line.startswith("- Dashboard / overview"))
    assert 'a quarterly cash projection in one custom_chart on dataset cash_flow_forecast with quarters 4' in rule
    assert "never in cash_waterfall" in rule


def test_one_figure_questions_go_straight_to_the_aggregate_tools():
    rule = next(line for line in ORCHESTRATOR_PROMPT.splitlines() if line.startswith("- One-figure questions"))
    assert "no subagent" in rule and "quoting its fields exactly" in rule
    assert "compares cash with liabilities" in rule and "follows the Cash position rule" in rule
    lines = ORCHESTRATOR_PROMPT.splitlines()
    dashboard = next(i for i, line in enumerate(lines) if line.startswith("- Dashboard / overview"))
    assert lines.index(rule) < dashboard
    for name in ("get_receivables_by_client", "get_headcount_and_payroll", "get_cash_and_payables"):
        assert name in RESEARCH_AGENT_PROMPT


def test_the_rendering_rule_makes_an_exception_for_one_figure_answers():
    assert "except for a one-figure question" in ORCHESTRATOR_PROMPT


def test_the_totals_the_aggregate_tools_return_are_not_called_unavailable():
    assert "a payroll total, an overdue total" not in ORCHESTRATOR_PROMPT
    rule = next(line for line in ORCHESTRATOR_PROMPT.splitlines() if line.startswith("- A total or sum no tool returned"))
    assert "get_headcount_and_payroll" in rule and "get_receivables_by_client" in rule
    assert "Never add figures yourself" in rule


def test_research_is_not_asked_to_aggregate():
    assert "Include totals, aggregates" not in RESEARCH_AGENT_PROMPT
    assert "Never add up" in RESEARCH_AGENT_PROMPT


def test_forward_looking_routing_excludes_what_if_growth():
    rule = next(line for line in ORCHESTRATOR_PROMPT.splitlines() if line.startswith("- Use do_projections (not do_research)"))
    assert "except what-if growth questions" in rule


def test_prompt_routes_what_if_to_a_card():
    rule = next(line for line in ORCHESTRATOR_PROMPT.splitlines() if line.startswith("- What-if growth questions"))
    assert "render_chat_visual" in rule
    assert 'dataset="revenue_forecast"' in rule and '"cash_flow_forecast"' in rule
    assert "quarters=<asked, 1-8>" in rule and "growth_pct=<asked, -50..50>" in rule
    assert "Never compute totals or differences" in rule
    # No line may route a what-if question through do_projections, except the lines that exclude it.
    for line in ORCHESTRATOR_PROMPT.splitlines():
        if "do_projections" in line and "except what-if growth questions" not in line and "Exception:" not in line:
            assert "what-if" not in line.lower() and "what if" not in line.lower(), line
    critical = next(line for line in ORCHESTRATOR_PROMPT.splitlines() if line.startswith("- CRITICAL: ALWAYS call do_research"))
    assert "Exception: a what-if growth question calls render_chat_visual directly" in critical
