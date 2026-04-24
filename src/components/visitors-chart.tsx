"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { ApexOptions } from "apexcharts";

// react-apexcharts must be loaded dynamically in nextjs
const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

export function VisitorsChart() {
  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: "area",
        toolbar: { show: false },
        animations: { enabled: true },
        background: "transparent",
      },
      colors: ["#71717a", "#3f3f46"],
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
      grid: {
        show: false,
      },
      xaxis: {
        categories: [
          "Apr 5",
          "Apr 9",
          "Apr 13",
          "Apr 18",
          "Apr 23",
          "Apr 28",
          "May 3",
          "May 7",
          "May 12",
          "May 17",
          "May 22",
          "May 27",
          "Jun 1",
          "Jun 5",
          "Jun 9",
          "Jun 14",
          "Jun 19",
          "Jun 24",
          "Jun 30",
        ],
        labels: {
          style: {
            colors: "#a1a1aa", // zinc-400
            fontSize: "11px",
            fontFamily: "inherit",
          },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
        tooltip: { enabled: false }
      },
      yaxis: {
        show: false,
      },
      legend: { show: false },
      theme: { mode: "dark" },
    }),
    []
  );

  const series = [
    {
      name: "Series 1",
      data: [31, 40, 28, 51, 42, 109, 100, 40, 60, 30, 80, 50, 90, 40, 60, 40, 80, 30, 100],
    },
    {
      name: "Series 2",
      data: [11, 32, 45, 32, 34, 52, 41, 20, 40, 20, 50, 30, 70, 20, 40, 20, 50, 15, 60],
    },
  ];

  return <Chart options={options} series={series} type="area" height={320} width="100%" />;
}
