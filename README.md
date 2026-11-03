# Deep Agents Finance ERP

A finance ERP showcase powered by CopilotKit deep agents. An AI assistant can analyze invoices, review accounts, check inventory, manage HR data, generate financial reports, compose themed dashboards, and provide actionable business insights.

**Stack:** Next.js 16 (frontend) + FastAPI / LangGraph (agent, owns the data) + CopilotKit (AI layer). No database is required.

**Highlights:**

- 7 frontend tools (6 UI + 1 HITL) registered via `useRenderTool` / `useHumanInTheLoop`
- 12 dashboard widget types with 4 pre-built templates (Executive Summary, Cash Flow Risk, Cost Control, Revenue Overview)
- Dashboard gallery (`/dashboards`) for browsing, loading, saving, and deleting layouts (saved layouts live in the browser's `localStorage` under a versioned key; dashboards saved under an older version are ignored)
- Multi-agent orchestration: orchestrator + research subagent (14 tools) + projections subagent (6 tools)
- Human-in-the-loop approval that really pays supplier bills and marks reorders as on order, with the change highlighted on screen

## Prerequisites

- [Node.js](https://nodejs.org/) 20.9+ (`.nvmrc` pins 24) and [pnpm](https://pnpm.io/) 11
- [uv](https://docs.astral.sh/uv/) 0.11+ (it provisions Python 3.12 for the agent)
- An LLM API key (see `agent/.env.example`)

## Quick start

```bash
pnpm install                          # installs the web app and syncs the agent environment (uv sync)
cp agent/.env.example agent/.env      # then set the API key in agent/.env
pnpm dev                              # web on http://localhost:3000, agent on http://127.0.0.1:8123
```

Open [http://localhost:3000](http://localhost:3000). Use `localhost`: `127.0.0.1:3000` or a fallback port is refused by CORS and shows "Could not load the company data".

The agent service must be running for any page to show, since all data comes from it.

For a production-style run, `pnpm demo` builds the web app and starts both servers without hot reload.

## Environment variables

### `agent/.env`

| Variable            | Description                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `MISTRAL_API_KEY`   | Mistral API key (format `mstrl_...`), required                                                        |
| `FRONTEND_ORIGIN`   | Browser origin allowed by CORS (default: `http://localhost:3000`)                                     |

### `.env` at the repo root (optional)

Copy `.env.example` to `.env` to change a default; the web app works without it.

| Variable            | Description                                                                      |
| ------------------- | -------------------------------------------------------------------------------- |
| `REMOTE_ACTION_URL` | Agent URL (default: `http://127.0.0.1:8123/copilotkit/agents/finance_erp_agent`) |
| `COPILOTKIT_TELEMETRY_DISABLED` | CopilotKit telemetry is off by default; set to `false` to opt in         |
| `NEXT_PUBLIC_ERP_API_URL` | Agent URL the browser reads the company data from (default: `http://localhost:8123`) |

## Scripts

| Script             | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `pnpm dev`         | Web (hot reload) and agent (auto-reload) together    |
| `pnpm demo`        | Build, then run web and agent without hot reload     |
| `pnpm build`       | Production build of the web app                      |
| `pnpm lint`        | ESLint                                               |
| `pnpm test:agent`  | Agent tests (pytest)                                 |

## End-to-end tests

Browser scenarios live in `e2e/scenarios/` and are driven by the Playwright MCP plugin, not by a test runner: the repo has no Playwright dependency.

```bash
pnpm e2e:build      # assembles helpers + each scenario into .playwright-mcp/scenarios/<name>.js
```

Start the servers (`pnpm demo`; live scenarios need a real `MISTRAL_API_KEY` in `agent/.env`), then run a built file with the plugin's `browser_run_code_unsafe` tool and `filename: ".playwright-mcp/scenarios/live.agent.js"`. A scenario passes when the tool returns `passed` with an empty `failed` list. Scenarios that need a scripted model (`stub.*`) run on a local stand-in for the Mistral API and cost no credits: `node e2e/fixtures/stack.mjs` starts it with the agent and the web app (Windows only: it stops processes with `taskkill`). See `e2e/README.md`.

## Replaying the demo

The Settings icon at the bottom of the left bar has one entry, **Reset demo data**. It restores the seeded books, the default dashboard, the dashboards saved in the browser and the subagent steps, and opens a fresh conversation. It is disabled while the assistant is answering. Restarting the agent also restores the books.

## Architecture

```
Browser (:3000)
  |
  |  Next.js API route (/api/copilotkit)
  |       |
  |       v
  |  CopilotKit Runtime (HttpAgent)
  |       |  AG-UI / SSE
  |       v
  |  FastAPI (:8123)
  |       |
  |       v
  |  LangGraph Orchestrator (7 frontend tools + 2 subagent tools)
  |      /         \
  |     v           v
  |  Research    Projections
  |  Sub-agent   Sub-agent
  |  (14 tools)  (6 tools)
  |     |
  |     v
  |  ERP store (in memory) — every figure the agent quotes and the pages show;
  |  served to the browser at /api/erp/snapshot, and as charts and cards
  |  by the dataset catalog at /api/erp/datasets/{id}
  |
```

## Pages

| Route         | Description                                                              |
| ------------- | ------------------------------------------------------------------------ |
| `/`           | Dashboard — KPI cards, charts, transactions, invoices (agent-composable) |
| `/dashboards` | Gallery — browse templates, save/load/delete custom layouts              |
| `/invoices`   | Invoice list with filtering and summary cards                            |
| `/accounts`   | Chart of accounts and transaction ledger                                 |
| `/inventory`  | Stock management and reorder alerts                                      |
| `/hr`         | Employee directory and department breakdown                              |
