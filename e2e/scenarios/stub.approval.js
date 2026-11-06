// The supplier-payment approval is selected by scope in the agent, and the
// decision stays in the thread as a receipt. Needs the stub stack
// (`node e2e/fixtures/stack.mjs`): the stub plays the model, so no credit is
// spent.
async (page, h) => {
  const byId = (id) => page.getByTestId(id);
  const inChat = (name) => byId("copilot-message-list").getByRole("button", { name, exact: true });
  const PROMPT = "Approve the supplier bills due this week, including any overdue ones";
  const ask = (args = { due_within_days: 7, include_overdue: true }) => ({
    toolCall: { name: "request_approval", args: { type: "supplier_payment", ...args } },
  });
  const sum = (bills) => bills.reduce((total, b) => total + b.amount, 0);
  const shownNumbers = async () =>
    await byId("bill-approval-row").evaluateAll((rows) => rows.map((r) => r.querySelector("td").innerText.trim()));
  const fresh = async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
  };
  // Asks, waits for the card and returns what the store selects now.
  const askForTheCard = async (script) => {
    await fresh();
    const before = await h.snapshot();
    const selected = h.billsForApproval(before);
    h.assert(selected.length > 0, "the store holds unpaid bills overdue or due this week");
    await h.stubScript(script);
    await h.sendPrompt(PROMPT);
    await h.expectVisible(byId("bill-approval-card"), 30000);
    return { before, selected };
  };

  await h.test("The card lists overdue and due-this-week bills from the store", async () => {
    const { before, selected } = await askForTheCard([ask(), { text: "Done." }]);
    h.assertEqual(await shownNumbers(), selected.map((b) => b.number), "the card lists the selection, earliest due first");
    h.assertEqual(
      Number(await byId("bill-approval-total").getAttribute("data-amount")),
      sum(selected),
      "the card total is the sum of the selected bills",
    );
    h.assert(selected.some((b) => b.status === "overdue"), "an overdue bill is among them");
    h.assertEqual(await h.snapshot(), before, "nothing is written while the card waits");
    await inChat("Reject").click();
    await h.waitForRunEnd();
    return { numbers: selected.map((b) => b.number) };
  });

  await h.test("A scope without overdue bills leaves them off the card", async () => {
    await fresh();
    const selected = h.billsForApproval(await h.snapshot(), 7, false);
    h.assert(selected.length > 0, "the store holds unpaid bills due this week");
    await h.stubScript([ask({ due_within_days: 7, include_overdue: false }), { text: "Done." }]);
    await h.sendPrompt(PROMPT);
    await h.expectVisible(byId("bill-approval-card"), 30000);
    h.assertEqual(await shownNumbers(), selected.map((b) => b.number), "only the bills due from today are listed");
    await inChat("Reject").click();
    await h.waitForRunEnd();
  });

  await h.test("Approve leaves a frozen receipt and moves cash and payables", async () => {
    const { before, selected } = await askForTheCard([ask(), { text: "The payment was made." }]);
    const total = sum(selected);
    await inChat("Approve Payment").click();
    await h.waitForRunEnd();
    const receipt = byId("approval-receipt");
    await h.expectVisible(receipt, 15000);
    h.assertEqual(Number(await receipt.getAttribute("data-count")), selected.length, "the receipt counts the bills");
    h.assertEqual(Number(await receipt.getAttribute("data-amount")), total, "the receipt carries the total");
    const text = await receipt.innerText();
    h.assert(text.includes("Approved by you"), "the receipt says who approved: " + text);
    h.assert(text.includes(h.formatUsd(total)), "the receipt shows the total: " + text);
    h.assertEqual(await byId("bill-approval-card").count(), 0, "the card is gone");
    h.assertEqual(await inChat("Approve Payment").count(), 0, "no Approve button is left");
    h.assertEqual(await inChat("Reject").count(), 0, "no Reject button is left");
    const after = await h.snapshot();
    h.assertEqual(before.totals.cash - after.totals.cash, total, "Cash fell by the total");
    h.assertEqual(before.totals.accountsPayable - after.totals.accountsPayable, total, "Accounts Payable fell by the total");
    h.assertEqual(h.billsForApproval(after), [], "nothing is left to approve in that scope");
    return { count: selected.length, total };
  });

  await h.test("Reject leaves a Rejected receipt and changes nothing", async () => {
    const { before } = await askForTheCard([ask(), { text: "Understood, nothing was paid." }]);
    await inChat("Reject").click();
    await h.waitForRunEnd();
    const receipt = byId("approval-receipt");
    await h.expectVisible(receipt, 15000);
    h.assertEqual((await receipt.innerText()).trim(), "Rejected", "the receipt says Rejected");
    h.assertEqual(await byId("bill-approval-card").count(), 0, "the card is gone");
    h.assertEqual(await h.snapshot(), before, "the books are unchanged");
  });

  await h.test("A reload does not pay twice", async () => {
    const { before, selected } = await askForTheCard([ask(), { text: "The payment was made." }]);
    const total = sum(selected);
    await inChat("Approve Payment").click();
    await h.waitForRunEnd();
    await h.expectVisible(byId("approval-receipt"), 15000);
    const paid = await h.snapshot();
    h.assertEqual(before.totals.cash - paid.totals.cash, total, "the approval paid once");

    await h.open("/");
    await page.waitForTimeout(2000);
    h.assertEqual(await byId("bill-approval-card").count(), 0, "no approval card comes back");
    h.assertEqual(await h.snapshot(), paid, "the books did not move on reload");
    return { total };
  });

  await fresh();
}
