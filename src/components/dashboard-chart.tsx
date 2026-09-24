"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import { cn } from "@/lib/utils";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

const RANGES = ["30d", "7d", "1h"] as const;

interface DashboardChartSeries {
  name: string;
  data: number[];
}

interface DashboardChartProps {
  title: string;
  subtitle?: string;
  series: DashboardChartSeries[];
  /** Unix milliseconds, aligned 1:1 with each series data array. */
  categories: number[];
  colors?: string[];
  height?: number;
  yAxisFormatter?: (value: number) => string;
  activeRange?: string;
  onRangeChange?: (range: string) => void;
  loading?: boolean;
}

export function DashboardChart({
  title,
  subtitle,
  series,
  categories,
  colors = ["#71717a", "#3f3f46"],
  height = 200,
  yAxisFormatter,
  activeRange = "1h",
  onRangeChange,
  loading,
}: DashboardChartProps) {
  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: "area",
        toolbar: { show: false },
        animations: { enabled: true },
        background: "transparent",
        sparkline: { enabled: false },
      },
      colors,
      fill: {
        type: "gradient",
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.4,
          opacityTo: 0.05,
          stops: [0, 90, 100],
        },
      },
      dataLabels: { enabled: false },
      stroke: { curve: "smooth", width: 2 },
      grid: { show: false },
      xaxis: {
        type: "datetime",
        categories,
        labels: {
          show: true,
          style: {
            colors: "#a1a1aa",
            fontSize: "10px",
            fontFamily: "inherit",
          },
          rotate: 0,
          hideOverlappingLabels: true,
          datetimeUTC: false,
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
        tooltip: { enabled: false },
      },
      yaxis: {
        show: false,
        labels: {
          formatter: yAxisFormatter,
        },
      },
      tooltip: {
        theme: "dark",
        y: {
          formatter: yAxisFormatter,
        },
      },
      legend: { show: false },
      theme: { mode: "dark" },
    }),
    [categories, colors, yAxisFormatter],
  );

  return (
    <div className="rounded-xl border border-white/5 bg-[#111113] p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-[14px] font-medium text-white">{title}</h2>
          {subtitle && (
            <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center overflow-hidden rounded-md border border-white/10 bg-black">
          {RANGES.map((range, i) => (
            <button
              key={range}
              onClick={() => onRangeChange?.(range)}
              className={cn(
                "px-2.5 py-1 text-[11px] font-medium transition-colors",
                i > 0 && "border-l border-white/5",
                activeRange === range
                  ? "text-zinc-300 bg-white/10"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("w-full mt-2 -ml-2 -mb-2 transition-opacity", loading && "opacity-50")}>
        <Chart
          options={options}
          series={series}
          type="area"
          height={height}
          width="100%"
        />
      </div>
    </div>
  );
}
