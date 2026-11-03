# End-to-end scenarios

Scenarios are plain JavaScript files run by the Playwright MCP plugin (`browser_run_code_unsafe`). The repo has no Playwright dependency and no test runner.

```
e2e/
  build.mjs                    pnpm e2e:build
  lib/helpers.js               (page) => helpers, one expression
  scenarios/<group>.<name>.js  async (page, h) => { ... }, one expression
```

## Run a scenario

1. `pnpm e2e:build` writes `.playwright-mcp/scenarios/<group>.<name>.js` (gitignored). `pnpm e2e:build live` builds only the names containing `live`.
2. Start the servers it needs, check ports 3000 and 8123 are free first.
3. Call `browser_run_code_unsafe` with `filename: ".playwright-mcp/scenarios/live.agent.js"`.
4. Read the result: `{ passed, failed: [], cases: [...] }`. Any failed case makes the call throw.
5. Stop what you started. Run one scenario at a time: the browser is shared.

| Group | Servers |
|---|---|
| `offline` | `pnpm demo`. No model is called and no message is sent, so any key value works. |
| `live` | `pnpm demo` with a real `MISTRAL_API_KEY` in `agent/.env` |
| `stub` | The stub stack, below. No credit is spent and no real key is needed. |

## The stub stack

`fixtures/mistral-stub.mjs` imitates the Mistral chat completions API (streamed or not). The agent talks to it because `langchain-mistralai` reads `MISTRAL_BASE_URL`; nothing in the shipped code knows about it.

```
pnpm build                                              # the web app is started with `pnpm start`
nohup node e2e/fixtures/stack.mjs --logs <dir> > <dir>/stack.out 2>&1 &
# wait for "stack ready" in stack.out, run the scenario, then:
node e2e/fixtures/stack.mjs stop
```

`stack.mjs` starts the stub (`:8790`, `STUB_PORT` to change it, and keep `STUB_URL` in `lib/helpers.js` in step), then the agent with `MISTRAL_BASE_URL` pointing at the stub and a fake key, then the web app. It refuses to start when 8790, 8123 or 3000 is taken. `stop` kills the whole tree it started. The launcher is Windows only: it stops processes with `taskkill`.

A scenario scripts the model with `h.stubScript([...])`. Each model call takes the next step; an empty queue answers 500. Steps:

| Step | Effect |
|---|---|
| `{ text }` | a streamed text answer |
| `{ toolCall: { name, args } }` | a streamed tool call; `args` is an object |
| `{ text, toolCall }` | both, text first |
| `{ status: 429, retryAfter: 2, message }` | an HTTP error with an optional `Retry-After` (seconds); without it the agent waits 2 s before its one retry |
| any answer step with `hold: true` | the stream stays open after its first chunk until `h.stubRelease()` |

### Scenarios about failures

`stub.failures.js` plays scripted 429 and 500 answers and blocked snapshot requests on the plain stub stack. `stub.agent-down.js` needs the agent stopped, which a scenario cannot do, so the runner plays it three times and the file reads which step it is in:

```
nohup node e2e/fixtures/stack.mjs --allow-agent-exit --logs <dir> > <dir>/stack.out 2>&1 &
# 1. run stub.agent-down.js        -> loads the app (arm)
#    stop only the agent: taskkill /PID <pid listening on 8123> /T /F
# 2. run stub.agent-down.js        -> the agent is down: chat notice, stale figures, error screen
#    start the agent again by hand, with the stack's environment, from agent/:
#    MISTRAL_BASE_URL=http://127.0.0.1:8790/v1 MISTRAL_API_KEY=stub-key uv run uvicorn main:app --host 127.0.0.1 --port 8123
# 3. run stub.agent-down.js        -> Retry on the error screen loads the data
node e2e/fixtures/stack.mjs stop   # then stop the hand-started agent and check 8123 is free
```

Without `--allow-agent-exit` the launcher brings the whole stack down when the agent exits.

`h.stubReset()` empties the queue and the request log; `h.stubRequests()` lists what the agent sent. A scripted `request_approval` takes bill ids read from `h.snapshot()` (`h.payableBillIds`), never hard-coded ones.

## The reference dashboard segment

`h.runDashboardSegment()` clicks the "Cash Flow Dashboard" suggestion and times the dashboard the orchestrator builds. The seconds run from the click to the first scan showing all five elements asked for by the suggestion; they are recorded, not enforced. Each element is accepted from any widget that shows it (widgets carry `data-widget-type`, and a custom chart `data-widget-dataset`):

| Asked for | Accepted widget | Figures compared |
|---|---|---|
| Cash and Accounts Payable KPIs | KPI cards or metric cards (`kpi-Cash`, `kpi-Accounts Payable`) | the card text contains the snapshot KPI value |
| AR aging | the AR aging gauge, or a custom chart on `ar_aging` | gauge: collection rate and bucket amounts from the snapshot; chart: the catalog response seen during the run equals the route's answer when read again |
| Supplier bills due | the bills widget (`outstanding-invoices` in payable mode, titled "Outstanding Bills") | listed bill numbers equal the snapshot bills in the displayed statuses; each row's amount and supplier match |
| Quarterly cash projection | a custom chart on `cash_flow_forecast` or `cash_flow_by_quarter`, or the cash waterfall in waterfall mode | chart: same catalog comparison; waterfall: its cumulative net equals a trailing sum of the snapshot cash flow |

The result is `{ complete, seconds, runSeconds, missing, mismatches, compared, widgets, shown, notices }`; the caller decides what must hold. Start from `h.resetDemo()` so repeated runs are independent.

## The reference scenario

`live.reference.js` is one full pass per run: reset, the dashboard segment (limit `DASHBOARD_MAX_SECONDS` = 60 in the file), subagent cards that show a step before they complete, "Approve Payments" (card total equal to the sum of the store's bills, Cash and Accounts Payable both down by that total, books balanced), then a follow-up question that must state the new cash and payables. Every dollar amount in the chat, read before the approval and again after it, must be a money field of the pass: the store's totals, KPIs, aging buckets, bill amounts, quarterly cash flow and `cash_position` figures, plus the numbers the catalog drew during the dashboard (`catalogNumbers`). "$1.2M" style amounts match within their own rounding. A failure carries the pass data in its error text; the runner records one line per pass (seconds, result, 429 notices) and reads tokens from the agent's `model_usage` log lines. A pass lost to a 429 is discarded and replayed. `stub.reference-retry.js` is the stub-stack proof that a Retry around an approval pays once.

## Rules for a scenario file

- One single expression, no `import`, no `require`, no trailing `;`: the tool runs it in a VM without modules. `build.mjs` rejects a file that is not one expression.
- Everything comes from `h`: `open`, `visit`, `resetDemo`, `sendPrompt`, `waitForRunEnd`, `chatText`, `snapshot`, `moneyIn`, `formatUsd`, `test`, `assert`, `assertEqual`, `expectVisible`, `byId`, and for the stub `stubScript`, `stubRelease`, `stubReset`, `stubRequests`, `payableBillIds`, `openSettings`, `clickReset`, and `runDashboardSegment`.
- `h.resetDemo()` resets through the API and reloads the page; `h.clickReset()` uses the Settings control, which is what a scenario about the control must do.
- Group related checks as named cases with `h.test(name, fn)`; every case runs and failures are collected.
- Compare displayed figures with `h.snapshot()` (`GET /api/erp/snapshot`, served by the agent), never with hard-coded values.
- Validated at 1280x720; `h.open` sets it.

`offline.widgets.js` loads a saved dashboard holding all twelve widget types, with a full config, an empty one and none, through the gallery's Load button and the versioned saved-dashboards storage key. It needs no model, only `pnpm demo` (or `pnpm start` and `pnpm start:agent` with a fake key), and fails on any empty widget, console error or page error.
