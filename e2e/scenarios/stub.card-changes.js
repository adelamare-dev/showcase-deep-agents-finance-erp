// After an approval changes the books, the cash card already in the chat keeps
// the figures it first showed, struck through, next to the new ones. Needs the
// stub stack (`node e2e/fixtures/stack.mjs`): the stub plays the model, so no
// credit is spent.
async (page, h) => {
  const byId = (id) => page.getByTestId(id);
  const inChat = (name) => byId("copilot-message-list").getByRole("button", { name, exact: true });
  const sum = (bills) => bills.reduce((total, b) => total + b.amount, 0);
  const amount = (text) => Number(text.replace(/[^0-9.-]/g, ""));
  const totalCashRow = () =>
    byId("copilot-message-list").locator('span:text-is("Total Cash")').locator("xpath=..");

  await h.test("After approval the cash card shows the old total struck through", async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
    const selected = h.billsForApproval(await h.snapshot());
    h.assert(selected.length > 0, "the store holds unpaid bills overdue or due this week");
    const total = sum(selected);

    await h.stubScript([
      { toolCall: { name: "render_chat_visual", args: { dataset: "cash_position" } } },
      { text: "Here is the cash position." },
    ]);
    await h.sendPrompt("Show me the cash position");
    await h.expectVisible(totalCashRow(), 30000);
    await h.waitForRunEnd();
    h.assertEqual(await byId("changed-value-before").count(), 0, "nothing is struck through before a change");
    const shownBefore = (await totalCashRow().innerText()).replace("Total Cash", "").trim();
    const cashBefore = (await h.snapshot()).totals.cash;
    h.assertEqual(amount(shownBefore), cashBefore, "the card shows the stored Total Cash");

    await h.stubScript([
      { toolCall: { name: "request_approval", args: { type: "supplier_payment", due_within_days: 7, include_overdue: true } } },
      { text: "The payment was made." },
    ]);
    await h.sendPrompt("Approve the supplier bills due this week, including any overdue ones");
    await h.expectVisible(byId("bill-approval-card"), 30000);
    await inChat("Approve Payment").click();
    await h.waitForRunEnd();
    const receipt = byId("approval-receipt");
    await h.expectVisible(receipt, 15000);
    const paid = Number(await receipt.getAttribute("data-amount"));
    h.assertEqual(paid, total, "the receipt carries the total");

    const cashAfter = (await h.snapshot()).totals.cash;
    const row = totalCashRow();
    await row.locator('[data-testid="changed-value-after"]').waitFor({ state: "visible", timeout: 15000 });
    const before = await row.getByTestId("changed-value-before").innerText();
    const after = await row.getByTestId("changed-value-after").innerText();
    h.assertEqual(amount(before), cashBefore, "the struck value is the Total Cash read before the approval");
    h.assertEqual(amount(after), cashAfter, "the new value is the Total Cash of the snapshot");
    h.assertEqual(cashBefore - cashAfter, paid, "the gap is the receipt total");

    const text = await h.chatText();
    h.assert(!text.includes(before) || before === after, "the shared chat text read leaves the struck value out: " + before);
    return { before, after, paid };
  });
}
