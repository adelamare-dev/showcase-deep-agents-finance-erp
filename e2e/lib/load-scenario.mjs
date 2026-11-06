// Reads e2e/lib/helpers.js and one e2e/scenarios/<name>.js and assembles them
// into the single async expression the Playwright plugin accepts. Shared by
// e2e/build.mjs (writes the expression to a file) and the @playwright/test spec
// (evaluates it on the test's page).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

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

// `only` inlines a list of entry indices into a scenario that declares
// `const ONLY = null;`; returns null when the scenario declares no such marker.
export function loadScenario(name, { only } = {}) {
  let scenario = expression(join(here, "..", "scenarios", `${name}.js`));
  if (only) {
    const marker = "const ONLY = null;";
    if (!scenario.includes(marker)) return null;
    scenario = scenario.replace(marker, `const ONLY = [${only.join(", ")}];`);
  }
  const helpers = expression(join(here, "helpers.js"));
  const source = `async (page) => {\n  const h = (${helpers}\n)(page);\n  return await h.run(${scenario}\n);\n}\n`;
  return {
    source,
    run: (page) => new Function(`return (${source})`)()(page),
  };
}
