# End-to-end scenarios

Scenarios are plain JavaScript files with two runners over one source: `@playwright/test` (`pnpm e2e`, `pnpm e2e:live`) and the Playwright MCP plugin (`browser_run_code_unsafe`).

```
playwright.config.ts           projects offline / stub / live, and the stub stack as webServer
e2e/
  build.mjs                    pnpm e2e:build (plugin files)
  playwright.live.config.ts    the live project only, no webServer
  lib/helpers.js               (page) => helpers, one expression
  lib/load-scenario.mjs        assembles helpers + one scenario (used by build.mjs and the spec)
  scenarios/<group>.<name>.js  async (page, h) => { ... }, one expression
  specs/scenarios.spec.ts      one test per scenario file
```

## Run with `@playwright/test`

- `pnpm e2e` builds the web app, starts the stub stack (stub, agent, web) and runs the `offline` and `stub` projects. The runner starts and stops the servers; ports 8790, 8123 and 3000 must be free (`reuseExistingServer` is off). `stub.agent-down` is listed as skipped: it needs the agent killed by hand, so only the plugin plays it.
- One scenario: `pnpm e2e -g stub.reset` (pnpm appends the arguments to `playwright test`; the build still runs first).
- `pnpm e2e:live` runs the `live` project against a `pnpm demo` you started yourself with a real `MISTRAL_API_KEY`; it starts no server. Live runs need Mistral's "API pay-as-you-go": in free mode the API is held to 2 requests per minute per `ministral` model (since 2026-11-07), and a dashboard makes 8 to 10 model calls, so most runs end on a 429 (discarded and replayed, never counted). Select with `pnpm e2e:live -g live.agent`. Its timeout is 60 minutes (a whole scenario file is one test, and `live.questions` has 18 entries of up to about 2 minutes each). To play only some entries of `live.questions`, pass their indices in `E2E_ONLY`, for example in PowerShell `$env:E2E_ONLY='3,5'; pnpm e2e:live -g live.questions` (unset it afterwards; a scenario without an entry selection fails while it is set).
- Each test logs `<name>: n/n cases passed` and fails when a case fails, with the failed cases in the error. A `live.*` test also prints one line `live-result <JSON>` before it can fail: `{scenario, startedAt, endedAt, only, passed, failed, cases}` (`only` is `E2E_ONLY` or null; each case carries `ms` and its `data` or `error`), so a series driver can record a failed pass too.
- First time on a machine: `pnpm exec playwright install chromium`.
- `--only=<indices>` (below) is the build-time form of that selection for the plugin path; the runner takes `E2E_ONLY`. Without either, whole files run. The live project runs with a real key (pay-as-you-go, see `pnpm e2e:live` above).

## Run a scenario with the plugin

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

`stack.mjs` starts the stub (`:8790`, `STUB_PORT` to change it, and keep `STUB_URL` in `lib/helpers.js` in step), then the agent with `MISTRAL_BASE_URL` pointing at the stub and a fake key, then the web app. It refuses to start when 8790, 8123 or 3000 is taken. `stop` kills the whole tree it started. The launcher is Windows only: it stops processes with `taskkill`. `pnpm e2e` does not use it: the runner starts the same three servers itself.

A scenario scripts the model with `h.stubScript([...])`. Each model call takes the next step; an empty queue answers 500. Steps:

| Step | Effect |
|---|---|
| `{ text }` | a streamed text answer |
| `{ toolCall: { name, args } }` | a streamed tool call; `args` is an object |
| `{ toolCalls: [{ name, args }, …] }` | several tool calls in one assistant message |
| `{ text, toolCall }` | both, text first |
| `{ status: 429, retryAfter: 2, message }` | an HTTP error with an optional `Retry-After` (seconds); without it the agent waits 2 s before its one retry |
| any step with `delayMs: 3000` | the stub waits that long before it answers |
| any answer step with `hold: true` | the stream stays open after its first chunk until `h.stubRelease()` |

`stub.figures.js` (6 cases) scripts closing texts with correct and invented amounts: a wrong amount is retried and never shown, a wrong amount twice shows the `unverified-figure` badge, a correct one is not badged, "Checking figures…" shows while the reply is prepared (also after a tool result), and an old reply is not badged after an approval changes the books. `stub.parallel.js` scripts one assistant message carrying two tool calls (`toolCalls`) and checks two subagent cards. `stub.fallback.js` (3 cases) scripts a 429 that survives the retry on the reference request, on the orchestrator and inside a subagent, and checks the dashboard built from rules; a 429 on another request still shows Retry. `specs/figure-guard.unit.spec.ts` (titles start `offline.`) runs the TypeScript figure rule on `agent/tests/data/figure_cases.json`, the same cases as pytest. `specs/agent-sync.unit.spec.ts` (titles start `offline.`) checks the message `scripts/agent-sync.mjs` prints when the install-time malware check cannot reach api.osv.dev.

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

`stub.dashboard-options.js` (4 cases) scripts an `update_dashboard` call whose list options (`metrics`, `categories`, `statuses`) arrive as one string each and checks the widgets render with a single item, with no error screen. It also scripts a refused call followed by a corrected one (the refused call adds nothing, the corrected one renders) and an accepted `replace` call with the reference widgets (exactly those widgets remain, the two KPI cards entirely visible at scroll position 0, the gauge and the bills list each starting inside the visible scroll area, and the three rows together within one scroll-area height), then approves supplier payments and checks the metric cards show `kpi-delta-Cash` and `kpi-delta-Accounts Payable` equal to the amount paid.

`h.stubReset()` empties the queue and the request log; `h.stubRequests()` lists what the agent sent. A scripted `request_approval` passes a scope (`due_within_days`, `include_overdue`), never bill ids; the bills it should select are recomputed from `h.snapshot()` with `h.billsForApproval(snapshot, days, includeOverdue)`. `stub.approval.js` plays the card, the frozen receipt (`approval-receipt`, with `data-count` and `data-amount`), the rejection and the reload. `stub.card-changes.js` checks that the cash card in the chat shows its first figures struck through after an approval. `stub.reset.js` covers the two-click reset, the block while a run or an approval card is pending, the disarm when a run starts, a message sent during the reset, and a failed reset.

## The reference dashboard segment

`h.runDashboardSegment()` clicks the "Cash Flow Dashboard" suggestion and times the dashboard the orchestrator builds. The seconds run from the click to the first scan showing all five elements asked for by the suggestion; they are recorded, not enforced. Each element is accepted from any widget that shows it (widgets carry `data-widget-type`, and a custom chart `data-widget-dataset`):

| Asked for | Accepted widget | Figures compared |
|---|---|---|
| Cash and Accounts Payable KPIs | KPI cards or metric cards (`kpi-Cash`, `kpi-Accounts Payable`) | the card text contains the snapshot KPI value |
| AR aging | the AR aging gauge, or a custom chart on `ar_aging` | gauge: collection rate and bucket amounts from the snapshot; chart: the catalog response seen during the run equals the route's answer when read again |
| Supplier bills due | the bills widget (`outstanding-invoices` in payable mode, titled "Outstanding Bills") | listed bill numbers equal the snapshot bills in the displayed statuses; each row's amount and supplier match |
| Quarterly cash projection | a custom chart on `cash_flow_forecast` or `cash_flow_by_quarter`, or the cash waterfall in waterfall mode | chart: same catalog comparison; waterfall: its cumulative net equals a trailing sum of the snapshot cash flow |

The result is `{ complete, seconds, runSeconds, missing, mismatches, compared, widgets, shown, notices }`; the caller decides what must hold. Start from `h.resetDemo()` so repeated runs are independent.

`live.approval.js` reads the whole last turn (message and cards) through `h.chatText()` for its follow-up check, not only the last message.

## The reference scenario

`live.reference.js` is one full pass per run: reset, the dashboard segment (limit `DASHBOARD_MAX_SECONDS` = 60 in the file), subagent cards that show a step before they complete, "Approve Payments" (the card lists exactly `h.billsForApproval(snapshot, 7, true)`, total equal to their sum; Cash and Accounts Payable both down by that total, the Cash delta visible for about 3 s, books balanced, the frozen receipt `approval-receipt` carrying the same count and total), then a follow-up question that must state the new cash and payables and none of their old values. Every dollar amount in the chat, read before the approval and again after it, must be a money field of the pass: the store's totals, KPIs, aging buckets, bill amounts, quarterly cash flow and `cash_position` figures, plus the money values the catalog drew during the dashboard (`catalogMoney`: chart values and cash position amounts, no counts or years). A rounded amount ("$1.2M", "$58K") must equal a field rounded the same way. A failure carries the pass data in its error text; the runner records one line per pass (seconds, result, 429 notices) and reads tokens from the agent's `model_usage` log lines. A pass lost to a 429 is discarded and replayed. `stub.reference-retry.js` is the stub-stack proof that a Retry around an approval pays once.

## The suggestions and free questions

`live.questions.js` holds one entry per chat suggestion and per likely free question (indices in the file's `ENTRIES`), each run as one case on a fresh thread after a data reset, and compared with the snapshot and the catalog read at the end of the run. An entry passes when:

- the run ends without an error notice and the reply is not empty;
- every dollar amount in the chat (text and cards, chart axes left out) is a money field of the run (the helpers' `moneyFields`: totals, KPIs, aging buckets, bill amounts, quarterly cash flow, cash position, catalog money) or one of the entry's `expected(snapshot, ds)` figures (these include sums the scenario computes itself: per client, per department, quantity x unit cost), or a line or total computed by an approval card; a rounded amount must equal a field rounded the same way;
- the entry's own checks hold: figures it must state (`states`, `statesCounts`), records it must name (`mentions`, `mentionsAny`) or must not name (`mentionsNone`), and its visible effect (a cash card, a chart, a budget or spend widget, a revenue or cash flow forecast card drawn for 6 quarters);
- no `unverified-figure` badge is visible, and every percentage and count written in the chat is a field of the snapshot or of the catalog answers the run fetched, or a number the user typed (`percentsIn`, `countsIn`, below).

Three kinds are special. The dashboard suggestion passes on a complete segment with matching figures (the seconds are recorded, not enforced). The payment suggestion passes on a card listing exactly `h.billsForApproval(snapshot, 7, true)` and the reorder question on a card whose lines (sku, quantity) equal `h.itemsForRestock(snapshot)` (low-stock or out-of-stock items with no open order, twice the reorder level minus the quantity, lines of zero or less skipped), each with a total equal to the store's computation; the scenario then rejects it and the store must not change. The no-data question passes on a reply containing "I don't have this data" and no dollar amount.

A run that ended on a rate-limit notice (a 429 that survived the retry) throws an error starting with `DISCARDED`: the runner replays it and does not count it. Any other failure, a provider error status or a timeout included, starts with `FAILED` or an assertion message and carries the reply and the catalog requests seen.

Select entries when building: `pnpm e2e:build live.questions --only=8` writes `.playwright-mcp/scenarios/live.questions.only-8.js` with that index inlined (`--only=3,5` gives `only-3-5`), and that file runs like any other built scenario. The index is the position in `ENTRIES`, and each case is named after it. Without `--only` the full file runs every entry, which is long: run one entry per call.

A pass shows that an amount equals a store figure or a sum the scenario computes from the store, not that a tool returned it.

`percentsIn(text)` and `countsIn(text)` read the percentages (`12%`, `29.6 %`) and the counts (an integer, at most one adjective, then employees, bills, invoices, clients, customers, suppliers or items) a reply writes. `unexplainedFigures(text, snapshot, bodies, typed, extraCounts)` returns those that nothing explains: a percentage must equal a KPI change, an expense share, the collection rate, a payroll share per department, the overdue share of open receivables or a catalog field whose name says pct, percent, rate, share, ratio, margin, change or growth, compared by absolute value to one decimal; a count must equal the length of the matching list, a count per status, department or category, a distinct client or supplier count, a catalog integer whose key names the noun, or `extraCounts`; with a status adjective ("4 overdue invoices") it must be that status's count (what a card in the chat computed). Numbers the user typed (`typed`) are admitted; years, "30 days" and "6 quarters" are not read, and numbers written in words are ignored. The check is independent of the figure guard on purpose: it reads the data, not the guard's rule.

The chat-amount helpers (`amountsIn`, `matches`, `moneyFields`, `strangers`, `catalogMoneyOf`, `dueSoonest`, together with `moneyIn`, `formatUsd` and `leaves`) live in `lib/helpers.js`, shared with `live.reference.js`.

## Rules for a scenario file

- One single expression, no `import`, no `require`, no trailing `;`: the tool runs it in a VM without modules. `build.mjs` rejects a file that is not one expression.
- Everything comes from `h`: `open`, `visit`, `resetDemo`, `sendPrompt`, `waitForRunEnd`, `chatText` (the only way to read the chat: `h.chatText(skip)` leaves out struck-through values and the selectors in `skip`), `snapshot`, `moneyIn`, `formatUsd`, `test`, `assert`, `assertEqual`, `expectVisible`, `byId`, and for the stub `stubScript`, `stubRelease`, `stubReset`, `stubRequests`, `billsForApproval`, `payableBillIds` (no scenario calls it now), `openSettings`, `clickReset`, `runDashboardSegment`, and `clippedCardContent` (lines describing content that overflows a dashboard card; empty when none).
- `h.resetDemo()` resets through the API and reloads the page; `h.clickReset()` uses the Settings control and clicks it twice (the first click only arms it), which is what a scenario about the control must do.
- Group related checks as named cases with `h.test(name, fn)`; every case runs and failures are collected.
- Compare displayed figures with `h.snapshot()` (`GET /api/erp/snapshot`, served by the agent), never with hard-coded values.
- Validated at 1280x720; `h.open` sets it.

`offline.widgets.js` loads a saved dashboard holding all twelve widget types, with a full config, an empty one and none, through the gallery's Load button and the versioned saved-dashboards storage key. It needs no model, only `pnpm demo` (or `pnpm start` and `pnpm start:agent` with a fake key), and fails on any empty widget, console error or page error.
