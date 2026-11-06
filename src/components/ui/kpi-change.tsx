"use client";

import { cn, formatCurrency } from "@/lib/utils";

// The ring stays under reduced motion; only the pulse is dropped.
export const KPI_HIGHLIGHT_RING = "ring-2 ring-primary motion-safe:animate-pulse";

/** The signed amount a KPI just moved by, shown under its label. */
export function KpiDelta({ label, delta }: { label: string; delta: number }) {
  return (
    <p
      data-testid={`kpi-delta-${label}`}
      className={cn(
        "mt-1 text-sm font-semibold",
        delta < 0 ? "text-red-600" : "text-emerald-600",
      )}
    >
      {delta < 0 ? "−" : "+"}
      {formatCurrency(Math.abs(delta))}
    </p>
  );
}
