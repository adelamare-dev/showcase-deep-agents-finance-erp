// The agent quotes the store: its answer to a cash question contains the
// value served by the snapshot route. Needs `pnpm demo` with a real
// MISTRAL_API_KEY in agent/.env.
async (page, h) => {
  await h.test("The snapshot route serves a balanced set of books", async () => {
    const snap = await h.snapshot();
    const t = snap.totals;
    h.assertEqual(t.assets, t.liabilities + t.equity, "assets equal liabilities plus equity");
    h.assertEqual(t.netProfit, t.revenue - t.expenses, "net profit is revenue minus expenses");
    h.assert(snap.bills.length > 0, "bills are served");
    return { cash: t.cash };
  });

  await h.test("The cash balance in the answer is the store's cash", async () => {
    const cash = (await h.snapshot()).totals.cash;
    await h.open("/");
    await h.sendPrompt("What is our cash balance?");
    await h.waitForRunEnd();
    const text = await h.chatText();
    const amounts = h.moneyIn(text);
    h.assert(
      text.includes(h.formatUsd(cash)) || amounts.includes(cash),
      `the chat shows ${h.formatUsd(cash)} (amounts seen: ${JSON.stringify(amounts)})`,
    );
    return { cash, amounts };
  });
}
