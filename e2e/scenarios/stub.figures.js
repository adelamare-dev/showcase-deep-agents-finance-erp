// Dollar amounts the assistant writes are checked against the books before the
// person reads them: a wrong one is retried and never shown, one still wrong
// after the retry is badged, a correct one is never badged, and "Checking
// figures..." shows while the reply is prepared. Needs the stub stack
// (`node e2e/fixtures/stack.mjs`): the stub plays the model, so no credit is spent.
async (page, h) => {
  const byId = (id) => page.getByTestId(id);
  const inChat = (name) => byId("copilot-message-list").getByRole("button", { name, exact: true });
  const reply = (cash) => `Cash is ${h.formatUsd(cash)} today.`;

  // An amount no number of the store equals.
  const strangeAmount = (snap) => {
    const known = new Set(h.leaves(snap).map((n) => Math.abs(n)));
    let n = 43000;
    while (known.has(n)) n += 1;
    return n;
  };

  const fresh = async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
    return await h.snapshot();
  };

  // Records whether `needle` was ever part of the chat text, from now on.
  const watchChat = (needle) =>
    page.evaluate((text) => {
      window.__figureSeen = false;
      const look = () => {
        const list = document.querySelector('[data-testid="copilot-message-list"]');
        if (list && list.textContent.includes(text)) window.__figureSeen = true;
      };
      if (window.__figureObserver) window.__figureObserver.disconnect();
      window.__figureObserver = new MutationObserver(look);
      window.__figureObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
      look();
    }, needle);
  const seen = () => page.evaluate(() => window.__figureSeen === true);

  await h.test("A wrong amount is retried and never shown", async () => {
    const snap = await fresh();
    const wrong = h.formatUsd(strangeAmount(snap));
    await h.stubScript([{ text: `Cash is ${wrong} today.` }, { text: reply(snap.totals.cash) }]);
    await watchChat(wrong);
    await h.sendPrompt("What is our cash?");
    await h.expectVisible(byId("copilot-assistant-message"), 30000);
    await h.waitForRunEnd();
    const text = await h.chatText();
    h.assert(text.includes(h.formatUsd(snap.totals.cash)), "the final reply states the stored cash: " + text);
    h.assert(!(await seen()), "the wrong amount was never in the chat");
    h.assert(!text.includes(wrong), "the wrong amount is not in the chat now");
    h.assertEqual(await byId("unverified-figure").count(), 0, "the correct reply carries no badge");
    h.assertEqual((await h.stubRequests()).length, 2, "the model was asked twice");
  });

  await h.test("A wrong amount twice shows an unverified badge", async () => {
    const snap = await fresh();
    const wrong = h.formatUsd(strangeAmount(snap));
    await h.stubScript([{ text: `Cash is ${wrong} today.` }, { text: `Cash is ${wrong} today.` }]);
    await h.sendPrompt("What is our cash?");
    const badge = byId("unverified-figure");
    await h.expectVisible(badge, 30000);
    await h.waitForRunEnd();
    h.assertEqual(await badge.count(), 1, "one figure is badged");
    h.assert((await badge.innerText()).includes(wrong), "the badge holds the amount: " + (await badge.innerText()));
    h.assert((await badge.innerText()).includes("unverified"), "the badge says unverified");
    const text = await h.chatText();
    h.assert(!text.includes("⟦") && !text.includes("⟧"), "the raw mark is never shown: " + text);
  });

  await h.test("A correct amount, with a tool result in the turn, is not badged", async () => {
    const snap = await fresh();
    await h.stubScript([
      { toolCall: { name: "render_chat_visual", args: { dataset: "cash_position" } } },
      { text: reply(snap.totals.cash) },
    ]);
    await h.sendPrompt("Show me the cash position");
    await h.waitForRunEnd();
    const text = await h.chatText();
    h.assert(text.includes(h.formatUsd(snap.totals.cash)), "the reply states the stored cash: " + text);
    h.assertEqual(await byId("unverified-figure").count(), 0, "no badge on a correct amount");
  });

  await h.test("Checking figures is shown while the reply is prepared", async () => {
    const snap = await fresh();
    await h.stubScript([{ text: reply(snap.totals.cash), delayMs: 3000 }]);
    await h.sendPrompt("What is our cash?");
    await h.expectVisible(byId("figure-check-status"), 2500);
    h.assert((await byId("figure-check-status").innerText()).includes("Checking figures"), "the status says what happens");
    await h.waitForRunEnd();
    h.assertEqual(await byId("figure-check-status").count(), 0, "the status is gone once the reply is shown");
    h.assert((await h.chatText()).includes(h.formatUsd(snap.totals.cash)), "the reply is shown");
  });

  await h.test("Checking figures is shown after a tool result too", async () => {
    const snap = await fresh();
    await h.stubScript([
      { toolCall: { name: "render_chat_visual", args: { dataset: "cash_position" } } },
      { text: reply(snap.totals.cash), delayMs: 3000 },
    ]);
    await h.sendPrompt("Show me the cash position");
    await h.expectVisible(byId("figure-check-status"), 15000);
    await h.waitForRunEnd();
    h.assertEqual(await byId("figure-check-status").count(), 0, "the status is gone once the reply is shown");
  });

  await h.test("An old reply is not badged after an approval changes the books", async () => {
    const snap = await fresh();
    const cashBefore = snap.totals.cash;
    await h.stubScript([{ text: reply(cashBefore) }]);
    await h.sendPrompt("What is our cash?");
    await h.expectVisible(byId("copilot-assistant-message"), 30000);
    await h.waitForRunEnd();
    h.assertEqual(await byId("unverified-figure").count(), 0, "the first reply is not badged");

    await h.stubScript([
      { toolCall: { name: "request_approval", args: { type: "supplier_payment", due_within_days: 7, include_overdue: true } } },
      { text: "The payment was made." },
    ]);
    await h.sendPrompt("Approve the supplier bills due this week, including any overdue ones");
    await h.expectVisible(byId("bill-approval-card"), 30000);
    await inChat("Approve Payment").click();
    await h.waitForRunEnd();
    await h.expectVisible(byId("approval-receipt"), 15000);
    const cashAfter = (await h.snapshot()).totals.cash;
    h.assert(cashAfter !== cashBefore, "the approval changed the cash");
    await byId("kpi-delta-Cash").waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(800);
    const text = await h.chatText();
    h.assert(text.includes(h.formatUsd(cashBefore)), "the old reply still states the old cash: " + text);
    h.assertEqual(await byId("unverified-figure").count(), 0, "the old reply is still not badged");
  });
}
