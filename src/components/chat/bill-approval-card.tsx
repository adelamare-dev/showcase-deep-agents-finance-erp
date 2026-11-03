"use client";

import { useState } from "react";
import { DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

export type BillRow = {
  id: string;
  number: string;
  supplier: string;
  amount: number;
  dueDate: string;
};

type Props = {
  bills: BillRow[];
  totalAmount: number;
  action: string;
  respond: (result: unknown) => Promise<void>;
};

// The agent computes the rows and the total from the books; this card only
// shows them and sends back one decision for the whole batch.
export function BillApprovalCard({ bills, totalAmount, action, respond }: Props) {
  // Set on the first click so a second click cannot send another answer.
  const [answered, setAnswered] = useState(false);

  const answer = (approved: boolean) => {
    if (answered) return;
    setAnswered(true);
    void respond({
      approved,
      message: approved
        ? `Payment approved for ${bills.length} bill(s) totalling ${formatCurrency(totalAmount)}`
        : "Payment rejected by user",
    });
  };

  return (
    <div
      data-testid="bill-approval-card"
      className="my-2 animate-in fade-in slide-in-from-bottom-2 rounded-2xl border border-border bg-card p-5 duration-300 ease-out"
    >
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10">
          <DollarSign className="h-4 w-4 text-warning" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            Payment Approval Required
          </p>
          <p className="text-xs text-muted-foreground">{action}</p>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-border/50 bg-muted/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Bill</th>
              <th className="px-3 py-2 font-medium">Supplier</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((bill) => (
              <tr
                key={bill.id}
                data-testid="bill-approval-row"
                data-bill-id={bill.id}
                className="border-b border-border/30"
              >
                <td className="px-3 py-2 font-mono text-foreground">
                  {bill.number}
                </td>
                <td className="px-3 py-2 text-foreground">{bill.supplier}</td>
                <td className="px-3 py-2 text-right font-medium text-foreground">
                  {formatCurrency(bill.amount)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {bill.dueDate}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Total</span>
          <span
            data-testid="bill-approval-total"
            data-amount={totalAmount}
            className="text-sm font-bold text-foreground"
          >
            {formatCurrency(totalAmount)}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          disabled={answered}
          onClick={() => answer(true)}
          className="flex-1 bg-emerald-600 text-white hover:bg-emerald-500"
        >
          Approve Payment
        </Button>
        <Button
          variant="destructive"
          disabled={answered}
          onClick={() => answer(false)}
          className="flex-1"
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
