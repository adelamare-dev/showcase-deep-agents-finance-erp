// A subagent card lists the tool calls its subagent makes while it runs: at
// least one step is on screen before the card reaches its completed state.
// The scenario returns the step list as displayed, with the time each step
// first appeared; the runner compares it with the `subagent_step` lines of the
// agent's log for the same run. Needs `pnpm demo` with a real MISTRAL_API_KEY
// in agent/.env, and the agent's output (started with PYTHONUNBUFFERED=1) in a
// file the runner can read.
async (page, h) => {
  // Every subagent card on screen: its title, whether it shows its completed
  // summary, and the labels of its steps.
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

  await h.test("Subagent steps appear before the subagent tool ends and stay once it has", async () => {
    await h.open("/");
    const startedAt = Date.now();
    await page.locator("button", { hasText: /^Cash Position$/ }).click();

    // key: card index + step index -> first time seen; done: card index -> first time seen complete.
    const firstSeen = {};
    const doneAt = {};
    let last = [];
    let idleSince = 0;
    const deadline = startedAt + 180000;
    while (Date.now() < deadline) {
      const now = Date.now() - startedAt;
      last = await readCards();
      last.forEach((card, c) => {
        card.steps.forEach((label, s) => {
          firstSeen[c + "." + s] = firstSeen[c + "." + s] ?? { label, ms: now };
        });
        if (card.complete) doneAt[c] = doneAt[c] ?? now;
      });
      const busy = (await page.getByTestId("copilot-loading-cursor").count()) > 0;
      if (busy || last.length === 0) idleSince = 0;
      else if (!idleSince) idleSince = Date.now();
      else if (Date.now() - idleSince > 1500) break;
      await page.waitForTimeout(100);
    }

    h.assert(last.length > 0, "the run produced a subagent card");
    h.assert(last.every((card) => card.complete), "every subagent card reached its completed state");
    const early = Object.entries(firstSeen).filter(
      ([key, seen]) => seen.ms < doneAt[key.split(".")[0]],
    );
    h.assert(early.length > 0, "at least one step was on screen before its card completed");
    h.assert(last.some((card) => card.steps.length > 0), "the steps stay on the completed card");
    return {
      cards: last.map((card, c) => ({
        title: card.title,
        completedAtMs: doneAt[c],
        steps: card.steps.map((label, s) => ({ label, firstSeenMs: firstSeen[c + "." + s].ms })),
      })),
      stepsSeenBeforeCompletion: early.length,
    };
  });
}
