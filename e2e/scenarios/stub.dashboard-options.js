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

  await h.test("a replace carrying an unknown widget type changes nothing", async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
    const before = (await h.scanDashboard()).widgets.map((w) => w.type);
    await h.stubScript([
      {
        toolCall: {
          name: "update_dashboard",
          args: {
            replace: true,
            widgets: [
              { type: "metric_cards", config: { metrics: ["Cash"] } },
              { type: "pie_of_doom", config: {} },
            ],
          },
        },
      },
      { text: "Done." },
    ]);
    await h.sendPrompt("Build the pie dashboard");
    await h.waitForRunEnd();
    await page.waitForTimeout(1000);
    const after = (await h.scanDashboard()).widgets.map((w) => w.type);
    h.assertEqual(after, before, "the default widgets are all still there");
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
    h.assert((await h.chatText()).includes("Replacing dashboard with"), "the tool card says the dashboard is replaced");
    // The whole reference layout sits in the first screen of the scroll area:
    // the KPI cards, then the gauge and the bills list beside each other.
    const view = await page.evaluate(() => {
      const main = document.querySelector("main");
      const area = main.getBoundingClientRect();
      const box = (q) => {
        const el = document.querySelector(q);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      };
      return {
        areaTop: area.top,
        areaBottom: area.top + main.clientHeight,
        scrollTop: main.scrollTop,
        cash: box("[data-testid='kpi-Cash']"),
        payables: box("[data-testid='kpi-Accounts Payable']"),
        gauge: box("[data-widget-type='ar-aging-gauge']"),
        bills: box("[data-widget-type='outstanding-invoices']"),
      };
    });
    h.assertEqual(view.scrollTop, 0, "the dashboard was not scrolled");
    for (const name of ["cash", "payables", "gauge", "bills"]) {
      const b = view[name];
      h.assert(b, `the ${name} widget is on the dashboard`);
      h.assert(b.top >= view.areaTop && b.bottom <= view.areaBottom, `the ${name} widget is entirely visible without scrolling: ${JSON.stringify(view)}`);
    }
    // Half width: the first three open bills show, and the link counts them all.
    const visibleRows = (sel) =>
      page.evaluate((q) => [...document.querySelectorAll(q + " tbody tr")].filter((tr) => tr.getBoundingClientRect().height > 0).length, sel);
    const bills = "[data-widget-type='outstanding-invoices']";
    const openBills = (await h.snapshot()).bills.filter((b) => b.status === "pending" || b.status === "overdue").length;
    h.assert(openBills > 3, `the store has more than three open bills: ${openBills}`);
    h.assertEqual(await visibleRows(bills), Math.min(3, openBills), "the half-width bills card shows three rows");
    const hint = (await page.locator(bills + " [data-testid='bills-total']").innerText()).trim();
    h.assertEqual(hint, `(${openBills})`, "the half-width link counts every open bill");
    const inView = view;
    await h.stubReset();
    return { types, inView };
  });

  await h.test("a full-width bills card lists every open bill", async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
    await h.stubScript([
      {
        toolCall: {
          name: "update_dashboard",
          args: { replace: true, widgets: [{ type: "invoices", colSpan: 4, config: { kind: "payable" } }] },
        },
      },
      { text: "Done." },
    ]);
    await h.sendPrompt("Show the bills");
    await h.waitForRunEnd();
    await page.waitForTimeout(1000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const card = document.querySelector("[data-widget-type='outstanding-invoices']");
      const rows = [...card.querySelectorAll("tbody tr")];
      return {
        rows: rows.length,
        visible: rows.filter((tr) => tr.getBoundingClientRect().height > 0).length,
        hint: [...card.querySelectorAll("[data-testid='bills-total']")].filter((e) => e.getBoundingClientRect().width > 0).length,
        width: card.getBoundingClientRect().width,
      };
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    const openBills = (await h.snapshot()).bills.filter((b) => b.status === "pending" || b.status === "overdue").length;
    h.assertEqual(result.rows, openBills, `the card lists every open bill: ${JSON.stringify(result)}`);
    h.assertEqual(result.visible, openBills, `every bill row shows at full width: ${JSON.stringify(result)}`);
    h.assertEqual(result.hint, 0, "no count hint at full width");
    await h.stubReset();
    return result;
  });

  await h.test("metric cards show the change highlight after an approval", async () => {
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
            ],
          },
        },
      },
      { text: "Done." },
    ]);
    await h.sendPrompt("Build the cash dashboard");
    await h.waitForRunEnd();
    const cards = page.locator("[data-widget-type='metric-cards']");
    await h.expectVisible(cards, 10000);
    const before = (await h.snapshot()).totals;

    await h.stubScript([
      { toolCall: { name: "request_approval", args: { type: "supplier_payment", due_within_days: 7, include_overdue: true } } },
      { text: "The payment was made." },
    ]);
    await h.sendPrompt("Approve the supplier bills due this week, including any overdue ones");
    await h.expectVisible(page.getByTestId("bill-approval-card"), 30000);
    await page.getByTestId("copilot-message-list").getByRole("button", { name: "Approve Payment", exact: true }).click();
    const cashDelta = cards.getByTestId("kpi-delta-Cash");
    const payablesDelta = cards.getByTestId("kpi-delta-Accounts Payable");
    await h.expectVisible(cashDelta, 15000);
    await h.expectVisible(payablesDelta, 15000);
    const cashText = await cashDelta.innerText();
    const payablesText = await payablesDelta.innerText();
    await h.waitForRunEnd();
    const after = (await h.snapshot()).totals;
    const paid = before.cash - after.cash;
    h.assert(paid > 0, "the approval paid something");
    const money = (text) => Number(text.replace(/[^0-9.]/g, ""));
    h.assert(cashText.startsWith("−"), `the Cash change is a decrease: ${cashText}`);
    h.assertEqual(money(cashText), paid, "the Cash change on the metric card is the paid total");
    h.assertEqual(money(payablesText), before.accountsPayable - after.accountsPayable, "the Accounts Payable change is the amount paid");
    await h.stubReset();
    return { cashText, payablesText, paid };
  });

  // One assistant message carries a reset and a replacing update; the dashboard
  // ends with exactly the widgets given, whichever order the calls come in.
  for (const [label, order] of [["a reset then a replace", ["reset", "replace"]], ["a replace then a reset", ["replace", "reset"]]]) {
    await h.test(`${label} in one message leaves exactly the replaced widgets`, async () => {
      await h.stubReset();
      await h.resetDemo();
      await h.open("/");
      const calls = {
        reset: { name: "manage_dashboard", args: { action: "reset" } },
        replace: {
          name: "update_dashboard",
          args: {
            replace: true,
            widgets: [
              { type: "metric_cards", config: { metrics: ["Cash"] } },
              { type: "ar_aging_gauge", config: {} },
            ],
          },
        },
      };
      await h.stubScript([{ toolCalls: order.map((k) => calls[k]) }, { text: "Done." }]);
      await h.sendPrompt("Reset the dashboard and build the cash view");
      await h.waitForRunEnd();
      await page.waitForTimeout(1500);
      const types = (await h.scanDashboard()).widgets.map((w) => w.type);
      h.assertEqual(types, ["metric-cards", "ar-aging-gauge"], "exactly the replaced widgets remain");
      await h.stubReset();
      return { types };
    });
  }

  // The guard lasts one run: a reset asked in the next run applies again.
  await h.test("a reset asked in a later run applies after a replacing update", async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
    const defaults = (await h.scanDashboard()).widgets.map((w) => w.type);
    await h.stubScript([
      {
        toolCall: {
          name: "update_dashboard",
          args: {
            replace: true,
            widgets: [
              { type: "metric_cards", config: { metrics: ["Cash"] } },
              { type: "ar_aging_gauge", config: {} },
            ],
          },
        },
      },
      { text: "Done." },
    ]);
    await h.sendPrompt("Build the cash view");
    await h.waitForRunEnd();
    await page.waitForTimeout(1000);
    const built = (await h.scanDashboard()).widgets.map((w) => w.type);
    h.assertEqual(built, ["metric-cards", "ar-aging-gauge"], "the first run left the replaced widgets");

    await h.stubScript([
      { toolCall: { name: "manage_dashboard", args: { action: "reset" } } },
      { text: "Reset." },
    ]);
    await h.sendPrompt("Put the default dashboard back");
    await h.waitForRunEnd();
    await page.waitForTimeout(1500);
    const types = (await h.scanDashboard()).widgets.map((w) => w.type);
    h.assertEqual(types, defaults, "the second run restored the default widgets");
    await h.stubReset();
    return { built, types };
  });
}
