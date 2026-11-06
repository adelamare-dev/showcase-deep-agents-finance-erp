"use client";

import { CheckCircle2, Ban, Info } from "lucide-react";
import { approvalReceiptText } from "@/content/ui-text";
import { formatCurrency } from "@/lib/utils";

type Receipt = {
  outcome?: string;
  type?: string;
  count?: number;
  total?: number;
  message?: string;
};

function parse(result: string): Receipt | undefined {
  try {
    const value: unknown = JSON.parse(result);
    return value && typeof value === "object" ? (value as Receipt) : undefined;
  } catch {
    return undefined;
  }
}

// What is left of an approval card after the decision: the outcome and the
// figures the agent reported, with no buttons. The numbers are also exposed
// as data attributes.
export function ApprovalReceipt({ result }: { result: string }) {
  const receipt = parse(result);
  if (!receipt) return null;

  const count = Number(receipt.count ?? 0);
  const total = Number(receipt.total ?? 0);
  const approved = receipt.outcome === "approved";
  const rejected = receipt.outcome === "rejected";
  const text = approved
    ? approvalReceiptText.approved(
        count,
        receipt.type === "inventory_reorder" ? "item" : "bill",
        formatCurrency(total),
      )
    : rejected
      ? approvalReceiptText.rejected
      : (receipt.message ?? "");
  if (!text) return null;

  const Icon = approved ? CheckCircle2 : rejected ? Ban : Info;
  return (
    <div
      data-testid="approval-receipt"
      data-outcome={receipt.outcome}
      data-count={count}
      data-amount={total}
      className="my-2 flex items-center gap-2 rounded-2xl border border-border/50 bg-card px-4 py-3 text-sm text-foreground"
    >
      <Icon
        className={`h-4 w-4 shrink-0 ${approved ? "text-emerald-600" : "text-muted-foreground"}`}
      />
      <span>{text}</span>
    </div>
  );
}
