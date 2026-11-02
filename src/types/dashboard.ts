export type WidgetType =
  | "kpi-cards"
  | "revenue-chart"
  | "expense-breakdown"
  | "recent-transactions"
  | "outstanding-invoices"
  | "custom-chart"
  | "cash-waterfall"
  | "ar-aging-gauge"
  | "budget-variance"
  | "spend-heatmap"
  | "revenue-forecast"
  | "metric-cards";

// Declared as type aliases (not interfaces) so widgets are assignable to the
// JSON-serializable context values passed to `useAgentContext`.
export type BaseWidget = {
  id: string;
  type: WidgetType;
  colSpan: 1 | 2 | 3 | 4;
  order: number;
};

export type KpiCardsWidget = BaseWidget & {
  type: "kpi-cards";
  config: { metrics?: string[] };
};

export type RevenueChartWidget = BaseWidget & {
  type: "revenue-chart";
  config: { showProfit?: boolean; showExpenses?: boolean };
};

export type ExpenseBreakdownWidget = BaseWidget & {
  type: "expense-breakdown";
  config: { categories?: string[] };
};

export type RecentTransactionsWidget = BaseWidget & {
  type: "recent-transactions";
  config: { limit?: number };
};

export type OutstandingInvoicesWidget = BaseWidget & {
  type: "outstanding-invoices";
  config: { statuses?: ("pending" | "overdue")[] };
};

export type CustomChartWidget = BaseWidget & {
  type: "custom-chart";
  config: {
    title: string;
    subtitle?: string;
    chartType: "area" | "bar" | "line";
    data: { label: string; value: number; value2?: number; value3?: number }[];
    series: { key: string; color: string; label: string }[];
    formatValues?: "currency" | "number" | "percent";
  };
};

export type CashWaterfallWidget = BaseWidget & {
  type: "cash-waterfall";
  config: {
    title?: string;
    subtitle?: string;
    mode: "waterfall" | "flow-comparison";
    quarters?: number;
    showNetLine?: boolean;
    comparisonData?: { quarter: string; inflow: number; outflow: number }[];
  };
};

export type ArAgingGaugeWidget = BaseWidget & {
  type: "ar-aging-gauge";
  config: {
    title?: string;
    warningThreshold?: number;
    criticalThreshold?: number;
  };
};

export type BudgetVarianceWidget = BaseWidget & {
  type: "budget-variance";
  config: {
    title?: string;
    subtitle?: string;
    showPercentage?: boolean;
    categories?: string[];
  };
};

export type SpendHeatmapWidget = BaseWidget & {
  type: "spend-heatmap";
  config: {
    title?: string;
    subtitle?: string;
    categories?: (
      | "payroll"
      | "operations"
      | "marketing"
      | "infrastructure"
      | "rnd"
      | "other"
    )[];
    colorScale?: "purple" | "blue" | "red";
  };
};

export type RevenueForecastWidget = BaseWidget & {
  type: "revenue-forecast";
  config: {
    title?: string;
    subtitle?: string;
    mode: "forecast" | "quarterly";
    scenarios?: {
      label: string;
      values: { quarter: string; value: number }[];
      color: string;
    }[];
    trailingQuarters?: number;
    showMarginLine?: boolean;
  };
};

export type MetricCardsWidget = BaseWidget & {
  type: "metric-cards";
  config: {
    metrics: string[];
    stacked?: boolean;
  };
};

export type DashboardWidget =
  | KpiCardsWidget
  | RevenueChartWidget
  | ExpenseBreakdownWidget
  | RecentTransactionsWidget
  | OutstandingInvoicesWidget
  | CustomChartWidget
  | CashWaterfallWidget
  | ArAgingGaugeWidget
  | BudgetVarianceWidget
  | SpendHeatmapWidget
  | RevenueForecastWidget
  | MetricCardsWidget;

export interface SavedDashboard {
  id: string;
  name: string;
  description?: string;
  category: "template" | "custom";
  widgets: DashboardWidget[];
  createdAt: string;
  updatedAt: string;
}
