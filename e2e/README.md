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

## Rules for a scenario file

- One single expression, no `import`, no `require`, no trailing `;`: the tool runs it in a VM without modules. `build.mjs` rejects a file that is not one expression.
- Everything comes from `h`: `open`, `visit`, `resetDemo`, `sendPrompt`, `waitForRunEnd`, `chatText`, `snapshot`, `moneyIn`, `formatUsd`, `test`, `assert`, `assertEqual`, `expectVisible`.
- Group related checks as named cases with `h.test(name, fn)`; every case runs and failures are collected.
- Compare displayed figures with `h.snapshot()` (`GET /api/erp/snapshot`, served by the agent), never with hard-coded values.
- Validated at 1280x720; `h.open` sets it.
