// One orchestrator message that carries both subagent calls shows two cards,
// each with its own steps, alive at the same time. The stub plays the model
// (the subagents' calls come from the same queue), so no credit is spent and
// the result does not depend on whether the agent allows parallel tool calls.
// Needs the stub stack (`node e2e/fixtures/stack.mjs`).
async (page, h) => {
  // Every subagent card on screen: title, completed or not, labels of its steps.
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

  await h.test("two subagent cards are shown for one orchestrator message", async () => {
    await h.stubReset();
    await h.resetDemo();
    await h.open("/");
    // Both subagents read the next scripted steps as they arrive, so the first
    // two steps are the same call (a tool both of them own) and the delays keep
    // the cards open long enough to be seen together.
    const read = { toolCall: { name: "query_quarterly_financials", args: { last_n: 4 } }, delayMs: 1500 };
    await h.stubScript([
      {
        toolCalls: [
          { name: "do_research", args: { query: "Quarterly financials for the dashboard" } },
          { name: "do_projections", args: { query: "Cash projection for the next four quarters" } },
        ],
      },
      read,
      read,
      { text: "Quarterly figures gathered.", delayMs: 1500 },
      { text: "Projection prepared.", delayMs: 1500 },
      {
        toolCall: {
          name: "update_dashboard",
          args: { replace: true, widgets: [{ type: "metric_cards", config: { metrics: ["Cash"] } }] },
        },
      },
      { text: "The dashboard is ready." },
    ]);
    await h.sendPrompt("Build the cash dashboard");

    let together = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !together) {
      const cards = await readCards();
      if (cards.length === 2 && cards.every((c) => !c.complete && c.steps.length > 0)) together = cards;
      else await page.waitForTimeout(100);
    }
    h.assert(together, "both cards were on screen at once, each running with its own step");
    const titles = together.map((c) => c.title.split(":")[0]).sort();
    h.assertEqual(titles, ["Projecting", "Researching"], "one card per subagent");
    h.assertEqual(together.map((c) => c.steps.length), [1, 1], "each card holds the one step of its own subagent");

    await h.waitForRunEnd();
    const done = await readCards();
    h.assertEqual(done.length, 2, "still two cards");
    h.assert(done.every((c) => c.complete), "both cards completed");
    h.assert(done.every((c) => c.steps.length === 1), "each card keeps its own step");
    h.assert((await h.chatText()).includes("The dashboard is ready."), "the closing text is shown");
    h.assertEqual((await h.stubRequests()).length, 7, "one orchestrator message, two subagent runs, the update and the closing text");
    await h.stubReset();
    return { titles };
  });
}
