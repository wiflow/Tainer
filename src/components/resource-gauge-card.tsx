import type { ApexOptions } from "apexcharts";

import { ApexChart } from "@/components/apex-chart";
import { cn, formatBytes } from "@/lib/utils";

function accentToColor(accentClassName: string) {
  if (accentClassName.includes("emerald")) {
    return "#34d399";
  }

  if (accentClassName.includes("amber")) {
    return "#f59e0b";
  }

  if (accentClassName.includes("fuchsia")) {
    return "#d946ef";
  }

  return "#38bdf8";
}

function percentLabel(ratio: number | null) {
  if (ratio == null) {
    return "--";
  }

  return `${Math.round(ratio * 100)}%`;
}

export function ResourceGaugeCard({
  accentClassName,
  amountLabel,
  icon,
  label,
  ratio,
}: {
  accentClassName: string;
  amountLabel: string;
  icon: React.ReactNode;
  label: string;
  ratio: number | null;
}) {
  const normalizedRatio = Math.max(0, Math.min(ratio ?? 0, 1));
  const percent = Math.round(normalizedRatio * 100);
  const color = accentToColor(accentClassName);
  const chartOptions: ApexOptions = {
    chart: {
      animations: {
        enabled: true,
      },
      background: "transparent",
      sparkline: {
        enabled: true,
      },
      toolbar: {
        show: false,
      },
    },
    colors: [color],
    fill: {
      colors: [color],
    },
    plotOptions: {
      radialBar: {
        dataLabels: {
          name: {
            show: false,
          },
          value: {
            show: false,
          },
        },
        endAngle: 130,
        hollow: {
          size: "64%",
        },
        startAngle: -130,
        track: {
          background: "#27272a",
          margin: 0,
          strokeWidth: "100%",
        },
      },
    },
    stroke: {
      lineCap: "round",
    },
    tooltip: {
      enabled: false,
    },
  };
  const barBgMuted = accentClassName.replace("text-", "bg-") + "/15";

  return (
    <div className="group relative flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-[#111113] p-4 transition-colors hover:border-white/10">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg",
              barBgMuted,
            )}
          >
            <span className={cn("h-3.5 w-3.5", accentClassName)}>{icon}</span>
          </div>
          <span className="text-[13px] font-medium text-zinc-300">{label}</span>
        </div>
        <span
          className={cn(
            "mt-4 block text-2xl font-semibold tracking-tight tabular-nums",
            percent > 85 ? "text-red-400" : "text-zinc-100",
          )}
        >
          {percentLabel(ratio)}
        </span>
        <p className="mt-1 text-[11px] tabular-nums text-zinc-500">{amountLabel}</p>
        <div className={cn("mt-4 h-1.5 w-full overflow-hidden rounded-full", barBgMuted)}>
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{
              backgroundColor: color,
              width: `${Math.max(percent, 4)}%`,
            }}
          />
        </div>
      </div>

      <div className="shrink-0">
        <ApexChart
          height={138}
          options={chartOptions}
          series={[percent]}
          type="radialBar"
          width={138}
        />
      </div>
    </div>
  );
}

export function formatUsageLabel(usedBytes: number, totalBytes: number) {
  return `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`;
}
