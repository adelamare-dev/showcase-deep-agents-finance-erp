// Assembles e2e/lib/helpers.js and each e2e/scenarios/<name>.js into
// .playwright-mcp/scenarios/<name>.js, ready for the Playwright plugin's
// browser_run_code_unsafe. Usage: node e2e/build.mjs [name-filter]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", ".playwright-mcp", "scenarios");
const filter = process.argv[2] ?? "";

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
  const scenario = expression(join(here, "scenarios", file));
  const built = `async (page) => {\n  const h = (${helpers}\n)(page);\n  return await h.run(${scenario}\n);\n}\n`;
  writeFileSync(join(outDir, file), built);
  console.log(`built .playwright-mcp/scenarios/${file}`);
}
