# Deep Agents Finance ERP

A small finance ERP whose AI assistant orchestrates sub-agents you can watch, asks for your approval before it acts, and shows only ERP figures on its cards and charts. The figures it writes in the chat text come from the books or from tool results (a subagent's figures are judged by its data tools' outputs, not by its own prose), and one that cannot be matched is badged "unverified". The model varies between runs, so a free question can still end on a badge (see [Known limits](#known-limits)). Ask for a cash flow dashboard, a list of overdue invoices or a what-if on revenue; approve a supplier payment and see the cash and the bills change on screen.

**Status.** Version 0.5.4. The reference scenario (click "Cash Flow Dashboard", get a complete dashboard, approve the payments, then ask a follow-up question) passed five times in a row, and the 18 suggestions and likely questions each passed 3 of 3 on one commit (`b78f895`, 2026-11-12, API pay-as-you-go). Model output varies between runs, so these are measurements, not guarantees. See [Measured behaviour](#measured-behaviour) and [Known limits](#known-limits).

**Stack:** Next.js 16 (frontend) + FastAPI / LangGraph (agent, owns the data) + CopilotKit (AI layer) + Mistral models. No database is required.

**Highlights:**

- 7 frontend tools (6 UI + 1 human-in-the-loop approval), all registered with `useRenderTool`
- 12 dashboard widget types with 4 pre-built templates (Executive Summary, Cash Flow Risk, Cost Control, Revenue Overview)
- Dashboard gallery (`/dashboards`) for browsing, loading, saving, and deleting layouts (saved layouts live in the browser's `localStorage` under a versioned key; dashboards saved under an older version are ignored)
- Multi-agent orchestration: orchestrator (with 3 exact-aggregate tools for one-figure questions) + research subagent (17 tools) + projections subagent (6 tools) that the orchestrator can call in one message, with each subagent step listed live on its card
- Human-in-the-loop approval that really pays supplier bills and marks reorders as on order, with the change highlighted on screen. Approve Payments covers the unpaid bills due within the next 7 days and the overdue ones, the code picks them, and the decision stays in the thread as a receipt
- After a payment, the cash card already in the chat keeps its first figures struck through beside the new ones
- A what-if on revenue or cash (growth and quarters) is answered with a forecast card whose figures come from the catalog
- No figure on a card or chart comes from the model: it names a dataset, the code fills in the numbers
- Figure guard: every dollar amount, percentage and count in the assistant's text must match this turn's tool results, the store or your own message; otherwise it is retried once, then shown with an "unverified" badge. An amount written with K, M or B (or thousand, million, billion) is admitted at the decimals actually written, zero included ("$730K" for $729,850, "$1M" for $1,045,000); percentages keep at least one decimal and unscaled amounts stay exact to the cent. When an amount was rounded, the retry names the exact tool value it came from. "Checking figures…" shows while the reply is prepared
- Rules fallback: when the model service is out of capacity on the "Cash Flow Dashboard" request, the dashboard is built from the store by fixed rules, with no model call, and a card says "Model unavailable — built from rules"

## Prerequisites

- [Node.js](https://nodejs.org/) 20.9+ (`.nvmrc` pins 24) and [pnpm](https://pnpm.io/) 11
- [uv](https://docs.astral.sh/uv/) 0.11+ (it provisions Python 3.12 for the agent)
- A Mistral API key (see below: free mode is too limited for a live run)
- Docker is **not** needed (the Postgres files in `templates/postgres/` are an archive, wired to nothing)

On Windows, clone to a short path (for example `C:\dev\erp`): a deep path pushes files in `agent/.venv` past the 260-character `MAX_PATH` limit and `uv sync` fails.

## Get a Mistral key

1. Sign in to [console.mistral.ai](https://console.mistral.ai/). Free mode needs no credit card (checked 2026-11-04 on [docs.mistral.ai](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key)).
2. Open **API Keys** ([console.mistral.ai/api-keys](https://console.mistral.ai/api-keys)), choose **New key**, give it a name and an expiration date, and create it.
3. Copy the key once; it is put in `agent/.env` below and nowhere else.

**Free mode or API pay-as-you-go.** Free mode includes about $10 of usage a month, renewing (as shown in the Mistral console on 2026-11-08), but the API is held to the free-tier limits: since 2026-11-07, 2 requests per minute per `ministral` model, and a dashboard makes 8 to 10 model calls, so a live run is unusable (it often ends on a 429). To run the demo live, enable **API pay-as-you-go** in the Mistral console (billing; not "Pay-as-you-go for Vibe Code"). The API then consumes prepaid credits and its limits are those the demo needs: measured on 2026-11-08 on this project's key, `ministral-14b-2512` answered 120 requests and 1,500,000 tokens per minute, and `ministral-8b-2512` 750 requests per minute. Set a spending cap in the console. The project uses `ministral-14b-2512` for every role in both cases. See [Known limits](#known-limits).

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
| `FRONTEND_ORIGIN`   | Browser origin allowed by CORS and by the agent's Origin check (default: `http://localhost:3000`)     |

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
| `pnpm e2e`         | Browser scenarios, offline and stub (starts its servers) |
| `pnpm e2e:live`    | Live scenarios against a running `pnpm demo`         |
| `pnpm e2e:build`   | Assemble the scenarios for the Playwright plugin     |

## Tests

- **Agent:** `pnpm test:agent` runs pytest in `agent/`. It makes no model call and needs no real key (`uv` itself needs network access for its malware check).
- **Browser scenarios:** they live in `e2e/scenarios/` and run under `@playwright/test` or through the Playwright MCP plugin, from one source.

```bash
pnpm exec playwright install chromium   # once
pnpm e2e            # builds the web app, starts stub + agent + web, runs the offline and stub projects (ports 8790, 8123, 3000 must be free)
pnpm e2e:live       # live project against a running `pnpm demo` with a real key (E2E_ONLY=3,5 selects entries of live.questions)
pnpm e2e:build      # assembles helpers + each scenario into .playwright-mcp/scenarios/<name>.js
pnpm e2e:build offline   # only the scenarios whose name contains "offline"
```

For the plugin path, start the servers with `pnpm demo`, then run a built file with the plugin's `browser_run_code_unsafe` tool and `filename: ".playwright-mcp/scenarios/offline.pages.js"`. A scenario passes when the tool returns `passed` with an empty `failed` list.

| Group | Needs |
| --- | --- |
| `offline.*` | `pnpm demo` with any non-empty `MISTRAL_API_KEY`; no model is called |
| `live.*` | `pnpm demo` with a real key; needs API pay-as-you-go (free mode is limited to 2 requests per minute), and a 429 loses the run |
| `stub.*` | A local stand-in for the Mistral API, no credits: `node e2e/fixtures/stack.mjs` (Windows only, it stops processes with `taskkill`); `pnpm e2e` starts the same servers itself on any OS, except `stub.agent-down`, which only the plugin plays |

See `e2e/README.md` for the details.

## Measured behaviour

Models: `ministral-14b-2512` for the orchestrator and both subagents, dated ids only; the orchestrator calls the research and projections subagents in one message. The measurements below are labelled with their date; those before 2026-11-08 ran on free mode, and the 2026-11-07 ones at its 2 requests per minute. Everything from 2026-11-09 ran on API pay-as-you-go, with no 429 in any pass.

**Reference scenario** (`e2e/scenarios/live.reference.js`): a click on "Cash Flow Dashboard" must build the complete dashboard, with figures equal to the store, and the follow-up question must then be answered correctly. Result on `b78f895` (2026-11-12, `ministral-14b-2512`, no 429, no rules fallback): **5 of 5 consecutive passes**. Each pass clicked "Cash Flow Dashboard", approved the supplier payments in the chat, then asked a follow-up. Click to complete dashboard: 23.5, 20.8, 22.6, 22.9 and 21.4 s (median 22.6 s, maximum 23.5 s); the pass criterion is **60 s** and **45 s** remains the target. Each dashboard had 4 widgets (metric cards, AR aging gauge, supplier bills, cash flow forecast chart); the research subagent listed 6 steps (5 in the last pass) and the projections subagent 1, overlapping. The approval card showed 4 bills for $50,650; Cash went from $1,092,000 to $1,041,350 and payables from $59,850 to $9,200, equal to the store, and the follow-up answer quoted $1,041,350 and $9,200. 11 to 12 model calls per pass.

**Parallel subagents** (2026-11-09, `live.dashboard`, 10 valid runs per variant, no 429, every figure equal to the store). Both variants have the orchestrator call the two subagents in one message. With everything on `ministral-14b-2512`: dashboard in a median of 20.9 s (17.8 to 38.6 s), 7 model calls at the median (7 to 10). With the subagents on `ministral-8b-2512`: median 21.55 s (15.1 to 28.9 s), 8 model calls at the median (7 to 9). Both met the bar (at most 1 failure, median 45 s or less, none over 60 s, no wrong figure); the all-14b variant has the lower median and ships: the parallel call is on and every role uses `ministral-14b-2512`. The gap between medians (0.65 s) is within the noise of ten runs.

**Suggestions and likely free questions** (`e2e/scenarios/live.questions.js`, 18 entries, 3 valid runs each on a fresh thread after a data reset). Figures on screen are compared with the store. Eight full passes (the first five on 2026-11-09, the last three on 2026-11-12), each on the commit named, none with a 429:

| Commit | Entries at 3 of 3 | Runs passed | Entries below 3 of 3 |
| --- | --- | --- | --- |
| `41b0900` | 16 of 18 | 51 of 54 | Cash Flow Dashboard (2), Cost Control Dashboard (1) |
| `e5add81` | 17 of 18 | 53 of 54 | Cash Flow Chart (2) |
| `6187546` | 16 of 18 | 52 of 54 | Cash Position (2), Budget (2) |
| `8c636d3` | 17 of 18 | 53 of 54 | Budget (2) |
| `d4da505` | 15 of 18 | 51 of 54 | Unpaid supplier bills (2), Biggest expense categories (2), Budget (2) |
| `ae13351` | 17 of 18 | 53 of 54 | Budget (2) |
| `bba2417` | 17 of 18 | 52 of 54 | Biggest expense categories (1) |
| **`b78f895`** | **18 of 18** | **54 of 54** | none |

Two partial replays (2026-11-09): `80e5ee1` ran entries 0 to 7 only (23 of 24 runs; Cost Control Dashboard 2 of 3), and `73ec40b` replayed Budget alone (3 of 3) on the same demo as `8c636d3`, after a fix to the check.

One run per entry (2026-11-21, `e585b26`, Next 16.4.6, CopilotKit 1.88.0, no prompt, tool or model change since `b78f895`): 18 of 18 entries passed at the first run; no 429, no fallback, no run discarded.

The threshold (all 18 entries at 3 of 3 on one commit) is **met on `b78f895`**: 54 of 54 runs, no 429, no fallback, no discarded run. The two heads before it each missed it by one entry: `ae13351` on Budget (a quarterly profit of "$586K" that the live check did not yet admit, fixed in the check) and `bba2417` on Biggest expense categories (the model added the months itself and the guard badged it, fixed by returning exact category totals and shares with the monthly rows). The final pass, per entry (passes out of 3, median seconds per run):

| Entry | Passes | Median |
| --- | --- | --- |
| Cash Flow Dashboard | 3 | 75.6 |
| Cash Position | 3 | 42.3 |
| Overdue Invoices | 3 | 32.0 |
| Cash Flow Chart | 3 | 43.1 |
| Approve Payments | 3 | 51.2 |
| Reorder Inventory | 3 | 39.9 |
| Cost Control Dashboard | 3 | 41.5 |
| Cash Position Chart | 3 | 23.2 |
| Which client owes us the most? | 3 | 13.3 |
| Cash position and payables | 3 | 13.5 |
| Which supplier bills are still unpaid? | 3 | 20.7 |
| What-if over 6 quarters | 3 | 24.0 |
| Headcount and payroll | 3 | 16.4 |
| Low stock | 3 | 21.1 |
| Biggest expense categories | 3 | 37.3 |
| Budget | 3 | 29.9 |
| Receivables and overdue | 3 | 16.9 |
| "What is our ESG score?" (answers "I don't have this data") | 3 | 14.1 |

The median is the whole scenario run, checks included; the reference series above times the dashboard step alone. Failures seen over the series, by class and what addressed each:

- A closing text after a dashboard that cites figures: the guard treats every figure written after `update_dashboard` as unverified, and the prompt bans figures in that sentence.
- A subagent's rounded "50%" admitted by the guard: its figures are judged by its data tools' outputs, not its prose.
- A guard retry that ended in a model service error: the retry copy drops streamed tool calls.
- A model rounding badged by the guard ("$730,000", then expense category amounts): the figure rule admits K and M amounts at the written decimals, the correction names the exact tool value, and the expense totals and shares come with the monthly rows.
- Gaps in the live check itself (forecast values, growth percentages, quarterly revenue, expenses and profit): the check mirrors those calculations.
- A themed dashboard wiped by a save and reset, or by a reset in the same run as a replacing update: one replacing update, and the web ignores a reset that follows an applied replacement in the same run.
- The supplier-bills question answered by navigating to the invoices page without naming bills: the prompt now requires naming the matching records first.

Counts vary between replays, so read each as one sample of three, not as a rate.

Earlier, off-series checks: on 2026-11-08, on API pay-as-you-go, the supplier-payment approval (selected in code, with overdue bills included) and the reorder approval passed live (`live.approval` 3 of 3 cases in 2 runs on the final fixes); `live.reference` passed 1 of 3 smoke runs because the model wrote sums of its own in the dashboard's closing text, the defect the guard rule and the prompt rule above address. On 2026-11-07, in free mode at 2 requests per minute, the rules fallback built the reference dashboard in 8 s, equal to the store. On 2026-11-06 the reference dashboard was complete in 12.8 to 14.4 s in 5 runs.

## Security

Dependencies follow a strict policy: a 7-day release cooldown, `trustPolicy: no-downgrade`, no exotic or build-script dependencies, and `pnpm audit` at the `high` level.
An exception is always exact and commented; a rule is never loosened. `@copilotkit/react-core` and `@copilotkit/runtime` are pinned exactly (1.88.0): a bump is an explicit decision.
`pnpm audit` currently reports 8 high alerts, all in transitive dependencies of `@copilotkit/*`, none fixable with a safe override:

- `undici` 5.29.0 (5 advisories) and `@fastify/busboy` 2.1.1: not reachable. The WebSocket, TLS and multipart code is never loaded; the patched versions are 6.x/3.x majors.
- `graphql-scalars` 1.26.0 (PhoneNumber ReDoS): not reachable. Only `GraphQLJSONObject` is used; the fix is a 2.x major.
- `zod` 3.25.76 (memory exhaustion on oversized collections): no safe override (4.x major): `@ag-ui/client` and `zod-to-json-schema` need the same zod 3 instance as the schemas they inspect. The demo assumes a trusted machine and network (see below).

**Network exposure.** The demo has no authentication: it assumes one user on one machine. Both servers listen on `127.0.0.1` only (`next dev` and `next start` with `-H 127.0.0.1`, the agent with `--host 127.0.0.1`), so another device on the network cannot reach them. A page from another site can still make your browser send requests to `localhost`, so two checks refuse them:

- The `/api/copilotkit` route answers 403 to a `Host` other than `localhost`, `127.0.0.1` or `[::1]` (a DNS-rebinding page), 403 to a write whose `Origin` is not the app's own, and 415 to a POST that is not `application/json` (a cross-site `text/plain` POST needs no CORS preflight).
- The agent answers 403 to any POST whose `Origin` is not `FRONTEND_ORIGIN`, so a foreign page can neither reset the demo data nor start a run on `:8123`.

Before 0.5.2, a run against the Mistral stub (2026-11-12) showed that a cross-site page could start a run and answer the approval card itself, paying bills without a click; the same requests are now refused. A local process can still call both servers, and no per-run limit bounds model spend (message size, concurrent runs): run the demo on a machine you trust and set a spending cap in the Mistral console. Opening the app from another device would mean dropping `-H 127.0.0.1` and accepting that exposure.

## Known limits

- **Model variance.** The series above passed on one commit, with three runs per entry; it is a sample, not a rate. The model can still round an amount or phrase an answer differently: the figure guard then badges the amount as "unverified", and a question outside the 18 entries has not been measured.
- **Free-mode capacity.** Free mode allows 2 requests per minute per `ministral` model (since 2026-11-07) and often answers a 429 "not enough capacity" that an automatic retry does not always cure, so a live run is lost to it; enable API pay-as-you-go (see "Get a Mistral key"). On pay-as-you-go a 429 is rare (none seen on 2026-11-08, 2026-11-09 or 2026-11-12): replay it after a few minutes. Only the "Cash Flow Dashboard" request has the rules fallback; other requests show the Retry notice.
- **Figure-guard retries.** Each retry of a reply that cites an unmatched figure is one more model request; in free mode it can end on a 429 and the Retry banner.
- **Parallel subagents** (`ORCHESTRATOR_PARALLEL_TOOL_CALLS` in `agent/models.py`) are on, measured on 2026-11-09 (see Measured behaviour).
- **Windows only** for the stub stack launcher; validated at 1280x720, no mobile layout.

## When something fails

A failed answer (rate limit, model service error, agent not reachable) is shown above the chat input in plain words, with a **Retry** that runs the assistant again on the same conversation without adding a message. A model rate limit is retried once automatically per model call, after the `Retry-After` delay when it is 8 s or less, or after 2 s when Mistral sends none. If the figures cannot be reloaded, the page keeps the old ones and says they may be out of date, with a Retry.

`pnpm install` fails with "The malware check could not reach api.osv.dev": uv checks every package against OSV before installing it, and the check is on purpose. Nothing was installed. Check your network or proxy (`HTTPS_PROXY`), then run `pnpm install` again (or `pnpm run postinstall` when nothing else changed).

The app opens with the chat panel open and seven suggestions, "Cash Flow Dashboard" first (Reorder Inventory and Cost Control Dashboard included). Close it with the panel's Close button.

## Replaying the demo

The Settings icon at the bottom of the left bar has one entry, **Reset demo data**. It restores the seeded books, the default dashboard, the dashboards saved in the browser and the subagent steps, and opens a fresh conversation. The first click only arms it (the label becomes "Click again to reset" for 4 seconds); the second click resets. It is disabled while the assistant is answering or an approval card waits for an answer. A pending approval card disappears on reset, because the reset opens a new conversation. If the reset fails, the books and the dashboard stay as they were, the error is shown and the chat is already on a new, empty conversation. Restarting the agent also restores the books.

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
  |  LangGraph Orchestrator (7 frontend tools + 2 subagent tools + 3 aggregate tools)
  |      /         \
  |     v           v
  |  Research    Projections
  |  Sub-agent   Sub-agent
  |  (17 tools)  (6 tools)
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
## Credit and licence

This repository is a standalone fork of the [Deep Agents Finance ERP showcase](https://github.com/CopilotKit/CopilotKit/tree/main/examples/showcases/deep-agents-finance-erp) from [CopilotKit](https://github.com/CopilotKit/CopilotKit), released under the MIT licence (see `LICENSE`). No resync with the original is planned.
