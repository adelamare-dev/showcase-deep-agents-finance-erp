// Every chat suggestion and about ten likely free questions, one case per entry,
// each on a fresh thread after a data reset and compared with the store as it is
// when the run ends. Needs `pnpm demo` with a real MISTRAL_API_KEY in agent/.env.
//
// An entry passes when its run ends without an error notice, the reply is not
// empty, every dollar amount in the chat (text and cards, chart axes left out)
// belongs to the money fields of the run plus the entry's own `expected` figures,
// and the entry's visible effect shows. Special kinds: the dashboard suggestion
// passes on a complete segment with matching figures (its time is recorded, not
// enforced); the approval suggestions pass on a card that lists the right records
// with a total equal to the store's computation, then the card is rejected and the
// store must not change; the no-data question passes on "I don't have this data"
// and no dollar amount.
//
// A run that ended on a rate-limit or model-side notice throws "DISCARDED ...":
// the runner replays it and does not count it. Select entries by setting
// `globalThis.questionsOnly = [indices]` before evaluating the file (default:
// every entry, which is long: run one entry per call).
//
// Entry fields: name, prompt (sent as typed), chip (a suggestion button to click
// instead of typing), kind, expected(snap, ds) -> amounts allowed besides the
// money fields (`ds(path)` reads a catalog route), states(snap) -> amounts the
// reply must state, mentions / mentionsAny / mentionsNone(snap) -> strings,
// orUrl (a page the app may move to instead of naming a record), effect:
// cashCard | chart | visual | widgets | forecast.
async (page, h) => {
  const ONLY = globalThis.questionsOnly ?? null;
  const byId = (id) => page.getByTestId(id);
  const inChat = (name) => byId("copilot-message-list").getByRole("button", { name, exact: true });
  const sum = (rows, pick = (r) => r.amount) => rows.reduce((t, r) => t + pick(r), 0);
  const unpaid = (rows) => rows.filter((r) => r.status === "pending" || r.status === "overdue");
  const groupSums = (rows, key) => {
    const out = {};
    for (const r of rows) out[r[key]] = (out[r[key]] ?? 0) + r.amount;
    return out;
  };

  // Figures a question about one part of the books may quote, read from the store.
  const invoiceFigures = (s) => [
    ...s.invoices.map((i) => i.amount),
    ...Object.values(groupSums(unpaid(s.invoices), "client")),
    ...Object.values(groupSums(s.invoices.filter((i) => i.status === "overdue"), "client")),
    ...Object.values(groupSums(s.invoices, "status")),
    sum(unpaid(s.invoices)),
  ];
  const billFigures = (s) => [...s.bills.map((b) => b.amount), ...Object.values(groupSums(s.bills, "status")), sum(unpaid(s.bills))];
  const stockFigures = (s) => [
    ...s.inventoryItems.map((i) => i.unitCost),
    ...s.inventoryItems.map((i) => i.quantity * i.unitCost),
    ...s.inventoryItems.map((i) => Math.max(0, 2 * i.reorderLevel - i.quantity) * i.unitCost),
    sum(s.inventoryItems, (i) => i.quantity * i.unitCost),
  ];
  const hrFigures = (s) => [
    ...s.employees.map((e) => e.salary),
    ...Object.values(groupSums(s.employees.map((e) => ({ ...e, amount: e.salary })), "department")),
    sum(s.employees.filter((e) => e.status === "active"), (e) => e.salary),
    sum(s.employees, (e) => e.salary),
    ...h.leaves(s.monthlyExpenseByCategory),
    ...s.expenseBreakdown.map((e) => e.amount),
  ];
  const expenseFigures = (s) => [...s.expenseBreakdown.map((e) => e.amount), sum(s.expenseBreakdown, (e) => e.amount)];
  const budgetFigures = (s) => [...h.leaves(s.budgetVsActual), ...expenseFigures(s)];
  const restockNeeded = (s) => s.inventoryItems.filter((i) => i.status !== "in-stock" && !i.onOrder);

  const ENTRIES = [
    { name: "Cash Flow Dashboard", kind: "dashboard" },
    {
      name: "Cash Position",
      chip: "Cash Position",
      expected: (s) => s.accounts.map((a) => a.balance),
      effect: "cashCard",
    },
    {
      name: "Overdue Invoices",
      chip: "Overdue Invoices",
      expected: invoiceFigures,
      // The reply names an overdue invoice, or the app moved to the overdue invoices.
      mentionsAny: (s) => s.invoices.filter((i) => i.status === "overdue").flatMap((i) => [i.number, i.client]),
      orUrl: /^\/invoices\?filter=overdue$/,
    },
    { name: "Cash Flow Chart", chip: "Cash Flow Chart", expected: () => [], effect: "chart" },
    { name: "Approve Payments", chip: "Approve Payments", kind: "bills" },
    { name: "Reorder Inventory", chip: "Reorder Inventory", kind: "reorder" },
    {
      name: "Cost Control Dashboard",
      chip: "Cost Control Dashboard",
      expected: budgetFigures,
      effect: "widgets",
    },
    {
      name: "Cash Position Chart",
      prompt: "Render an inline cash position visual comparing cash and liabilities",
      expected: (s) => s.accounts.map((a) => a.balance),
      effect: "visual",
    },
    {
      name: "Which client owes us the most?",
      prompt: "Which client owes us the most?",
      expected: invoiceFigures,
      mentionsAny: (s) => {
        const sums = groupSums(unpaid(s.invoices), "client");
        const top = Math.max(...Object.values(sums));
        return Object.keys(sums).filter((c) => sums[c] === top);
      },
    },
    {
      name: "Cash position and payables",
      prompt: "What is our cash position now, and how much do we owe suppliers?",
      expected: billFigures,
      states: (s) => [s.totals.cash, s.totals.accountsPayable],
    },
    {
      name: "Unpaid supplier bills",
      prompt: "Which supplier bills are still unpaid?",
      expected: billFigures,
      mentionsAny: (s) => unpaid(s.bills).flatMap((b) => [b.number, b.supplier]),
      mentionsNone: (s) => s.bills.filter((b) => b.status === "paid").map((b) => b.number),
    },
    {
      name: "What-if over 6 quarters",
      prompt: "What if revenue grows 12% each quarter for the next 6 quarters?",
      expected: () => [],
      effect: "forecast",
    },
    {
      name: "Headcount and payroll",
      prompt: "How many employees do we have, and what is our total payroll?",
      expected: hrFigures,
      mentionsAny: (s) => [String(s.employees.length), String(s.employees.filter((e) => e.status === "active").length)],
    },
    {
      name: "Low stock",
      prompt: "Which items are low on stock?",
      expected: stockFigures,
      mentionsAny: (s) => s.inventoryItems.filter((i) => i.status !== "in-stock").flatMap((i) => [i.name, i.sku]),
    },
    {
      name: "Biggest expense categories",
      prompt: "What are our biggest expense categories?",
      expected: expenseFigures,
      mentionsAny: (s) => [[...s.expenseBreakdown].sort((a, b) => b.amount - a.amount)[0].category],
    },
    {
      name: "Budget",
      prompt: "How are we doing against budget?",
      expected: budgetFigures,
    },
    {
      name: "Receivables and overdue",
      prompt: "What is our total accounts receivable, and how much of it is overdue?",
      expected: invoiceFigures,
      states: (s) => [s.totals.accountsReceivable],
    },
    { name: "ESG score", prompt: "What is our ESG score?", noData: true },
  ];

  // The chat as text, without the user message and the chart axes (their tick
  // labels are drawn by the chart library, not written by the assistant).
  const readChat = () =>
    page.evaluate(() => {
      const copy = document.querySelector("[data-testid='copilot-message-list']").cloneNode(true);
      copy.querySelectorAll(".recharts-wrapper,[data-testid='copilot-user-message']").forEach((el) => el.remove());
      const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
      const parts = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent.trim();
        if (t) parts.push(t);
      }
      return parts.join("\n");
    });

  // A run that ended on a notice is not a verdict on the code when the cause is
  // the model service: the runner discards it and replays.
  const discardIfNotice = async (stage) => {
    const banner = byId("run-error-banner");
    if (!(await banner.count())) return;
    const kind = await banner.first().getAttribute("data-kind");
    const text = (await banner.first().innerText()).replace(/\s+/g, " ").trim();
    const prefix = kind === "rate-limit" || kind === "model" ? "DISCARDED" : "FAILED";
    throw new Error(`${prefix} ${kind} notice ${stage}: ${text}`);
  };

  const watchCatalog = () => {
    const seen = [];
    const onResponse = async (res) => {
      if (!res.url().includes("/api/erp/datasets/")) return;
      try {
        seen.push({ url: res.url(), body: res.ok() ? await res.json() : null });
      } catch {
        // A response that cannot be read is simply not compared.
      }
    };
    page.on("response", onResponse);
    return { seen, stop: () => page.off("response", onResponse) };
  };

  const ds = async (path) => (await page.request.get(h.ERP_URL + "/api/erp/datasets/" + path)).json();

  const runDashboardEntry = async () => {
    await h.resetDemo();
    const seg = await h.runDashboardSegment(page);
    await discardIfNotice("after the dashboard run");
    const data = { seconds: seg.seconds, runSeconds: seg.runSeconds, widgets: seg.widgets, shown: seg.shown, mismatches: seg.mismatches, notices: seg.notices };
    if (!seg.complete || seg.mismatches.length) {
      throw new Error("FAILED the dashboard is incomplete or differs from the store: " + JSON.stringify({ missing: seg.missing, ...data }));
    }
    return data;
  };

  const runApprovalEntry = async (entry) => {
    const isBills = entry.kind === "bills";
    await h.resetDemo();
    await h.open("/");
    const before = await h.snapshot();
    const chip = byId("copilot-sidebar").locator("button", { hasText: new RegExp(`^${entry.chip}$`) });
    await h.expectVisible(chip, 15000);
    const started = Date.now();
    await chip.first().click();
    const card = byId(isBills ? "bill-approval-card" : "reorder-approval-card");
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !(await card.count()) && !(await byId("run-error-banner").count())) {
      // A run that ended without a card will not produce it later.
      if ((await byId("copilot-loading-cursor").count()) === 0 && Date.now() - started > 15000) {
        await page.waitForTimeout(3000);
        if (!(await card.count())) break;
      }
      await page.waitForTimeout(500);
    }
    await discardIfNotice("before the approval card");
    h.assert(await card.count(), "no approval card after the run: " + (await readChat()).slice(0, 300));
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const data = { seconds };

    let allowed = [];
    if (isBills) {
      const ids = await byId("bill-approval-row").evaluateAll((rows) => rows.map((r) => r.dataset.billId));
      const total = Number(await byId("bill-approval-total").getAttribute("data-amount"));
      const byBill = Object.fromEntries(before.bills.map((b) => [b.id, b]));
      h.assert(ids.length > 0, "the card lists bills");
      h.assert(ids.every((id) => byBill[id] && byBill[id].status !== "paid"), "every listed bill is an unpaid supplier bill in the store");
      data.leftOff = h.dueSoonest(before.bills, ids);
      h.assertEqual(total, sum(ids, (id) => byBill[id].amount), "card total = sum of the listed bills");
      h.assert(total <= before.totals.cash, "the account can cover the card total");
      Object.assign(data, { ids, total });
      allowed = [total, ...ids.map((id) => byBill[id].amount)];
    } else {
      const rows = await byId("reorder-approval-row").evaluateAll((els) => els.map((r) => ({ sku: r.dataset.sku, quantity: Number(r.dataset.quantity) })));
      const total = Number(await byId("reorder-approval-total").getAttribute("data-amount"));
      const item = Object.fromEntries(before.inventoryItems.map((i) => [i.sku, i]));
      const needed = restockNeeded(before).map((i) => i.sku).sort();
      h.assert(rows.length > 0, "the card lists items");
      h.assert(rows.every((r) => item[r.sku] && item[r.sku].status !== "in-stock" && !item[r.sku].onOrder), "every listed item is low or out of stock and not on order: " + JSON.stringify(rows.map((r) => ({ sku: r.sku, status: item[r.sku]?.status, onOrder: item[r.sku]?.onOrder }))));
      h.assertEqual(rows.map((r) => r.sku).sort(), needed, "listed SKUs equal the store's items needing a restock");
      h.assert(rows.every((r) => r.quantity > 0 && item[r.sku].quantity + r.quantity >= item[r.sku].reorderLevel), "each quantity brings the stock to at least its reorder level: " + JSON.stringify(rows.map((r) => ({ sku: r.sku, ordered: r.quantity, stock: item[r.sku].quantity, reorderLevel: item[r.sku].reorderLevel }))));
      h.assertEqual(total, sum(rows, (r) => r.quantity * item[r.sku].unitCost), "card total = sum of quantity x unit cost");
      Object.assign(data, { rows, total });
      allowed = [total, ...stockFigures(before)];
    }
    const fields = [...(await h.moneyFields(before, [])), ...allowed.map(Math.abs)];
    h.assertEqual(h.strangers(await readChat(), fields), [], "chat amounts that are not money fields of this run");

    // Reject: nothing may change.
    await inChat(isBills ? "Reject" : "Skip Reorder").click();
    await card.waitFor({ state: "detached", timeout: 30000 });
    await h.waitForRunEnd();
    await discardIfNotice("after the rejection");
    const after = await h.snapshot();
    h.assertEqual(after.totals, before.totals, "totals unchanged by the rejection");
    h.assertEqual(after.bills, before.bills, "bills unchanged by the rejection");
    h.assertEqual(after.inventoryItems, before.inventoryItems, "inventory unchanged by the rejection");
    // Judged last so the rest of the card and the rejection are still exercised and recorded.
    if (isBills) h.assertEqual(data.leftOff, [], "unpaid supplier bills due earlier than a listed bill, left off the card (card: " + JSON.stringify(data) + ")");
    return data;
  };

  const runPlainEntry = async (entry) => {
    await h.resetDemo();
    await h.open("/");
    h.assertEqual(await byId("copilot-user-message").count(), 0, "the thread starts empty");
    const catalog = watchCatalog();
    const started = Date.now();
    try {
      if (entry.chip) {
        const chip = byId("copilot-sidebar").locator("button", { hasText: new RegExp(`^${entry.chip}$`) });
        await h.expectVisible(chip, 15000);
        await chip.first().click();
      } else {
        await h.sendPrompt(entry.prompt);
      }
      await h.waitForRunEnd(240000);
      await page.waitForTimeout(1500);
    } finally {
      catalog.stop();
    }
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    await discardIfNotice("after the run");

    const snap = await h.snapshot();
    const reply = await readChat();
    const data = { seconds, reply: reply.slice(0, 700), amounts: h.amountsIn(reply).map((a) => a.text) };
    h.assert(reply.length > 0, "the reply is empty");

    if (entry.noData) {
      const said = reply.toLowerCase().replace(/[’‘]/g, "'");
      h.assert(said.includes("i don't have this data"), "the reply does not say \"I don't have this data\": " + reply.slice(0, 300));
      h.assertEqual(h.amountsIn(reply).map((a) => a.text), [], "dollar amounts in a reply about data the store lacks");
      return data;
    }

    data.catalog = catalog.seen.map((r) => new URL(r.url).pathname.split("/").pop() + new URL(r.url).search);
    try {
      await checkReply(entry, snap, reply, catalog, data);
    } catch (e) {
      throw new Error(String((e && e.message) || e) + " | run data: " + JSON.stringify(data));
    }
    return data;
  };

  const checkReply = async (entry, snap, reply, catalog, data) => {
    const catalogMoney = [...new Set(catalog.seen.flatMap((r) => h.catalogMoneyOf(r.body)))];
    // An approval card the question raised computes its own lines and total from
    // the store (the model only picks identifiers and quantities).
    const cost = Object.fromEntries(snap.inventoryItems.map((i) => [i.sku, i.unitCost]));
    const reorderRows = await byId("reorder-approval-row").evaluateAll((els) => els.map((r) => ({ sku: r.dataset.sku, quantity: Number(r.dataset.quantity) })));
    const cardFigures = [
      ...reorderRows.map((r) => r.quantity * (cost[r.sku] ?? 0)),
      ...(await byId("reorder-approval-total").evaluateAll((els) => els.map((el) => Number(el.dataset.amount)))),
      ...(await byId("bill-approval-total").evaluateAll((els) => els.map((el) => Number(el.dataset.amount)))),
    ];
    const fields = [...(await h.moneyFields(snap, catalogMoney)), ...cardFigures, ...(await entry.expected(snap, ds)).map(Math.abs)];
    h.assertEqual(h.strangers(reply, fields), [], "chat amounts that are not in the store or the catalog");
    for (const v of entry.states ? entry.states(snap) : []) {
      h.assert(h.amountsIn(reply).some((a) => h.matches(a, Math.abs(v))), `the reply does not state ${h.formatUsd(v)}: ` + reply.slice(0, 400));
    }
    for (const s of entry.mentions ? entry.mentions(snap) : []) h.assert(reply.includes(s), `the reply does not mention ${s}`);
    if (entry.mentionsAny) {
      const options = entry.mentionsAny(snap);
      const here = new URL(page.url());
      const moved = entry.orUrl && entry.orUrl.test(here.pathname + here.search);
      h.assert(moved || options.some((s) => reply.includes(s)), "the reply mentions none of: " + options.slice(0, 8).join(", ") + " | " + reply.slice(0, 300));
    }
    const named = entry.mentionsNone ? entry.mentionsNone(snap).filter((s) => reply.includes(s)) : [];
    h.assertEqual(named, [], "the reply names records the store says are settled");

    const charts = await byId("copilot-message-list").locator(".recharts-wrapper").count();
    const cashCard = await byId("copilot-message-list").getByText("Cash Position Summary").count();
    data.charts = charts;
    if (entry.effect === "cashCard") h.assert(cashCard > 0, "no Cash Position card in the chat");
    if (entry.effect === "chart") h.assert(charts > 0, "no chart card in the chat");
    if (entry.effect === "visual") h.assert(charts > 0 || cashCard > 0, "no chart or Cash Position card in the chat");
    if (entry.effect === "forecast") {
      h.assert(charts > 0, "no chart card in the chat");
      const asked = catalog.seen.map((r) => Number(new URL(r.url).searchParams.get("quarters") ?? 0));
      data.quarters = asked;
      h.assert(asked.some((q) => q >= 5), "no catalog request for more than 4 quarters: " + JSON.stringify(asked));
    }
    if (entry.effect === "widgets") {
      const widgets = (await h.scanDashboard()).widgets;
      data.widgets = widgets.map((w) => (w.dataset ? `${w.type}:${w.dataset}` : w.type));
      // The default dashboard already holds a few widgets: a cost control view adds
      // the budget or spend ones.
      h.assert(data.widgets.some((w) => w === "budget-variance" || w === "spend-heatmap"), "the dashboard shows no budget or spend widget: " + data.widgets.join(", "));
    }
    return data;
  };

  for (const [index, entry] of ENTRIES.entries()) {
    if (ONLY && !ONLY.includes(index)) continue;
    await h.test(`${index} ${entry.name}`, async () => {
      if (entry.kind === "dashboard") return await runDashboardEntry();
      if (entry.kind === "bills" || entry.kind === "reorder") return await runApprovalEntry(entry);
      return await runPlainEntry(entry);
    });
  }
}
