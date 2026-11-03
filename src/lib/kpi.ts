import type { KPI } from "@/types/erp";

// KPIs where a lower figure is the good news.
const COST_KPIS = new Set(["Operating Expenses"]);

/** Whether the KPI's move is favourable: a cost going down counts as good. */
export function isKpiFavourable(kpi: KPI): boolean {
  return COST_KPIS.has(kpi.label) ? kpi.trend === "down" : kpi.trend === "up";
}
