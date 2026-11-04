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

## Measured behaviour

On the free tier with `ministral-14b-2512`, a click on "Cash Flow Dashboard" builds the complete dashboard, with figures equal to the store, in 26 to 141 s depending on the model service's load. The scenario's pass criterion is 60 s (the allowed fallback after reducing calls and trying a larger model, which this account cannot use); 45 s remains the target and is not reliably met. Mistral often answers a call with a 429 "not enough capacity" that an automatic retry does not always cure, so a live run can be lost to it: replay it after a few minutes. The reference scenario (`e2e/scenarios/live.reference.js`) has not yet passed five times in a row.

Measured on 2026-11-03 across several prompt states: 21 live runs, 11 lost (9 to a 429, 1 to a read timeout, 1 that ended without a dashboard), 10 valid dashboards; of those 10, 5 were within 45 s and those same 5 were also within 60 s, so 5 runs were within 60 s in all (the first two, before the prompt changes, took 138 and 141 s).

Every suggestion and ten likely free questions (18 entries, `e2e/scenarios/live.questions.js`) were run three times each on 2026-11-04, with no run lost to a 429. Three times out of three: "Cash Position", "Overdue Invoices", "Cash Flow Chart", the "Cash Position Chart" chip, and the questions on unpaid supplier bills, low stock, expense categories, budget, receivables and the no-data question ("What is our ESG score?" answers "I don't have this data").

Known limits:

- **Approve Payments** (0 of 3) lists the bills due this week and leaves off the one bill already overdue ($1,850). The model narrows its own query to "due this week"; no tool filters it out. The total on the card is right and rejecting changes nothing.
- **Cash Flow Dashboard** (2 of 3): in one run the model loaded a saved template instead of building the dashboard, which misses the Cash and Accounts Payable cards and the supplier bills.
- **Removed suggestions.** "Cost Control Dashboard" (2 of 3: one comment quoted a figure the store does not hold) and "Reorder Inventory" (2 of 3: one item left off the card) are no longer offered on the first screen; both can still be typed.
- **Not covered** (the model wrote a figure the store does not hold, or named the wrong record): which client owes the most (it picks a draft invoice), the cash and payables follow-up (once showed the overdue receivables as payables), a what-if over 6 quarters (rounded or truncated values), and headcount and payroll (sums of its own). The percentages the model writes in a comment are not checked and vary from run to run.

## When something fails

A failed answer (rate limit, model service error, agent not reachable) is shown above the chat input in plain words, with a **Retry** that runs the assistant again on the same conversation without adding a message. A model rate limit is retried once automatically per model call, after the `Retry-After` delay when it is 8 s or less, or after 2 s when Mistral sends none. If the figures cannot be reloaded, the page keeps the old ones and says they may be out of date, with a Retry. The agent refuses to start without `MISTRAL_API_KEY` and names `agent/.env`.

The app opens with the chat panel open and "Cash Flow Dashboard" as the first suggestion. Close it with the panel's Close button.

## Replaying the demo

The Settings icon at the bottom of the left bar has one entry, **Reset demo data**. It restores the seeded books, the default dashboard, the dashboards saved in the browser and the subagent steps, and opens a fresh conversation. It is disabled while the assistant is answering. A pending approval card disappears on reset, because the reset opens a new conversation. Restarting the agent also restores the books.

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
