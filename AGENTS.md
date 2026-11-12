# AGENTS.md — Deep Agents Finance ERP

> This file holds only what is specific to this repo. Target: under 150 lines.
> Code, comments, commits, README, docs, UI and this file are all in **English**.

## Status

Standalone fork of the `CopilotKit/examples/showcases/deep-agents-finance-erp` showcase: no upstream resync is planned. Public demo repo (LinkedIn, meetings), run locally, later the base of a private repo. Success means an orchestration that is **visible, human-controlled and exact on the numbers**, not an absence of failures.

**Done.** The agent runs on Mistral (dated model ids, `agent/models.py`). It owns all data in `ErpStore` (`agent/erp_store.py`, seeded by `agent/erp_seed.py`); derived values are computed at read time. The web reads the records from `GET /api/erp/snapshot` and every chart or card the model asks for from the dataset catalog (`agent/erp_datasets.py`, `GET /api/erp/datasets/{id}`): the model names a dataset and bounded parameters, the code fills in the figures. Approving a supplier payment or a reorder in the chat really changes the store (see the pitfall on `request_approval`): a payment takes a scope chosen in code, and the card leaves a frozen receipt in the thread. The chat cash card keeps its first figures struck through beside the new ones after a change. A what-if growth question is answered with a forecast card drawn from the catalog. `POST /api/erp/reset` restores the seed, and the Settings icon's **Reset demo data** (`useErp().resetDemo`) calls it, then clears the dashboard, the saved dashboards, the subagent steps and opens a new thread. The reset needs two clicks within `RESET_CONFIRM_MS` and is disabled while `agent.isRunning` (false during an interrupt) or while `approval-pending` is set (`src/lib/approval-pending.ts`); `resetDemo` opens the new thread first, so a failed API reset leaves the books and dashboard untouched but the chat on a new, empty thread. Postgres is archived in `templates/postgres/` and wired to nothing.

**Failures are told in the UI.** A failed run shows a plain notice above the chat input with a Retry (`src/components/chat/run-error-banner.tsx`, causes classified in `src/lib/run-errors.ts`); figures that cannot be reloaded stay on screen with a notice and a Retry (`ErpProvider`); `error.tsx`, `global-error.tsx` and `not-found.tsx` are minimal. The agent refuses to start without `MISTRAL_API_KEY`.

**Figures and fallback.** Every $ amount, % and count the orchestrator writes must come from this turn's tool results, the store snapshot or the user's text: the server rule (`agent/figure_guard.py`, `FigureGuardMiddleware`) retries once, then leaves a mark `⟦unverified:RAW⟧`. A K/M/B amount is admitted at the decimals actually written, zero included ("$730K" for 729,850), and the retry correction names the one tool value a rounded amount came from. Two rules are server-only, the web net does not apply them: a text written after an `update_dashboard` call of the same turn may carry no figure (the widgets carry them; every figure in it is unverified, and the retry uses a dashboard correction), and a subagent's figures are judged by its data tools' outputs (the tool message's `artifact["sources"]`), not by its prose. The retry thread drops streamed tool calls from the wrong message (Mistral answers 400 otherwise). The web rule (`src/lib/figure-guard.ts`, `verified-markdown.tsx`) renders marks as an "unverified" badge, and "Checking figures…" shows while a run is on. On the reference request only, a 429 that survives the retry switches the rest of the turn to a rules build (`reference_dashboard.py`, `reference_fallback.py`): no model call, a dashboard from the store, a card "Model unavailable — built from rules". Mistral's free mode holds the API to 2 requests per minute per `ministral` model (since 2026-11-07), which makes the orchestration unusable live (a dashboard makes 7-10 model calls). With "API pay-as-you-go" enabled in the Mistral console (prepaid credits, not "Pay-as-you-go for Vibe Code") the limits measured on 2026-11-08 suit the demo (`ministral-14b-2512` 120 requests and 1.5M tokens per minute); every role uses `ministral-14b-2512` and the orchestrator calls both subagents in one message (`ORCHESTRATOR_PARALLEL_TOOL_CALLS`, measured on 2026-11-09: median 20.9 s for the dashboard, against 21.55 s with the subagents on 8b). Set a spending cap.

**First screen.** The chat is open on load with seven suggestions, the reference one ("Cash Flow Dashboard") first (Reorder Inventory and Cost Control Dashboard included; checked at 1280x720, no overlap or overflow); the header holds only the fictional avatar (not a control) and the sidebar only routes plus Settings. No visible control is without an effect.

**Release state.** Version `0.5.0`. On `b78f895` (2026-11-12, `ministral-14b-2512`, API pay-as-you-go, no 429, no fallback) the reference series passed 5 of 5 consecutive runs (dashboard click to complete 20.8 to 23.5 s, median 22.6 s, against the 60 s bar and 45 s target; approval, cash and payables, and the follow-up answer equal to the store) and the 18-entry series (`e2e/scenarios/live.questions.js`) reached 18 entries at 3 of 3, 54 of 54 runs. The two heads before it each missed by one entry (`ae13351`: Budget, a live-check gap; `bba2417`: Biggest expense categories, fixed by the exact totals in `query_monthly_expenses`). The tables are in the README, "Measured behaviour"; the per-entry evidence is in `SETUP/`, outside the repo. This is one sample of three per entry: the model can still round an amount, and the guard then badges it. What remains is human review and the push by the owner. The approval scenario `live.approval` was last run on 2026-11-08; the series covers Approve Payments and Reorder Inventory at 3 of 3.

**README.** It is the public entry point and states the same limits as this file (reference series not proven, series threshold not met, uncovered free questions). When a measurement changes, change the README table and this paragraph together. It carries no video link until a video exists.

`SETUP/` (spec, plan, evidence) is deliberately **outside the repo** and gitignored: cite nothing from it in code, commits, README or UI.

## Stack and paths

| What                                                     | Where                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Web: Next 16 (App Router), React 19, Tailwind v4, shadcn | `src/app`, `src/components`, `src/hooks`, `src/context`, `src/content`, `src/lib`, `src/types`                    |
| Runtime CopilotKit to agent                              | `src/app/api/copilotkit/[[...slug]]/route.ts` (the only Next route)                                               |
| Chat, UI tools, agent context                            | `src/components/layout/shell.tsx` + `src/hooks/use-*.tsx`                                                         |
| Brand, suggestions and UI text (single source)           | `src/content/brand.ts`, `src/content/ui-text.ts`                                                                  |
| Snapshot client and context                              | `src/lib/erp-api.ts`, `src/context/erp-context.tsx`                                                               |
| Agent FastAPI (`:8123`), graph                           | `agent/main.py`, `agent/agent.py`                                                                                 |
| Data: seed, store, routes                                | `agent/erp_seed.py`, `agent/erp_store.py`, `agent/erp_datasets.py`, `agent/erp_api.py`                            |
| Prompts, tools, subagents, models                        | `agent/prompts.py`, `agent/tools.py`, `agent/frontend_tools.py`, `agent/isolated_subagents.py`, `agent/models.py` |
| Browser scenarios (`@playwright/test` and plugin)        | `e2e/`, `playwright.config.ts`, `e2e/specs/` (see `e2e/README.md`)                                                |
| Figure guard (server, web), shared cases | `agent/figure_guard.py`, `agent/figure_guard_middleware.py`, `src/lib/figure-guard.ts`, `agent/tests/data/figure_cases.json` |
| Rules fallback for the reference dashboard | `agent/reference_dashboard.py`, `agent/reference_fallback.py` |
| Mistral stub and its stack launcher                      | `e2e/fixtures/` (scripted answers and HTTP errors, no credit spent)                                               |
| Postgres archive (not wired)                             | `templates/postgres/`                                                                                             |

## Commands

- `pnpm install` installs the web app, then runs `scripts/agent-sync.mjs` (postinstall), which runs `uv sync` in `agent/` and explains a malware check that cannot reach api.osv.dev.
- `pnpm dev` runs web on `:3000` and agent on `:8123`, both with reload.
- `pnpm demo` makes a production build, then runs both servers without reload. Mode for measurements and meetings.
- `pnpm build` / `pnpm start` are web only. `pnpm dev:agent` / `pnpm start:agent` are agent only.
- `pnpm lint` runs ESLint on the web app (`agent/` is ignored).
- `pnpm test:agent` runs pytest in `agent/`. It makes no model call and needs no real key; `uv` itself needs network for its `malware-check`.
- `pnpm exec playwright install chromium` installs the browser for the runner (once).
- `pnpm e2e` builds the web app, starts stub, agent and web itself (any OS; ports 8790, 8123, 3000 free) and runs the `offline` and `stub` projects. `pnpm e2e:live` runs the `live` project against a running `pnpm demo` with a real key (60 min timeout; `E2E_ONLY=3,5` selects entries of `live.questions`).
- `pnpm e2e:build` (plugin path) assembles the browser scenarios into `.playwright-mcp/scenarios/`; `pnpm e2e:build offline` builds only the names containing `offline`.
- `pnpm build`, then `nohup node e2e/fixtures/stack.mjs --logs <dir> > <dir>/stack.out 2>&1 &` starts the Mistral stub (`:8790`), agent and web app for the plugin path's `stub.*` scenarios; `node e2e/fixtures/stack.mjs stop` stops them. Windows only (`taskkill`).
- Binaries: `pnpm exec <bin>`, never `npx`. Python: `uv run`, from `agent/`.

Prerequisites: Node >= 20.9 (`.nvmrc` pins 24), pnpm 11, uv >= 0.11 (Python 3.12). Docker is not needed.

## Repo rules

- **One source of data.** The agent owns it (`ErpStore`); the web reads it through `GET /api/erp/snapshot`. **No displayed figure** (card, chart, approval) may come from the model: it picks an identifier, the code fills in the numbers.
- **No spec or plan identifier** (plan step labels, work-item numbers) in code, names, comments or printed messages.
- **Dated model ids**, never `-latest`. `MISTRAL_API_KEY` is never printed, logged or committed.
- **Dates are relative to today**, never hard-coded.
- **Validated at 1280x720**; no mobile work.
- **No agent pushes.** No `--force`, no `--hard`, no deletion beyond what the task produces.
- Commits follow **Conventional Commits**, with no AI attribution.

## Conventions

- TypeScript `strict`, alias `@/*` to `./src/*`. Client components start with `"use client"`.
- Tailwind classes composed with `cn()` (`src/lib/utils.ts`); `cpk:` prefix to override CopilotKit components.
- Python: `from __future__ import annotations`, English docstrings, `@tool` from `langchain_core.tools`. Details in `agent/AGENTS.md`.
- **Strict dependency policy on both sides.** pnpm (`pnpm-workspace.yaml`): 7-day cooldown, `trustPolicy: no-downgrade`, `blockExoticSubdeps`, `strictDepBuilds`, `audit.level: high`. uv (`agent/pyproject.toml`): `exclude-newer`, `no-build`, `required-version`, `malware-check`. A dependency that hits a rule gets an **exact, commented** exception (`trustPolicyExclude`, `allowBuilds`), never a loosened rule.

## Pitfalls

- **A saved `custom-chart` without a `dataset` is ignored on read** (old format); a dashboard carrying inline figures is refused on save.
- **`update_dashboard` widgets carry options, never figures.** `use-update-dashboard.tsx` drops `scenarios` and `comparisonData` from a config (and the tool refuses them); a widget with no config renders with its defaults (`WidgetRenderer` normalises it). The tool refuses a type outside `WIDGET_TYPES` (`frontend_tools.py`, one list that must match `TYPE_MAP`). A new widget type goes in `WIDGET_TYPES`, `TYPE_MAP`, `DEFAULT_COLSPAN`, the tool docstring and the prompt, and in `COMPACT_WIDGET_TYPES` when it is small.
- **`update_dashboard` upserts by type, in place.** A type already on the dashboard (the default `outstanding-invoices`, say) is updated where it stands (`upsertWidget`), keeping its order (a `custom_chart` is always added), so a dashboard built over the defaults keeps them in front. The grid flows densely (`grid-flow-row-dense`), so the gauge appended after the bills list back-fills the cell beside it. With `replace` true the layout becomes exactly the widgets given (the defaults leave); a replace that removes existing widgets does not auto-scroll. The web applies a call only when the tool's JSON result says `updated: true`; a refused or unreadable result changes nothing. A themed dashboard is one call with `replace` true: the prompt forbids save plus reset unless asked. A dashboard reset that arrives in the same run as an applied replacing update is ignored (`handled-tool-calls.ts`, cleared when a run starts and on the demo reset), so a reset and a replace in one turn leave the replaced dashboard whatever order their results land in.
- **`request_approval` applies the decision on the server, once.** The tool takes a scope for payments (`due_within_days` 0..31 and `include_overdue`; never bill ids) or, for reorders, nothing: code selects the lines (`ErpStore.items_for_restock`: low or out-of-stock items with no open order, quantity twice `reorderLevel` minus quantity, lines of 0 or less skipped); `items` (sku and quantity) stays accepted only for a reorder the user names item by item. The store selects the bills (`ErpStore.bills_for_approval`), the tool previews, calls `copilotkit_interrupt` and mutates only after an explicit `approved: true`. The card echoes `billIds` (or the `items` lines it showed) in its answer; the resume applies the recomputed selection only if it is non-empty and within those ids or lines (same sku and quantity), else nothing. LangGraph re-runs the tool body on resume, so nothing may be written before the interrupt. Every result is JSON `{outcome, type, count, total, message}`, and `ApprovalReceipt` renders it on the tool's Complete status. Paying is idempotent (a paid bill is skipped), a rejection changes nothing, and the tool then sends the custom event `erp_data_changed` (`{changes: [{metric, delta}]}`), which `ErpProvider` turns into a reload and a 3 s highlight on the KPI cards and the metric cards (both use `src/components/ui/kpi-change.tsx`). A reorder only sets `onOrder` on the items: no account moves.
- **The live check mirrors the agent's calculations.** `e2e/lib/helpers.js` re-derives the percentages the tools print from the snapshot and mirrors `projectRevenue` / `projectCashFlow` and their growth percentages; keep them in step with `agent/erp_datasets.py`. The check also admits `snap.quarterlyRevenue` (quarterly revenue, expenses, profit) and the expense totals and shares. `e2e/specs/live-checks.unit.spec.ts` (18 cases, fixture printed by the Python) pins them. The series driver is not in the repo.
- **The figure guard has one rule per language and one set of cases.** Change `agent/figure_guard.py` and `src/lib/figure-guard.ts` together with `agent/tests/data/figure_cases.json`, which pytest and `e2e/specs/figure-guard.unit.spec.ts` both read. A verdict is frozen at the first render of a message (`src/lib/figure-verdicts.ts`) and forgotten on reset.
- **Orchestrator text is not streamed** (`emit_messages=False` in `agent/main.py`): tool calls stream, the text arrives whole in the final messages snapshot. A scenario must not wait for streamed text mid-run.
- **The rules fallback hides its recipe tool from the model** and runs only for the reference request, which the web sends through `useAgentContext` ("Reference dashboard request"). Middleware order is fixed: `CopilotKitMiddleware`, `ReferenceFallbackMiddleware`, `FigureGuardMiddleware`. Any other request keeps the Retry banner.
- **A failed run is told once, in one place.** `RunErrorBanner` subscribes to `onRunErrorEvent` (error sent by the agent) and `onRunFailed` (request failed) and never shows the raw text, which can carry the provider URL. Retry calls `copilotkit.runAgent({ agent })` on the messages already in the thread: no message is added, and tool effects stay once per key, so a call carried out before the failure is not carried out again (and one the failed run never reached is carried out on the retry). The only retry on the model side is one 429 per model call (`agent/models.py`), after the `Retry-After` seconds when they are at most 8, or after 2 s when the header is missing or not a number (Mistral's 429 carries none); everything else fails at once. There is no run-wide wait budget, so a turn with several limited calls can add up to 8 s each.
- **Brand and wording live in `src/content/`.** The product name, company, user initials and logo come from `brand.ts`; suggestions, titles and nav labels from `ui-text.ts`. `agent/tests/test_brand_names.py` fails when a blocklisted company name or a hard-coded "JD" appears elsewhere in `src/` or `agent/`. A KPI with no history (`trend: "flat"`) shows no change badge.
- **With the chat open by default, its panel covers the chat toggle at 1280x720**; the panel header's Close button is the visible control, and the toggle reappears once closed.
- **`useRenderTool` requires `parameters`** in `@copilotkit/react-core` 1.80.0: each front-end tool declares a permissive `zod` schema of the fields it reads. The live browser scenario rendered the research, cash and approval cards.
- **No `instructions` prop on `CopilotSidebar`** in 1.80.0. Instructions go through `useAgentContext` (`shell.tsx`), like the KPIs and the dashboard layout.
- **Live runs depend on the Mistral plan.** Free mode (about $10/month of included, renewing usage, as shown in the Mistral console on 2026-11-08) is held to the free-tier limits: 2 requests per minute per `ministral` model since 2026-11-07, a 429 `backend_out_of_capacity` that a 2 s retry does not always cure, and a targeted live check of that day lost every run to code 1300; only the `ministral` ids answered there. With "API pay-as-you-go" enabled (2026-11-08) the same key answered 200 with tool calls on `ministral-14b-2512` (120 requests per minute), `ministral-8b-2512`, `ministral-3b-2512`, `mistral-small-2603`, `mistral-medium-2508` and `mistral-large-2512` (`agent/scripts/probe_models.py`). A run lost to a 429 is discarded and replayed after the window, never counted. The agent logs one `model_usage` line per model call (ids and token counts only).
- **`@copilotkit/*` stays on 1.80.0**: 1.83.0 is refused by `minimumReleaseAge`. Do not force the bump or loosen the cooldown.
- **Windows `MAX_PATH`**: a clone that is too deep breaks `agent/.venv` past 260 characters. Keep the path short.
- **Subagents run in isolated threads** (`isolated_subagents.py`) on purpose: it keeps internal events out of the parent stream. Do not "simplify" to `subagents=[...]`. The one thing that crosses is a `subagent_step` custom event per subagent tool call, dispatched from the parent's loop and stored by `src/lib/subagent-steps.ts` under the card's tool call id; the card lists them live.
- **`agent/` is invisible to ESLint** (`eslint.config.mjs` ignores it): a green lint says nothing about Python.
- **CORS allows only `FRONTEND_ORIGIN`**, default `http://localhost:3000`. Opening the app on `http://127.0.0.1:3000` makes the snapshot request fail. Use `localhost`, or set `FRONTEND_ORIGIN`.
- **`agent/.env` is not readable by agents** (workstation policy). Never try; check for the key with a script that prints only `bool(os.environ.get("MISTRAL_API_KEY"))`.
- **Background servers start from Git Bash** with `nohup ... > log 2>&1 &`, never `Start-Process`, which opens a visible console window on the user's desktop. Check ports 3000 and 8123 are free first, stop what you started, and verify the ports are free again.
- **Tool-call effects are applied once per key** (`src/lib/handled-tool-calls.ts`, keyed by tool name and arguments, not by call id). A reset forgets the keys; any new frontend tool that applies a side effect must claim its key there, or a replayed demo will skip it.
- **E2E has two runners over one source.** `@playwright/test` (`pnpm e2e`, `pnpm e2e:live`) and the Playwright plugin (`browser_run_code_unsafe`) both load `e2e/scenarios/` through `e2e/lib/load-scenario.mjs`. A scenario is still one single expression with no `import`. `stub.agent-down` is plugin-only (skipped in the runner). For the plugin path run `pnpm e2e:build` first; its files live in `.playwright-mcp/` (gitignored). `h.chatText(skip)` is the single reader of chat text (a TreeWalker over the live list that skips struck-through `changed-value-before` values): a scenario must not read the chat another way.

## Verification

Default level: **standard**.

- Web: `pnpm build` (type check on) and `pnpm lint`; lint is at 0 errors and 3 warnings (`dashboard-grid.tsx`, `shell.tsx` x2): add none.
- Agent, offline: `pnpm test:agent` (no network call expected).
- Browser, offline and stub: `pnpm e2e` (no real key, no credit).
- End to end: `pnpm demo`, then `GET http://127.0.0.1:8123/health` and `http://localhost:3000`.
- **A change that depends on the model** (prompt, tool contract, approval, chat cards, live checks) **is checked live with Mistral as soon as possible**, in its own batch of work, not left to the series: `pnpm demo`, then `pnpm e2e:live` (`E2E_ONLY` to select entries). The key is present in `agent/.env`; agents never read that file, but may run the servers that load it. "No key" is never a reason to skip.
- Every live measurement compares with values **read from the store at test time**, never hard-coded. A 429 is not a code failure: wait out the window, replay, note it.
- Check each library API in the installed package (or with Context7) before using it.

## Working principles

- **Think before coding.** State assumptions; if several interpretations exist, present them instead of silently picking one. If something is unclear, stop and ask.
- **Simplicity first.** No unrequested feature, no abstraction for a single use, no speculative flexibility. If 200 lines fit in 50, rewrite.
- **Surgical changes.** Do not touch neighbouring code, comments or formatting; do not refactor what is not broken; follow the existing style. Flag dead code, do not delete it.
- **Goal-driven execution.** Turn each task into a verifiable criterion, with a check at each step of the plan; loop until the criterion holds.

## Meta — keeping this file alive

- A rule that is no longer true is worse than no rule: delete it as soon as it is stale.
- Two contradictory rules make the reader choose at random: at the first tension between two lines, delete one.
- A rule that says nothing actionable is noise: cut it.
- Every added rule must trace to an observed fact; otherwise mark it `TODO: verify`, and remove it if the check fails.
- Never update this file without explicit confirmation. Above 150 lines, condense before adding.
