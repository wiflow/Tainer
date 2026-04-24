"use client";

import type { ApexOptions } from "apexcharts";

import { ApexChart } from "@/components/apex-chart";

export function LoadAverageChart({
  values,
}: {
  values: number[];
}) {
  if (values.length === 0) {
    return <p className="text-[13px] text-zinc-500">Load averages are unavailable.</p>;
  }

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
      enabled: false,
    },
    fill: {
      gradient: {
        opacityFrom: 0.28,
        opacityTo: 0.04,
        shadeIntensity: 1,
        stops: [0, 100],
      },
      type: "gradient",
    },
    grid: {
      borderColor: "#27272a",
      strokeDashArray: 4,
    },
    markers: {
      hover: {
        size: 6,
      },
      size: 5,
      strokeColors: "#09090b",
      strokeWidth: 3,
    },
    stroke: {
      curve: "smooth",
      lineCap: "round",
      width: 3,
    },
    tooltip: {
      theme: "dark",
      y: {
        formatter(value) {
          return value.toFixed(2);
        },
      },
    },
    xaxis: {
      categories: ["1 minute", "5 minutes", "15 minutes"],
      labels: {
        style: {
          colors: "#71717a",
          fontSize: "11px",
        },
      },
    },
    yaxis: {
      labels: {
        formatter(value) {
          return value.toFixed(2);
        },
        style: {
          colors: "#71717a",
          fontSize: "11px",
        },
      },
    },
  };

  return (
    <ApexChart
      height={220}
      options={chartOptions}
      series={[
        {
          data: values,
          name: "Load average",
        },
      ]}
      type="area"
    />
  );
}
