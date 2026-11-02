# AGENTS.md — agent/ (Python)

## Scope

FastAPI + LangGraph service that exposes the `finance_erp_agent` graph over AG-UI on `127.0.0.1:8123`, and the ERP data over `GET /api/erp/snapshot`. The Next runtime calls the agent (`/api/copilotkit`); the browser reads only the snapshot route directly. The front end lives at the repo root (`src/`), not here.

## Commands

- Resync the environment: `uv sync` (already run by `pnpm install`).
- Dev server: `uv run uvicorn main:app --host 127.0.0.1 --port 8123 --reload`.
- Tests: `uv run pytest -q`. They run offline: `tests/conftest.py` sets a fake key, and the model is simulated or stopped before any network call.
- Adding a dependency: `uv add <pkg>`, then check that `exclude-newer`, `no-build` and `malware-check` in `pyproject.toml` do not refuse it. An exception is justified, never a loosened rule.

## Conventions

- `load_dotenv()` at the top of the module, **before** any import that reads the environment (`main.py`, `agent.py`).
- One domain module per role: `erp_seed.py` (starting data set, dates as day offsets) and `erp_store.py` (`ErpStore`, `get_store()`) for data; `erp_api.py` (`/api/erp/*` routes); `tools.py` (read tools and forecast calculations, no data of its own, `research_tools` / `projections_tools`); `frontend_tools.py` (UI `ui_tools` + human-in-the-loop `hitl_tools`); `isolated_subagents.py` (`do_research` / `do_projections`).
- A `@tool` docstring is the description the model sees: keep it in English, and know that changing it changes the agent's behaviour.
- Prompts are upper-case constants in `prompts.py`; no spec or plan identifier in any text sent to the model.

## Boundaries

- Modules import **flat** (`from tools import research_tools`): they resolve only when the process starts with `agent/` as the working directory. Run `uv run ...` from `agent/`, never from the root.
- `agent/` is covered by neither ESLint nor tsconfig: `pnpm lint` and `pnpm build` say nothing about this folder.
- **Single source of data.** Every figure comes from `get_store()`: a process-wide singleton, not the FastAPI lifespan, because tools run outside requests and in threads; a `threading.Lock` guards `reset` and mutations. Amounts are **whole dollars (`int`)**, so sums are exact and `assets == liabilities + equity` is tested with `==`. Derived values (totals, KPIs, aging, the `overdue` status, quarter labels) are computed at read time. Tests pass a fixed `as_of` (year end, 29 February, quarter start) through the `store` fixture.
- **Known gap.** `render_chat_visual` and the `custom_chart` widget still take their data from the model's arguments (see `frontend_tools.py`), and `request_approval` only returns the user's answer: it updates no record in the store.
- CORS is limited to `FRONTEND_ORIGIN` (default `http://localhost:3000`), methods `GET` and `POST`. A page opened on `127.0.0.1:3000` is refused.
- `agent/.env` holds `MISTRAL_API_KEY` and is not readable by agents. To check it is set, print only `bool(os.environ.get("MISTRAL_API_KEY"))`.
- Subagents run in a `ThreadPoolExecutor` **by design**: LangChain callbacks do not cross the thread boundary, which keeps internal events out of the chat. Do not replace them with `subagents=[...]`.
- `MemorySaver` is the checkpointer: state does not survive a server restart, on purpose for the demo.
- Models: every Mistral client is built in `models.py` (dated ids, timeout, a single attempt). The orchestrator uses `_StreamingToolCallMistral`: Mistral delivers a tool call in one chunk carrying `finish_reason`, which `ag_ui_langgraph` would ignore without this re-splitting.
- The harness profile is registered under the key `mistral` (the one `ChatMistralAI` declares): it removes the virtual file system and the `task` tool. `build_agent()` is called only from `main.py`; `tests/test_agent_tools.py` pins the list of 9 exposed tools.
- `CopilotKitMiddleware` already serializes AG-UI `Context` objects (copilotkit 0.1.96): no `json.dumps` patch is needed, and a test guards it.

Up: see the root `AGENTS.md` for working principles, repo rules and verification.

## Meta — keeping this file alive

- A stale rule is deleted, not left in place.
- Every added rule traces to an observed fact; otherwise `TODO: verify`.
- Never update without explicit confirmation. Above 150 lines, condense before adding.
