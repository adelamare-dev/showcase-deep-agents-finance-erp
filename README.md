# Deep Agents Finance ERP

A small finance ERP whose AI assistant orchestrates sub-agents you can watch, asks for your approval before it acts, and quotes only figures that the ERP itself holds. Ask for a cash flow dashboard, a list of overdue invoices or a what-if on revenue; approve a supplier payment and see the cash and the bills change on screen.

**Status.** A working base for a demo, not a finished one. The reference scenario (click "Cash Flow Dashboard", get a complete dashboard, then ask a follow-up question) has not passed five times in a row yet. See [Measured behaviour](#measured-behaviour) and [Known limits](#known-limits).

**Stack:** Next.js 16 (frontend) + FastAPI / LangGraph (agent, owns the data) + CopilotKit (AI layer) + Mistral models. No database is required.

**Highlights:**

- 7 frontend tools (6 UI + 1 human-in-the-loop approval), all registered with `useRenderTool`
- 12 dashboard widget types with 4 pre-built templates (Executive Summary, Cash Flow Risk, Cost Control, Revenue Overview)
- Dashboard gallery (`/dashboards`) for browsing, loading, saving, and deleting layouts (saved layouts live in the browser's `localStorage` under a versioned key; dashboards saved under an older version are ignored)
- Multi-agent orchestration: orchestrator + research subagent (14 tools) + projections subagent (6 tools), with each subagent step listed live on its card
- Human-in-the-loop approval that really pays supplier bills and marks reorders as on order, with the change highlighted on screen
- No figure on a card or chart comes from the model: it names a dataset, the code fills in the numbers

## Prerequisites

- [Node.js](https://nodejs.org/) 20.9+ (`.nvmrc` pins 24) and [pnpm](https://pnpm.io/) 11
- [uv](https://docs.astral.sh/uv/) 0.11+ (it provisions Python 3.12 for the agent)
- A Mistral API key (free, see below)
- Docker is **not** needed (the Postgres files in `templates/postgres/` are an archive, wired to nothing)

On Windows, clone to a short path (for example `C:\dev\erp`): a deep path pushes files in `agent/.venv` past the 260-character `MAX_PATH` limit and `uv sync` fails.

## Get a free Mistral key

1. Sign in to [console.mistral.ai](https://console.mistral.ai/). Free mode needs no credit card; usage and rate limits apply (checked 2026-11-04 on [docs.mistral.ai](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key)).
2. Open **API Keys** ([console.mistral.ai/api-keys](https://console.mistral.ai/api-keys)), choose **New key**, give it a name and an expiration date, and create it.
3. Copy the key once; it is put in `agent/.env` below and nowhere else.

Only the `ministral` family answers on a free account in this project's tests (`ministral-14b-2512` is used for every role), and the free tier often answers 429 "not enough capacity". See [Known limits](#known-limits).

## Quick start

```bash
pnpm install                          # installs the web app and syncs the agent environment (uv sync)
cp agent/.env.example agent/.env      # then set MISTRAL_API_KEY in agent/.env
pnpm demo                             # builds the web app, then web on :3000 and agent on :8123
```

Open [http://localhost:3000](http://localhost:3000). Use `localhost`: `127.0.0.1:3000` or a fallback port is refused by CORS and shows "Could not load the company data".

The agent service must be running for any page to show, since all data comes from it. It refuses to start without `MISTRAL_API_KEY` and names `agent/.env`.

For development with hot reload, use `pnpm dev` instead of `pnpm demo`.

## Environment variables

### `agent/.env`

| Variable            | Description                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `MISTRAL_API_KEY`   | Mistral API key, required                                                                             |
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
| `pnpm lint`        | ESLint (web app only)                                |
| `pnpm test:agent`  | Agent tests (pytest, offline)                        |
| `pnpm e2e:build`   | Assemble the browser scenarios                       |

## Tests

- **Agent:** `pnpm test:agent` runs pytest in `agent/`. It makes no model call and needs no real key (`uv` itself needs network access for its malware check).
- **Browser scenarios:** they live in `e2e/scenarios/` and are driven by the Playwright MCP plugin, not by a test runner: the repo has no Playwright dependency.

```bash
pnpm e2e:build      # assembles helpers + each scenario into .playwright-mcp/scenarios/<name>.js
pnpm e2e:build offline   # only the scenarios whose name contains "offline"
```

Start the servers with `pnpm demo`, then run a built file with the plugin's `browser_run_code_unsafe` tool and `filename: ".playwright-mcp/scenarios/offline.pages.js"`. A scenario passes when the tool returns `passed` with an empty `failed` list.

| Group | Needs |
| --- | --- |
| `offline.*` | `pnpm demo` with any non-empty `MISTRAL_API_KEY`; no model is called |
| `live.*` | `pnpm demo` with a real key; spends free-tier quota, and a 429 loses the run |
| `stub.*` | A local stand-in for the Mistral API, no credits: `node e2e/fixtures/stack.mjs` (Windows only, it stops processes with `taskkill`) |

See `e2e/README.md` for the details.

## Measured behaviour

Models: `ministral-14b-2512` for the orchestrator and both subagents, free tier, dated ids only.

**Reference scenario** (`e2e/scenarios/live.reference.js`): a click on "Cash Flow Dashboard" must build the complete dashboard, with figures equal to the store, and the follow-up question must then be answered correctly. Result: **not proven, 0 of 5 consecutive passes.** The pass criterion is **60 s** from click to complete dashboard (the allowed fallback after reducing calls and trying a larger model, which this account cannot use); **45 s** remains the target and is not reliably met.

On 2026-11-03, across several prompt states: 21 live runs, 11 lost (9 to a 429, 1 to a read timeout, 1 that ended without a dashboard), 10 valid dashboards, all complete with figures equal to the store. Of the 10, 5 were within 45 s and the same 5 within 60 s; the time depends strongly on the model service's load, from 26 to 141 s. No run has yet passed from the dashboard through the follow-up question; in one run the follow-up said "$68,105 owed to suppliers" while the store held $11,050. Prompts were changed between runs, and each change reset the count.

**Suggestions and likely free questions** (`e2e/scenarios/live.questions.js`): each of the 18 entries run three times on 2026-11-04, on one commit, each on a fresh thread after a data reset, with no run lost to a 429. Figures on screen are compared with the store.

| Entry | Passes |
| --- | --- |
| Cash Flow Dashboard | 2 of 3 |
| Cash Position (typed) and its chart chip | 3 of 3 each |
| Overdue Invoices | 3 of 3 |
| Cash Flow Chart | 3 of 3 |
| Approve Payments | 0 of 3 |
| Reorder Inventory (no longer offered) | 2 of 3 |
| Cost Control Dashboard (no longer offered) | 2 of 3 |
| Which supplier bills are still unpaid? | 3 of 3 |
| Low stock | 3 of 3 |
| Biggest expense categories | 3 of 3 |
| Budget | 3 of 3 |
| Receivables and overdue | 3 of 3 |
| "What is our ESG score?" (answers "I don't have this data") | 3 of 3 |
| Which client owes us the most? | 1 of 3 |
| Cash position and payables | 2 of 3 |
| What-if of 12% over 6 quarters | 1 of 3 |
| Headcount and payroll | 1 of 3 |

Counts vary between replays: an earlier series on mixed versions gave other counts (for example Cash Position 0 of 3, then 3 of 3), so read these as one sample of three, not as a rate.

## Known limits

- **Approve Payments** (0 of 3) lists the bills due this week and leaves off the one bill already overdue ($1,850). The model narrows its own query to "due this week"; no tool filters it out. The total on the card is right and rejecting changes nothing.
- **Cash Flow Dashboard** (2 of 3): in one run the model loaded a saved template instead of building the dashboard, which misses the Cash and Accounts Payable cards and the supplier bills.
- **Removed suggestions.** "Cost Control Dashboard" (2 of 3: one comment quoted a figure the store does not hold) and "Reorder Inventory" (2 of 3: one item left off the card) are no longer offered on the first screen; both can still be typed.
- **Not covered** (the model wrote a figure the store does not hold, or named the wrong record): which client owes the most (it picks a draft invoice), the cash and payables follow-up (once showed the overdue receivables as payables), a what-if over 6 quarters (rounded or truncated values), and headcount and payroll (sums of its own). The percentages the model writes in a comment are not checked and vary from run to run.
- **Free-tier capacity.** Mistral often answers a call with a 429 "not enough capacity" that an automatic retry does not always cure, so a live run can be lost to it: replay it after a few minutes.
- **Windows only** for the stub stack launcher; validated at 1280x720, no mobile layout.

## When something fails

A failed answer (rate limit, model service error, agent not reachable) is shown above the chat input in plain words, with a **Retry** that runs the assistant again on the same conversation without adding a message. A model rate limit is retried once automatically per model call, after the `Retry-After` delay when it is 8 s or less, or after 2 s when Mistral sends none. If the figures cannot be reloaded, the page keeps the old ones and says they may be out of date, with a Retry.

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

## Going further

- [`templates/postgres/`](templates/postgres/README.md): an archived Postgres setup (wired to nothing) and how to derive a private, persistent copy of this public repo.
- [`docs/vite-migration.md`](docs/vite-migration.md): a note on moving from Next to React + Vite. Nothing has been migrated.

## Credit and licence

This repository is a standalone fork of the [Deep Agents Finance ERP showcase](https://github.com/CopilotKit/CopilotKit/tree/main/examples/showcases/deep-agents-finance-erp) from [CopilotKit](https://github.com/CopilotKit/CopilotKit), released under the MIT licence (see `LICENSE`). No resync with the original is planned.
