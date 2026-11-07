// When Mistral stays saturated after the one retry, the reference request is
// answered from the books with no model call, and a card says so. Any other
// request keeps the Retry notice. Needs the stub stack (`node e2e/fixtures/stack.mjs`):
// the stub plays the model, so no credit is spent. The orchestrator's text is not
// streamed, so nothing here waits for it mid-run: the closing sentence is read
// once the run has ended.
async (page, h) => {
  const byId = (id) => page.getByTestId(id);
  const saturated = { status: 429, retryAfter: 1, message: "" };
  const TITLE = "Model unavailable — built from rules";
  const CLOSING = "Its figures come straight from the books.";
  const fresh = async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
  };

  // The recipe card: its title and the steps the code listed on it.
  const recipeCard = () =>
    page.evaluate((title) => {
      const card = [...document.querySelectorAll("div.rounded-lg")].find((c) => c.innerText.trim().startsWith(title));
      return card ? [...card.querySelectorAll('[data-testid="subagent-step"]')].map((el) => el.innerText.trim()) : null;
    }, TITLE);

  const expectFallback = async (seg) => {
    h.assert(seg.complete, "the dashboard misses " + seg.missing.join(", "));
    h.assertEqual(seg.mismatches, [], "dashboard figures that differ from the store");
    h.assertEqual(await byId("run-error-banner").count(), 0, "no Retry notice");
    h.assertEqual(
      await recipeCard(),
      ["Cash and payables", "Query ar aging", "Bills for approval", "Build dataset"],
      "the card lists the four steps the code ran",
    );
    h.assert((await byId("copilot-message-list").innerText()).includes(CLOSING), "the closing sentence is shown");
  };

  await h.test("a 429 on the reference request builds the dashboard from rules", async () => {
    await fresh();
    // Two refusals use up the retry; the stub holds no other step, so a third
    // model call would answer 500 and show the notice.
    await h.stubScript([saturated, saturated]);
    const seg = await h.runDashboardSegment(page);
    await expectFallback(seg);
    h.assertEqual((await h.stubRequests()).length, 2, "the model was asked twice and never again");
    return { seconds: seg.seconds, compared: seg.compared.length };
  });

  await h.test("a 429 inside a subagent also falls back", async () => {
    await fresh();
    // The orchestrator asks for research; the subagent's model is refused twice.
    await h.stubScript([
      { toolCall: { name: "do_research", args: { query: "Cash, payables, bills and aging for the dashboard" } } },
      saturated,
      saturated,
    ]);
    const seg = await h.runDashboardSegment(page);
    await expectFallback(seg);
    h.assertEqual((await h.stubRequests()).length, 3, "no model call after the subagent was refused");
    return { seconds: seg.seconds, compared: seg.compared.length };
  });

  await h.test("a 429 on another request still shows Retry", async () => {
    await fresh();
    const before = await h.scanDashboard();
    await h.stubScript([saturated, saturated]);
    const chip = byId("copilot-sidebar").locator("button", { hasText: /^Cash Position$/ });
    await h.expectVisible(chip, 15000);
    await chip.first().click();
    await h.expectVisible(byId("run-error-banner"), 60000);
    h.assertEqual(await recipeCard(), null, "no recipe card");
    h.assertEqual((await h.scanDashboard()).widgets.map((w) => w.type), before.widgets.map((w) => w.type), "the dashboard is unchanged");
  });

  await h.stubReset();
}
