"use client";

import { useEffect } from "react";
import { useRenderTool, ToolCallStatus } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useDashboard } from "@/context/dashboard-context";
import { CompletedToolCard } from "@/components/chat/tool-card";
import { isChartDatasetId } from "@/lib/erp-api";
import { claimToolCall } from "@/lib/handled-tool-calls";

/** Map agent widget type names to internal WidgetType values. */
const TYPE_MAP: Record<string, string> = {
  kpi_cards: "kpi-cards",
  revenue_chart: "revenue-chart",
  expense_breakdown: "expense-breakdown",
  transactions: "recent-transactions",
  invoices: "outstanding-invoices",
  custom_chart: "custom-chart",
};

const DEFAULT_COLSPAN: Record<string, 1 | 2 | 3 | 4> = {
  "kpi-cards": 4,
  "revenue-chart": 3,
  "expense-breakdown": 1,
  "recent-transactions": 2,
  "outstanding-invoices": 2,
  "custom-chart": 2,
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
        const config = w.config ?? {};

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
            config: config as any,
          });
        } else {
          upsertWidget(
            internalType as any,
            (order) => ({
              id: `${internalType}-${Date.now()}`,
              type: internalType as any,
              colSpan,
              order,
              config: config as any,
            }),
            { config: config as any, colSpan },
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
