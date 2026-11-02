// Live agent on the real model: tool cards, approval card and graph resume.
// Needs `pnpm demo` with a real MISTRAL_API_KEY in agent/.env.
async (page, h) => {
  const lastAssistantText = async () =>
    (await page.getByTestId("copilot-assistant-message").last().innerText()).trim();

  const approveButton = () =>
    page.getByTestId("copilot-message-list").getByRole("button", { name: "Approve Payment", exact: true });

  await h.test("Cash Position shows a research card then the cash card", async () => {
    await h.open("/");
    await page.locator("button", { hasText: /^Cash Position$/ }).click();
    await h.expectVisible(page.getByText("Researching:"), 90000);
    await h.expectVisible(page.getByText("Cash Position Summary"), 90000);
    await h.waitForRunEnd();
    const text = await h.chatText();
    h.assert(h.moneyIn(text).length > 0, "the cash card shows dollar amounts");
    return { amounts: h.moneyIn(text) };
  });

  await h.test("Overdue payment: approval card, Approve, the graph resumes", async () => {
    await h.open("/");
    await h.sendPrompt("Process payment for all overdue invoices");
    await h.expectVisible(approveButton(), 90000);
    const messages = page.getByTestId("copilot-assistant-message");
    const countBefore = await messages.count();
    const textBefore = countBefore > 0 ? await lastAssistantText() : "";
    await approveButton().click();
    // Once answered, the approval card leaves the chat and the graph resumes.
    await approveButton().waitFor({ state: "detached", timeout: 30000 });
    await h.waitForRunEnd();
    const countAfter = await messages.count();
    const answer = await lastAssistantText();
    h.assert(countAfter > countBefore, `a new assistant message follows the approval (${countBefore} -> ${countAfter})`);
    h.assert(answer.length > 0 && answer !== textBefore, "the final assistant answer differs from the pre-approval one");
    h.assert(!answer.includes("Approve Payment"), "the final assistant answer is not the approval card");
    return { finalAnswerChars: answer.length };
  });
}
