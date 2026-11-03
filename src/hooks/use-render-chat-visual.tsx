"use client";

import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { InlineChatChart } from "@/components/chat/inline-chart";
import { CashPositionCard } from "@/components/chat/cash-position-card";

// The model only names a dataset of the catalog and its bounded parameters:
// every figure is read from the agent service when the card renders.
export function useRenderChatVisual() {
  useRenderTool(
    {
      name: "render_chat_visual",
      parameters: z.object({
        dataset: z.string().optional(),
        quarters: z.number().optional(),
        growth_pct: z.number().optional(),
        metric: z.enum(["revenue", "profit", "cash_flow"]).optional(),
        chartType: z.string().optional(),
      }),
      render: ({ parameters: args, status }) => {
        if (args?.dataset === "cash_position") {
          return <CashPositionCard status={status} />;
        }
        return <InlineChatChart status={status} args={args ?? {}} />;
      },
    },
    [],
  );
}
