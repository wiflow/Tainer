import * as React from "react";

import { cn } from "@/lib/utils";

interface DataTableColumn {
  label: string;
  className?: string;
}

interface DataTableProps {
  columns: DataTableColumn[];
  children: React.ReactNode;
  emptyMessage?: string;
  className?: string;
}

export function DataTable({
  columns,
  children,
  emptyMessage = "No data available.",
  className,
}: DataTableProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-white/5 bg-[#111113]",
        className,
      )}
    >
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-white/5 bg-black/40">
            {columns.map((col) => (
              <th
                key={col.label}
                className={cn(
                  "px-4 py-3 font-medium text-zinc-400",
                  col.className,
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {children || (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-[13px] text-zinc-500"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
