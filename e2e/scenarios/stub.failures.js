// Model and data failures are told in plain words, with a Retry that runs the
// agent again on the same conversation. Needs the stub stack
// (`node e2e/fixtures/stack.mjs`): the stub answers with scripted HTTP errors,
// so no real model is called. The "agent service down" case is a separate
// scenario (stub.agent-down.js) because it needs the agent stopped.
async (page, h) => {
  const byId = (id) => page.getByTestId(id);
  const banner = byId("run-error-banner");
  const heading = (text) => page.getByText(text, { exact: true });
  const userMessages = () => byId("copilot-user-message").count();
  const sentToModel = async () => (await h.stubRequests()).length;
  const fresh = async () => {
    await page.unroute("**/api/erp/snapshot").catch(() => {});
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
  };
  const lastReply = async () => (await byId("copilot-assistant-message").last().innerText()).trim();

  await h.test("A 429 followed by success completes the run", async () => {
    await fresh();
    await h.stubScript([{ status: 429, retryAfter: 1, message: "" }, { text: "Recovered after one retry." }]);
    const started = Date.now();
    await h.sendPrompt("Status please");
    await h.waitForRunEnd();
    const ms = Date.now() - started;
    h.assertEqual(await banner.count(), 0, "no failure notice is shown");
    h.assert((await lastReply()).includes("Recovered after one retry."), "the answer is in the chat");
    h.assertEqual(await sentToModel(), 2, "the model was asked twice: the refused call and its retry");
    return { ms };
  });

  await h.test("A 429 without Retry-After is retried once after the default wait", async () => {
    await fresh();
    await h.stubScript([{ status: 429, message: "" }, { text: "Recovered with no header." }]);
    const started = Date.now();
    await h.sendPrompt("Status please");
    await h.waitForRunEnd();
    const ms = Date.now() - started;
    h.assertEqual(await banner.count(), 0, "no failure notice is shown");
    h.assert((await lastReply()).includes("Recovered with no header."), "the answer is in the chat");
    h.assertEqual(await sentToModel(), 2, "the model was asked twice: the refused call and its retry");
    h.assert(ms >= 2000, "the default wait of 2 s was observed (" + ms + " ms)");
    return { ms };
  });

  await h.test("A persistent 429 shows a clear message and Retry", async () => {
    await fresh();
    await h.stubScript([
      { status: 429, retryAfter: 1, message: "" },
      { status: 429, retryAfter: 1, message: "" },
    ]);
    const started = Date.now();
    await h.sendPrompt("Status please");
    await h.expectVisible(banner, 30000);
    const ms = Date.now() - started;
    h.assertEqual(await banner.getAttribute("data-kind"), "rate-limit", "the cause is the rate limit");
    const text = (await banner.innerText()).trim();
    h.assert(/too many requests/i.test(text), "the notice names the rate limit: " + text);
    h.assert(!/mistral|http|429|api\./i.test(text), "the notice carries no provider detail: " + text);
    h.assertEqual(await sentToModel(), 2, "one retry, no more");
    const retry = byId("run-error-retry");
    h.assert(await retry.isEnabled(), "Retry is available once the run has stopped");
    h.assertEqual(await userMessages(), 1, "one user message");

    await h.stubScript([{ text: "Back after the retry." }]);
    await retry.click();
    await h.waitForRunEnd();
    h.assertEqual(await banner.count(), 0, "the notice is gone");
    h.assert((await lastReply()).includes("Back after the retry."), "the retried run answered");
    h.assertEqual(await userMessages(), 1, "Retry added no message");
    return { ms };
  });

  await h.test("A 429 asking for a long wait fails at once", async () => {
    await fresh();
    await h.stubScript([{ status: 429, retryAfter: 60, message: "" }, { text: "Must not be reached." }]);
    const started = Date.now();
    await h.sendPrompt("Status please");
    await h.expectVisible(banner, 30000);
    const ms = Date.now() - started;
    h.assertEqual(await banner.getAttribute("data-kind"), "rate-limit", "the cause is the rate limit");
    h.assertEqual(await sentToModel(), 1, "no retry was made");
    h.assert(ms < 15000, "the notice came without waiting for the 60 s (" + ms + " ms)");
    return { ms };
  });

  await h.test("A 500 shows a clear message and Retry re-runs the last prompt", async () => {
    await fresh();
    await h.stubScript([{ status: 500, message: "" }]);
    await h.sendPrompt("Give me the status of the books");
    await h.expectVisible(banner, 30000);
    h.assertEqual(await banner.getAttribute("data-kind"), "model", "the cause is the model service");
    h.assert(/model service/i.test(await banner.innerText()), "the notice names the model service");
    h.assertEqual(await sentToModel(), 1, "a 500 is not retried");
    const firstSize = (await h.stubRequests())[0].messages;

    await h.stubScript([{ text: "The books are fine." }]);
    await byId("run-error-retry").click();
    await h.waitForRunEnd();
    const requests = await h.stubRequests();
    h.assertEqual(requests.length, 2, "Retry asked the model once more");
    h.assertEqual(requests[1].messages, firstSize, "the same conversation was sent again");
    h.assertEqual(await userMessages(), 1, "Retry added no message");
    h.assert((await lastReply()).includes("The books are fine."), "the retried run answered");
    h.assertEqual(await banner.count(), 0, "the notice is gone");
  });

  await h.test("Retry carries out a tool call the failed run never reached", async () => {
    await fresh();
    await h.expectVisible(heading("Revenue vs Expenses"), 10000);
    await h.stubScript([{ status: 500, message: "" }]);
    await h.sendPrompt("Remove the revenue chart");
    await h.expectVisible(banner, 30000);
    h.assertEqual(await heading("Revenue vs Expenses").count(), 1, "nothing changed on the dashboard yet");

    await h.stubScript([
      { toolCall: { name: "manage_dashboard", args: { action: "remove", widgetId: "revenue-chart" } } },
      { text: "The revenue chart is removed." },
    ]);
    await byId("run-error-retry").click();
    await h.waitForRunEnd();
    await heading("Revenue vs Expenses").waitFor({ state: "detached", timeout: 10000 });
    h.assertEqual(await banner.count(), 0, "the notice is gone");
  });

  await h.test("Retry does not carry out a tool call twice", async () => {
    await fresh();
    const widgets = () => page.getByRole("heading").count();
    await h.expectVisible(heading("Revenue vs Expenses"), 10000);
    const before = await widgets();
    // The tool call runs, then the model call that should follow it fails.
    await h.stubScript([
      { toolCall: { name: "manage_dashboard", args: { action: "remove", widgetId: "revenue-chart" } } },
      { status: 500, message: "" },
    ]);
    await h.sendPrompt("Remove the revenue chart");
    await h.expectVisible(banner, 30000);
    await heading("Revenue vs Expenses").waitFor({ state: "detached", timeout: 10000 });
    const afterFailure = await widgets();

    // The model repeats the very same call: the dashboard must not move again.
    await h.stubScript([
      { toolCall: { name: "manage_dashboard", args: { action: "remove", widgetId: "revenue-chart" } } },
      { text: "Done." },
    ]);
    await byId("run-error-retry").click();
    await h.waitForRunEnd();
    h.assertEqual(await widgets(), afterFailure, "the dashboard is as the first call left it");
    h.assert(afterFailure < before, "the first call did remove the widget");
    h.assert((await lastReply()).includes("Done."), "the retried run answered");
  });

  await h.test("A failure inside a subagent is told too", async () => {
    await fresh();
    await h.stubScript([
      { toolCall: { name: "do_research", args: { query: "How much cash do we hold?" } } },
      { status: 500, message: "" },
    ]);
    await h.sendPrompt("How much cash do we hold?");
    await h.expectVisible(banner, 60000);
    h.assertEqual(await banner.getAttribute("data-kind"), "model", "the cause is the model service");
    h.assertEqual((await h.stubRequests()).length, 2, "the subagent call was not retried");
    await h.stubScript([{ text: "Cash is fine." }]);
    await byId("run-error-retry").click();
    await h.waitForRunEnd();
    h.assertEqual(await banner.count(), 0, "the notice is gone");
  });

  await h.test("Figures that cannot be reloaded are flagged with a Retry", async () => {
    await fresh();
    const notice = byId("erp-stale-notice");
    const kpi = await byId("kpi-Cash").innerText();
    await page.route("**/api/erp/snapshot", (route) => route.abort("connectionrefused"));
    await h.stubScript([{ text: "Nothing changed." }]);
    await h.sendPrompt("Status please");
    await h.waitForRunEnd();
    await h.expectVisible(notice, 10000);
    h.assert(/out of date/.test(await notice.innerText()), "the notice says the figures may be old");
    h.assertEqual(await byId("kpi-Cash").innerText(), kpi, "the old figures stay on screen");

    // Still down: the notice stays after a Retry.
    await byId("erp-stale-retry").click();
    await page.waitForTimeout(800);
    h.assertEqual(await notice.count(), 1, "the notice stays while the service is down");

    await page.unroute("**/api/erp/snapshot");
    await byId("erp-stale-retry").click();
    await notice.waitFor({ state: "detached", timeout: 10000 });
  });

  await h.test("A failed reload after a successful reset is flagged too", async () => {
    await fresh();
    await page.route("**/api/erp/snapshot", (route) => route.abort("connectionrefused"));
    const item = await h.openSettings();
    await item.click();
    await h.expectVisible(byId("erp-stale-notice"), 10000);
    await page.unroute("**/api/erp/snapshot");
    await page.keyboard.press("Escape");
    await byId("erp-stale-retry").click();
    await byId("erp-stale-notice").waitFor({ state: "detached", timeout: 10000 });
  });

  await h.test("An unknown route shows the not-found page", async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(h.WEB_URL + "/this-page-does-not-exist");
    await h.expectVisible(page.getByText("This page does not exist."), 10000);
    await page.getByRole("link", { name: "Back to the dashboard" }).click();
    await h.expectVisible(byId("kpi-Cash"), 20000);
  });

  await fresh();
}
