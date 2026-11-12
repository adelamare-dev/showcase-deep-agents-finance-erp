import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// The helpers are one expression that takes a page; the figure checks never use it.
const source = `return (${readFileSync("e2e/lib/helpers.js", "utf8").trim().replace(/;+$/, "")}\n)`;
const helpers = new Function(source)()(null) as {
  unexplainedFigures: (text: string, snap: unknown, bodies?: unknown[], typed?: string, extra?: number[]) => string[];
  projectRevenue: (snap: unknown, quarters?: number, method?: string) => { revenue: number; expenses: number; profit: number }[];
  projectCashFlow: (snap: unknown, quarters?: number) => { operating: number; investing: number; financing: number; net: number; balance: number }[];
  projectedMoney: (snap: unknown) => number[];
  projectionPercents: (snap: unknown) => number[];
  strangers: (text: string, fields: number[]) => string[];
  expenseTotals: (snap: unknown) => { byCategory: { category: string; total: number; sharePct: number }[]; total: number };
};
// moneyFields reads the cash position over page.request, so it runs here with a stub page.
const withStubPage = new Function(source)()({ request: { get: async () => ({ json: async () => ({}) }) } }) as {
  moneyFields: (snap: unknown, catalogMoney: number[]) => Promise<number[]>;
};

const quarters = [100_000, 110_000, 125_000, 130_000];
const nets = [40_000, 25_000, 55_000, 70_000];
const snap = {
  totals: { revenue: 800_000, netProfit: 123_456 },
  kpis: [],
  expenseBreakdown: [],
  arAging: { collectionRate: 0.5 },
  quarterlyRevenue: quarters.map((revenue) => ({ revenue })),
  cashFlowData: nets.map((net) => ({ net })),
  budgetVsActual: [{ category: "Rent", budget: 30_000, actual: 33_300, variance: -3_300 }],
  invoices: [
    { status: "paid", amount: 61_400, client: "A" },
    { status: "pending", amount: 20_000, client: "B" },
    { status: "overdue", amount: 18_600, client: "C" },
    { status: "overdue", amount: 1_000, client: "D" },
  ],
  bills: [],
  employees: [],
  inventoryItems: [],
};
const pct = (n: number) => `${n}%`;
const rates = quarters.slice(1).map((r, i) => (r - quarters[i]) / quarters[i]);
const mean = rates.reduce((t, r) => t + r, 0) / rates.length;
const vol = Math.sqrt(rates.reduce((t, r) => t + (r - mean) ** 2, 0) / rates.length);
const bad = (text: string, bodies: unknown[] = []) => helpers.unexplainedFigures(text, snap, bodies);

test("offline.live-checks profit margin, one decimal", () => {
  expect(bad(pct(Number(((123_456 / 800_000) * 100).toFixed(1))))).toEqual([]);
});
test("offline.live-checks collection rate, whole number", () => {
  const rate = (61_400 / (61_400 + 39_600)) * 100;
  expect(bad(pct(Math.round(rate)))).toEqual([]);
  expect(bad(pct(Number(rate.toFixed(1))))).toEqual([]);
});
test("offline.live-checks a whole percent that only rounds another ratio is rejected", () => {
  const margin = pct(Math.round((123_456 / 800_000) * 100));
  expect(bad(margin)).toEqual([margin]);
  expect(bad(pct(Math.round(mean * 100)))).toEqual([pct(Math.round(mean * 100))]);
  expect(bad("61.0%")).not.toEqual([]);
});
test("offline.live-checks cash-flow trend, whole number", () => {
  const trend = ((nets[3] - nets[1]) / Math.abs(nets[1])) * 100;
  expect(bad(pct(Math.round(trend)))).toEqual([]);
});
test("offline.live-checks growth and volatility", () => {
  expect(bad(pct(Number((mean * 100).toFixed(1))))).toEqual([]);
  expect(bad(pct(Number((vol * 100).toFixed(1))))).toEqual([]);
});
test("offline.live-checks projected change over the trailing four quarters", () => {
  const trailing = quarters.reduce((t, q) => t + q, 0);
  let current = quarters[3];
  let total = 0;
  for (let i = 0; i < 4; i++) total += current = Math.trunc(current * (1 + mean));
  expect(bad(pct(Number((((total - trailing) / trailing) * 100).toFixed(1))))).toEqual([]);
});
test("offline.live-checks budget variance over budget", () => {
  expect(bad(pct(11))).toEqual([]);
  expect(bad(pct(10.9))).not.toEqual([]);
});
test("offline.live-checks fractional share in a percent field is read times 100", () => {
  expect(bad("a 37.5% share", [{ payrollShare: 0.375 }])).toEqual([]);
  expect(bad("a 38.5% share", [{ payrollShare: 0.375 }])).toEqual(["38.5%"]);
});
test("offline.live-checks unrelated numbers stay rejected", () => {
  expect(bad("a 48.2% rate")).toEqual(["48.2%"]);
  expect(bad("a 97% rate")).toEqual(["97%"]);
  expect(bad("7 overdue invoices")).toEqual(["7 overdue invoices"]);
  expect(bad("2 overdue invoices")).toEqual([]);
});

// Fixture for the projection mirrors. The expected rows were printed by the Python
// calculations (project_revenue and project_cash_flow in agent/erp_datasets.py,
// horizon 8) on this same fixture; they are not computed here.
const REV = [410_000, 428_500, 455_250, 470_800, 492_300, 515_900, 538_400, 561_050];
const EXP = [301_000, 309_400, 322_700, 331_900, 349_100, 362_800, 371_250, 389_600];
const OP = [120_000, 131_500, 140_250, 152_000, 149_000, 163_800, 171_900, 180_400];
const INV = [-30_000, -32_500, -28_000, -41_000, -35_500, -38_200, -36_000, -44_100];
const FIN = [-12_000, -15_500, -9_000, -22_000, -14_000, -18_500, -16_000, -21_250];
const projSnap = {
  quarterlyRevenue: REV.map((revenue, i) => ({ revenue, expenses: EXP[i] })),
  cashFlowData: OP.map((operating, i) => ({ operating, investing: INV[i], financing: FIN[i], net: operating + INV[i] + FIN[i] })),
  totals: { cash: 905_000 },
};
const pyLinear = [[586197, 405553, 180644], [612472, 422159, 190313], [639924, 439444, 200480], [668606, 457438, 211168], [698575, 476168, 222407], [729886, 495666, 234220], [762601, 515961, 246640], [796782, 537088, 259694]];
const pySeasonal = [[591120, 398152, 192968], [621126, 414599, 206527], [636737, 418715, 218022], [668600, 441879, 226721], [591120, 398152, 192968], [621126, 414599, 206527], [636737, 418715, 218022], [668600, 441879, 226721]];
const pyCash = [[188450, -38450, -17438, 132562, 1037562], [196859, -40372, -17438, 139049, 1176611], [205643, -42295, -17438, 145910, 1322521], [214820, -44218, -17438, 153164, 1475685], [224405, -46140, -17438, 160827, 1636512], [234419, -48062, -17438, 168919, 1805431], [244879, -49985, -17438, 177456, 1982887], [255806, -51908, -17438, 186460, 2169347]];
const rows = (r: { revenue: number; expenses: number; profit: number }[]) => r.map((p) => [p.revenue, p.expenses, p.profit]);

test("offline.live-checks linear revenue projection equals the Python", () => {
  expect(rows(helpers.projectRevenue(projSnap, 8, "linear"))).toEqual(pyLinear);
  expect(rows(helpers.projectRevenue(projSnap, 3, "linear"))).toEqual(pyLinear.slice(0, 3));
});
test("offline.live-checks seasonal revenue projection equals the Python", () => {
  expect(rows(helpers.projectRevenue(projSnap, 8, "seasonal"))).toEqual(pySeasonal);
});
test("offline.live-checks cash-flow projection equals the Python", () => {
  expect(helpers.projectCashFlow(projSnap, 8).map((p) => [p.operating, p.investing, p.financing, p.net, p.balance])).toEqual(pyCash);
});
test("offline.live-checks a projected amount is admitted, a wrong one is not", () => {
  const fields = helpers.projectedMoney(projSnap);
  expect(helpers.strangers("Revenue reaches $586,197 and profit $180,644.", fields)).toEqual([]);
  expect(helpers.strangers("Revenue reaches $586,198.", fields)).toEqual(["$586,198"]);
});

// The growth percentages of the same fixture: projectionPercents' order, printed by
// the Python (project_revenue and project_cash_flow, horizon 8, on this fixture):
// quarter-over-quarter growth, its average and volatility, operating growth, then the
// four seasonal year-over-year rows.
const pyPercents = [4.5, 4.5, 0.2, 4.5, 20.1, 20.4, 18.3, 19.2];
const projFull = { ...snap, quarterlyRevenue: projSnap.quarterlyRevenue, cashFlowData: projSnap.cashFlowData, totals: { ...snap.totals, cash: 905_000 } };
test("offline.live-checks growth percentages of the forecast tools equal the Python", () => {
  expect(helpers.projectionPercents(projSnap)).toEqual(pyPercents);
});
test("offline.live-checks a forecast growth percentage is admitted, a wrong one is not", () => {
  for (const v of pyPercents) expect(helpers.unexplainedFigures(`growth of ${v}% expected`, projFull)).toEqual([]);
  expect(helpers.unexplainedFigures("Revenue expected to grow by 11.9% quarter-over-quarter.", projFull)).toEqual(["11.9%"]);
});

test("offline.live-checks a quarterly profit is admitted, a wrong one is not", async () => {
  const quarterly = { ...snap, quarterlyRevenue: [{ quarter: "Q4 2026", revenue: 900_000, expenses: 314_000, profit: 586_000 }] };
  const fields = await withStubPage.moneyFields(quarterly, []);
  expect(helpers.strangers("Q4 profit reached $586,000 and $586K.", fields)).toEqual([]);
  expect(helpers.strangers("Q4 profit reached $586,001.", fields)).toEqual(["$586,001"]);
});

test("offline.live-checks expense category totals and shares are admitted, a re-added one is not", async () => {
  const expenses = {
    ...snap,
    expenseBreakdown: [
      { category: "Operations", amount: 277_000, percentage: 25.2 },
      { category: "Payroll", amount: 580_000, percentage: 52.8 },
      { category: "Other", amount: 242_000, percentage: 22.0 },
    ],
  };
  const out = helpers.expenseTotals(expenses);
  expect(out.byCategory.map((c) => c.category)).toEqual(["Payroll", "Operations", "Other"]);
  expect(out.total).toBe(1_099_000);
  const fields = await withStubPage.moneyFields(expenses, []);
  expect(helpers.strangers("Payroll is $580,000, Operations $277,000, together $1,099,000.", fields)).toEqual([]);
  expect(helpers.unexplainedFigures("Payroll is 52.8% and Operations 25.2%.", expenses)).toEqual([]);
  expect(helpers.strangers("The top two add up to $857,000 and $1,098,000.", fields)).toEqual(["$857,000", "$1,098,000"]);
});

test("offline.live-checks a whole K or M amount matches the value it rounds", () => {
  expect(helpers.strangers("revenue is $730K", [729_850])).toEqual([]);
  expect(helpers.strangers("cash is $1M", [1_045_000])).toEqual([]);
  expect(helpers.strangers("revenue is $731K", [729_850])).toEqual(["$731K"]);
  expect(helpers.strangers("revenue is $730,000", [729_850])).toEqual(["$730,000"]);
});
