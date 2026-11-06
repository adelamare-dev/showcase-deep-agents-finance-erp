"use client";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  className?: string;
  // Hidden while the table's own container is narrower than 28rem.
  secondary?: boolean;
  // Amounts and badges stay on one line in a narrow table; other cells wrap.
  nowrap?: boolean;
}

const SECONDARY_CLASS = "hidden @md:table-cell";

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
}: DataTableProps<T>) {
  return (
    <div className="@container">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col, i) => (
              <TableHead
                key={i}
                className={`px-2 @md:px-4 text-xs uppercase tracking-wider ${col.secondary ? SECONDARY_CLASS : ""}`}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow key={keyExtractor(row)}>
              {columns.map((col, i) => (
                <TableCell
                  key={i}
                  className={`px-2 @md:px-4 py-3.5 ${col.className || "text-muted-foreground"} ${col.nowrap ? "" : "whitespace-normal @md:whitespace-nowrap"} ${col.secondary ? SECONDARY_CLASS : ""}`}
                >
                  {typeof col.accessor === "function"
                    ? col.accessor(row)
                    : String(row[col.accessor])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
