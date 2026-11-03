// The reference scenario, one pass per run: reset, "Cash Flow Dashboard" (timed
// and compared with the store), live subagent steps, "Approve Payments" (card
// total equal to the store, approval, Cash and Accounts Payable both down by
// that total, books balanced), then a follow-up question that sees the new
// state. Every dollar amount in the chat must belong to the money fields
// computed for the pass: the store's totals, KPIs, aging buckets, bill amounts
// and quarterly cash flow, plus the money values the dataset catalog drew during
// the run (chart values and cash position amounts, not counts or years). A
// rounded amount ("$58K", "$1.2M") must equal one of those fields rounded the
// same way. The check runs before the approval and again after it, when the chat
// cards have refreshed; in the follow-up answer the values the approval changed
// (cash, payables) must be the new ones, never the old ones. Needs `pnpm demo` with a real MISTRAL_API_KEY in agent/.env.
//
// The result carries the data the runner records per pass: the dashboard
// segment seconds, the widgets chosen and the notices seen. Tokens and 429
// retries are read from the agent's log by the runner. On a failure the same
// data is inside the error text.
async (page, h) => {
  const DASHBOARD_MAX_SECONDS = 60;
  const FOLLOW_UP = "What is our cash position now, and how much do we owe suppliers?";
  const byId = (id) => page.getByTestId(id);
  const inChat = (name) => byId("copilot-message-list").getByRole("button", { name, exact: true });
  const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);
  const leaves = (v) => (typeof v === "number" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(leaves) : []);

  // Dollar amounts as written in a text. A scaled amount ("$1.2M", "$58K",
  // "$3 thousand") is a rounding: it matches a field whose value, rounded to the
  // same number of decimals at the same scale, gives the written number.
  const SCALE = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
  const amountsIn = (text) =>
    [...text.matchAll(/\$\s?(\d[\d,]*)(?:\.(\d+))?\s?(thousand|million|billion|[KMBkmb]\b)?/g)].map((m) => {
      const scale = m[3] ? SCALE[m[3].toLowerCase()] : 1;
      const written = Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : ""));
      return { text: m[0].trim(), value: written * scale, written, scale, decimals: m[2] ? m[2].length : 0, rounded: Boolean(m[3]) };
    });
  const matches = (a, v) =>
    a.rounded
      ? Math.abs(Math.round((v / a.scale) * 10 ** a.decimals) / 10 ** a.decimals - a.written) < 1e-9
      : Math.abs(v - a.value) <= 0.005;

  // The money fields of this pass, read from the store now.
  const moneyFields = async (snap, catalogMoney) => {
    const cashPosition = await (await page.request.get(h.ERP_URL + "/api/erp/datasets/cash_position")).json();
    const ar = { ...snap.arAging };
    delete ar.collectionRate;
    return [
      ...leaves(snap.totals),
      ...snap.kpis.flatMap((k) => h.moneyIn(k.value)),
      ...leaves(ar),
      ...snap.bills.map((b) => b.amount),
      ...leaves(snap.cashFlowData),
      ...leaves(cashPosition),
      ...catalogMoney,
    ].map(Math.abs);
  };
  const strangers = (text, fields) => amountsIn(text).filter((a) => !fields.some((v) => matches(a, v))).map((a) => a.text);

  // Supplier bills due, as the prompt defines them for a payment ask: unpaid
  // bills, the ones due soonest. The card must not skip an unpaid bill that is
  // due earlier than one it lists.
  const dueSoonest = (bills, ids) => {
    const unpaid = bills.filter((b) => b.status !== "paid");
    const latest = unpaid.filter((b) => ids.includes(b.id)).map((b) => b.dueDate).sort().pop();
    return unpaid.filter((b) => !ids.includes(b.id) && b.dueDate < latest).map((b) => b.number);
  };

  // Subagent cards on screen: title, completed or not, and step labels.
  const readCards = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("div.rounded-lg")]
        .filter((card) => /^(Researching|Projecting):/.test(card.innerText.trim()))
        .map((card) => ({
          title: card.innerText.trim().split("\n")[0],
          complete: /Completed (data gathering|projections)/.test(card.innerText),
          steps: [...card.querySelectorAll('[data-testid="subagent-step"]')].map((el) => el.innerText.trim()),
        })),
    );

  await h.test("Reference pass", async () => {
    const watch = { on: true };
    const data = { dashboard: null, subagents: [], approval: null, followUp: null, banner: null };
    try {
      await h.resetDemo();
      const initial = await h.snapshot();
      h.assertEqual(initial.totals.assets, initial.totals.liabilities + initial.totals.equity, "books balance at the start");

      // Watch the subagent cards for the whole pass.
      const t0 = Date.now();
      const firstStep = {};
      const doneAt = {};
      const titles = {};
      const watcher = (async () => {
        while (watch.on) {
          const now = Date.now() - t0;
          try {
            (await readCards()).forEach((card, c) => {
              titles[c] = card.title;
              card.steps.forEach((_, s) => (firstStep[c + "." + s] ??= now));
              if (card.complete) doneAt[c] ??= now;
            });
          } catch {
            // The page was busy loading; the next scan reads it.
          }
          await page.waitForTimeout(150);
        }
      })();

      // 1. The dashboard segment.
      const seg = await h.runDashboardSegment(page);
      data.dashboard = { seconds: seg.seconds, runSeconds: seg.runSeconds, complete: seg.complete, widgets: seg.widgets, mismatches: seg.mismatches, notices: seg.notices };
      h.assert(seg.complete, "the dashboard misses " + seg.missing.join(", "));
      h.assertEqual(seg.mismatches, [], "dashboard figures that differ from the store");
      h.assert(seg.seconds <= DASHBOARD_MAX_SECONDS, `the dashboard took ${seg.seconds} s, above ${DASHBOARD_MAX_SECONDS} s`);

      // 2. Approve Payments, proposed once the dashboard is composed.
      const before = await h.snapshot();
      h.assertEqual(before.totals, initial.totals, "the dashboard run left the books untouched");
      const chip = byId("copilot-sidebar").locator("button", { hasText: /^Approve Payments$/ });
      await h.expectVisible(chip, 15000);
      await chip.first().click();
      await h.expectVisible(byId("bill-approval-card"), 120000);

      const ids = await byId("bill-approval-row").evaluateAll((rows) => rows.map((r) => r.dataset.billId));
      const cardTotal = Number(await byId("bill-approval-total").getAttribute("data-amount"));
      const byBill = Object.fromEntries(before.bills.map((b) => [b.id, b]));
      h.assert(ids.length > 0, "the card lists bills");
      h.assert(ids.every((id) => byBill[id] && byBill[id].status !== "paid"), "every listed bill is an unpaid supplier bill in the store");
      h.assertEqual(dueSoonest(before.bills, ids), [], "unpaid supplier bills due earlier than a listed bill, left off the card");
      h.assertEqual(cardTotal, sum(ids, (id) => byBill[id].amount), "card total = sum of the listed bills");
      h.assert(cardTotal <= before.totals.cash, "the account can cover the card total");

      const fieldsBefore = await moneyFields(before, seg.catalogMoney);
      const foreign = strangers(await h.chatText(), [...fieldsBefore, cardTotal]);
      h.assertEqual(foreign, [], "chat amounts before the approval that are not money fields of this pass");

      // The Cash delta stays up about 3 s: record when it appears and goes.
      await page.evaluate(() => {
        const mark = (window.__cashDelta = { appeared: null, gone: null });
        const look = () => {
          const there = Boolean(document.querySelector('[data-testid="kpi-delta-Cash"]'));
          if (there && mark.appeared === null) mark.appeared = performance.now();
          if (!there && mark.appeared !== null && mark.gone === null) mark.gone = performance.now();
        };
        new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        look();
      });
      await inChat("Approve Payment").click();
      await h.expectVisible(byId("kpi-delta-Cash"), 60000);
      const cashDelta = (await byId("kpi-delta-Cash").first().innerText()).trim();
      const payablesDelta = (await byId("kpi-delta-Accounts Payable").first().innerText()).trim();
      h.assertEqual(cashDelta, "−" + h.formatUsd(cardTotal), "Cash delta shown");
      h.assertEqual(payablesDelta, "−" + h.formatUsd(cardTotal), "Accounts Payable delta shown");
      await h.waitForRunEnd();

      const after = await h.snapshot();
      h.assertEqual(before.totals.cash - after.totals.cash, cardTotal, "Cash fell by the total");
      h.assertEqual(before.totals.accountsPayable - after.totals.accountsPayable, cardTotal, "Accounts Payable fell by the total");
      h.assertEqual(after.totals.equity, before.totals.equity, "equity unchanged");
      h.assertEqual(after.totals.assets, after.totals.liabilities + after.totals.equity, "books balance after the approval");
      const afterBill = Object.fromEntries(after.bills.map((b) => [b.id, b]));
      h.assert(ids.every((id) => afterBill[id].status === "paid"), "the listed bills are paid");
      const untouched = before.bills.filter((b) => !ids.includes(b.id));
      h.assertEqual(untouched.map((b) => afterBill[b.id].status), untouched.map((b) => b.status), "other bills unchanged");
      data.approval = { ids, cardTotal, cashDelta, payablesDelta, cash: [before.totals.cash, after.totals.cash], payables: [before.totals.accountsPayable, after.totals.accountsPayable] };

      const storeAfter = await moneyFields(after, []);
      const fieldsAfter = [...fieldsBefore, ...storeAfter, ...(await moneyFields(after, seg.catalogMoney)), cardTotal];
      h.assertEqual(strangers(await h.chatText(), fieldsAfter), [], "chat amounts after the approval that are not money fields of this pass");
      await page.waitForFunction(() => window.__cashDelta.gone !== null, null, { timeout: 10000 });
      const shownMs = await page.evaluate(() => window.__cashDelta.gone - window.__cashDelta.appeared);
      data.approval.deltaMs = Math.round(shownMs);
      h.assert(shownMs >= 2000 && shownMs <= 5000, `the Cash delta stayed ${Math.round(shownMs)} ms, expected about 3000 ms (2000 to 5000)`);
      h.assert((await byId("kpi-Cash").first().innerText()).includes(after.kpis.find((k) => k.label === "Cash").value), "the Cash KPI shows the new value");

      // 3. A follow-up that sees the new state.
      const answersBefore = await byId("copilot-assistant-message").count();
      await h.sendPrompt(FOLLOW_UP);
      await h.waitForRunEnd();
      h.assert((await byId("copilot-assistant-message").count()) > answersBefore, "the follow-up was answered");
      const finalSnap = await h.snapshot();
      h.assertEqual(finalSnap.totals, after.totals, "the follow-up changed nothing");
      const chatNow = await h.chatText();
      const lastAnswer = (await byId("copilot-assistant-message").last().innerText()).trim();
      const stated = amountsIn(lastAnswer + "\n" + chatNow.slice(chatNow.lastIndexOf(FOLLOW_UP)));
      const says = (v) => stated.some((a) => matches(a, v));
      h.assert(says(after.totals.cash), "the follow-up shows the new cash " + h.formatUsd(after.totals.cash) + ": " + lastAnswer);
      h.assert(says(after.totals.accountsPayable), "the follow-up shows the new payables " + h.formatUsd(after.totals.accountsPayable) + ": " + lastAnswer);
      // What the approval changed must not be stated at its old value: cash,
      // payables and the totals of the statuses the paid bills came from.
      const statusTotal = (snap, status) => sum(snap.bills.filter((b) => b.status === status), (b) => b.amount);
      const paidStatuses = [...new Set(ids.map((id) => byBill[id].status))];
      const stale = [
        before.totals.cash,
        before.totals.accountsPayable,
        sum(before.bills.filter((b) => b.status !== "paid"), (b) => b.amount),
        ...paidStatuses.map((status) => statusTotal(before, status)),
      ].filter((v) => !storeAfter.includes(Math.abs(v)));
      h.assertEqual(stated.filter((a) => stale.some((v) => matches(a, v))).map((a) => a.text), [], "the follow-up states a value the approval changed at its old amount");
      h.assertEqual(strangers(chatNow, fieldsAfter), [], "chat amounts after the follow-up that are not money fields of this pass");
      data.followUp = { answer: lastAnswer.slice(0, 400) };

      // 4. Subagent steps: each card showed a step before it completed.
      watch.on = false;
      await watcher;
      data.subagents = Object.keys(titles).map((c) => {
        const steps = Object.keys(firstStep).filter((k) => k.startsWith(c + "."));
        const early = steps.filter((k) => firstStep[k] < doneAt[c]).length;
        return { title: titles[c], steps: steps.length, stepsBeforeCompletion: early, completed: doneAt[c] !== undefined };
      });
      h.assert(data.subagents.length > 0, "the pass produced subagent cards");
      h.assert(data.subagents.every((s) => s.completed), "every subagent card completed");
      h.assert(data.subagents.every((s) => s.stepsBeforeCompletion > 0), "each subagent card showed a step before it completed: " + JSON.stringify(data.subagents));
      return data;
    } catch (e) {
      watch.on = false;
      try {
        data.banner = (await byId("run-error-banner").count()) ? await byId("run-error-banner").getAttribute("data-kind") : null;
      } catch {
        // No banner to read.
      }
      throw new Error(String((e && e.message) || e) + " | pass data: " + JSON.stringify(data));
    }
  });
}
