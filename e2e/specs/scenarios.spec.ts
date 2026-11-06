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
    const loaded = loadScenario(name);
    if (!loaded) throw new Error(`scenario ${name} not found`);
    const result = await loaded.run(page);
    console.log(`${name}: ${result.passed}/${result.cases.length} cases passed`);
    expect(result.failed).toEqual([]);
  });
}
