"use client";

import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { InlineChatChart } from "@/components/chat/inline-chart";
import { CashPositionCard } from "@/components/chat/cash-position-card";

export function useRenderChatVisual() {
  useRenderTool(
    {
      name: "render_chat_visual",
      parameters: z.object({
        type: z.string().optional(),
        accounts: z
          .array(z.object({ name: z.string(), balance: z.number() }))
          .optional(),
        totalCash: z.number().optional(),
        totalLiabilities: z.number().optional(),
        netPosition: z.number().optional(),
        title: z.string().optional(),
        chartType: z.string().optional(),
        data: z
          .array(
            z.object({
              label: z.string(),
              value: z.number(),
              value2: z.number().optional(),
            }),
          )
          .optional(),
        series: z
          .array(
            z.object({ key: z.string(), color: z.string(), label: z.string() }),
          )
          .optional(),
      }),
      render: ({ parameters: args, status }) => {
        if (args?.type === "cash_position") {
          return (
            <CashPositionCard
              status={status}
              args={{
                accounts: args.accounts ?? [],
                totalCash: args.totalCash ?? 0,
                totalLiabilities: args.totalLiabilities ?? 0,
                netPosition: args.netPosition ?? 0,
              }}
            />
          );
        }
        return (
          <InlineChatChart
            status={status}
            args={{
              title: args?.title ?? "",
              type: (args?.chartType ?? "area") as "area" | "bar" | "line",
              data: args?.data ?? [],
              series: args?.series ?? [],
            }}
          />
        );
      },
    },
    [],
  );
}
