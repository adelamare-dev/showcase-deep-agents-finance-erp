// Assembles e2e/lib/helpers.js and each e2e/scenarios/<name>.js into
// .playwright-mcp/scenarios/<name>.js, ready for the Playwright plugin's
// browser_run_code_unsafe.
// Usage: node e2e/build.mjs [name-filter] [--only=3,5]
// `--only` inlines a list of entry indices into a scenario that declares
// `const ONLY = null;` and writes <name>.only-3-5.js beside the full build.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", ".playwright-mcp", "scenarios");
const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith("--")) ?? "";
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;
if (only && !only.every((n) => /^\d+$/.test(n))) throw new Error("--only takes comma-separated entry indices, e.g. --only=3,5");

// The plugin accepts one single expression: no trailing semicolon, no import.
const expression = (path) => {
  const src = readFileSync(path, "utf8").trim().replace(/;+$/, "");
  try {
    new Function(`return (${src}\n)`);
  } catch (e) {
    throw new Error(`${path} is not a single expression: ${e.message}`);
  }
  return src;
};

const helpers = expression(join(here, "lib", "helpers.js"));
mkdirSync(outDir, { recursive: true });

const names = readdirSync(join(here, "scenarios"))
  .filter((f) => f.endsWith(".js") && f.includes(filter));
for (const file of names) {
  let scenario = expression(join(here, "scenarios", file));
  let outName = file;
  if (only) {
    const marker = "const ONLY = null;";
    if (!scenario.includes(marker)) continue;
    scenario = scenario.replace(marker, `const ONLY = [${only.join(", ")}];`);
    outName = file.replace(/\.js$/, `.only-${only.join("-")}.js`);
  }
  const built = `async (page) => {\n  const h = (${helpers}\n)(page);\n  return await h.run(${scenario}\n);\n}\n`;
  writeFileSync(join(outDir, outName), built);
  console.log(`built .playwright-mcp/scenarios/${outName}`);
}
