"""Thread-isolated subagent tools for the Finance ERP orchestrator.

Each tool runs an internal Deep Agent inside a ThreadPoolExecutor, which
breaks LangChain callback propagation at the OS thread boundary. This
prevents subagent events from leaking to the parent's astream_events()
stream (and ultimately the frontend chat).

The tool calls the subagent makes are reported on purpose, as one custom
event each (`subagent_step`) dispatched from the parent's event loop, so the
chat card of the running tool can list them live while no other subagent
event crosses the thread boundary.

Pattern adapted from deep-agents/agent/tools.py.
"""

from __future__ import annotations

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Callable

from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId, tool

from models import SUBAGENT_RECURSION_LIMIT, subagent_chat_model
from prompts import RESEARCH_AGENT_PROMPT, PROJECTIONS_AGENT_PROMPT
from tools import research_tools, projections_tools

# Name of the custom event carrying one subagent tool call.
SUBAGENT_STEP_EVENT = "subagent_step"
# A step shows its arguments as a short preview, never the full payload.
MAX_STEP_ARGS_CHARS = 120

# Same logger as the server's own output, so the lines reach its log.
logger = logging.getLogger("uvicorn.error")


def _stream_subagent(
    query: str,
    system_prompt: str,
    agent_tools: list,
    on_tool_call: Callable[[dict], None],
) -> str:
    """Create and run a deep agent in the current (isolated) thread."""
    from deepagents import create_deep_agent

    agent = create_deep_agent(
        model=subagent_chat_model(),
        system_prompt=system_prompt,
        tools=agent_tools,
        # No middleware — this runs in an isolated thread
    )

    final_state = None
    for mode, chunk in agent.stream(
        {"messages": [HumanMessage(content=query)]},
        config={"recursion_limit": SUBAGENT_RECURSION_LIMIT},
        stream_mode=["updates", "values"],
    ):
        if mode == "values":
            final_state = chunk
            continue
        for update in chunk.values():
            messages = update.get("messages") if isinstance(update, dict) else None
            if not isinstance(messages, list):
                continue
            for message in messages:
                for call in getattr(message, "tool_calls", None) or []:
                    on_tool_call(call)
    return final_state["messages"][-1].content


async def _emit_step(call: dict, config: RunnableConfig, tool_call_id: str) -> None:
    args = json.dumps(call.get("args") or {}, default=str)[:MAX_STEP_ARGS_CHARS]
    logger.info("subagent_step tool=%s", call["name"])
    await adispatch_custom_event(
        SUBAGENT_STEP_EVENT,
        {"toolCallId": tool_call_id, "tool": call["name"], "args": args},
        config=config,
    )


async def _run_subagent(
    query: str,
    system_prompt: str,
    agent_tools: list,
    config: RunnableConfig,
    tool_call_id: str,
) -> str:
    """Run the subagent in its own thread and report each of its tool calls."""
    loop = asyncio.get_running_loop()
    sends: list = []

    def on_tool_call(call: dict) -> None:
        # Runs in the subagent thread: the event must be dispatched on the
        # parent's loop, where the parent's callbacks live.
        sends.append(
            asyncio.run_coroutine_threadsafe(
                _emit_step(call, config, tool_call_id), loop
            )
        )

    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            result = await loop.run_in_executor(
                executor,
                _stream_subagent,
                query,
                system_prompt,
                agent_tools,
                on_tool_call,
            )
    finally:
        # The thread is done, raised or not: every send is registered. Finish
        # them before the card receives its result. A progress event that
        # fails is only logged, so it cannot discard a finished answer.
        outcomes = await asyncio.gather(
            *(asyncio.wrap_future(f) for f in sends), return_exceptions=True
        )
        for outcome in outcomes:
            if isinstance(outcome, BaseException):
                logger.warning("subagent_step event failed: %r", outcome)
    return result


@tool
async def do_research(
    query: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> str:
    """Research the ERP database — invoices, accounts, transactions, inventory,
    employees, financial reports, cash flow analysis, and revenue forecasts.

    Use this tool for any question about current or historical company data.

    Args:
        query: The research question or data request.
    """
    print(f"[TOOL] do_research: query='{query}' (thread-isolated)")
    result = await _run_subagent(
        query, RESEARCH_AGENT_PROMPT, research_tools, config, tool_call_id
    )
    print(f"[TOOL] do_research: completed ({len(result)} chars)")
    return result


@tool
async def do_projections(
    query: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> str:
    """Compute financial projections — revenue forecasts, cash flow projections,
    scenario analysis, and trend analysis from historical data.

    Use this tool for forward-looking questions about future quarters,
    "what-if" scenarios, or trend analysis.

    Args:
        query: The projection or forecast request.
    """
    print(f"[TOOL] do_projections: query='{query}' (thread-isolated)")
    result = await _run_subagent(
        query, PROJECTIONS_AGENT_PROMPT, projections_tools, config, tool_call_id
    )
    print(f"[TOOL] do_projections: completed ({len(result)} chars)")
    return result
