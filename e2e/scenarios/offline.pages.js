// Every page shows the values served by the agent's snapshot route. Needs
// `pnpm demo`; no model is called and no message is sent.
async (page, h) => {
  const bodyText = async () => await page.locator("body").innerText();
  const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);

  const requested = [];
  page.on("request", (req) => requested.push(req.url()));

  await h.test("The dashboard shows every KPI of the store", async () => {
    const snap = await h.snapshot();
    h.assert(snap.kpis.length >= 6, "the snapshot serves the KPIs");
    await h.visit("/");
    const text = await bodyText();
    for (const kpi of snap.kpis) {
      h.assert(text.includes(kpi.label), `label "${kpi.label}" is shown`);
      h.assert(text.includes(kpi.value), `value ${kpi.value} of "${kpi.label}" is shown`);
    }
    return { kpis: snap.kpis.map((k) => `${k.label}=${k.value}`) };
  });

  await h.test("Flat KPIs are not shown as a negative change", async () => {
    const snap = await h.snapshot();
    await h.visit("/");
    const flat = snap.kpis.filter((k) => k.trend === "flat").map((k) => k.label);
    h.assert(flat.length > 0, "the store serves at least one flat KPI");
    for (const label of flat) {
      const card = page.locator("p", { hasText: label }).first().locator("xpath=ancestor::*[contains(@class,'group')][1]");
      const badge = (await card.locator("[class*='rounded-full']").first().getAttribute("class")) || "";
      h.assert(!badge.includes("red"), `"${label}" has no red badge (${badge})`);
    }
    return { flat };
  });

  await h.test("Invoices page shows the store's invoices and totals", async () => {
    const snap = await h.snapshot();
    await h.visit("/invoices");
    const text = await bodyText();
    for (const inv of snap.invoices) {
      h.assert(text.includes(inv.number), `${inv.number} is listed`);
    }
    const open = sum(
      snap.invoices.filter((i) => i.status === "pending" || i.status === "overdue"),
      (i) => i.amount,
    );
    h.assert(text.includes(h.formatUsd(open)), `outstanding ${h.formatUsd(open)} is shown`);
    return { invoices: snap.invoices.length, outstanding: open };
  });

  await h.test("Invoices page lists supplier bills apart from client invoices", async () => {
    const snap = await h.snapshot();
    await h.visit("/invoices?filter=supplier");
    const text = await bodyText();
    for (const bill of snap.bills) {
      h.assert(text.includes(bill.number), `${bill.number} is listed`);
    }
    h.assert(!snap.invoices.some((inv) => text.includes(inv.number)), "no client invoice is listed");
    const owed = sum(
      snap.bills.filter((b) => b.status !== "paid"),
      (b) => b.amount,
    );
    h.assert(text.includes(h.formatUsd(owed)), `outstanding ${h.formatUsd(owed)} is shown`);
    await h.visit("/invoices?filter=supplier-paid");
    const paidText = await bodyText();
    const unpaid = snap.bills.filter((b) => b.status !== "paid");
    h.assert(unpaid.every((b) => !paidText.includes(b.number)), "the paid filter hides unpaid bills");
    return { bills: snap.bills.length, owed };
  });

  await h.test("Accounts page shows the chart of accounts and the transactions", async () => {
    const snap = await h.snapshot();
    await h.visit("/accounts");
    const text = await bodyText();
    for (const acc of snap.accounts) {
      h.assert(text.includes(acc.name), `account "${acc.name}" is listed`);
    }
    h.assert(text.includes(snap.transactions[0].description), "a transaction is listed");
    h.assert(text.includes(h.formatUsd(snap.totals.assets)), `total assets ${h.formatUsd(snap.totals.assets)} are shown`);
    h.assert(text.includes(h.formatUsd(snap.totals.liabilities)), `total liabilities ${h.formatUsd(snap.totals.liabilities)} are shown`);
    return { accounts: snap.accounts.length };
  });

  await h.test("Inventory page shows the store's items and stock value", async () => {
    const snap = await h.snapshot();
    await h.visit("/inventory");
    const text = await bodyText();
    for (const item of snap.inventoryItems) {
      h.assert(text.includes(item.sku), `${item.sku} is listed`);
    }
    const value = sum(snap.inventoryItems, (i) => i.quantity * i.unitCost);
    h.assert(text.includes(h.formatUsd(value)), `stock value ${h.formatUsd(value)} is shown`);
    return { items: snap.inventoryItems.length, value };
  });

  await h.test("HR page shows the store's employees and payroll", async () => {
    const snap = await h.snapshot();
    await h.visit("/hr");
    const text = await bodyText();
    for (const emp of snap.employees) {
      h.assert(text.includes(emp.name), `${emp.name} is listed`);
    }
    const payroll = sum(snap.employees.filter((e) => e.status === "active"), (e) => e.salary);
    h.assert(text.includes(h.formatUsd(payroll)), `active payroll ${h.formatUsd(payroll)} is shown`);
    return { employees: snap.employees.length, payroll };
  });

  await h.test("The forecast headline on the Revenue Overview template is the store's base case", async () => {
    const snap = await h.snapshot();
    h.assert(Array.isArray(snap.revenueScenarios), "the snapshot serves the revenue scenarios");
    const base = snap.revenueScenarios.find((s) => s.label === "Base");
    h.assert(base && base.values.length > 0, "the snapshot serves a base scenario");
    const target = base.values[base.values.length - 1].value;
    await h.visit("/dashboards");
    await page.getByRole("button", { name: /Revenue Overview/ }).first().click();
    await page.getByText("base case target").first().waitFor({ state: "visible", timeout: 30000 });
    const headline = await page
      .getByText("base case target")
      .first()
      .locator("xpath=preceding-sibling::span[1]")
      .innerText();
    h.assertEqual(headline, h.formatUsd(target), "the headline is the last base-case value of the snapshot");
    return { headline, target };
  });

  await h.test("No page asks a dashboards route or a database", async () => {
    const own = requested.filter((u) => u.startsWith(h.WEB_URL + "/api/") && !u.includes("/api/copilotkit"));
    h.assertEqual(own, [], "the web app serves no other API route");
    h.assert(requested.some((u) => u.endsWith("/api/erp/snapshot")), "the snapshot route was requested");
    return { requests: requested.length };
  });
}
