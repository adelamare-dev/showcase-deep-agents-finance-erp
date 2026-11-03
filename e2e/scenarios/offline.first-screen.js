// The first screen: the chat is open with the reference suggestion first, the
// header and sidebar carry no control without an effect, nothing overflows
// and the brand comes from one place. Needs `pnpm demo`; no model is called
// and no message is sent.
async (page, h) => {
  const BLOCKED = ["Stark", "Wayne", "Umbrella", "Acme", "Globex", "Initech", "Cyberdyne", "Soylent", "Massive Dynamic"];
  const chatOnScreen = async () => (await h.byId("copilot-sidebar").boundingBox()).x < 1280;
  const firstLoad = async (path = "/") => {
    await h.visit(path);
    await page.waitForTimeout(800);
  };

  await h.test("The chat is open with the reference suggestion first", async () => {
    await firstLoad("/");
    h.assert(await chatOnScreen(), "the chat panel is on screen without any click");
    const chips = await page.locator("[data-testid='copilot-sidebar'] button").evaluateAll((els) =>
      els.filter((e) => e.closest("[class*='flex-wrap']")).map((e) => e.textContent.trim()),
    );
    h.assert(chips.length >= 1, "the welcome view lists suggestions");
    h.assertEqual(chips[0], "Cash Flow Dashboard", "the first suggestion");
    return { suggestions: chips };
  });

  await h.test("The header has no search and no bell; the avatar is not a control", async () => {
    await firstLoad("/");
    const header = page.locator("main header");
    h.assertEqual(await header.locator("input").count(), 0, "inputs in the header");
    h.assertEqual(await header.locator("button, a").count(), 0, "controls in the header");
    const avatar = header.getByRole("img");
    await h.expectVisible(avatar);
    const text = (await avatar.innerText()).trim();
    h.assert(/^[A-Z]{2}$/.test(text), `the avatar shows initials (${text})`);
    return { initials: text };
  });

  await h.test("Every visible header and sidebar control has an effect", async () => {
    const effects = [];
    await firstLoad("/");
    // Sidebar links: each one changes the route.
    for (const [name, path] of [["Dashboards", "/dashboards"], ["Invoices", "/invoices"], ["Accounts", "/accounts"], ["Inventory", "/inventory"], ["HR", "/hr"], ["Dashboard", "/"]]) {
      await page.getByRole("link", { name, exact: true }).click();
      await page.waitForURL((u) => u.pathname === path, { timeout: 15000 });
      effects.push(`${name} -> ${path}`);
    }
    // Settings: opens a menu whose entry exists, Escape closes it.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await h.expectVisible(page.getByRole("menuitem", { name: "Reset demo data" }), 5000);
    await page.keyboard.press("Escape");
    await page.getByRole("menuitem", { name: "Reset demo data" }).waitFor({ state: "detached", timeout: 5000 });
    effects.push("Settings opens and closes its menu");
    // The chat's own close button, visible at 1280x720, closes the panel.
    await h.expectVisible(h.byId("copilot-close-button"));
    await h.byId("copilot-close-button").click();
    for (let i = 0; i < 20 && (await chatOnScreen()); i++) await page.waitForTimeout(250);
    h.assert(!(await chatOnScreen()), "the chat panel is parked off screen after Close");
    effects.push("Close closes the chat");
    // Once closed, the toggle is reachable and opens it again.
    await h.byId("copilot-chat-toggle").click();
    for (let i = 0; i < 20 && !(await chatOnScreen()); i++) await page.waitForTimeout(250);
    h.assert(await chatOnScreen(), "the toggle opens the chat again");
    effects.push("The toggle reopens the chat");
    return { effects };
  });

  await h.test("The data pages carry no add button that does nothing", async () => {
    for (const [path, label] of [["/hr", "Add Employee"], ["/inventory", "Add Item"], ["/invoices", "New Invoice"]]) {
      await firstLoad(path);
      h.assertEqual(await page.getByRole("button", { name: label }).count(), 0, `"${label}" on ${path}`);
    }
  });

  await h.test("Nothing overflows at 1280x720", async () => {
    const out = {};
    for (const path of ["/", "/dashboards", "/invoices", "/accounts", "/inventory", "/hr"]) {
      await firstLoad(path);
      const sizes = await page.evaluate(() => {
        const m = document.querySelector("main");
        const c = document.querySelector("[data-testid='copilot-sidebar']");
        return {
          main: [m.scrollWidth, m.clientWidth],
          chat: [c.scrollWidth, c.clientWidth],
          page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
        };
      });
      for (const [k, [sw, cw]] of Object.entries(sizes)) h.assert(sw <= cw, `${path}: ${k} scrollWidth ${sw} <= clientWidth ${cw}`);
      out[path] = sizes;
    }
    return out;
  });

  await h.test("Icon buttons have accessible names", async () => {
    await firstLoad("/");
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button, a[href]")]
        .filter((e) => e.getClientRects().length > 0)
        .filter((e) => !(e.getAttribute("aria-label") || e.textContent.trim()))
        .map((e) => e.outerHTML.slice(0, 80)),
    );
    h.assertEqual(unnamed, [], "visible buttons and links without a name");
  });

  await h.test("A KPI the store has no history for shows no change badge", async () => {
    const snap = await h.snapshot();
    await firstLoad("/");
    const flat = snap.kpis.filter((k) => k.trend === "flat").map((k) => k.label);
    h.assert(flat.length > 0, "the store serves at least one flat KPI");
    for (const label of flat) {
      const card = h.byId(`kpi-${label}`);
      await h.expectVisible(card);
      const text = await card.innerText();
      h.assert(!/\d%/.test(text), `"${label}" shows no percentage (${JSON.stringify(text)})`);
    }
    const moving = snap.kpis.filter((k) => k.trend !== "flat");
    for (const k of moving) {
      const text = await h.byId(`kpi-${k.label}`).innerText();
      h.assert(text.includes(`${Math.abs(k.change)}%`), `"${k.label}" still shows its ${k.change}% change`);
    }
    return { flat, moving: moving.map((k) => k.label) };
  });

  await h.test("Dashboard cards show their content unclipped with the chat open", async () => {
    await firstLoad("/");
    h.assert(await chatOnScreen(), "the chat is open");
    await h.expectVisible(page.getByText("Expense Breakdown", { exact: true }));
    const problems = await page.evaluate(() => {
      const out = [];
      for (const card of document.querySelectorAll("main [data-slot='card']")) {
        const box = card.getBoundingClientRect();
        const name = (card.querySelector("[data-slot='card-title']")?.textContent || card.textContent).trim().slice(0, 30);
        for (const el of card.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > box.right + 1) out.push(`${name}: <${el.tagName.toLowerCase()}> ends ${Math.round(r.right - box.right)}px past the card`);
          else if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && getComputedStyle(el).display !== "inline") out.push(`${name}: <${el.tagName.toLowerCase()}> scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
        }
        const title = card.querySelector("[data-slot='card-title']");
        if (title && title.getClientRects().length) {
          const lines = Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight));
          if (lines > 1) out.push(`${name}: title wraps over ${lines} lines`);
        }
        // A row whose label and amount are squeezed together is clipped in practice.
        if (card.getBoundingClientRect().width < 300 && card.querySelector("[data-slot='card-title']")) out.push(`${name}: card only ${Math.round(box.width)}px wide`);
      }
      return out;
    });
    h.assertEqual(problems, [], "clipped content in dashboard cards");
  });

  await h.test("A cost KPI is coloured by favourability, its arrow shows the real direction", async () => {
    const snap = await h.snapshot();
    await firstLoad("/");
    const COST = ["Operating Expenses"];
    const seen = [];
    for (const k of snap.kpis.filter((x) => x.trend !== "flat")) {
      const badge = h.byId(`kpi-${k.label}`).locator("div.rounded-full");
      const cls = (await badge.getAttribute("class")) || "";
      const favourable = COST.includes(k.label) ? k.change < 0 : k.change > 0;
      h.assert(cls.includes(favourable ? "emerald" : "red"), `"${k.label}" (change ${k.change}) is ${favourable ? "green" : "red"}: ${cls}`);
      const arrowUp = (await badge.locator("svg").getAttribute("class")).includes("arrow-up-right");
      h.assertEqual(arrowUp, k.change > 0, `"${k.label}" arrow direction`);
      seen.push(`${k.label}: ${k.change} -> ${favourable ? "green" : "red"}`);
    }
    h.assert(snap.kpis.some((k) => COST.includes(k.label) && k.trend !== "flat"), "the store serves a moving cost KPI");
    return { seen };
  });

  await h.test("/components is gone", async () => {
    const res = await page.goto(h.WEB_URL + "/components");
    h.assertEqual(res.status(), 404, "status of /components");
    await h.expectVisible(page.getByText("This page does not exist."));
    await h.expectVisible(page.getByRole("link", { name: "Back to the dashboard" }));
  });

  await h.test("The brand names are the ones from the brand module", async () => {
    await firstLoad("/");
    const title = await page.title();
    h.assert(title.startsWith("FinanceOS"), `the tab title (${title})`);
    const text = await page.locator("body").innerText();
    for (const b of BLOCKED) h.assert(!text.toLowerCase().includes(b.toLowerCase()), `"${b}" is not shown`);
    await h.expectVisible(page.getByText("FinanceOS AI", { exact: true }));
  });
}
