"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/layout/shell";
import { Header } from "@/components/layout/header";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable } from "@/components/ui/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { useErp } from "@/context/erp-context";
import { formatCurrency, cn } from "@/lib/utils";
import type { Bill, Invoice } from "@/types/erp";

export default function InvoicesPage() {
  return (
    <Suspense>
      <InvoicesContent />
    </Suspense>
  );
}

function InvoicesContent() {
  const { invoices, bills } = useErp();
  const searchParams = useSearchParams();
  const activeFilter = searchParams.get("filter") || "all";

  // `?filter=supplier` and `?filter=supplier-<status>` list the bills we owe;
  // every other value lists client invoices, as before.
  const supplierView = activeFilter.startsWith("supplier");
  const status = supplierView
    ? activeFilter.replace(/^supplier-?/, "") || "all"
    : activeFilter;
  const statuses = supplierView
    ? ["all", "paid", "pending", "overdue"]
    : ["all", "paid", "pending", "overdue", "draft"];
  const hrefFor = (f: string) =>
    supplierView
      ? f === "all"
        ? "/invoices?filter=supplier"
        : `/invoices?filter=supplier-${f}`
      : f === "all"
        ? "/invoices"
        : `/invoices?filter=${f}`;

  const filtered =
    status === "all" ? invoices : invoices.filter((inv) => inv.status === status);
  const filteredBills =
    status === "all" ? bills : bills.filter((bill) => bill.status === status);

  const records: { amount: number; status: string }[] = supplierView
    ? bills
    : invoices;
  const totalOutstanding = records
    .filter((r) => r.status === "pending" || r.status === "overdue")
    .reduce((sum, r) => sum + r.amount, 0);
  const totalPaid = records
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + r.amount, 0);
  const overdueCount = records.filter((r) => r.status === "overdue").length;
  const noun = supplierView ? "bill" : "invoice";

  return (
    <Shell>
      <Header
        title="Invoices"
        subtitle={
          supplierView
            ? "Supplier bills and payments"
            : "Manage billing and payments"
        }
      />

      <div className="space-y-6 p-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Outstanding
              </p>
              <p className="mt-2 text-2xl font-bold text-amber-600">
                {formatCurrency(totalOutstanding)}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {supplierView ? "Paid YTD" : "Collected YTD"}
              </p>
              <p className="mt-2 text-2xl font-bold text-emerald-600">
                {formatCurrency(totalPaid)}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Overdue
              </p>
              <p className="mt-2 text-2xl font-bold text-red-600">
                {overdueCount} {noun}{overdueCount !== 1 && "s"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Actions Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link
              href="/invoices"
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                !supplierView
                  ? "border-foreground/20 bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              Clients
            </Link>
            <Link
              href="/invoices?filter=supplier"
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                supplierView
                  ? "border-foreground/20 bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              Suppliers
            </Link>
            <span className="mx-1 h-5 w-px bg-border" />
            {statuses.map((f) => (
              <Link
                key={f}
                href={hrefFor(f)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  status === f
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {f}
              </Link>
            ))}
          </div>
        </div>

        {/* Invoice Table */}
        <Card className="p-0">
          <CardContent className="p-0">
            {supplierView ? (
              <DataTable<Bill>
                keyExtractor={(row) => row.id}
                columns={[
                  {
                    header: "Bill",
                    accessor: (row) => (
                      <p className="font-medium text-foreground">{row.number}</p>
                    ),
                  },
                  {
                    header: "Supplier",
                    accessor: "supplier",
                    className: "text-foreground",
                  },
                  {
                    header: "Amount",
                    accessor: (row) => (
                      <span className="font-medium text-foreground">
                        {formatCurrency(row.amount)}
                      </span>
                    ),
                  },
                  {
                    header: "Issued",
                    accessor: "issuedDate",
                    className: "text-muted-foreground",
                  },
                  {
                    header: "Due Date",
                    accessor: "dueDate",
                    className: "text-muted-foreground",
                  },
                  {
                    header: "Status",
                    accessor: (row) => <StatusBadge status={row.status} />,
                  },
                ]}
                data={filteredBills}
              />
            ) : (
            <DataTable<Invoice>
              keyExtractor={(row) => row.id}
              columns={[
                {
                  header: "Invoice",
                  accessor: (row) => (
                    <div>
                      <p className="font-medium text-foreground">
                        {row.number}
                      </p>
                    </div>
                  ),
                },
                {
                  header: "Client",
                  accessor: "client",
                  className: "text-foreground",
                },
                {
                  header: "Amount",
                  accessor: (row) => (
                    <span className="font-medium text-foreground">
                      {formatCurrency(row.amount)}
                    </span>
                  ),
                },
                {
                  header: "Issued",
                  accessor: "issuedDate",
                  className: "text-muted-foreground",
                },
                {
                  header: "Due Date",
                  accessor: "dueDate",
                  className: "text-muted-foreground",
                },
                {
                  header: "Items",
                  accessor: (row) => (
                    <span className="text-muted-foreground">
                      {row.items.length}
                    </span>
                  ),
                },
                {
                  header: "Status",
                  accessor: (row) => <StatusBadge status={row.status} />,
                },
              ]}
              data={filtered}
            />
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
