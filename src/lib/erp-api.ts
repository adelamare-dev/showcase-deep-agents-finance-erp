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
