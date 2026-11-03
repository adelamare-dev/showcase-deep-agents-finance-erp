"use client";

import {
  DollarSign,
  TrendingUp,
  FileText,
  Receipt,
  Wallet,
  CreditCard,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { useErp } from "@/context/erp-context";
import { formatCurrency } from "@/lib/utils";
import type { KPI } from "@/types/erp";

const iconMap: Record<string, React.ElementType> = {
  "dollar-sign": DollarSign,
  "trending-up": TrendingUp,
  "file-text": FileText,
  receipt: Receipt,
  wallet: Wallet,
  "credit-card": CreditCard,
};

export function KPICard({ kpi }: { kpi: KPI }) {
  const Icon = iconMap[kpi.icon] || DollarSign;
  const isPositive = kpi.trend === "up";
  const isFlat = kpi.trend === "flat";
  const delta = useErp().highlights[kpi.label];
  const highlighted = delta !== undefined;

  return (
    <Card
      data-testid={`kpi-${kpi.label}`}
      className={cn(
        "group transition-all duration-300 hover:shadow-lg",
        // The ring stays under reduced motion; only the pulse is dropped.
        highlighted && "ring-2 ring-primary motion-safe:animate-pulse",
      )}
      size="sm"
    >
      <CardContent>
        <div className="flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
              isFlat
                ? "bg-muted text-muted-foreground"
                : isPositive
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-red-50 text-red-600",
            )}
          >
            {isFlat ? (
              <Minus className="h-3 w-3" />
            ) : isPositive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {Math.abs(kpi.change)}%
          </div>
        </div>

        <div className="mt-4">
          <p className="text-2xl font-bold tracking-tight text-foreground">
            {kpi.value}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{kpi.label}</p>
          {highlighted && (
            <p
              data-testid={`kpi-delta-${kpi.label}`}
              className={cn(
                "mt-1 text-sm font-semibold",
                delta < 0 ? "text-red-600" : "text-emerald-600",
              )}
            >
              {delta < 0 ? "−" : "+"}
              {formatCurrency(Math.abs(delta))}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
