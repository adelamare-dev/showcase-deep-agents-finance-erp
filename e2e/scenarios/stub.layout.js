// Widget width follows the widget type on the real container width, at 1280x720
// with the chat open: the AR gauge and the bills list sit side by side, the
// chart takes a full row, and the widget added last is scrolled into view.
// Needs the stub stack (`node e2e/fixtures/stack.mjs`): the stub plays the
// model, so no credit is spent.
async (page, h) => {
  const DEFAULT_WIDGET_IDS = ["kpi-cards", "revenue-chart", "expense-breakdown", "recent-transactions", "outstanding-invoices"];
  const box = (type) =>
    page.evaluate((t) => {
      const el = document.querySelector(`[data-widget-type='${t}']`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }, type);

  // Empties the default dashboard first: the case checks the grid on the reference widget set alone.
  const build = async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
    await h.stubScript([
      ...DEFAULT_WIDGET_IDS.map((widgetId) => ({ toolCall: { name: "manage_dashboard", args: { action: "remove", widgetId } } })),
      {
        toolCall: {
          name: "update_dashboard",
          args: {
            widgets: [
              { type: "metric_cards", config: { metrics: ["Cash", "Accounts Payable"] } },
              { type: "ar_aging_gauge", config: {} },
              { type: "invoices", config: { kind: "payable" } },
              { type: "custom_chart", config: { dataset: "cash_flow_forecast", quarters: 4 } },
            ],
          },
        },
      },
      { text: "Done." },
    ]);
    await h.sendPrompt("Build the cash dashboard");
    await h.waitForRunEnd();
    await page.waitForTimeout(1500);
  };

  await h.test("reference layout fits 1280x720 with the chat open", async () => {
    await build();
    const gauge = await box("ar-aging-gauge");
    const bills = await box("outstanding-invoices");
    const metrics = await box("metric-cards");
    h.assert(gauge && bills && metrics, "the metric cards, the gauge and the bills list are on the dashboard");
    h.assert(Math.abs(gauge.top - bills.top) <= 2, `gauge and bills list share a row: ${gauge.top} vs ${bills.top}`);
    const rowBottom = Math.max(gauge.bottom, bills.bottom);
    // One screen of the scroll area: its height minus the top padding of the grid wrapper.
    const budget = await page.evaluate(() => {
      const wrapper = document.querySelector("[data-widget-type]").parentElement.parentElement;
      return document.querySelector("main").clientHeight - parseFloat(getComputedStyle(wrapper).paddingTop);
    });
    const extent = rowBottom - metrics.top;
    h.assert(extent <= budget, `metric cards to the end of the row fit on one screen: extent ${extent}, budget ${budget}`);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(scrollWidth <= 1280, `no horizontal overflow: ${scrollWidth}`);
    await h.expectVisible(page.getByTestId("copilot-message-list"), 5000);
    return { gauge, bills, metrics, extent, budget, scrollWidth };
  });

  await h.test("no widget content overflows its card", async () => {
    await build();
    h.assertEqual(await h.clippedCardContent(), [], "clipped content in dashboard cards");
  });

  await h.test("the last added widget is scrolled into view", async () => {
    await build();
    const inside = await page.evaluate(() => {
      const chart = document.querySelector("[data-widget-type='custom-chart']");
      const main = document.querySelector("main");
      if (!chart || !main) return null;
      const c = chart.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      return { top: c.top, bottom: c.bottom, mainTop: m.top, mainBottom: m.bottom };
    });
    h.assert(inside, "the chart and the main area exist");
    h.assert(inside.top >= inside.mainTop - 1 && inside.bottom <= inside.mainBottom + 1, `the chart sits inside the main area: ${JSON.stringify(inside)}`);
    return inside;
  });
}
