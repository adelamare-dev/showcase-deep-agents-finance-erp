// Approving a supplier payment or a reorder changes the agent's books and the
// screen shows it. Needs `pnpm demo` with a real MISTRAL_API_KEY in agent/.env.
async (page, h) => {
  const inChat = (name) =>
    page.getByTestId("copilot-message-list").getByRole("button", { name, exact: true });
  const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);
  const paidNumbers = (snap) => snap.bills.filter((b) => b.status === "paid").map((b) => b.number);

  const expectBooksBalance = (totals) => {
    h.assertEqual(totals.assets, totals.liabilities + totals.equity, "assets = liabilities + equity");
  };

  await h.test("Approving supplier payments pays the bills and shows the change", async () => {
    await h.resetDemo();
    await h.open("/");
    const before = await h.snapshot();
    await h.sendPrompt("Approve the supplier bills due this week, including any overdue ones");
    await h.expectVisible(page.getByTestId("bill-approval-card"), 120000);

    // The card total is the sum of the listed bills as the store holds them.
    const ids = await page.getByTestId("bill-approval-row").evaluateAll((rows) => rows.map((r) => r.dataset.billId));
    const cardTotal = Number(await page.getByTestId("bill-approval-total").getAttribute("data-amount"));
    const byId = Object.fromEntries(before.bills.map((b) => [b.id, b]));
    h.assert(ids.length > 0, "the card lists bills");
    h.assert(ids.every((id) => byId[id] && byId[id].status !== "paid"), "every listed bill is unpaid in the store");
    h.assertEqual(cardTotal, sum(ids, (id) => byId[id].amount), "card total = sum of the listed bills");

    await inChat("Approve Payment").click();
    // The change is highlighted for a few seconds: read it while it shows.
    await h.expectVisible(page.getByTestId("kpi-delta-Cash"), 60000);
    const cashDelta = (await page.getByTestId("kpi-delta-Cash").innerText()).trim();
    const payablesDelta = (await page.getByTestId("kpi-delta-Accounts Payable").innerText()).trim();
    h.assertEqual(cashDelta, "−" + h.formatUsd(cardTotal), "Cash delta shown");
    h.assertEqual(payablesDelta, "−" + h.formatUsd(cardTotal), "Accounts Payable delta shown");
    await h.waitForRunEnd();

    const after = await h.snapshot();
    h.assertEqual(before.totals.cash - after.totals.cash, cardTotal, "Cash fell by the total");
    h.assertEqual(before.totals.accountsPayable - after.totals.accountsPayable, cardTotal, "Accounts Payable fell by the total");
    h.assertEqual(after.totals.equity, before.totals.equity, "equity unchanged");
    expectBooksBalance(after.totals);
    const afterById = Object.fromEntries(after.bills.map((b) => [b.id, b]));
    h.assert(ids.every((id) => afterById[id].status === "paid"), "the listed bills are paid");
    const untouched = before.bills.filter((b) => !ids.includes(b.id));
    h.assertEqual(untouched.map((b) => afterById[b.id].status), untouched.map((b) => b.status), "other bills unchanged");

    // The delta fades after a few seconds and the KPI shows the new figure.
    await page.getByTestId("kpi-delta-Cash").waitFor({ state: "detached", timeout: 10000 });
    const cashKpi = after.kpis.find((k) => k.label === "Cash");
    h.assert((await page.getByTestId("kpi-Cash").innerText()).includes(cashKpi.value), "the Cash KPI shows the new value");

    // A following turn no longer lists the paid bills.
    await h.sendPrompt("Which supplier bills are still unpaid?");
    await h.waitForRunEnd();
    const answer = await page.getByTestId("copilot-assistant-message").last().innerText();
    const nowPaid = paidNumbers(after).filter((n) => !paidNumbers(before).includes(n));
    h.assert(nowPaid.every((n) => !answer.includes(n)), "the answer omits the bills just paid");
    const stillOpen = after.bills.filter((b) => b.status !== "paid");
    h.assert(stillOpen.length === 0 || stillOpen.some((b) => answer.includes(b.number)), "the answer lists a bill still unpaid");
    return { ids, cardTotal, cashDelta, payablesDelta, beforeTotals: before.totals, afterTotals: after.totals };
  });

  await h.test("Rejecting a supplier payment changes nothing", async () => {
    await h.resetDemo();
    await h.open("/");
    const before = await h.snapshot();
    await h.sendPrompt("Approve the supplier bills due this week, including any overdue ones");
    await h.expectVisible(page.getByTestId("bill-approval-card"), 120000);
    await inChat("Reject").click();
    await page.getByTestId("bill-approval-card").waitFor({ state: "detached", timeout: 30000 });
    await h.waitForRunEnd();
    const after = await h.snapshot();
    h.assertEqual(after.totals, before.totals, "totals unchanged");
    h.assertEqual(after.bills, before.bills, "bills unchanged");
    h.assertEqual(await page.getByTestId("kpi-delta-Cash").count(), 0, "no change is highlighted");
    return { totals: after.totals };
  });

  await h.test("Approving a reorder marks the items on order without touching the books", async () => {
    await h.resetDemo();
    await h.open("/");
    const before = await h.snapshot();
    await h.sendPrompt("Check inventory levels and reorder anything that needs restocking");
    await h.expectVisible(page.getByTestId("reorder-approval-card"), 120000);
    const rows = await page.getByTestId("reorder-approval-row").evaluateAll((els) =>
      els.map((r) => ({ sku: r.dataset.sku, quantity: Number(r.dataset.quantity) })),
    );
    const cardTotal = Number(await page.getByTestId("reorder-approval-total").getAttribute("data-amount"));
    const cost = Object.fromEntries(before.inventoryItems.map((i) => [i.sku, i.unitCost]));
    h.assert(rows.length > 0 && rows.every((r) => cost[r.sku] !== undefined), "every listed SKU exists in the store");
    h.assertEqual(cardTotal, sum(rows, (r) => r.quantity * cost[r.sku]), "card total = sum of quantity x unit cost");

    await inChat("Approve PO").click();
    await page.getByTestId("reorder-approval-card").waitFor({ state: "detached", timeout: 30000 });
    await h.waitForRunEnd();
    const after = await h.snapshot();
    const onOrder = Object.fromEntries(after.inventoryItems.map((i) => [i.sku, i.onOrder]));
    h.assertEqual(rows.map((r) => onOrder[r.sku]), rows.map((r) => r.quantity), "ordered items are on order");
    h.assertEqual(after.inventoryItems.filter((i) => i.onOrder > 0).length, rows.length, "no other item is on order");
    h.assertEqual(after.totals, before.totals, "cash, payables and equity unchanged");
    expectBooksBalance(after.totals);
    h.assertEqual(
      after.inventoryItems.map((i) => i.quantity),
      before.inventoryItems.map((i) => i.quantity),
      "stock quantities unchanged",
    );
    return { rows, cardTotal };
  });
}
