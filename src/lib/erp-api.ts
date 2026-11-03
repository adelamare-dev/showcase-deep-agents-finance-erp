import type {
  Account,
  ARAgingData,
  Bill,
  BudgetVsActual,
  CashFlowDataPoint,
  Employee,
  ExpenseBreakdown,
  InventoryItem,
  Invoice,
  KPI,
  MonthlyExpenseByCategory,
  QuarterlyDataPoint,
  RevenueScenario,
  RevenueDataPoint,
  Totals,
  Transaction,
} from "@/types/erp";

export const ERP_API_URL = (
  process.env.NEXT_PUBLIC_ERP_API_URL ?? "http://localhost:8123"
).replace(/\/+$/, "");

// Every dataset the UI shows, as served by `GET /api/erp/snapshot`.
export type ErpSnapshot = {
  kpis: KPI[];
  revenueData: RevenueDataPoint[];
  expenseBreakdown: ExpenseBreakdown[];
  invoices: Invoice[];
  bills: Bill[];
  accounts: Account[];
  transactions: Transaction[];
  inventoryItems: InventoryItem[];
  employees: Employee[];
  quarterlyRevenue: QuarterlyDataPoint[];
  revenueScenarios: RevenueScenario[];
  cashFlowData: CashFlowDataPoint[];
  arAging: ARAgingData;
  budgetVsActual: BudgetVsActual[];
  monthlyExpenseByCategory: MonthlyExpenseByCategory[];
  totals: Totals;
};

export async function fetchSnapshot(): Promise<ErpSnapshot> {
  const res = await fetch(`${ERP_API_URL}/api/erp/snapshot`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`The data service answered ${res.status}`);
  }
  return (await res.json()) as ErpSnapshot;
}

// A chart of the dataset catalog: one column per series, named `value`,
// `value2`, `value3`, ... and described by `series`.
export type ChartRow = { label: string; [key: string]: string | number };

// Datasets that return a chart. `cash_position` is a card, not a chart, so a
// custom chart may not name it. Keep in step with the catalog in the agent.
export const CHART_DATASET_IDS = [
  "revenue_by_quarter",
  "cash_flow_by_quarter",
  "expense_breakdown",
  "ar_aging",
  "budget_variance",
  "revenue_forecast",
  "cash_flow_forecast",
  "scenario_analysis",
] as const;

export function isChartDatasetId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (CHART_DATASET_IDS as readonly string[]).includes(value)
  );
}

export type ChartDataset = {
  title: string;
  chartType: "area" | "bar" | "line";
  data: ChartRow[];
  series: { key: string; color: string; label: string }[];
  formatValues: "currency" | "number" | "percent";
};

export type CashPositionDataset = {
  title: string;
  accounts: { name: string; balance: number }[];
  totalCash: number;
  totalLiabilities: number;
  netPosition: number;
};

export type DatasetParams = {
  quarters?: number;
  growth_pct?: number;
  metric?: "revenue" | "profit" | "cash_flow";
};

// Builds the chart or card from the store at request time, so every figure it
// shows comes from the agent service.
export async function fetchDataset<T extends ChartDataset | CashPositionDataset>(
  id: string,
  params: DatasetParams = {},
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const suffix = query.size ? `?${query}` : "";
  const res = await fetch(
    `${ERP_API_URL}/api/erp/datasets/${encodeURIComponent(id)}${suffix}`,
    { cache: "no-store" },
  );
  if (res.status === 404) {
    throw new Error(`"${id}" is not a known dataset.`);
  }
  if (res.status === 422) {
    throw new Error("The chart parameters are out of range.");
  }
  if (!res.ok) {
    throw new Error(`The data service answered ${res.status}`);
  }
  return (await res.json()) as T;
}

// Puts the agent's books back to the seeded data.
export async function resetErpData(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${ERP_API_URL}/api/erp/reset`, { method: "POST" });
  } catch {
    throw new Error("The data service is not reachable. Start the agent and try again.");
  }
  if (!res.ok) {
    throw new Error(`The data service answered ${res.status}`);
  }
}
