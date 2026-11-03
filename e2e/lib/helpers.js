// Helpers shared by every scenario. One single expression: the Playwright
// plugin evaluates it in a VM with no require, no process and no import.
// `build.mjs` inlines it into each built scenario.
(page) => {
  const WEB_URL = "http://localhost:3000";
  const ERP_URL = "http://127.0.0.1:8123";
  const SNAPSHOT_URL = ERP_URL + "/api/erp/snapshot";
  // Keep in step with the stub's port in e2e/fixtures/stack.mjs.
  const STUB_URL = "http://127.0.0.1:8790";
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

  // Restores the seeded data on the agent, then reloads the app on it.
  const resetDemo = async () => {
    const res = await page.request.post(ERP_URL + "/api/erp/reset");
    assert(res.ok(), "POST " + ERP_URL + "/api/erp/reset answered " + res.status());
    await visit("/");
  };

  // Opens the Settings menu and returns its "Reset demo data" entry.
  const openSettings = async () => {
    const item = page.getByRole("menuitem", { name: "Reset demo data" });
    if (!(await item.isVisible())) await page.getByRole("button", { name: "Settings", exact: true }).click();
    await item.waitFor({ state: "visible", timeout: 5000 });
    return item;
  };
  // Clicks it and waits for the reset to finish (the menu closes when it has).
  const clickReset = async () => {
    const item = await openSettings();
    await item.click();
    await item.waitFor({ state: "detached", timeout: 30000 });
  };

  // The Mistral stub (stack.mjs starts it). Scripts and requests are described
  // at the top of e2e/fixtures/mistral-stub.mjs.
  const stubPost = async (path, data) => {
    const res = await page.request.post(STUB_URL + path, data === undefined ? {} : { data });
    assert(res.ok(), "POST " + STUB_URL + path + " answered " + res.status());
    return await res.json();
  };
  const stubScript = (steps) => stubPost("/__script", steps);
  const stubRelease = () => stubPost("/__release");
  const stubReset = () => stubPost("/__reset");
  const stubRequests = async () => await (await page.request.get(STUB_URL + "/__requests")).json();

  // Unpaid bills whose total the operating account can cover, read from the
  // store now. Returns their ids, at most `count` of them.
  const payableBillIds = (snap, count = 2) => {
    const ids = [];
    let total = 0;
    for (const bill of snap.bills.filter((b) => b.status !== "paid")) {
      if (ids.length < count && total + bill.amount <= snap.totals.cash) {
        ids.push(bill.id);
        total += bill.amount;
      }
    }
    return ids;
  };

  // ---- The reference dashboard segment -------------------------------------
  // The wanted elements and the widgets that may show each one (see README).
  const PROJECTION_DATASETS = ["cash_flow_forecast", "cash_flow_by_quarter"];

  const scanDashboard = () =>
    page.evaluate(() => {
      const widgets = [...document.querySelectorAll("[data-widget-type]")]
        .filter((el) => !el.classList.contains("widget-exit"))
        .map((el) => ({
          type: el.dataset.widgetType,
          dataset: el.dataset.widgetDataset || null,
          charted: !!el.querySelector(".recharts-wrapper"),
          text: el.innerText,
          rows: [...el.querySelectorAll("tbody tr")].map((tr) =>
            [...tr.querySelectorAll("td")].map((td) => td.innerText.trim()),
          ),
        }));
      const kpis = {};
      for (const el of document.querySelectorAll("[data-testid^='kpi-']")) {
        kpis[el.dataset.testid.slice(4)] = el.innerText;
      }
      return { widgets, kpis };
    });

  // Which of the five asked-for elements the scan shows, and in which widget.
  const classifyDashboard = (scan) => {
    const found = {
      cashKpi: scan.kpis["Cash"] !== undefined ? "kpi Cash" : null,
      payableKpi: scan.kpis["Accounts Payable"] !== undefined ? "kpi Accounts Payable" : null,
      arAging: null,
      billsDue: null,
      cashProjection: null,
    };
    for (const w of scan.widgets) {
      if (w.type === "ar-aging-gauge") found.arAging ??= w;
      else if (w.type === "custom-chart" && w.dataset === "ar_aging" && w.charted) found.arAging ??= w;
      else if (w.type === "outstanding-invoices" && w.text.includes("Outstanding Bills")) found.billsDue ??= w;
      else if (w.type === "custom-chart" && PROJECTION_DATASETS.includes(w.dataset) && w.charted) {
        found.cashProjection ??= w;
      } else if (w.type === "cash-waterfall" && w.text.includes("cumulative net cash flow")) {
        found.cashProjection ??= w;
      }
    }
    const missing = Object.keys(found).filter((k) => !found[k]);
    const label = (w) => (typeof w === "string" ? w : w.dataset ? `${w.type}:${w.dataset}` : w.type);
    return { missing, shown: Object.fromEntries(Object.entries(found).map(([k, w]) => [k, w && label(w)])), found };
  };

  // Clicks the hero suggestion and times the dashboard it builds. Compares the
  // displayed figures with the snapshot and with the catalog routes, both read
  // during the run. Returns what it saw; the caller decides what must hold.
  const runDashboardSegment = async (target = page, timeout = 240000) => {
    await open("/");
    const catalog = [];
    const onResponse = async (res) => {
      if (!res.url().includes("/api/erp/datasets/")) return;
      try {
        catalog.push({ url: res.url(), status: res.status(), body: res.ok() ? await res.json() : null });
      } catch {
        // A response that cannot be read is simply not compared.
      }
    };
    target.on("response", onResponse);
    const result = { complete: false, seconds: null, runSeconds: null, missing: [], mismatches: [], compared: [], widgets: [], notices: [] };
    try {
      const hero = target.locator("[data-testid='copilot-sidebar'] button", { hasText: /^Cash Flow Dashboard$/ });
      await expectVisible(hero, 15000);
      const started = Date.now();
      await hero.first().click();

      let shown = null;
      let idleSince = 0;
      while (Date.now() - started < timeout) {
        const { missing, shown: now } = classifyDashboard(await scanDashboard());
        if (!missing.length) {
          result.seconds = Math.round((Date.now() - started) / 100) / 10;
          shown = now;
          break;
        }
        // A run that ended without the dashboard will not produce it later.
        if ((await byId("copilot-loading-cursor").count()) > 0 || Date.now() - started < 8000) idleSince = 0;
        else if (!idleSince) idleSince = Date.now();
        else if (Date.now() - idleSince > 5000) break;
        await target.waitForTimeout(500);
      }
      await waitForRunEnd(Math.max(10000, timeout - (Date.now() - started)));
      result.runSeconds = Math.round((Date.now() - started) / 100) / 10;
      await target.waitForTimeout(800);

      const scan = await scanDashboard();
      const { missing, shown: finalShown, found } = classifyDashboard(scan);
      result.missing = missing;
      result.complete = !missing.length;
      result.widgets = scan.widgets.map((w) => (w.dataset ? `${w.type}:${w.dataset}` : w.type));
      result.shown = shown ?? finalShown;
      result.notices = (await byId("copilot-sidebar").innerText()).split("\n").filter((l) => /429|rate.?limit|too many requests|went wrong|failed/i.test(l));

      // Figures, against the store as it is now.
      const snap = await snapshot();
      const check = (cond, msg) => {
        result.compared.push(msg);
        if (!cond) result.mismatches.push(msg);
      };
      const usd = (n) => formatUsd(Math.round(n));
      for (const [key, label] of [["cashKpi", "Cash"], ["payableKpi", "Accounts Payable"]]) {
        if (!found[key]) continue;
        const kpi = snap.kpis.find((k) => k.label === label);
        check(scan.kpis[label].includes(kpi.value), `${label} card shows ${kpi.value}`);
      }
      const checkCatalog = (w, ids) => {
        const seen = catalog.filter((r) => ids.some((id) => new URL(r.url).pathname.endsWith("/datasets/" + id)) && r.body);
        check(seen.length > 0, `${w.dataset}: a catalog response was seen`);
        return seen;
      };
      const ar = found.arAging;
      if (ar && ar.type === "ar-aging-gauge") {
        const a = snap.arAging;
        check(ar.text.includes(`${Math.round(a.collectionRate * 100)}%`), `AR gauge shows ${Math.round(a.collectionRate * 100)}%`);
        for (const key of ["total", "current", "thirtyDay", "sixtyDay", "ninetyPlus"]) {
          check(ar.text.includes(usd(a[key])), `AR gauge shows ${key} ${usd(a[key])}`);
        }
      }
      const bills = found.billsDue;
      if (bills) {
        const statuses = new Set(bills.rows.map((r) => (r[3] || "").toLowerCase()));
        const wanted = snap.bills.filter((b) => statuses.has(b.status)).map((b) => b.number).sort();
        const shownNumbers = bills.rows.map((r) => r[0].split("\n")[0].trim()).sort();
        check(bills.rows.length > 0, "the bills widget lists rows");
        check(JSON.stringify(shownNumbers) === JSON.stringify(wanted), `bills listed ${shownNumbers.join(",")} equal the store's ${[...statuses].join("/")} bills`);
        for (const row of bills.rows) {
          const bill = snap.bills.find((b) => b.number === row[0].split("\n")[0].trim());
          check(!!bill && row[1] === usd(bill.amount) && row[0].includes(bill.supplier), `bill row ${row[0].split("\n")[0]} matches the store`);
        }
      }
      for (const w of [ar, found.cashProjection]) {
        if (w && w.type === "custom-chart") {
          for (const r of checkCatalog(w, [w.dataset])) {
            const u = new URL(r.url);
            const again = await (await target.request.get(ERP_URL + u.pathname + u.search)).json();
            check(JSON.stringify(again) === JSON.stringify(r.body), `${w.dataset} response equals the store's answer to ${u.search || "the same request"}`);
          }
        }
      }
      const proj = found.cashProjection;
      if (proj && proj.type === "cash-waterfall") {
        const nets = snap.cashFlowData.map((d) => d.net);
        const cumulative = [];
        for (let q = 1; q <= nets.length; q++) cumulative.push(usd(nets.slice(-q).reduce((t, n) => t + n, 0)));
        check(cumulative.some((c) => proj.text.includes(c)), "waterfall cumulative net equals a trailing sum of the store's cash flow");
      }
    } finally {
      target.off("response", onResponse);
    }
    return result;
  };

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
    assert, assertEqual, expectVisible, byId,
    STUB_URL, openSettings, clickReset, stubScript, stubRelease, stubReset, stubRequests, payableBillIds,
    open, visit, resetDemo, sendPrompt, waitForRunEnd, chatText, snapshot,
    moneyIn, formatUsd, scanDashboard, classifyDashboard, runDashboardSegment, test, run,
  };
  return h;
}
