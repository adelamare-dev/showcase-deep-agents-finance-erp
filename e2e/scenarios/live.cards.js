// Cards and charts are filled from the dataset catalog: the Cash Position card
// shows the store's figures and a requested chart is drawn from a catalog
// response the store can reproduce. Needs `pnpm demo` with a real
// MISTRAL_API_KEY in agent/.env.
async (page, h) => {
  const getJson = async (path) => {
    const res = await page.request.get(h.ERP_URL + path);
    return { status: res.status(), body: res.ok() ? await res.json() : null };
  };

  // Every number held by the snapshot, at any depth.
  const numbersIn = (value, out = new Set()) => {
    if (typeof value === "number") out.add(value);
    else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
    else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
    return out;
  };

  await h.test("The catalog route answers 404 for an unknown id and 422 out of bounds", async () => {
    h.assertEqual((await getJson("/api/erp/datasets/payroll_secrets")).status, 404, "unknown dataset");
    for (const query of ["quarters=0", "quarters=9", "growth_pct=51", "metric=headcount"]) {
      h.assertEqual((await getJson("/api/erp/datasets/revenue_forecast?" + query)).status, 422, query);
    }
  });

  await h.test("Cash Position: the card shows the store's figures and nothing else", async () => {
    await h.open("/");
    await h.sendPrompt("What's our current cash position and how does it compare to our liabilities?");
    await h.expectVisible(page.getByText("Cash Position Summary"), 90000);
    await h.waitForRunEnd();

    // Read the store after the run, as the card did.
    const snap = await h.snapshot();
    const cashAccounts = snap.accounts.filter((a) => a.code.startsWith("10"));
    const expectedCard = [
      ...cashAccounts.map((a) => a.balance),
      snap.totals.cash,
      snap.totals.liabilities,
      snap.totals.cash - snap.totals.liabilities,
    ].map(Math.abs);

    const card = page.locator("div.rounded-2xl", { hasText: "Cash Position Summary" }).last();
    await h.expectVisible(card.getByText("Total Cash"), 30000);
    const shown = h.moneyIn(await card.innerText());
    h.assertEqual([...shown].sort((a, b) => a - b), [...expectedCard].sort((a, b) => a - b), "the card amounts");

    // Whatever the assistant adds in the chat must be a figure of the store, or
    // the sum of its invoices or bills by status, possibly rounded ("$1.09M", "$730K").
    const allowed = [...numbersIn(snap), snap.totals.cash - snap.totals.liabilities];
    for (const rows of [snap.invoices, snap.bills]) {
      for (const status of new Set(rows.map((r) => r.status))) {
        allowed.push(rows.filter((r) => r.status === status).reduce((t, r) => t + r.amount, 0));
      }
    }
    const foreign = [];
    for (const m of (await h.chatText()).matchAll(/\$\s?(\d[\d,]*(?:\.(\d+))?)\s?([KkMm])?/g)) {
      const unit = { k: 1e3, m: 1e6 }[(m[3] || "").toLowerCase()] || 1;
      const value = Number(m[1].replace(/,/g, "")) * unit;
      const tolerance = unit > 1 ? (unit / 10 ** (m[2] ? m[2].length : 0)) / 2 : 0;
      if (!allowed.some((v) => Math.abs(Math.abs(v) - value) <= tolerance)) foreign.push(m[0]);
    }
    h.assertEqual(foreign, [], "chat amounts that are not in the store");
    return { card: shown, cashAccounts: cashAccounts.length };
  });

  await h.test("A forecast chart is drawn from a catalog response the store reproduces", async () => {
    const responses = [];
    const onResponse = async (res) => {
      if (res.url().includes("/api/erp/datasets/")) {
        responses.push({ url: res.url(), status: res.status(), body: res.ok() ? await res.json() : null });
      }
    };
    page.on("response", onResponse);
    try {
      await h.open("/");
      await h.sendPrompt("Show me the revenue forecast for the next 4 quarters as a chart.");
      await h.expectVisible(
        page.getByTestId("copilot-message-list").locator(".recharts-wrapper"),
        120000,
      );
      await h.waitForRunEnd();
    } finally {
      page.off("response", onResponse);
    }
    const charts = responses.filter((r) => r.body && r.body.data);
    h.assert(charts.length > 0, "the chart came from a catalog response (" + responses.length + " seen)");
    for (const r of charts) {
      const again = await getJson(new URL(r.url).pathname + new URL(r.url).search);
      h.assertEqual(again.body, r.body, "the response equals the store's answer to the same request");
    }
    return { requests: charts.map((r) => r.url) };
  });
}
