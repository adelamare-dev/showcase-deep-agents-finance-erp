import { expect, test } from "@playwright/test";
import cases from "../../agent/tests/data/figure_cases.json";
import { allowedValues, extractFigures, isAllowed } from "../../src/lib/figure-guard";

// The Python module (agent/figure_guard.py) runs the same cases. The titles
// start with "offline." so the offline project plays them.
for (const c of cases as Array<{
  name: string;
  text: string;
  tools: string[];
  userText: string;
  snapshot?: unknown;
  expectUnverified: string[];
}>) {
  test(`offline.figure-guard ${c.name}`, () => {
    const allowed = allowedValues(c.tools, c.snapshot ?? {}, c.userText);
    const found = extractFigures(c.text).filter((f) => !isAllowed(f, allowed));
    expect(found.map((f) => f.raw)).toEqual(c.expectUnverified);
  });
}

test("offline.figure-guard kinds and values", () => {
  const figs = extractFigures("$1.1M, 12.5% and 42 employees, ($1,850)");
  expect(figs.map((f) => [f.raw, f.kind, f.value])).toEqual([
    ["$1.1M", "money", 1_100_000],
    ["12.5%", "percent", 12.5],
    ["42 employees", "count", 42],
    ["($1,850)", "money", 1850],
  ]);
});
