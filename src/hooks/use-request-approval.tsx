"use client";

import {
  ToolCallStatus,
  useInterrupt,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { useEffect } from "react";
import { z } from "zod";
import { setApprovalPending } from "@/lib/approval-pending";
import {
  BillApprovalCard,
  type BillRow,
} from "@/components/chat/bill-approval-card";
import { ApprovalReceipt } from "@/components/chat/approval-receipt";
import { InventoryReorderCard } from "@/components/chat/inventory-reorder-card";

type ApprovalArgs = {
  type: "supplier_payment" | "inventory_reorder";
  bills?: BillRow[];
  billIds?: string[];
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

// Flags the approval as pending while its card is mounted. The flag clears when
// the user answers (`respond`) or when the card unmounts, which happens once the
// interrupt is no longer rendered, for example after a reset or a new thread.
function PendingMarker() {
  useEffect(() => {
    setApprovalPending(true);
    return () => setApprovalPending(false);
  }, []);
  return null;
}

export function useRequestApproval() {
  // The approval card itself comes from useInterrupt below: the agent's
  // `copilotkit_interrupt(action="request_approval", ...)` pauses the run. Once
  // the user has answered, the tool call completes and this renderer leaves a
  // receipt in the thread. A reload starts a new thread, so a receipt is never
  // replayed. It also keeps
  // the wildcard `useRenderTool({ name: "*" })` from drawing a generic ToolCard.
  useRenderTool(
    {
      name: "request_approval",
      parameters: z.object({}),
      render: (props) =>
        props.status === ToolCallStatus.Complete ? (
          <ApprovalReceipt result={props.result} />
        ) : null,
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
        setApprovalPending(false);
        resolve(result);
      };

      if (args.type === "inventory_reorder") {
        return (
          <>
            <PendingMarker />
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
          </>
        );
      }

      return (
        <>
          <PendingMarker />
          <BillApprovalCard
            bills={args.bills ?? []}
            billIds={args.billIds ?? []}
            totalAmount={args.totalAmount ?? 0}
            action={args.action ?? "Pay supplier bills"}
            respond={respond}
          />
        </>
      );
    },
  });
}
