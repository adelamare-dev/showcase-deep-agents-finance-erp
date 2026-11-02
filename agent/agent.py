"""Finance ERP agent — orchestrator with thread-isolated research & projections tools."""

from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

from copilotkit import CopilotKitMiddleware
from deepagents import (
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    create_deep_agent,
    register_harness_profile,
)
from langgraph.checkpoint.memory import MemorySaver

from frontend_tools import frontend_tools
from isolated_subagents import do_research, do_projections
from models import orchestrator_chat_model
from prompts import ORCHESTRATOR_PROMPT

# Deep Agents adds a virtual filesystem and a `task` tool by default. The demo
# agent needs neither: its subagents run as the `do_research` and
# `do_projections` tools. The profile key is the provider name `ChatMistralAI`
# reports, so it applies to every Mistral client in the process.
register_harness_profile(
    "mistral",
    HarnessProfile(
        excluded_tools=frozenset(
            {"ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep"}
        ),
        general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
    ),
)


def build_agent():
    """Build the Finance ERP orchestrator with thread-isolated subagent tools."""
    return create_deep_agent(
        model=orchestrator_chat_model(),
        tools=[*frontend_tools, do_research, do_projections],
        system_prompt=ORCHESTRATOR_PROMPT,
        middleware=[CopilotKitMiddleware()],
        checkpointer=MemorySaver(),
    )
