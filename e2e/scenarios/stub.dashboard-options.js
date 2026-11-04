// A widget option the widgets read as a list (metrics, categories, statuses)
// arrives as one string from the model: it is taken as a single item and the
// page keeps rendering, instead of crashing on a string where a list is read.
// Needs the stub stack (`node e2e/fixtures/stack.mjs`): the stub plays the
// model, so no credit is spent.
async (page, h) => {
  const byId = (id) => page.getByTestId(id);

  await h.test("A list option sent as one string renders the widgets", async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
    const errors = [];
    const onPageError = (e) => errors.push(String((e && e.message) || e));
    page.on("pageerror", onPageError);
    try {
      await h.stubScript([
        {
          toolCall: {
            name: "update_dashboard",
            args: {
              widgets: [
                { type: "metric_cards", config: { metrics: "Cash" } },
                { type: "spend_heatmap", config: { categories: "marketing" } },
                { type: "budget_variance", config: { categories: "Marketing" } },
                { type: "expense_breakdown", config: { categories: "Marketing" } },
                { type: "invoices", config: { kind: "payable", statuses: "overdue" } },
                { type: "kpi_cards", config: { metrics: "Cash" } },
              ],
            },
          },
        },
        { text: "The dashboard now holds the widgets." },
      ]);
      await h.sendPrompt("Add the cost widgets");
      await h.waitForRunEnd();
      await page.waitForTimeout(1000);
    } finally {
      page.off("pageerror", onPageError);
    }

    h.assertEqual(await page.getByText("Something went wrong").count(), 0, "the page shows no error screen");
    h.assertEqual(errors, [], "page errors");
    const widgets = (await h.scanDashboard()).widgets;
    const types = widgets.map((w) => w.type);
    for (const type of ["metric-cards", "spend-heatmap", "budget-variance", "expense-breakdown", "outstanding-invoices", "kpi-cards"]) {
      h.assert(types.includes(type), `the ${type} widget is on the dashboard: ${types.join(", ")}`);
    }
    const metricCards = widgets.find((w) => w.type === "metric-cards");
    h.assert(metricCards.text.includes("Cash"), "the metric cards show the Cash KPI");
    h.assert(!metricCards.text.includes("Total Revenue"), "the metric cards show only the one KPI asked for");
    await h.stubReset();
    return { types };
  });
}
