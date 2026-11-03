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

`stack.mjs` starts the stub (`:8790`, `STUB_PORT` to change it, and keep `STUB_URL` in `lib/helpers.js` in step), then the agent with `MISTRAL_BASE_URL` pointing at the stub and a fake key, then the web app. It refuses to start when 8790, 8123 or 3000 is taken. `stop` kills the whole tree it started.

A scenario scripts the model with `h.stubScript([...])`. Each model call takes the next step; an empty queue answers 500. Steps:

| Step | Effect |
|---|---|
| `{ text }` | a streamed text answer |
| `{ toolCall: { name, args } }` | a streamed tool call; `args` is an object |
| `{ text, toolCall }` | both, text first |
| `{ status: 429, retryAfter: 2, message }` | an HTTP error with an optional `Retry-After` (seconds) |
| any answer step with `hold: true` | the stream stays open after its first chunk until `h.stubRelease()` |

`h.stubReset()` empties the queue and the request log; `h.stubRequests()` lists what the agent sent. A scripted `request_approval` takes bill ids read from `h.snapshot()` (`h.payableBillIds`), never hard-coded ones.

## Rules for a scenario file

- One single expression, no `import`, no `require`, no trailing `;`: the tool runs it in a VM without modules. `build.mjs` rejects a file that is not one expression.
- Everything comes from `h`: `open`, `visit`, `resetDemo`, `sendPrompt`, `waitForRunEnd`, `chatText`, `snapshot`, `moneyIn`, `formatUsd`, `test`, `assert`, `assertEqual`, `expectVisible`, and for the stub `stubScript`, `stubRelease`, `stubReset`, `stubRequests`, `payableBillIds`, `openSettings`, `clickReset`.
- `h.resetDemo()` resets through the API and reloads the page; `h.clickReset()` uses the Settings control, which is what a scenario about the control must do.
- Group related checks as named cases with `h.test(name, fn)`; every case runs and failures are collected.
- Compare displayed figures with `h.snapshot()` (`GET /api/erp/snapshot`, served by the agent), never with hard-coded values.
- Validated at 1280x720; `h.open` sets it.
