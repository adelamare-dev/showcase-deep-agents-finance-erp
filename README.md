# Deep Agents Finance ERP

A finance ERP showcase powered by CopilotKit deep agents. An AI assistant can analyze invoices, review accounts, check inventory, manage HR data, generate financial reports, compose themed dashboards, and provide actionable business insights.

**Stack:** Next.js 16 (frontend) + FastAPI / LangGraph (agent) + Postgres (persistence) + CopilotKit (AI layer)

**Highlights:**

- 7 frontend tools (6 UI + 1 HITL) registered via `useRenderTool` / `useHumanInTheLoop`
- 12 dashboard widget types with 4 pre-built templates (Executive Summary, Cash Flow Risk, Cost Control, Revenue Overview)
- Dashboard gallery (`/dashboards`) for browsing, loading, saving, and deleting layouts
- Multi-agent orchestration: orchestrator + research subagent (13 tools) + projections subagent (6 tools)
- Human-in-the-loop approval for invoice payments and inventory reorders

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

Open [http://localhost:3000](http://localhost:3000). Postgres is optional and only backs saved dashboards: set `DATABASE_URL` in `.env.local` (and run `docker compose up -d` for a seeded database) to enable persistence.

For a production-style run, `pnpm demo` builds the web app and starts both servers without hot reload.

## Environment variables

### `agent/.env`

| Variable            | Description                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `MISTRAL_API_KEY`   | Mistral API key                                                                                       |
| `OPENAI_API_KEY`    | OpenAI API key (currently used by the agent)                                     |
| `OPENAI_MODEL`      | Model to use                                                                                          |
| `LANGCHAIN_API_KEY` | LangSmith key for tracing (optional)                                                                  |

### `.env.local` (optional)

| Variable            | Description                                                                      |
| ------------------- | -------------------------------------------------------------------------------- |
| `REMOTE_ACTION_URL` | Agent URL (default: `http://localhost:8123/copilotkit/agents/finance_erp_agent`) |
| `DATABASE_URL`      | Postgres connection string, e.g. `postgresql://erp_user:erp_password@localhost:5432/finance_erp` |

## Scripts

| Script             | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `pnpm dev`         | Web (hot reload) and agent (auto-reload) together    |
| `pnpm demo`        | Build, then run web and agent without hot reload     |
| `pnpm build`       | Production build of the web app                      |
| `pnpm lint`        | ESLint                                               |
| `pnpm test:agent`  | Agent tests (pytest)                                 |

## Architecture

```
Browser (:3000)
  |
  |  Next.js API route (/api/copilotkit)
  |       |
  |       v
  |  CopilotKit Runtime (LangGraphHttpAgent)
  |       |  AG-UI / SSE
  |       v
  |  FastAPI (:8123)
  |       |
  |       v
  |  LangGraph Orchestrator (7 frontend tools + task)
  |      /         \
  |     v           v
  |  Research    Projections
  |  Sub-agent   Sub-agent
  |  (13 tools)  (6 tools)
  |     |
  |     v
  |  Postgres (:5432) — dashboards, seed data
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
