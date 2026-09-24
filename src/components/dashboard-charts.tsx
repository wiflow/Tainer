"use client";

import { useCallback, useEffect, useState } from "react";

import { DashboardChart } from "@/components/dashboard-chart";
import type { RRDChartData } from "@/lib/proxmox";

type Timeframe = "hour" | "day" | "week" | "month";
type ChartRange = "1h" | "7d" | "30d";

const TIMEFRAME_MAP: Record<ChartRange, Timeframe> = {
  "1h": "hour",
  "7d": "week",
  "30d": "month",
};

interface DashboardChartsProps {
  siteSlug: string;
}

export function DashboardCharts({ siteSlug }: DashboardChartsProps) {
  const [activeRange, setActiveRange] = useState<ChartRange>("1h");
  const [data, setData] = useState<RRDChartData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (range: ChartRange, background = false) => {
    const timeframe = TIMEFRAME_MAP[range];
    if (!background) {
      setLoading(true);
    }

    try {
      const res = await fetch(`/api/proxmox/rrd?timeframe=${timeframe}&site=${siteSlug}`, {
        cache: "default",
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {} finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, [siteSlug]);

  useEffect(() => {
    void fetchData(activeRange);
  }, [activeRange, fetchData]);

  useEffect(() => {
    if (activeRange !== "1h") return;

    const interval = setInterval(() => {
      void fetchData("1h", true);
    }, 60_000);

    return () => clearInterval(interval);
  }, [activeRange, fetchData]);

  function handleRangeChange(range: string) {
    if (!(range in TIMEFRAME_MAP)) {
      return;
    }

    setActiveRange(range as ChartRange);
  }

  const hasData = data && data.categories.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <DashboardChart
        title="CPU Usage"
        subtitle={hasData ? "Cluster average %" : "No RRD data available"}
        categories={hasData ? data.categories : []}
        series={hasData ? [{ name: "CPU %", data: data.cpu }] : []}
        colors={["#38bdf8"]}
        yAxisFormatter={(v) => `${v}%`}
        activeRange={activeRange}
        onRangeChange={handleRangeChange}
        loading={loading}
      />

      <DashboardChart
        title="RAM Usage"
        subtitle={hasData ? "Allocated memory %" : "No RRD data available"}
        categories={hasData ? data.categories : []}
        series={hasData ? [{ name: "RAM %", data: data.memoryPercent }] : []}
        colors={["#10b981"]}
        yAxisFormatter={(v) => `${v}%`}
        activeRange={activeRange}
        onRangeChange={handleRangeChange}
        loading={loading}
      />

      <DashboardChart
        title="Storage"
        subtitle={hasData ? "Rootfs utilization %" : "No RRD data available"}
        categories={hasData ? data.categories : []}
        series={hasData ? [{ name: "Storage %", data: data.storagePercent }] : []}
        colors={["#f59e0b"]}
        yAxisFormatter={(v) => `${v}%`}
        activeRange={activeRange}
        onRangeChange={handleRangeChange}
        loading={loading}
      />

      <DashboardChart
        title="Network Traffic"
        subtitle={hasData ? "Cluster throughput in MB" : "No RRD data available"}
        categories={hasData ? data.categories : []}
        series={
          hasData
            ? [
                { name: "Inbound", data: data.netIn },
                { name: "Outbound", data: data.netOut },
              ]
            : []
        }
        colors={["#38bdf8", "#f472b6"]}
        yAxisFormatter={(v) => `${v} MB`}
        activeRange={activeRange}
        onRangeChange={handleRangeChange}
        loading={loading}
      />
    </div>
  );
}
