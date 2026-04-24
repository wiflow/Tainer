"use client";

import dynamic from "next/dynamic";
import type {
  ApexAxisChartSeries,
  ApexNonAxisChartSeries,
  ApexOptions,
} from "apexcharts";

const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
});

type ApexChartType =
  | "area"
  | "bar"
  | "donut"
  | "line"
  | "pie"
  | "radar"
  | "radialBar";

export function ApexChart({
  height,
  options,
  series,
  type,
  width = "100%",
}: {
  height: number | string;
  options: ApexOptions;
  series: ApexAxisChartSeries | ApexNonAxisChartSeries;
  type: ApexChartType;
  width?: number | string;
}) {
  return (
    <ReactApexChart
      height={height}
      options={options}
      series={series}
      type={type}
      width={width}
    />
  );
}
