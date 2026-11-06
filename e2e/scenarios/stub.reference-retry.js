// Retry never pays twice. A model failure is injected around a supplier-payment
// approval, the run is retried, and the books show exactly one payment. Needs
// the stub stack (`node e2e/fixtures/stack.mjs`): the stub plays the model, so
// no credit is spent.
async (page, h) => {
  const byId = (id) => page.getByTestId(id);
  const banner = byId("run-error-banner");
  const inChat = (name) => byId("copilot-message-list").getByRole("button", { name, exact: true });
  const fresh = async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
  };
  const cardTotal = async () => Number(await byId("bill-approval-total").getAttribute("data-amount"));
  const shownIds = () => byId("bill-approval-row").evaluateAll((rows) => rows.map((r) => r.dataset.billId));
  const ask = () => ({
    toolCall: { name: "request_approval", args: { type: "supplier_payment", due_within_days: 7, include_overdue: true } },
  });

  await h.test("A failure right after the approval, then Retry: one payment", async () => {
    await fresh();
    const before = await h.snapshot();
    const ids = h.billsForApproval(before).map((b) => b.id);
    h.assert(ids.length > 0, "the store holds unpaid bills overdue or due this week");
    // The payment is applied, then the model call that should report it fails.
    await h.stubScript([ask(), { status: 500, message: "" }]);
    await h.sendPrompt("Approve the supplier bills due this week, including any overdue ones");
    await h.expectVisible(byId("bill-approval-card"), 30000);
    const total = await cardTotal();
    h.assertEqual(await shownIds(), ids, "the card lists the bills the store selects");
    await inChat("Approve Payment").click();
    await h.expectVisible(banner, 30000);
    const paid = await h.snapshot();
    h.assertEqual(before.totals.cash - paid.totals.cash, total, "the approval paid once before the failure");

    // The model repeats the same request: the bills are settled, so no card comes back.
    await h.stubScript([ask(), { text: "Those bills are already paid." }]);
    await byId("run-error-retry").click();
    await h.waitForRunEnd();
    h.assertEqual(await banner.count(), 0, "the notice is gone");
    h.assertEqual(await byId("bill-approval-card").count(), 0, "no second approval card");
    const after = await h.snapshot();
    h.assertEqual(before.totals.cash - after.totals.cash, total, "Cash fell by the total once");
    h.assertEqual(before.totals.accountsPayable - after.totals.accountsPayable, total, "Accounts Payable fell by the total once");
    h.assertEqual(after.totals.equity, before.totals.equity, "equity unchanged");
    h.assertEqual(after.bills, paid.bills, "Retry changed no bill");
    return { ids, total };
  });

  await h.test("A failure before the card, then Retry and approval: one payment", async () => {
    await fresh();
    const before = await h.snapshot();
    const ids = h.billsForApproval(before).map((b) => b.id);
    await h.stubScript([{ status: 500, message: "" }]);
    await h.sendPrompt("Approve the supplier bills due this week, including any overdue ones");
    await h.expectVisible(banner, 30000);
    h.assertEqual((await h.snapshot()).totals, before.totals, "nothing was paid by the failed run");

    await h.stubScript([ask(), { text: "The payment was made." }]);
    await byId("run-error-retry").click();
    await h.expectVisible(byId("bill-approval-card"), 30000);
    const total = await cardTotal();
    h.assertEqual(await shownIds(), ids, "the card lists the bills the store selects");
    await inChat("Approve Payment").click();
    await h.waitForRunEnd();
    const after = await h.snapshot();
    h.assertEqual(before.totals.cash - after.totals.cash, total, "Cash fell by the total once");
    h.assertEqual(before.totals.accountsPayable - after.totals.accountsPayable, total, "Accounts Payable fell by the total once");
    h.assertEqual(after.totals.assets, after.totals.liabilities + after.totals.equity, "books balance");
    h.assertEqual(await byId("copilot-user-message").count(), 1, "Retry added no message");
    return { ids, total };
  });

  await h.stubReset();
}
