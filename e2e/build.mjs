// Assembles e2e/lib/helpers.js and each e2e/scenarios/<name>.js into
// .playwright-mcp/scenarios/<name>.js, ready for the Playwright plugin's
// browser_run_code_unsafe.
// Usage: node e2e/build.mjs [name-filter] [--only=3,5]
// `--only` inlines a list of entry indices into a scenario that declares
// `const ONLY = null;` and writes <name>.only-3-5.js beside the full build.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadScenario } from "./lib/load-scenario.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", ".playwright-mcp", "scenarios");
const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith("--")) ?? "";
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;
if (only && !only.every((n) => /^\d+$/.test(n))) throw new Error("--only takes comma-separated entry indices, e.g. --only=3,5");

mkdirSync(outDir, { recursive: true });

const names = readdirSync(join(here, "scenarios"))
  .filter((f) => f.endsWith(".js") && f.includes(filter));
for (const file of names) {
  const loaded = loadScenario(file.replace(/\.js$/, ""), { only });
  if (!loaded) continue;
  const outName = only ? file.replace(/\.js$/, `.only-${only.join("-")}.js`) : file;
  writeFileSync(join(outDir, outName), loaded.source);
  console.log(`built .playwright-mcp/scenarios/${outName}`);
}
