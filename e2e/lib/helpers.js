// Helpers shared by every scenario. One single expression: the Playwright
// plugin evaluates it in a VM with no require, no process and no import.
// `build.mjs` inlines it into each built scenario.
(page) => {
  const WEB_URL = "http://localhost:3000";
  const ERP_URL = "http://127.0.0.1:8123";
  const SNAPSHOT_URL = ERP_URL + "/api/erp/snapshot";
  const RUN_TIMEOUT_MS = 120000;
  const cases = [];

  const assert = (cond, msg) => {
    if (!cond) throw new Error("Assertion failed: " + msg);
  };
  const assertEqual = (actual, expected, msg) =>
    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    );
  const expectVisible = async (locator, timeout = 30000) => {
    await locator.first().waitFor({ state: "visible", timeout });
  };

  const byId = (id) => page.getByTestId(id);
  const chatText = async () => (await byId("copilot-message-list").innerText()).trim();

  // Opens a route at 1280x720 and makes sure the chat sidebar is open.
  const open = async (path = "/") => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(WEB_URL + path);
    // A closed sidebar is parked off-screen but still counts as visible.
    const onScreen = async () => ((await byId("copilot-sidebar").boundingBox()).x < 1280);
    if (!(await onScreen())) await byId("copilot-chat-toggle").click();
    for (let i = 0; i < 20 && !(await onScreen()); i++) await page.waitForTimeout(250);
    await page.waitForTimeout(600);
  };

  // Opens a route without touching the chat: the data pages need no agent run.
  // `target` defaults to the shared page; pass another page to isolate storage.
  const visit = async (path, target = page) => {
    await target.setViewportSize({ width: 1280, height: 720 });
    await target.goto(WEB_URL + path);
    await target.waitForFunction(() => !document.body.innerText.includes("Loading data..."), null, { timeout: 30000 });
  };

  const sendPrompt = async (text) => {
    await byId("copilot-chat-textarea").fill(text);
    await byId("copilot-send-button").click();
  };

  // The loading cursor is shown while the agent streams; it must stay absent
  // for a moment to rule out the gap between two steps of the same run.
  const waitForRunEnd = async (timeout = RUN_TIMEOUT_MS) => {
    await expectVisible(byId("copilot-user-message"), 15000);
    const deadline = Date.now() + timeout;
    let idleSince = 0;
    while (Date.now() < deadline) {
      const busy = (await byId("copilot-loading-cursor").count()) > 0;
      if (busy) idleSince = 0;
      else if (!idleSince) idleSince = Date.now();
      else if (Date.now() - idleSince > 1500) return;
      await page.waitForTimeout(300);
    }
    throw new Error("The run did not end within " + timeout + " ms");
  };

  const snapshot = async () => {
    const res = await page.request.get(SNAPSHOT_URL);
    assert(res.ok(), "GET " + SNAPSHOT_URL + " answered " + res.status());
    return await res.json();
  };

  // Dollar amounts found in a text, as numbers: "$1,245,000" -> 1245000.
  const moneyIn = (text) =>
    [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  const formatUsd = (n) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

  const test = async (name, fn) => {
    const started = Date.now();
    try {
      const data = await fn();
      cases.push({ name, ok: true, ms: Date.now() - started, data });
    } catch (e) {
      cases.push({ name, ok: false, ms: Date.now() - started, error: String((e && e.message) || e) });
    }
  };

  // Runs a scenario, then throws if any case failed so the tool reports an error.
  const run = async (scenario) => {
    await scenario(page, h);
    const failed = cases.filter((c) => !c.ok).map((c) => c.name);
    const result = { passed: cases.length - failed.length, failed, cases };
    if (failed.length) throw new Error("Failed cases: " + JSON.stringify(result));
    return result;
  };

  const h = {
    WEB_URL, ERP_URL, SNAPSHOT_URL,
    assert, assertEqual, expectVisible,
    open, visit, sendPrompt, waitForRunEnd, chatText, snapshot,
    moneyIn, formatUsd, test, run,
  };
  return h;
}
