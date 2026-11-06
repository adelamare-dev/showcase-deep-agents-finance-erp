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

  await h.test("a refused update changes nothing, the corrected one renders", async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
    const before = (await h.scanDashboard()).widgets.map((w) => w.type);
    await h.stubScript([
      {
        toolCall: {
          name: "update_dashboard",
          args: {
            widgets: [
              { type: "metric_cards", config: { metrics: ["Cash"] } },
              { type: "custom_chart", config: { dataset: "no_such_dataset" } },
            ],
          },
        },
      },
      {
        toolCall: {
          name: "update_dashboard",
          args: { widgets: [{ type: "ar_aging_gauge", config: {} }] },
        },
      },
      { text: "The dashboard now holds the gauge." },
    ]);
    await h.sendPrompt("Add the cash widgets");
    await h.waitForRunEnd();
    await page.waitForTimeout(1000);
    const after = (await h.scanDashboard()).widgets.map((w) => w.type);
    h.assert(!after.includes("metric-cards"), `the valid widget of the refused call was not added: ${after.join(", ")}`);
    h.assert(!after.includes("custom-chart"), "the refused chart was not added");
    h.assert(after.includes("ar-aging-gauge"), "the corrected call rendered its widget");
    h.assertEqual(after.filter((t) => t !== "ar-aging-gauge"), before, "the refused call left the defaults untouched");
    await h.stubReset();
    return { before, after };
  });

  await h.test("an accepted replace leaves exactly the reference widgets in view", async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
    await h.stubScript([
      {
        toolCall: {
          name: "update_dashboard",
          args: {
            replace: true,
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
    const types = (await h.scanDashboard()).widgets.map((w) => w.type);
    h.assertEqual(types, ["metric-cards", "ar-aging-gauge", "outstanding-invoices", "custom-chart"], "exactly the widgets given, in order");
    // The two KPI cards show on load; the gauge and the bills list sit one row
    // below, and the three rows together fit one screen of the scroll area (the
    // toolbar above them is the only reason the second row starts low).
    const view = await page.evaluate(() => {
      const main = document.querySelector("main");
      const mainTop = main.getBoundingClientRect().top;
      const box = (q) => {
        const el = document.querySelector(q);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top - mainTop, bottom: r.bottom - mainTop };
      };
      const wrapper = document.querySelector("[data-widget-type]").parentElement.parentElement;
      return {
        height: main.clientHeight,
        scrollTop: main.scrollTop,
        budget: main.clientHeight - parseFloat(getComputedStyle(wrapper).paddingTop),
        cash: box("[data-testid='kpi-Cash']"),
        payables: box("[data-testid='kpi-Accounts Payable']"),
        gauge: box("[data-widget-type='ar-aging-gauge']"),
        bills: box("[data-widget-type='outstanding-invoices']"),
      };
    });
    h.assertEqual(view.scrollTop, 0, "the dashboard was not scrolled");
    for (const name of ["cash", "payables"]) {
      h.assert(view[name] && view[name].top >= 0 && view[name].bottom <= view.height, `the ${name} KPI is visible without scrolling: ${JSON.stringify(view[name])}`);
    }
    h.assert(view.gauge && view.bills, "the gauge and the bills list are on the dashboard");
    for (const name of ["gauge", "bills"]) {
      h.assert(view[name].top < view.height, `the ${name} starts inside the visible scroll area: ${JSON.stringify(view[name])}`);
    }
    const extent = Math.max(view.gauge.bottom, view.bills.bottom) - Math.min(view.cash.top, view.payables.top);
    h.assert(extent <= view.budget, `the KPIs, the gauge and the bills list fit one screen: extent ${extent}, budget ${view.budget}`);
    const inView = view;
    await h.stubReset();
    return { types, inView };
  });
}
