import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// The helpers are one expression that takes a page; the figure checks never use it.
const helpers = new Function(`return (${readFileSync("e2e/lib/helpers.js", "utf8").trim().replace(/;+$/, "")}\n)`)()(null) as {
  unexplainedFigures: (text: string, snap: unknown, bodies?: unknown[], typed?: string, extra?: number[]) => string[];
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
