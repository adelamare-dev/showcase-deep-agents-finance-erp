"""Finance ERP Agent — FastAPI + CopilotKit AG-UI entry point."""

import os

from dotenv import load_dotenv

load_dotenv()

from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent
from copilotkit.langgraph import copilotkit_customize_config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent import build_agent
from erp_api import router as erp_router
from frontend_tools import ui_tools, hitl_tools
from isolated_subagents import do_research, do_projections
from models import ORCHESTRATOR_RECURSION_LIMIT

app = FastAPI(title="Finance ERP Agent")

# The browser reads the ERP routes directly; only the web app's origin may.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(erp_router)

agent_graph = build_agent()

# Emit frontend tools + isolated subagent tools so their status shows in chat.
# The `task` tool is excluded from the graph: subagents run as the isolated
# `do_research` and `do_projections` tools instead.
_emit_tool_names = (
    [t.name for t in ui_tools]
    + [t.name for t in hitl_tools]
    + [do_research.name, do_projections.name]
)
agui_config = copilotkit_customize_config(
    emit_tool_calls=_emit_tool_names,
    emit_messages=True,
)
agui_config["recursion_limit"] = ORCHESTRATOR_RECURSION_LIMIT

add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="finance_erp_agent",
        description=(
            "A finance ERP assistant that can analyze invoices, review accounts, "
            "check inventory levels, manage HR data, generate financial reports, "
            "and provide actionable business insights."
        ),
        graph=agent_graph,
        config=agui_config,
    ),
    path="/copilotkit/agents/finance_erp_agent",
)


@app.get("/health")
async def health():
    return {"status": "ok"}
