"use client";

import { useEffect } from "react";
import { useRenderTool, ToolCallStatus } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useDashboard } from "@/context/dashboard-context";
import { CompletedToolCard } from "@/components/chat/tool-card";
import { isChartDatasetId } from "@/lib/erp-api";
import { claimToolCall } from "@/lib/handled-tool-calls";
import type { CustomChartWidget, DashboardWidget, WidgetType } from "@/types/dashboard";

/** Map agent widget type names to internal WidgetType values. */
const TYPE_MAP: Record<string, string> = {
  kpi_cards: "kpi-cards",
  revenue_chart: "revenue-chart",
  expense_breakdown: "expense-breakdown",
  transactions: "recent-transactions",
  invoices: "outstanding-invoices",
  custom_chart: "custom-chart",
  cash_waterfall: "cash-waterfall",
  ar_aging_gauge: "ar-aging-gauge",
  budget_variance: "budget-variance",
  spend_heatmap: "spend-heatmap",
  revenue_forecast: "revenue-forecast",
  metric_cards: "metric-cards",
};

// Options that would carry figures: the widgets draw theirs from the store.
const FIGURE_KEYS = ["scenarios", "comparisonData"];

// Options the widgets read as lists: a lone string would crash the page.
const LIST_KEYS = ["categories", "metrics", "statuses"];

const DEFAULT_COLSPAN: Record<string, 1 | 2 | 3 | 4> = {
  "kpi-cards": 4,
  "revenue-chart": 3,
  "expense-breakdown": 1,
  "recent-transactions": 2,
  "outstanding-invoices": 2,
  "custom-chart": 2,
  "cash-waterfall": 2,
  "ar-aging-gauge": 2,
  "budget-variance": 2,
  "spend-heatmap": 2,
  "revenue-forecast": 2,
  "metric-cards": 2,
};

interface WidgetSpec {
  type: string;
  colSpan?: number;
  config?: Record<string, unknown>;
}

function DashboardUpdater({
  widgets,
  status,
  result,
}: {
  widgets: WidgetSpec[];
  status: string;
  result?: unknown;
}) {
  const { upsertWidget, addWidget, getWidgets } = useDashboard();

  useEffect(() => {
    if (status !== ToolCallStatus.Complete || !widgets?.length) return;

    const key = `update_dashboard-${JSON.stringify(widgets)}`;
    if (!claimToolCall(key)) return;

    queueMicrotask(() => {
      for (const w of widgets) {
        const internalType = TYPE_MAP[w.type] ?? w.type;
        const colSpan = (w.colSpan ?? DEFAULT_COLSPAN[internalType] ?? 2) as
          | 1
          | 2
          | 3
          | 4;
        const config = Object.fromEntries(
          Object.entries(w.config ?? {})
            .filter(([k]) => !FIGURE_KEYS.includes(k))
            // A list option sent as a single string ("marketing") is one item.
            .map(([k, v]) => [k, LIST_KEYS.includes(k) && typeof v === "string" ? [v] : v]),
        );

        if (internalType === "custom-chart") {
          // A chart is filled from the catalog: one without a dataset, or
          // carrying its own figures, cannot be drawn from the store.
          if (!isChartDatasetId(config.dataset) || "data" in config) continue;
          const id = `custom-chart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          addWidget({
            id,
            type: "custom-chart",
            colSpan,
            order: getWidgets().length,
            config: config as CustomChartWidget["config"],
          });
        } else {
          const type = internalType as WidgetType;
          upsertWidget(
            type,
            (order) =>
              ({
                id: `${internalType}-${Date.now()}`,
                type,
                colSpan,
                order,
                config,
              }) as DashboardWidget,
            { config, colSpan } as Partial<DashboardWidget>,
          );
        }
      }
    });
  }, [status, widgets, upsertWidget, addWidget, getWidgets]);

  if (status === ToolCallStatus.Complete) {
    return (
      <CompletedToolCard
        name="update_dashboard"
        args={{ widgets }}
        result={result}
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground animate-pulse py-1">
      Updating dashboard...
    </p>
  );
}

export function useUpdateDashboard() {
  useRenderTool(
    {
      name: "update_dashboard",
      parameters: z.object({
        widgets: z
          .array(
            z.object({
              type: z.string(),
              colSpan: z.number().optional(),
              config: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .optional(),
      }),
      render: ({ parameters, status, result }) => (
        <DashboardUpdater
          widgets={parameters?.widgets ?? []}
          status={status}
          result={result}
        />
      ),
    },
    [],
  );
}
