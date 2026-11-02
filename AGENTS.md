# AGENTS.md — Deep Agents Finance ERP

> This file holds only what is specific to this repo. Target: under 150 lines.
> Code, comments, commits, README, docs, UI and this file are all in **English**.

## Status

Standalone fork of the `CopilotKit/examples/showcases/deep-agents-finance-erp` showcase: no upstream resync is planned. Public demo repo (LinkedIn, meetings), run locally, later the base of a private repo. Success means an orchestration that is **visible, human-controlled and exact on the numbers**, not an absence of failures.

**Done.** The agent runs on Mistral (dated model ids, `agent/models.py`). It owns all data in `ErpStore` (`agent/erp_store.py`, seeded by `agent/erp_seed.py`); derived values are computed at read time. The web reads everything from `GET /api/erp/snapshot`. Postgres is archived in `templates/postgres/` and wired to nothing.

**Not done yet.** The dataset catalog, live subagent steps in the chat, supplier approval, a reset control, failure handling in the UI, the first-screen rework, extra dashboard widgets and the reference series. The app is a working base, not the finished demo.

`SETUP/` (spec, plan, evidence) is deliberately **outside the repo** and gitignored: cite nothing from it in code, commits, README or UI.

## Stack and paths

| What | Where |
|---|---|
| Web: Next 16 (App Router), React 19, Tailwind v4, shadcn | `src/app`, `src/components`, `src/hooks`, `src/context`, `src/content`, `src/lib`, `src/types` |
| Runtime CopilotKit to agent | `src/app/api/copilotkit/[[...slug]]/route.ts` (the only Next route) |
| Chat, UI tools, agent context | `src/components/layout/shell.tsx` + `src/hooks/use-*.tsx` |
| Snapshot client and context | `src/lib/erp-api.ts`, `src/context/erp-context.tsx` |
| Agent FastAPI (`:8123`), graph | `agent/main.py`, `agent/agent.py` |
| Data: seed, store, routes | `agent/erp_seed.py`, `agent/erp_store.py`, `agent/erp_api.py` |
| Prompts, tools, subagents, models | `agent/prompts.py`, `agent/tools.py`, `agent/frontend_tools.py`, `agent/isolated_subagents.py`, `agent/models.py` |
| Browser scenarios (Playwright plugin) | `e2e/` (see `e2e/README.md`) |
| Postgres archive (not wired) | `templates/postgres/` |

## Commands

- `pnpm install` installs the web app, then runs `uv sync` in `agent/` (postinstall).
- `pnpm dev` runs web on `:3000` and agent on `:8123`, both with reload.
- `pnpm demo` makes a production build, then runs both servers without reload. Mode for measurements and meetings.
- `pnpm build` / `pnpm start` are web only. `pnpm dev:agent` / `pnpm start:agent` are agent only.
- `pnpm lint` runs ESLint on the web app (`agent/` is ignored).
- `pnpm test:agent` runs pytest in `agent/`. It makes no model call and needs no real key; `uv` itself needs network for its `malware-check`.
- `pnpm e2e:build` assembles the browser scenarios into `.playwright-mcp/scenarios/`.
- Binaries: `pnpm exec <bin>`, never `npx`. Python: `uv run`, from `agent/`.

Prerequisites: Node >= 20.9 (`.nvmrc` pins 24), pnpm 11, uv >= 0.11 (Python 3.12). Docker is not needed.

## Repo rules

- **One source of data.** The agent owns it (`ErpStore`); the web reads it through `GET /api/erp/snapshot`. **No displayed figure** (card, chart, approval) may come from the model: it picks an identifier, the code fills in the numbers. See the pitfall on `render_chat_visual` and `custom_chart` for where this is not yet true.
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

- **Figures still come from the model in two places.** `render_chat_visual` and `custom_chart` (a widget of `update_dashboard`) receive their data from the model's arguments, not from the store, until the dataset catalog lands. Do not present them as exact. The save path already refuses a dashboard carrying inline figures.
- **`request_approval` changes no data.** Approving a payment or a reorder only returns the answer to the model; no invoice or stock record is updated.
- **`useRenderTool` requires `parameters`** in `@copilotkit/react-core` 1.80.0: each front-end tool declares a permissive `zod` schema of the fields it reads. The live browser scenario rendered the research, cash and approval cards.
- **No `instructions` prop on `CopilotSidebar`** in 1.80.0. Instructions go through `useAgentContext` (`shell.tsx`), like the KPIs and the dashboard layout.
- **`pnpm lint` is red, and was before the migration**: 6 errors and 4 warnings in `src/`. Errors: `use-update-dashboard.tsx` (5 x `no-explicit-any`) and `cash-waterfall-chart.tsx` (variable reassigned after render). Warnings: `cash-position-card.tsx`, `dashboard-grid.tsx`, `shell.tsx` (2). Not a regression; fix before the final handover. Add none.
- **`@copilotkit/*` stays on 1.80.0**: 1.83.0 is refused by `minimumReleaseAge`. Do not force the bump or loosen the cooldown.
- **Windows `MAX_PATH`**: a clone that is too deep breaks `agent/.venv` past 260 characters. Keep the path short.
- **Subagents run in isolated threads** (`isolated_subagents.py`) on purpose: it keeps internal events out of the parent stream. Do not "simplify" to `subagents=[...]`.
- **`agent/` is invisible to ESLint** (`eslint.config.mjs` ignores it): a green lint says nothing about Python.
- **CORS allows only `FRONTEND_ORIGIN`**, default `http://localhost:3000`. Opening the app on `http://127.0.0.1:3000` makes the snapshot request fail. Use `localhost`, or set `FRONTEND_ORIGIN`.
- **`agent/.env` is not readable by agents** (workstation policy). Never try; check for the key with a script that prints only `bool(os.environ.get("MISTRAL_API_KEY"))`.
- **Background servers start from Git Bash** with `nohup ... > log 2>&1 &`, never `Start-Process`, which opens a visible console window on the user's desktop. Check ports 3000 and 8123 are free first, stop what you started, and verify the ports are free again.
- **E2E has no `@playwright/test`, by explicit decision.** Scenarios run through the Playwright plugin (`browser_run_code_unsafe`). A scenario is one single expression with no `import`. Run `pnpm e2e:build` first; the built files live in `.playwright-mcp/` (gitignored).

## Verification

Default level: **standard**.

- Web: `pnpm build` (type check on) and `pnpm lint`; compare with the known baseline above, add no error.
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
