"use client";

import { useEffect } from "react";
import { useRenderTool, ToolCallStatus } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useDashboard } from "@/context/dashboard-context";
import { CompletedToolCard } from "@/components/chat/tool-card";
import { claimToolCall } from "@/lib/handled-tool-calls";

interface ReorderUpdate {
  widgetId: string;
  colSpan?: number;
  order?: number;
}

function DashboardManager({
  action,
  widgetId,
  updates,
  status,
  result,
}: {
  action: string;
  widgetId?: string;
  updates?: ReorderUpdate[];
  status: string;
  result?: unknown;
}) {
  const { getWidgets, setWidgets, removeWidget, resetToDefault } =
    useDashboard();

  useEffect(() => {
    if (status !== ToolCallStatus.Complete) return;

    const key = `manage_dashboard-${action}-${widgetId || ""}-${JSON.stringify(updates || [])}`;
    if (!claimToolCall(key)) return;

    queueMicrotask(() => {
      if (action === "reset") {
        resetToDefault();
      } else if (action === "remove" && widgetId) {
        removeWidget(widgetId);
      } else if (action === "reorder" && updates) {
        const updatedWidgets = getWidgets().map((w) => {
          const update = updates.find((u) => u.widgetId === w.id);
          if (!update) return w;
          return {
            ...w,
            ...(update.colSpan !== undefined && {
              colSpan: update.colSpan as 1 | 2 | 3 | 4,
            }),
            ...(update.order !== undefined && { order: update.order }),
          } as typeof w;
        });
        setWidgets(updatedWidgets);
      }
    });
  }, [
    status,
    action,
    widgetId,
    updates,
    resetToDefault,
    removeWidget,
    getWidgets,
    setWidgets,
  ]);

  if (status === ToolCallStatus.Complete) {
    return (
      <CompletedToolCard
        name="manage_dashboard"
        args={{ action, widgetId, updates }}
        result={result}
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground animate-pulse py-1">
      Updating layout...
    </p>
  );
}

export function useManageDashboard() {
  useRenderTool(
    {
      name: "manage_dashboard",
      parameters: z.object({
        action: z.string().optional(),
        widgetId: z.string().optional(),
        updates: z
          .array(
            z.object({
              widgetId: z.string(),
              colSpan: z.number().optional(),
              order: z.number().optional(),
            }),
          )
          .optional(),
      }),
      render: ({ parameters, status, result }) => (
        <DashboardManager
          action={parameters?.action ?? ""}
          widgetId={parameters?.widgetId}
          updates={parameters?.updates}
          status={status}
          result={result}
        />
      ),
    },
    [],
  );
}
