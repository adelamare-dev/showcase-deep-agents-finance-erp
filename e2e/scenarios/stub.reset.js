// Settings > "Reset demo data" puts the books, the dashboard, the browser
// storage and the conversation back to their starting point. Needs the stub
// stack (`node e2e/fixtures/stack.mjs`): no real model is called.
async (page, h) => {
  const DASHBOARDS_KEY = "finance-os.dashboards.v2";
  const byId = (id) => page.getByTestId(id);
  const inChat = (name) =>
    byId("copilot-message-list").getByRole("button", { name, exact: true });
  const chatCount = async () =>
    (await byId("copilot-user-message").count()) + (await byId("copilot-assistant-message").count());
  const storedDashboards = () => page.evaluate((key) => window.localStorage.getItem(key), DASHBOARDS_KEY);
  const heading = (text) => page.getByText(text, { exact: true });
  const fresh = async () => {
    // A failed case may have left the blocked reset route behind.
    await page.unroute("**/api/erp/reset").catch(() => {});
    await h.stubReset();
    await h.resetDemo();
    await page.evaluate((key) => window.localStorage.removeItem(key), DASHBOARDS_KEY);
    await h.open("/");
  };

  // One take of the demo: ask, get the approval card for bills read from the
  // store now, approve. Returns what the card showed.
  const approveBills = async () => {
    const ids = h.payableBillIds(await h.snapshot());
    h.assert(ids.length > 0, "the store holds unpaid bills the account can cover");
    await h.stubScript([
      { toolCall: { name: "request_approval", args: { type: "supplier_payment", bill_ids: ids } } },
      { text: "The payment was made." },
    ]);
    await h.sendPrompt("Approve the supplier payments due this week");
    await h.expectVisible(byId("bill-approval-card"), 30000);
    const shown = await byId("bill-approval-row").evaluateAll((rows) => rows.map((r) => r.dataset.billId));
    const total = Number(await byId("bill-approval-total").getAttribute("data-amount"));
    await inChat("Approve Payment").click();
    await h.waitForRunEnd();
    return { ids, shown, total };
  };

  await h.test("Two takes start from identical values", async () => {
    await fresh();
    const initial = await h.snapshot();
    const cash = initial.kpis.find((k) => k.label === "Cash").value;
    h.assert((await byId("kpi-Cash").innerText()).includes(cash), "the Cash KPI shows the starting value");

    const first = await approveBills();
    h.assertEqual(first.shown, first.ids, "the card lists the scripted bills");
    const paid = await h.snapshot();
    h.assert(JSON.stringify(paid) !== JSON.stringify(initial), "approving changed the books");
    h.assertEqual(initial.totals.cash - paid.totals.cash, first.total, "cash fell by the card total");
    await byId("kpi-delta-Cash").waitFor({ state: "detached", timeout: 10000 });

    await h.clickReset();
    h.assertEqual(await h.snapshot(), initial, "the store is back to its starting values");
    await h.expectVisible(byId("kpi-Cash"), 10000);
    h.assert((await byId("kpi-Cash").innerText()).includes(cash), "the Cash KPI shows the starting value again");
    h.assertEqual(await chatCount(), 0, "the conversation is empty");
    h.assertEqual(await byId("bill-approval-card").count(), 0, "no approval card is left");

    // The agent must start a new thread too, not only the screen: its next
    // request carries a short history, shorter than the end of the first take.
    const lastCount = async () => (await h.stubRequests()).at(-1).messages;
    const firstCount = await lastCount();
    await h.stubScript([{ text: "Good morning." }]);
    await h.sendPrompt("Hello");
    await h.waitForRunEnd();
    const afterReset = await lastCount();
    h.assert(afterReset < firstCount, "the model got a short history after the reset (" + afterReset + " < " + firstCount + ")");
    await h.clickReset();

    const second = await approveBills();
    h.assertEqual(second.ids, first.ids, "the second take finds the same bills");
    h.assertEqual(second.total, first.total, "the second take shows the same total");
    h.assertEqual(await h.snapshot(), paid, "the second take ends in the same books as the first");
    return { ids: first.ids, total: first.total, cash, firstCount, afterReset };
  });

  await h.test("Reset is disabled while a run is in progress", async () => {
    await fresh();
    await h.stubScript([{ text: "Checking the books for you now.", hold: true }]);
    await h.sendPrompt("Give me a status update");
    await h.expectVisible(page.getByText("Checking", { exact: false }).last(), 30000);

    const item = await h.openSettings();
    h.assert(await item.isDisabled(), "Reset demo data is disabled during the run");
    await item.click({ force: true, timeout: 1000 }).catch(() => {});
    h.assertEqual(await byId("copilot-user-message").count(), 1, "the conversation was not cleared");
    h.assertEqual((await h.stubRequests()).length, 1, "the model was asked once");

    await h.stubRelease();
    await h.waitForRunEnd();
    h.assert(await item.isEnabled(), "Reset demo data is available once the run is over");
    await h.clickReset();
    h.assertEqual(await chatCount(), 0, "the conversation is empty after the reset");
  });

  await h.test("A saved custom dashboard is cleared by reset", async () => {
    await fresh();
    const customise = async () => {
      await h.stubScript([
        { toolCall: { name: "manage_dashboard", args: { action: "remove", widgetId: "revenue-chart" } } },
        { toolCall: { name: "save_dashboard", args: { name: "Take One Layout" } } },
        { text: "The dashboard is saved." },
      ]);
      await h.sendPrompt("Remove the revenue chart and save the layout");
      await h.waitForRunEnd();
      await heading("Revenue vs Expenses").waitFor({ state: "detached", timeout: 10000 });
    };

    await h.expectVisible(heading("Revenue vs Expenses"), 10000);
    h.assertEqual(await storedDashboards(), null, "nothing is saved at the start");
    await customise();
    h.assert((await storedDashboards()).includes("Take One Layout"), "the custom dashboard is saved in the browser");

    await h.clickReset();
    await h.expectVisible(heading("Revenue vs Expenses"), 10000);
    h.assertEqual(await storedDashboards(), null, "the saved dashboard is gone from the browser storage");
    await page.getByRole("link", { name: "Dashboards", exact: true }).click();
    await h.expectVisible(page.getByText("Dashboard Gallery"), 10000);
    h.assert(!(await page.locator("body").innerText()).includes("Take One Layout"), "the gallery no longer lists it");
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await h.expectVisible(heading("Revenue vs Expenses"), 10000);

    // The same instructions work again on the next take. Each page mounts its
    // own chat, closed: open it without reloading, which would hide a leftover.
    if ((await byId("copilot-sidebar").boundingBox()).x >= 1280) await byId("copilot-chat-toggle").click();
    await page.waitForTimeout(800);
    await h.stubReset();
    await customise();
    await h.clickReset();
  });

  await h.test("Reset with the chat panel closed starts a new thread", async () => {
    await fresh();
    const lastCount = async () => (await h.stubRequests()).at(-1).messages;
    for (const text of ["First question", "Second question"]) {
      await h.stubScript([{ text: "Answer to " + text }]);
      await h.sendPrompt(text);
      await h.waitForRunEnd();
    }
    const before = await lastCount();
    const panelOpen = async () => (await byId("copilot-sidebar").boundingBox()).x < 1280;
    await byId("copilot-chat-toggle").dispatchEvent("click");
    for (let i = 0; i < 20 && (await panelOpen()); i++) await page.waitForTimeout(250);
    h.assert(!(await panelOpen()), "the chat panel is closed");

    await h.clickReset();
    await byId("copilot-chat-toggle").dispatchEvent("click");
    for (let i = 0; i < 20 && !(await panelOpen()); i++) await page.waitForTimeout(250);
    await page.waitForTimeout(600);
    h.assertEqual(await chatCount(), 0, "the reopened chat is empty");

    await h.stubScript([{ text: "Good morning." }]);
    await h.sendPrompt("Hello");
    await h.waitForRunEnd();
    const after = await lastCount();
    h.assert(after < before, "the model got a short history (" + after + " < " + before + ")");
    return { before, after };
  });

  await h.test("A failed reset says why and changes nothing", async () => {
    await fresh();
    await h.stubScript([{ text: "Everything looks fine." }]);
    await h.sendPrompt("Status please");
    await h.waitForRunEnd();
    const books = await h.snapshot();
    const messages = await chatCount();
    const kpi = await byId("kpi-Cash").innerText();
    h.assert(messages > 0, "the chat holds the take");

    // The data service cannot be reached: the request dies like a refused connection.
    await page.route("**/api/erp/reset", (route) => route.abort("connectionrefused"));
    const item = await h.openSettings();
    await item.click();
    const alert = page.getByRole("alert").filter({ hasText: "data service" });
    await h.expectVisible(alert, 10000);
    h.assertEqual(
      (await alert.innerText()).trim(),
      "The data service is not reachable. Start the agent and try again.",
      "the alert says what is wrong in plain words",
    );
    h.assert(await item.isEnabled(), "the control can be tried again");
    h.assertEqual(await chatCount(), messages, "the chat is unchanged");
    h.assertEqual(await byId("kpi-Cash").innerText(), kpi, "the dashboard is unchanged");
    h.assertEqual(await h.snapshot(), books, "the books are unchanged");

    // A stale alert is not shown when the menu is opened again.
    await page.keyboard.press("Escape");
    await item.waitFor({ state: "detached", timeout: 5000 });
    await h.openSettings();
    h.assertEqual(await alert.count(), 0, "the alert is gone after reopening the menu");

    await page.unroute("**/api/erp/reset");
    await h.clickReset();
    h.assertEqual(await chatCount(), 0, "the reset works once the service is back");
  });

  await fresh();
}
