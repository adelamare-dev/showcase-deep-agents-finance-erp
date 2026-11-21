// The CopilotKit runtime has not yet answered its /info call (held back here so
// the window is deterministic). Until it answers, each useAgent call holds a
// provisional agent (isReady false) whose runs never reach the chat. Both entry
// points must therefore wait for the runtime, then send once it is ready:
// - a typed prompt, whose send button stays disabled until the runtime is ready;
// - a welcome-screen suggestion, whose button stays disabled likewise (a run
//   started on the provisional agent would be lost).
// Either way the user message must reach the chat, and approving the card it
// leads to must refresh the KPI figures.
// Needs the stub stack (`node e2e/fixtures/stack.mjs`, or `pnpm e2e`).
async (page, h) => {
  const INFO_DELAY_MS = 4000;
  // The "Approve Payments" suggestion's message (src/content/ui-text.ts); the
  // approval scenarios hard-code the same text, scenarios cannot import.
  const PROMPT = "Approve the supplier bills due this week, including any overdue ones";
  const script = [
    { toolCall: { name: "request_approval", args: { type: "supplier_payment", due_within_days: 7, include_overdue: true } } },
    { text: "The payment was made." },
  ];

  // Runs `body` with /info held back for INFO_DELAY_MS, then checks the shared
  // outcome. `body` gets the hold state and returns extra data for the case.
  const inColdWindow = async (body) => {
    await h.stubReset();
    await h.resetDemo();
    const before = await h.snapshot();
    await h.stubScript(script);
    const hold = { held: 0, releasedAt: null };
    const pattern = "**/api/copilotkit/info*";
    await page.route(pattern, async (route) => {
      hold.held += 1;
      await page.waitForTimeout(INFO_DELAY_MS);
      hold.releasedAt ??= Date.now();
      await route.continue().catch(() => {});
    });
    let extra;
    try {
      await h.open("/");
      extra = await body(hold);
      await h.expectVisible(page.getByTestId("copilot-user-message"), 20000);
      await h.expectVisible(page.getByTestId("bill-approval-card"), 30000);
      await page
        .getByTestId("copilot-message-list")
        .getByRole("button", { name: "Approve Payment", exact: true })
        .click();
      await h.expectVisible(page.getByTestId("kpi-delta-Cash").first(), 15000);
      await h.waitForRunEnd();
    } finally {
      await page.unroute(pattern);
    }
    h.assert((await h.chatText()).includes(PROMPT), "the chat shows the user message");
    const paid = before.totals.cash - (await h.snapshot()).totals.cash;
    h.assert(paid > 0, "the approval paid something");
    h.assertEqual(await page.getByTestId("approval-receipt").count(), 1, "one receipt in the thread");
    await h.stubReset();
    return { paid, held: hold.held, ...extra };
  };

  await h.test(
    "A prompt typed while the runtime is still connecting is sent once it is ready, and its approval refreshes the figures",
    () =>
      inColdWindow(async (hold) => {
        await page.getByTestId("copilot-chat-textarea").fill(PROMPT);
        h.assert(hold.held > 0, "the runtime's /info request was held back");
        h.assert(hold.releasedAt === null, "the runtime had not answered yet");
        h.assert(await page.getByTestId("copilot-send-button").isDisabled(), "the send button waits for the runtime");
        await page.getByTestId("copilot-send-button").click();
        h.assert(hold.releasedAt !== null, "the prompt left once the runtime answered");
      }),
  );

  await h.test(
    "A suggestion clicked while the runtime is still connecting is sent once it is ready, and its approval refreshes the figures",
    () =>
      inColdWindow(async (hold) => {
        const suggestion = page
          .getByTestId("copilot-sidebar")
          .getByRole("button", { name: "Approve Payments", exact: true });
        h.assert(hold.held > 0, "the runtime's /info request was held back");
        h.assert(hold.releasedAt === null, "the runtime had not answered yet");
        h.assert(await suggestion.isDisabled(), "the suggestion waits for the runtime");
        await suggestion.click();
        h.assert(hold.releasedAt !== null, "the suggestion left once the runtime answered");
      }),
  );
};
