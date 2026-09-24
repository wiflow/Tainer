"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  Map,
  MapMarker,
  MarkerContent,
  MarkerTooltip,
  MapControls,
  useMap,
  type MapRef,
} from "@/components/ui/map";
import { cn } from "@/lib/utils";
import type { SiteOverviewEntry } from "@/app/api/sites/overview/route";

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const statusColors: Record<SiteOverviewEntry["status"], string> = {
  online: "bg-emerald-500/70",
  degraded: "bg-amber-500/70",
  offline: "bg-rose-500/70",
};

const statusRingColors: Record<SiteOverviewEntry["status"], string> = {
  online: "ring-emerald-400/30",
  degraded: "ring-amber-400/30",
  offline: "ring-rose-400/30",
};

const statusDotColors: Record<SiteOverviewEntry["status"], string> = {
  online: "bg-emerald-500",
  degraded: "bg-amber-500",
  offline: "bg-rose-500",
};

function markerSize(site: SiteOverviewEntry): number {
  const base = 10;
  const scale = Math.min(site.deploymentCount, 50) / 50;
  return base + scale * 10;
}

const OVERLAP_PX = 30;

export type OverviewMapHandle = {
  flyTo: (lng: number, lat: number, zoom: number) => void;
  fitToSites: (sites: SiteOverviewEntry[]) => void;
};

function FlyToController({ mapHandle }: { mapHandle: React.RefObject<OverviewMapHandle | null> }) {
  const { map } = useMap();
  useImperativeHandle(mapHandle, () => ({
    flyTo: (lng: number, lat: number, zoom: number) => {
      map?.flyTo({ center: [lng, lat], zoom, duration: 1500 });
    },
    fitToSites: (sites: SiteOverviewEntry[]) => {
      if (!map || sites.length === 0) return;
      const located = sites.filter((s) => s.location);
      if (located.length === 0) return;

      if (located.length === 1) {
        const loc = located[0].location!;
        map.flyTo({ center: [loc.longitude, loc.latitude], zoom: 6, duration: 1500 });
        return;
      }

      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const s of located) {
        const loc = s.location!;
        if (loc.longitude < minLng) minLng = loc.longitude;
        if (loc.longitude > maxLng) maxLng = loc.longitude;
        if (loc.latitude < minLat) minLat = loc.latitude;
        if (loc.latitude > maxLat) maxLat = loc.latitude;
      }

      const EPSILON = 0.001;
      if (Math.abs(maxLng - minLng) < EPSILON && Math.abs(maxLat - minLat) < EPSILON) {
        map.flyTo({ center: [minLng, minLat], zoom: 12, duration: 1500 });
        return;
      }

      map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: { top: 80, bottom: 80, left: 80, right: 360 }, duration: 1500, maxZoom: 14 },
      );
    },
  }), [map]);
  return null;
}

function OverlapHelper({
  sites,
  onMarkerClick,
}: {
  sites: SiteOverviewEntry[];
  onMarkerClick: (clickedId: string, overlapping: SiteOverviewEntry[]) => void;
}) {
  const { map } = useMap();

  const getOverlapping = (clickedId: string): SiteOverviewEntry[] => {
    if (!map) return [];
    const clicked = sites.find((s) => s.id === clickedId);
    if (!clicked?.location) return [];

    const clickedPx = map.project([clicked.location.longitude, clicked.location.latitude]);

    return sites.filter((s) => {
      if (s.id === clickedId || !s.location) return false;
      const px = map.project([s.location.longitude, s.location.latitude]);
      const dx = px.x - clickedPx.x;
      const dy = px.y - clickedPx.y;
      return Math.sqrt(dx * dx + dy * dy) < OVERLAP_PX;
    });
  };

  const helperRef = useRef({ getOverlapping });
  helperRef.current.getOverlapping = getOverlapping;
  (globalThis as any).__overlapHelper = helperRef.current;

  return null;
}

export const OverviewMapInner = forwardRef<OverviewMapHandle, {
  sites: SiteOverviewEntry[];
  selectedSiteId: string | null;
  onSelectSite: (id: string | null) => void;
  loading: boolean;
}>(function OverviewMapInner({ sites, selectedSiteId, onSelectSite, loading }, ref) {
  const handleRef = useRef<OverviewMapHandle | null>(null);
  const [picker, setPicker] = useState<{
    anchor: { lng: number; lat: number };
    sites: SiteOverviewEntry[];
  } | null>(null);

  useImperativeHandle(ref, () => ({
    flyTo: (lng: number, lat: number, zoom: number) => {
      handleRef.current?.flyTo(lng, lat, zoom);
    },
    fitToSites: (s: SiteOverviewEntry[]) => {
      handleRef.current?.fitToSites(s);
    },
  }), []);

  const handleMarkerClick = (clickedId: string) => {
    const helper = (globalThis as any).__overlapHelper as
      | { getOverlapping: (id: string) => SiteOverviewEntry[] }
      | undefined;

    const overlapping = helper?.getOverlapping(clickedId) ?? [];
    const clicked = sites.find((s) => s.id === clickedId);

    if (overlapping.length > 0 && clicked?.location) {
      setPicker({
        anchor: { lng: clicked.location.longitude, lat: clicked.location.latitude },
        sites: [clicked, ...overlapping],
      });
    } else {
      setPicker(null);
      const isSelected = clickedId === selectedSiteId;
      onSelectSite(isSelected ? null : clickedId);
    }
  };

  const handlePickerSelect = (id: string) => {
    setPicker(null);
    onSelectSite(id);
  };

  const handlePickerDismiss = () => {
    setPicker(null);
  };

  return (
    <Map
      theme="dark"
      styles={{ light: DARK_STYLE, dark: DARK_STYLE }}
      className="!absolute inset-0 bg-[#0e0e0e]"
      center={[16, 20]}
      zoom={1.8}
      scrollZoom={true}
      renderWorldCopies={true}
      loading={loading}
    >
      <FlyToController mapHandle={handleRef} />
      <OverlapHelper sites={sites} onMarkerClick={handleMarkerClick} />
      <MapControls showFullscreen showZoom />

      {sites.map((site) => {
        if (!site.location) return null;
        const size = markerSize(site);
        const isSelected = site.id === selectedSiteId;

        return (
          <MapMarker
            key={site.id}
            longitude={site.location.longitude}
            latitude={site.location.latitude}
            onClick={() => handleMarkerClick(site.id)}
          >
            <MarkerContent>
              <div
                className={cn(
                  "rounded-full ring-2 transition-all duration-200",
                  statusColors[site.status],
                  statusRingColors[site.status],
                  isSelected && "ring-4 ring-white/40 scale-125",
                )}
                style={{ width: size, height: size }}
              />
            </MarkerContent>
            <MarkerTooltip
              offset={20}
              className="bg-zinc-900 text-zinc-100 border border-white/[0.08]"
            >
              <p className="font-medium text-zinc-200 text-xs">{site.name}</p>
              {site.location.address && (
                <p className="mt-0.5 text-[10px] text-zinc-500">{site.location.address}</p>
              )}
              <p className="mt-0.5 text-[10px] text-zinc-400">
                {site.nodeCount} node{site.nodeCount !== 1 ? "s" : ""} &middot;{" "}
                {site.deploymentCount} deployment{site.deploymentCount !== 1 ? "s" : ""}
              </p>
            </MarkerTooltip>
          </MapMarker>
        );
      })}

      {picker && (
        <MapMarker
          longitude={picker.anchor.lng}
          latitude={picker.anchor.lat}
        >
          <MarkerContent>
            <div className="relative" style={{ zIndex: 50 }}>
              <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45 bg-zinc-900 border-r border-b border-white/[0.08]" />
              <div
                className="absolute left-1/2 -translate-x-1/2 bottom-3 w-48 rounded-lg border border-white/[0.08] bg-zinc-900/95 backdrop-blur-xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
                  <span className="text-[11px] font-medium text-zinc-400">
                    {picker.sites.length} sites here
                  </span>
                  <button
                    onClick={handlePickerDismiss}
                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                    type="button"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="max-h-40 overflow-y-auto py-1">
                  {picker.sites.map((site) => (
                    <button
                      key={site.id}
                      onClick={() => handlePickerSelect(site.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.06]",
                        site.id === selectedSiteId && "bg-white/[0.06]",
                      )}
                      type="button"
                    >
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDotColors[site.status])} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-zinc-200 truncate">{site.name}</p>
                        <p className="text-[10px] text-zinc-500">
                          {site.nodeCount} node{site.nodeCount !== 1 ? "s" : ""} &middot;{" "}
                          {site.deploymentCount} dep{site.deploymentCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </MarkerContent>
        </MapMarker>
      )}
    </Map>
  );
});
