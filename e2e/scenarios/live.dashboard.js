// The reference dashboard: the hero suggestion must produce Cash and Accounts
// Payable KPIs, AR aging, supplier bills due and a quarterly cash projection,
// each with figures that equal the store's. Needs `pnpm demo` with a real
// MISTRAL_API_KEY in agent/.env. The seconds are recorded, not enforced.
async (page, h) => {
  await h.test("The reference suggestion builds the complete dashboard", async () => {
    await h.resetDemo();
    const r = await h.runDashboardSegment(page);
    const summary = JSON.stringify(r);
    h.assert(r.complete, "the dashboard misses " + r.missing.join(", ") + " " + summary);
    h.assertEqual(r.mismatches, [], "figures that differ from the store " + summary);
    return r;
  });
}
