# AGENTS.md — Deep Agents Finance ERP

> This file holds only what is specific to this repo. Target: under 150 lines.
> Code, comments, commits, README, docs, UI and this file are all in **English**.

## Status

Standalone fork of the `CopilotKit/examples/showcases/deep-agents-finance-erp` showcase: no upstream resync is planned. Public demo repo (LinkedIn, meetings), run locally, later the base of a private repo. Success means an orchestration that is **visible, human-controlled and exact on the numbers**, not an absence of failures.

**Done.** The agent runs on Mistral (dated model ids, `agent/models.py`). It owns all data in `ErpStore` (`agent/erp_store.py`, seeded by `agent/erp_seed.py`); derived values are computed at read time. The web reads the records from `GET /api/erp/snapshot` and every chart or card the model asks for from the dataset catalog (`agent/erp_datasets.py`, `GET /api/erp/datasets/{id}`): the model names a dataset and bounded parameters, the code fills in the figures. Approving a supplier payment or a reorder in the chat really changes the store (see the pitfall on `request_approval`); `POST /api/erp/reset` restores the seed, and the Settings icon's **Reset demo data** (`useErp().resetDemo`) calls it, then clears the dashboard, the saved dashboards, the subagent steps and opens a new thread; it is disabled while a run is in progress. Postgres is archived in `templates/postgres/` and wired to nothing.

**Failures are told in the UI.** A failed run shows a plain notice above the chat input with a Retry (`src/components/chat/run-error-banner.tsx`, causes classified in `src/lib/run-errors.ts`); figures that cannot be reloaded stay on screen with a notice and a Retry (`ErpProvider`); `error.tsx`, `global-error.tsx` and `not-found.tsx` are minimal. The agent refuses to start without `MISTRAL_API_KEY`.

**First screen.** The chat is open on load with the reference suggestion ("Cash Flow Dashboard") first; the header holds only the fictional avatar (not a control) and the sidebar only routes plus Settings. No visible control is without an effect.

**Not done yet.** The reference series: no run has yet passed from the dashboard to the follow-up question, so the count of consecutive passes is 0 of 5. The scenario enforces 60 s from click to complete dashboard (the allowed fallback after the other remedies); 45 s stays the target and is not reliably met. On `ministral-14b-2512` the valid dashboard runs were complete with figures equal to the store, but their time depends strongly on the model service's load (measurements, from several prompt states, are in the README and the evidence, not here). The suggestions and ten likely free questions are checked by a repeated live scenario (`e2e/scenarios/live.questions.js`); its results, the suggestions removed from the first screen and the questions not covered are in the README, "Measured behaviour". The app is a working base, not the finished demo.

`SETUP/` (spec, plan, evidence) is deliberately **outside the repo** and gitignored: cite nothing from it in code, commits, README or UI.

## Stack and paths

| What | Where |
|---|---|
| Web: Next 16 (App Router), React 19, Tailwind v4, shadcn | `src/app`, `src/components`, `src/hooks`, `src/context`, `src/content`, `src/lib`, `src/types` |
| Runtime CopilotKit to agent | `src/app/api/copilotkit/[[...slug]]/route.ts` (the only Next route) |
| Chat, UI tools, agent context | `src/components/layout/shell.tsx` + `src/hooks/use-*.tsx` |
| Brand, suggestions and UI text (single source) | `src/content/brand.ts`, `src/content/ui-text.ts` |
| Snapshot client and context | `src/lib/erp-api.ts`, `src/context/erp-context.tsx` |
| Agent FastAPI (`:8123`), graph | `agent/main.py`, `agent/agent.py` |
| Data: seed, store, routes | `agent/erp_seed.py`, `agent/erp_store.py`, `agent/erp_datasets.py`, `agent/erp_api.py` |
| Prompts, tools, subagents, models | `agent/prompts.py`, `agent/tools.py`, `agent/frontend_tools.py`, `agent/isolated_subagents.py`, `agent/models.py` |
| Browser scenarios (Playwright plugin) | `e2e/` (see `e2e/README.md`) |
| Mistral stub and its stack launcher | `e2e/fixtures/` (scripted answers and HTTP errors, no credit spent) |
| Postgres archive (not wired) | `templates/postgres/` |

## Commands

- `pnpm install` installs the web app, then runs `uv sync` in `agent/` (postinstall).
- `pnpm dev` runs web on `:3000` and agent on `:8123`, both with reload.
- `pnpm demo` makes a production build, then runs both servers without reload. Mode for measurements and meetings.
- `pnpm build` / `pnpm start` are web only. `pnpm dev:agent` / `pnpm start:agent` are agent only.
- `pnpm lint` runs ESLint on the web app (`agent/` is ignored).
- `pnpm test:agent` runs pytest in `agent/`. It makes no model call and needs no real key; `uv` itself needs network for its `malware-check`.
- `pnpm e2e:build` assembles the browser scenarios into `.playwright-mcp/scenarios/`.
- `pnpm build`, then `nohup node e2e/fixtures/stack.mjs --logs <dir> > <dir>/stack.out 2>&1 &` starts the Mistral stub (`:8790`), agent and web app for the `stub.*` scenarios; `node e2e/fixtures/stack.mjs stop` stops them. Windows only (`taskkill`).
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
- **`update_dashboard` widgets carry options, never figures.** `use-update-dashboard.tsx` drops `scenarios` and `comparisonData` from a config (and the tool refuses them); a widget with no config renders with its defaults (`WidgetRenderer` normalises it). A new widget type goes in `TYPE_MAP`, `DEFAULT_COLSPAN`, the tool docstring and the prompt.
- **`request_approval` applies the decision on the server, once.** The tool takes identifiers only (`bill_ids`, or `items` as sku and quantity), previews through the store, calls `copilotkit_interrupt` and mutates only after an explicit `approved: true`; LangGraph re-runs the tool body on resume, so nothing may be written before the interrupt. Paying is idempotent (a paid bill is skipped), a rejection changes nothing, and the tool then sends the custom event `erp_data_changed` (`{changes: [{metric, delta}]}`), which `ErpProvider` turns into a reload and a 3 s highlight on the KPI cards. A reorder only sets `onOrder` on the items: no account moves.
- **A failed run is told once, in one place.** `RunErrorBanner` subscribes to `onRunErrorEvent` (error sent by the agent) and `onRunFailed` (request failed) and never shows the raw text, which can carry the provider URL. Retry calls `copilotkit.runAgent({ agent })` on the messages already in the thread: no message is added, and tool effects stay once per key, so a call carried out before the failure is not carried out again (and one the failed run never reached is carried out on the retry). The only retry on the model side is one 429 per model call (`agent/models.py`), after the `Retry-After` seconds when they are at most 8, or after 2 s when the header is missing or not a number (Mistral's 429 carries none); everything else fails at once. There is no run-wide wait budget, so a turn with several limited calls can add up to 8 s each.
- **Brand and wording live in `src/content/`.** The product name, company, user initials and logo come from `brand.ts`; suggestions, titles and nav labels from `ui-text.ts`. `agent/tests/test_brand_names.py` fails when a blocklisted company name or a hard-coded "JD" appears elsewhere in `src/` or `agent/`. A KPI with no history (`trend: "flat"`) shows no change badge.
- **With the chat open by default, its panel covers the chat toggle at 1280x720**; the panel header's Close button is the visible control, and the toggle reappears once closed.
- **`useRenderTool` requires `parameters`** in `@copilotkit/react-core` 1.80.0: each front-end tool declares a permissive `zod` schema of the fields it reads. The live browser scenario rendered the research, cash and approval cards.
- **No `instructions` prop on `CopilotSidebar`** in 1.80.0. Instructions go through `useAgentContext` (`shell.tsx`), like the KPIs and the dashboard layout.
- **Free-tier live runs are unreliable.** Mistral answers many calls with a 429 `backend_out_of_capacity` that a 2 s retry does not always cure (many live runs are lost to it or to a read timeout), and only the `ministral` family answers on this account (`agent/scripts/probe_models.py`: 3b, 8b and 14b answer 200; the Small and Medium ids answer 429 with a quota of 0, Large answers 403). A run lost to a 429 is discarded and replayed after the window, never counted. The agent logs one `model_usage` line per model call (ids and token counts only).
- **`@copilotkit/*` stays on 1.80.0**: 1.83.0 is refused by `minimumReleaseAge`. Do not force the bump or loosen the cooldown.
- **Windows `MAX_PATH`**: a clone that is too deep breaks `agent/.venv` past 260 characters. Keep the path short.
- **Subagents run in isolated threads** (`isolated_subagents.py`) on purpose: it keeps internal events out of the parent stream. Do not "simplify" to `subagents=[...]`. The one thing that crosses is a `subagent_step` custom event per subagent tool call, dispatched from the parent's loop and stored by `src/lib/subagent-steps.ts` under the card's tool call id; the card lists them live.
- **`agent/` is invisible to ESLint** (`eslint.config.mjs` ignores it): a green lint says nothing about Python.
- **CORS allows only `FRONTEND_ORIGIN`**, default `http://localhost:3000`. Opening the app on `http://127.0.0.1:3000` makes the snapshot request fail. Use `localhost`, or set `FRONTEND_ORIGIN`.
- **`agent/.env` is not readable by agents** (workstation policy). Never try; check for the key with a script that prints only `bool(os.environ.get("MISTRAL_API_KEY"))`.
- **Background servers start from Git Bash** with `nohup ... > log 2>&1 &`, never `Start-Process`, which opens a visible console window on the user's desktop. Check ports 3000 and 8123 are free first, stop what you started, and verify the ports are free again.
- **Tool-call effects are applied once per key** (`src/lib/handled-tool-calls.ts`, keyed by tool name and arguments, not by call id). A reset forgets the keys; any new frontend tool that applies a side effect must claim its key there, or a replayed demo will skip it.
- **E2E has no `@playwright/test`, by explicit decision.** Scenarios run through the Playwright plugin (`browser_run_code_unsafe`). A scenario is one single expression with no `import`. Run `pnpm e2e:build` first; the built files live in `.playwright-mcp/` (gitignored).

## Verification

Default level: **standard**.

- Web: `pnpm build` (type check on) and `pnpm lint`; lint is at 0 errors and 3 warnings (`dashboard-grid.tsx`, `shell.tsx` x2): add none.
- Agent, offline: `pnpm test:agent` (no network call expected).
- End to end: `pnpm demo`, then `GET http://127.0.0.1:8123/health` and `http://localhost:3000`.
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
