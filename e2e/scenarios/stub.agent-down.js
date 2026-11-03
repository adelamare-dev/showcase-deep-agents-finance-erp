// What the user sees when the agent service goes away, and when it comes back.
// A scenario cannot stop a process, so the runner plays this file three times
// on the stub stack (see e2e/README.md) and the file reads which step it is in:
//   1. agent up, page not loaded      -> loads the app with the chat open (arm)
//   2. agent stopped, app on screen   -> the chat and the figures say so (down)
//   3. agent restarted, error screen  -> Retry on the error screen recovers
async (page, h) => {
  const byId = (id) => page.getByTestId(id);
  const loadError = page.getByText("Could not load the company data.", { exact: true });
  const agentUp = async () => {
    try {
      return (await page.request.get(h.ERP_URL + "/health", { timeout: 3000 })).ok();
    } catch {
      return false;
    }
  };

  const up = await agentUp();
  const onErrorScreen = (await loadError.count()) > 0;

  if (up && !onErrorScreen) {
    await h.test("Arm: the app is loaded with the chat open", async () => {
      await h.stubReset();
      await h.resetDemo();
      await h.open("/");
      await h.expectVisible(byId("kpi-Cash"), 10000);
      return { step: "armed: stop the agent, then play this file again" };
    });
    return;
  }

  if (!up && !onErrorScreen) {
    const banner = byId("run-error-banner");
    await h.test("A chat turn with the agent down says the agent is not reachable", async () => {
      await h.expectVisible(byId("kpi-Cash"), 5000);
      const kpi = await byId("kpi-Cash").innerText();
      await h.sendPrompt("Status please");
      await h.expectVisible(banner, 30000);
      h.assertEqual(await banner.getAttribute("data-kind"), "unreachable", "the cause is the agent service");
      const text = (await banner.innerText()).trim();
      h.assert(/agent service is not reachable/i.test(text), "the notice names the agent service: " + text);
      h.assert(await byId("run-error-retry").isEnabled(), "Retry is offered");
      h.assertEqual(await byId("kpi-Cash").innerText(), kpi, "the figures on screen are left as they were");

      // Still down: Retry fails again, in the same words.
      await byId("run-error-retry").click();
      await h.expectVisible(banner, 30000);
      h.assertEqual(await banner.getAttribute("data-kind"), "unreachable", "the notice comes back");
      return { text };
    });

    await h.test("The figures are flagged as possibly out of date", async () => {
      await h.expectVisible(byId("erp-stale-notice"), 10000);
      h.assert(/out of date/.test(await byId("erp-stale-notice").innerText()), "the notice says so");
    });

    await h.test("Reloading the app says why nothing is shown and offers Retry", async () => {
      await page.goto(h.WEB_URL + "/");
      await h.expectVisible(loadError, 20000);
      h.assert(await page.getByRole("button", { name: "Retry", exact: true }).isEnabled(), "Retry is offered");
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await h.expectVisible(loadError, 20000);
      return { step: "error screen shown: restart the agent, then play this file again" };
    });
    return;
  }

  await h.test("Retry on the error screen loads the data once the agent is back", async () => {
    h.assert(up, "the agent answers again");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await h.expectVisible(byId("kpi-Cash"), 20000);
    h.assertEqual(await loadError.count(), 0, "the error screen is gone");
    await h.open("/");
    await h.stubScript([{ text: "Back to normal." }]);
    await h.sendPrompt("Status please");
    await h.waitForRunEnd();
    h.assertEqual(await byId("run-error-banner").count(), 0, "no failure notice");
  });
}
