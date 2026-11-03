// All twelve widget types render from a saved dashboard, with a full config,
// with an empty one and with none, and raise no console or page error. The
// widgets are injected into the versioned saved-dashboards storage entry and
// loaded from the gallery, so no model is called. Needs `pnpm demo`.
async (page, h) => {
  const KEY = "finance-os.dashboards.v2";
  const stamp = "2026-01-01T00:00:00.000Z";
  const NAME = "Every Widget Type";

  const TYPES = [
    "kpi-cards", "revenue-chart", "expense-breakdown", "recent-transactions", "outstanding-invoices",
    "custom-chart", "cash-waterfall", "ar-aging-gauge", "budget-variance", "spend-heatmap",
    "revenue-forecast", "metric-cards",
  ];
  // Configs as the orchestrator may send them: options and identifiers, never figures.
  const FULL = {
    "kpi-cards": { metrics: ["Cash", "Accounts Payable"] },
    "revenue-chart": { showProfit: true, showExpenses: true },
    "expense-breakdown": { categories: ["Payroll", "Operations"] },
    "recent-transactions": { limit: 3 },
    "outstanding-invoices": { kind: "payable", statuses: ["pending", "overdue"] },
    "custom-chart": { dataset: "ar_aging", title: "AR aging", chartType: "bar" },
    "cash-waterfall": { mode: "waterfall", quarters: 4, showNetLine: true },
    "ar-aging-gauge": { title: "AR aging", warningThreshold: 0.85, criticalThreshold: 0.7 },
    "budget-variance": { showPercentage: true, categories: ["Payroll"] },
    "spend-heatmap": { categories: ["payroll", "marketing"], colorScale: "blue" },
    "revenue-forecast": { mode: "quarterly", trailingQuarters: 4, showMarginLine: true },
    "metric-cards": { metrics: ["Cash", "Accounts Payable"], stacked: true },
  };

  const build = (variant) =>
    TYPES.flatMap((type, order) => {
      // A custom chart without a dataset is refused when read, so it keeps its dataset.
      const config = type === "custom-chart" ? { dataset: "ar_aging" } : variant === "full" ? FULL[type] : {};
      if (variant === "absent" && type !== "custom-chart") {
        return [{ id: `w-${order}`, type, colSpan: 2, order }];
      }
      return [{ id: `w-${order}`, type, colSpan: 2, order, config }];
    });

  const seed = (arg) => window.localStorage.setItem(arg.key, arg.value);

  const renderVariant = async (variant) => {
    const p = await page.context().newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push("page: " + String(e.message || e)));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text());
    });
    try {
      const value = JSON.stringify([
        { id: "all-types", name: NAME, category: "custom", widgets: build(variant), createdAt: stamp, updatedAt: stamp },
      ]);
      await p.addInitScript(seed, { key: KEY, value });
      await h.visit("/dashboards", p);
      const card = p.locator("[role='button']", { hasText: NAME }).first();
      await card.waitFor({ state: "visible", timeout: 30000 });
      await card.getByRole("button", { name: "Load" }).click();
      await p.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
      try {
        await p.waitForFunction(
          (n) => document.querySelectorAll("[data-widget-type]").length >= n,
          TYPES.length,
          { timeout: 15000 },
        );
      } catch (e) {
        // A widget that throws takes the page down: report what it threw.
        throw new Error("the widgets did not render; errors: " + JSON.stringify(errors).slice(0, 600));
      }
      await p.waitForTimeout(1500);
      const seen = await p.evaluate(() =>
        [...document.querySelectorAll("[data-widget-type]")].map((el) => ({
          type: el.dataset.widgetType,
          height: Math.round(el.getBoundingClientRect().height),
          text: el.innerText.trim().length,
        })),
      );
      return { seen, errors };
    } finally {
      await p.close();
    }
  };

  const check = ({ seen, errors }) => {
    h.assertEqual(seen.map((w) => w.type).sort(), [...TYPES].sort(), "every type is on the page");
    const empty = seen.filter((w) => w.height < 40 || w.text === 0).map((w) => w.type);
    h.assertEqual(empty, [], "no widget renders empty");
    h.assertEqual(errors, [], "no console or page error");
    return seen.map((w) => `${w.type}:${w.height}`);
  };

  await h.test("All twelve widget types render with a full config", async () => check(await renderVariant("full")));
  await h.test("All twelve widget types render with an empty config", async () => check(await renderVariant("empty")));
  await h.test("All twelve widget types render with no config", async () => check(await renderVariant("absent")));
}
