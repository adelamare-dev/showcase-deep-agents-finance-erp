"use client";

import {
  ToolCallStatus,
  useInterrupt,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  BillApprovalCard,
  type BillRow,
} from "@/components/chat/bill-approval-card";
import { InventoryReorderCard } from "@/components/chat/inventory-reorder-card";

type ApprovalArgs = {
  type: "supplier_payment" | "inventory_reorder";
  bills?: BillRow[];
  totalAmount?: number;
  action?: string;
  items?: Array<{
    sku: string;
    name: string;
    currentQty: number;
    reorderQty: number;
    unitCost: number;
  }>;
  estimatedTotal?: number;
  supplier?: string;
};

type InterruptValue = {
  __copilotkit_interrupt_value__?: {
    action?: string;
    args?: ApprovalArgs;
  };
};

// `event.value` arrives as a JSON-encoded string from the runtime, not an
// object. Decode here so the rest of the hook can work with structured data.
function parseInterruptValue(raw: unknown): InterruptValue | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as InterruptValue;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === "object") return raw as InterruptValue;
  return undefined;
}

export function useRequestApproval() {
  // Suppress the wildcard `useRenderTool({ name: "*" })` from rendering a generic
  // ToolCard for `request_approval`. The actual approval UI is handled by
  // useInterrupt below — the agent's `copilotkit_interrupt(action="request_approval", ...)`
  // pauses the LangGraph run and emits an `on_interrupt` custom event, not a
  // normal tool execution.
  useRenderTool(
    {
      name: "request_approval",
      parameters: z.object({}),
      render: () => null,
    },
    [],
  );

  useInterrupt({
    agentId: "finance_erp_agent",
    enabled: (event) => {
      const value = parseInterruptValue(event.value);
      return (
        value?.__copilotkit_interrupt_value__?.action === "request_approval"
      );
    },
    render: ({ event, resolve }) => {
      const value = parseInterruptValue(event.value);
      const args = value?.__copilotkit_interrupt_value__?.args;
      // The interrupt API requires an element; an empty fragment renders nothing.
      if (!args) return <></>;

      const respond = async (result: unknown) => {
        resolve(result);
      };

      if (args.type === "inventory_reorder") {
        return (
          <InventoryReorderCard
            status={ToolCallStatus.Executing}
            args={{
              items: args.items ?? [],
              estimatedTotal: args.estimatedTotal ?? 0,
              supplier: args.supplier,
            }}
            respond={respond}
            result={undefined}
          />
        );
      }

      return (
        <BillApprovalCard
          bills={args.bills ?? []}
          totalAmount={args.totalAmount ?? 0}
          action={args.action ?? "Pay supplier bills"}
          respond={respond}
        />
      );
    },
  });
}
