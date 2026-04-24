"use client";

import type { ApexOptions } from "apexcharts";

import { ApexChart } from "@/components/apex-chart";
import type { LiveStoragePool } from "@/lib/proxmox";
import { formatBytes } from "@/lib/utils";

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function StoragePoolChart({
  pools,
}: {
  pools: LiveStoragePool[];
}) {
  if (pools.length === 0) {
    return (
      <div className="px-5 py-4 text-[13px] text-zinc-500">
        No active Proxmox storage pools are visible right now.
      </div>
    );
  }

  const usageSeries = pools.map((pool) => Math.round((pool.usageRatio ?? 0) * 100));
  const chartOptions: ApexOptions = {
    chart: {
      background: "transparent",
      foreColor: "#a1a1aa",
      toolbar: {
        show: false,
      },
    },
    colors: ["#38bdf8"],
    dataLabels: {
      enabled: true,
      formatter(value) {
        return `${Math.round(Number(value))}%`;
      },
      style: {
        colors: ["#f4f4f5"],
        fontSize: "11px",
        fontWeight: "600",
      },
    },
    grid: {
      borderColor: "#27272a",
      strokeDashArray: 4,
    },
    legend: {
      show: false,
    },
    plotOptions: {
      bar: {
        barHeight: "48%",
        borderRadius: 6,
        distributed: false,
        horizontal: true,
      },
    },
    tooltip: {
      custom({ dataPointIndex }) {
        const pool = pools[dataPointIndex];

        if (!pool) {
          return "";
        }

        return `
          <div style="padding:10px 12px;background:#09090b;color:#f4f4f5;border:1px solid #27272a;border-radius:12px;min-width:180px">
            <div style="font-size:12px;font-weight:600;margin-bottom:6px">${escapeHtml(pool.storage)}</div>
            <div style="font-size:12px;color:#a1a1aa">${escapeHtml(pool.node)} · ${escapeHtml(pool.type)}</div>
            <div style="margin-top:8px;font-size:12px">Used: ${formatBytes(pool.usedBytes ?? 0)}</div>
            <div style="font-size:12px">Free: ${formatBytes(pool.availableBytes ?? 0)}</div>
            <div style="font-size:12px">Total: ${formatBytes(pool.totalBytes ?? 0)}</div>
          </div>
        `;
      },
    },
    xaxis: {
      categories: pools.map((pool) => pool.storage),
      labels: {
        formatter(value) {
          return `${value}%`;
        },
        style: {
          colors: "#71717a",
          fontSize: "11px",
        },
      },
      max: 100,
    },
    yaxis: {
      labels: {
        style: {
          colors: "#d4d4d8",
          fontSize: "12px",
          fontWeight: 500,
        },
      },
    },
  };

  return (
    <div className="space-y-5 p-5">
      <ApexChart
        height={Math.max(260, pools.length * 56)}
        options={chartOptions}
        series={[
          {
            data: usageSeries,
            name: "Used",
          },
        ]}
        type="bar"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {pools.map((pool) => (
          <div
            key={pool.id}
            className="rounded-xl border border-white/5 bg-black/40 px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-zinc-100">{pool.storage}</p>
                <p className="mt-1 text-[12px] text-zinc-500">
                  {pool.shared ? "shared" : pool.node} · {pool.type}
                </p>
              </div>
              <p className="text-[12px] font-medium text-zinc-300">
                {Math.round((pool.usageRatio ?? 0) * 100)}%
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              <span>{formatBytes(pool.usedBytes ?? 0)} used</span>
              <span>{formatBytes(pool.availableBytes ?? 0)} free</span>
              <span>{formatBytes(pool.totalBytes ?? 0)} total</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
