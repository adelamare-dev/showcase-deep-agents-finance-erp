// The app starts whatever the browser storage holds: an entry in an old
// format, an entry carrying its own data, corrupted JSON, or storage that
// throws on access. Needs `pnpm demo`; no model is called.
async (page, h) => {
  const KEY = "finance-os.dashboards.v2";
  const OLD_KEY = "finance-erp-dashboards";
  const stamp = "2026-01-01T00:00:00.000Z";
  const widget = (id, config) => ({ id, type: "kpi-cards", colSpan: 4, order: 0, config });
  const dashboard = (id, name, widgets) => ({
    id, name, category: "custom", widgets, createdAt: stamp, updatedAt: stamp,
  });

  // Each case runs in its own page so its init script and storage stay isolated.
  const withPage = async (init, arg, fn) => {
    const p = await page.context().newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e.message || e)));
    try {
      await p.addInitScript(init, arg);
      return await fn(p, errors);
    } finally {
      await p.close();
    }
  };
  const gallery = async (p) => {
    await h.visit("/dashboards", p);
    await p.getByText("Dashboard Gallery").first().waitFor({ state: "visible", timeout: 30000 });
    return await p.locator("body").innerText();
  };
  const seed = (arg) => {
    for (const [k, v] of Object.entries(arg)) window.localStorage.setItem(k, v);
  };
  const TEMPLATES = ["Executive Summary", "Revenue Overview", "Cash Flow Risk", "Cost Control"];
  const assertTemplates = (text) => {
    for (const name of TEMPLATES) h.assert(text.includes(name), `template "${name}" is listed`);
  };

  await h.test("A dashboard in an old format or carrying data is ignored", async () => {
    const stored = {
      [OLD_KEY]: JSON.stringify([dashboard("old-1", "Legacy Layout", [widget("w", {})])]),
      [KEY]: JSON.stringify([
        dashboard("bad-1", "Carries Data", [widget("w", { data: [{ label: "x", value: 1 }] })]),
        { id: "bad-2", name: "Not A Dashboard" },
        dashboard("good-1", "Valid Saved Layout", [widget("w", {})]),
      ]),
    };
    return await withPage(seed, stored, async (p, errors) => {
      const text = await gallery(p);
      assertTemplates(text);
      h.assert(!text.includes("Legacy Layout"), "the entry under the old key is not read");
      h.assert(!text.includes("Carries Data"), "the entry carrying data is dropped");
      h.assert(!text.includes("Not A Dashboard"), "the malformed entry is dropped");
      h.assert(text.includes("Valid Saved Layout"), "the valid entry is kept");
      h.assertEqual(errors, [], "no page error");
    });
  });

  await h.test("Corrupted JSON in storage does not break startup", async () => {
    return await withPage(seed, { [KEY]: "{not json" }, async (p, errors) => {
      assertTemplates(await gallery(p));
      await h.visit("/", p);
      h.assertEqual(errors, [], "no page error");
    });
  });

  await h.test("A stored value of the wrong shape does not break startup", async () => {
    return await withPage(seed, { [KEY]: JSON.stringify({ not: "a list" }) }, async (p, errors) => {
      assertTemplates(await gallery(p));
      h.assertEqual(errors, [], "no page error");
    });
  });

  await h.test("Storage that throws on access does not break startup", async () => {
    const block = () => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    };
    return await withPage(block, undefined, async (p, errors) => {
      assertTemplates(await gallery(p));
      await h.visit("/", p);
      const kpis = (await h.snapshot()).kpis;
      const text = await p.locator("body").innerText();
      h.assert(text.includes(kpis[0].value), "the dashboard still shows the store's values");
      h.assertEqual(errors, [], "no page error");
    });
  });
  await h.test("A dashboard saved from the toolbar is stored and read back", async () => {
    return await withPage(() => {}, undefined, async (p, errors) => {
      await h.visit("/", p);
      await p.getByRole("button", { name: "Save" }).first().click();
      await p.getByPlaceholder("Dashboard name...").fill("Saved From Toolbar");
      await p.getByPlaceholder("Dashboard name...").press("Enter");
      await p.getByText("Current:").first().waitFor({ state: "visible", timeout: 10000 });
      const text = await gallery(p);
      h.assert(text.includes("Saved From Toolbar"), "the saved dashboard is listed after a reload");
      h.assertEqual(errors, [], "no page error");
    });
  });

}
