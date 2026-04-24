"use client";

import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Cpu,
  ExternalLink,
  HardDrive,
  MemoryStick,
  Server,
  Box,
  MapPin,
  Search,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  OverviewResponse,
  SiteOverviewEntry,
} from "@/app/api/sites/overview/route";
import type { OverviewMapHandle } from "@/components/overview-map-inner";

const MapInner = lazy(() => import("@/components/overview-map-inner").then((m) => ({ default: m.OverviewMapInner })));

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatPercent(ratio: number | null): string {
  if (ratio == null) return "N/A";
  return `${Math.round(ratio * 100)}%`;
}

const statusColors: Record<SiteOverviewEntry["status"], string> = {
  online: "bg-emerald-500",
  degraded: "bg-amber-500",
  offline: "bg-rose-500",
};

function MiniGauge({
  icon,
  label,
  percent,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  percent: number | null;
  detail: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-zinc-400">
          {icon}
          {label}
        </span>
        <span className="text-zinc-200 font-medium tabular-nums">{detail}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700",
            percent != null && percent > 80
              ? "bg-rose-500"
              : percent != null && percent > 60
                ? "bg-amber-500"
                : "bg-emerald-500",
          )}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function SiteDetailView({
  site,
  onBack,
}: {
  site: SiteOverviewEntry;
  onBack: () => void;
}) {
  const cluster = site.cluster;
  const cpuPercent = cluster?.cpuRatio != null ? Math.round(cluster.cpuRatio * 100) : null;
  const memPercent =
    cluster && cluster.memoryTotalBytes > 0
      ? Math.round((cluster.memoryUsedBytes / cluster.memoryTotalBytes) * 100)
      : null;
  const storagePercent =
    cluster && cluster.rootfsTotalBytes > 0
      ? Math.round((cluster.rootfsUsedBytes / cluster.rootfsTotalBytes) * 100)
      : null;

  return (
    <>
      {/* Header with back arrow */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
        <button
          onClick={onBack}
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <span
            className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_8px_currentColor]",
              statusColors[site.status],
            )}
          />
          <h3 className="text-[15px] font-semibold text-zinc-100 truncate">{site.name}</h3>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex border-b border-white/[0.06]">
        <div className="flex flex-1 flex-col items-center py-3 border-r border-white/[0.06]">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Nodes</span>
          <span className="text-lg font-semibold text-zinc-100 tabular-nums">{site.nodeCount}</span>
        </div>
        <div className="flex flex-1 flex-col items-center py-3">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Deployments</span>
          <span className="text-lg font-semibold text-zinc-100 tabular-nums">{site.deploymentCount}</span>
        </div>
      </div>

      {/* Metrics */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {cluster ? (
          <>
            <MiniGauge
              icon={<Cpu className="h-3.5 w-3.5" />}
              label="CPU"
              percent={cpuPercent}
              detail={formatPercent(cluster.cpuRatio)}
            />
            <MiniGauge
              icon={<MemoryStick className="h-3.5 w-3.5" />}
              label="Memory"
              percent={memPercent}
              detail={
                cluster.memoryTotalBytes > 0
                  ? `${formatBytes(cluster.memoryUsedBytes)} / ${formatBytes(cluster.memoryTotalBytes)}`
                  : "N/A"
              }
            />
            <MiniGauge
              icon={<HardDrive className="h-3.5 w-3.5" />}
              label="Storage"
              percent={storagePercent}
              detail={
                cluster.rootfsTotalBytes > 0
                  ? `${formatBytes(cluster.rootfsUsedBytes)} / ${formatBytes(cluster.rootfsTotalBytes)}`
                  : "N/A"
              }
            />
          </>
        ) : (
          <p className="text-xs text-zinc-500">Unable to fetch metrics</p>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-white/[0.06] px-5 py-4">
        <Link
          href={`/sites/${site.slug}`}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/[0.06] px-4 py-2.5 text-[13px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.1]"
        >
          Open Dashboard
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </>
  );
}

function SitesListView({
  data,
  onSelectSite,
}: {
  data: OverviewResponse;
  onSelectSite: (id: string) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = data.sites.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <h3 className="text-[15px] font-semibold text-zinc-100">Sites</h3>
        <div className="flex items-center gap-3 text-[10px]">
          {(["online", "degraded", "offline"] as const).map((status) => {
            const count = data.sites.filter((s) => s.status === status).length;
            if (count === 0) return null;
            return (
              <span key={status} className="flex items-center gap-1 text-zinc-400">
                <span className={cn("h-1.5 w-1.5 rounded-full", statusColors[status])} />
                {count}
              </span>
            );
          })}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex border-b border-white/[0.06]">
        <div className="flex flex-1 flex-col items-center py-3 border-r border-white/[0.06]">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Sites</span>
          <span className="text-lg font-semibold text-zinc-100 tabular-nums">{data.totals.sites}</span>
        </div>
        <div className="flex flex-1 flex-col items-center py-3 border-r border-white/[0.06]">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Nodes</span>
          <span className="text-lg font-semibold text-zinc-100 tabular-nums">{data.totals.nodes}</span>
        </div>
        <div className="flex flex-1 flex-col items-center py-3">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Deployments</span>
          <span className="text-lg font-semibold text-zinc-100 tabular-nums">{data.totals.deployments}</span>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2">
          <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          <input
            type="text"
            placeholder="Search sites..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-[12px] text-zinc-200 placeholder:text-zinc-600 outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-zinc-500 hover:text-zinc-300" type="button">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Sites list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-[11px] text-zinc-600">No sites found</p>
        ) : (
          filtered.map((site) => {
            const cpuPercent = site.cluster?.cpuRatio != null ? Math.round(site.cluster.cpuRatio * 100) : null;
            const memPercent =
              site.cluster && site.cluster.memoryTotalBytes > 0
                ? Math.round((site.cluster.memoryUsedBytes / site.cluster.memoryTotalBytes) * 100)
                : null;

            return (
              <button
                key={site.id}
                onClick={() => onSelectSite(site.id)}
                className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors border-b border-white/[0.04] hover:bg-white/[0.04]"
                type="button"
              >
                <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", statusColors[site.status])} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium text-zinc-200 truncate">{site.name}</p>
                    {!site.location && (
                      <span className="shrink-0 text-[9px] text-zinc-600 bg-white/[0.04] px-1.5 py-0.5 rounded">No loc</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-zinc-500">
                    <span>{site.nodeCount} node{site.nodeCount !== 1 ? "s" : ""}</span>
                    <span>{site.deploymentCount} deployment{site.deploymentCount !== 1 ? "s" : ""}</span>
                  </div>
                  {(cpuPercent != null || memPercent != null) && (
                    <div className="flex items-center gap-2 mt-2">
                      {cpuPercent != null && (
                        <div className="flex-1">
                          <div className="flex items-center justify-between text-[9px] text-zinc-500 mb-0.5">
                            <span>CPU</span>
                            <span className="tabular-nums text-zinc-400">{cpuPercent}%</span>
                          </div>
                          <div className="h-1 rounded-full bg-white/[0.06]">
                            <div
                              className={cn("h-full rounded-full", cpuPercent > 80 ? "bg-rose-500" : cpuPercent > 60 ? "bg-amber-500" : "bg-emerald-500")}
                              style={{ width: `${cpuPercent}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {memPercent != null && (
                        <div className="flex-1">
                          <div className="flex items-center justify-between text-[9px] text-zinc-500 mb-0.5">
                            <span>RAM</span>
                            <span className="tabular-nums text-zinc-400">{memPercent}%</span>
                          </div>
                          <div className="h-1 rounded-full bg-white/[0.06]">
                            <div
                              className={cn("h-full rounded-full", memPercent > 80 ? "bg-rose-500" : memPercent > 60 ? "bg-amber-500" : "bg-emerald-500")}
                              style={{ width: `${memPercent}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

function RightPanel({
  data,
  selectedSite,
  onSelectSite,
  onBack,
}: {
  data: OverviewResponse;
  selectedSite: SiteOverviewEntry | null;
  onSelectSite: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute inset-y-0 right-0 z-20 flex w-80 flex-col border-l border-white/[0.06] bg-zinc-950/70 backdrop-blur-xl">
      {selectedSite ? (
        <SiteDetailView site={selectedSite} onBack={onBack} />
      ) : (
        <SitesListView data={data} onSelectSite={onSelectSite} />
      )}
    </div>
  );
}

export function OverviewMap() {
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const mapRef = useRef<OverviewMapHandle | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/sites/overview", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as OverviewResponse;
        setData(json);
      }
    } catch {
      // retry on next interval
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSelectSite = useCallback((id: string) => {
    setSelectedSiteId(id);
    if (data) {
      const site = data.sites.find((s) => s.id === id);
      if (site?.location) {
        mapRef.current?.flyTo(site.location.longitude, site.location.latitude, 10);
      }
    }
  }, [data]);

  const handleBack = useCallback(() => {
    setSelectedSiteId(null);
    mapRef.current?.flyTo(16, 20, 1.8);
  }, []);

  const locatedSites = data?.sites.filter((s) => s.location) ?? [];
  const selectedSite = data?.sites.find((s) => s.id === selectedSiteId) ?? null;

  return (
    <div className="relative h-full overflow-hidden">
      {mounted ? (
        <Suspense fallback={null}>
          <MapInner
            ref={mapRef}
            sites={locatedSites}
            selectedSiteId={selectedSiteId}
            onSelectSite={(id) => id ? handleSelectSite(id) : handleBack()}
            loading={false}
          />
        </Suspense>
      ) : null}

      {data ? (
        <RightPanel
          data={data}
          selectedSite={selectedSite}
          onSelectSite={handleSelectSite}
          onBack={handleBack}
        />
      ) : (
        <div className="pointer-events-auto absolute inset-y-0 right-0 z-20 flex w-80 flex-col border-l border-white/[0.06] bg-zinc-950/70 backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <h3 className="text-[15px] font-semibold text-zinc-100">Sites</h3>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-white/60" />
              <p className="text-[11px] text-zinc-500">Loading sites...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
