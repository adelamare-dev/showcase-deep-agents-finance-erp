import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// One test per scenario file. The scenario collects its own named cases and
// throws when any fails, so a thrown error is the failure.
const names = readdirSync(join(__dirname, "..", "scenarios"))
  .filter((f) => f.endsWith(".js"))
  .map((f) => f.replace(/\.js$/, ""));

for (const name of names) {
  if (name === "stub.agent-down") {
    // It needs the agent killed and restarted by hand between three runs, so
    // only the Playwright plugin plays it (see e2e/README.md).
    test.skip(name, () => {});
    continue;
  }
  test(name, async ({ page }) => {
    // Imported at run time: the loader is an ES module (import.meta), which the
    // runner's CommonJS transform of this file cannot load statically.
    const { loadScenario } = await import("../lib/load-scenario.mjs");
    // E2E_ONLY="3,5" plays only those entries of a scenario that declares a selection.
    const onlyRaw = process.env.E2E_ONLY;
    const only = onlyRaw ? onlyRaw.split(",").map((n) => n.trim()) : undefined;
    if (only && !only.every((n) => /^\d+$/.test(n))) {
      throw new Error("E2E_ONLY takes comma-separated entry indices, e.g. E2E_ONLY=3,5");
    }
    const loaded = loadScenario(name, { only });
    if (!loaded) throw new Error(only ? `scenario ${name} not found or takes no entry selection (unset E2E_ONLY)` : `scenario ${name} not found`);
    const startedAt = new Date().toISOString();
    // run() throws when a case failed, with the full result in the message; the
    // live record below is printed first so a failed pass is recorded too.
    let result: { passed: number; failed: string[]; cases: unknown[] };
    try {
      result = await loaded.run(page);
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      const json = message.startsWith("Failed cases: ") ? message.slice("Failed cases: ".length) : null;
      if (name.startsWith("live.")) {
        const failedResult = json ? JSON.parse(json) : { passed: 0, failed: [name], cases: [{ name, ok: false, error: message }] };
        console.log("live-result " + JSON.stringify({ scenario: name, startedAt, endedAt: new Date().toISOString(), only: onlyRaw ?? null, ...failedResult }));
      }
      throw e;
    }
    if (name.startsWith("live.")) {
      console.log("live-result " + JSON.stringify({ scenario: name, startedAt, endedAt: new Date().toISOString(), only: onlyRaw ?? null, passed: result.passed, failed: result.failed, cases: result.cases }));
    }
    console.log(`${name}: ${result.passed}/${result.cases.length} cases passed`);
    expect(result.failed).toEqual([]);
  });
}
