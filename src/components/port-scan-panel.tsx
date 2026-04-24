"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, LoaderCircle, Radio, RadioTower, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type PortResult = {
  open: boolean;
  port: number;
  service: string;
  url: string | null;
};

export function PortScanCard({
  deploymentId,
  deploymentType,
  ip,
  siteSlug,
}: {
  deploymentId: string;
  deploymentType: "lxc" | "qemu";
  ip: string;
  siteSlug?: string;
}) {
  const [results, setResults] = useState<PortResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supportsScan = deploymentType === "lxc";
  const hasRoutableIp = ip && ip !== "Unavailable" && ip !== "DHCP" && ip !== "No IP";
  const canScan = Boolean(supportsScan && hasRoutableIp);

  const scan = useCallback(async () => {
    if (!canScan) return;
    setLoading(true);
    setError(null);
    try {
      const params = siteSlug ? `?siteSlug=${encodeURIComponent(siteSlug)}` : "";
      const response = await fetch(`/api/proxmox/port-scan${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deploymentId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || `Scan failed (${response.status})`);
      }
      const data = await response.json();
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [deploymentId, canScan, siteSlug]);

  useEffect(() => {
    scan();
  }, [scan]);

  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="border-b border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RadioTower className="h-4 w-4 text-zinc-500" />
            <div>
              <CardTitle>Services</CardTitle>
              <CardDescription>
                {supportsScan
                  ? `Open ports detected on ${ip}.`
                  : "Port scanning is currently available for LXC containers only."}
              </CardDescription>
            </div>
          </div>
          <Button
            disabled={loading || !canScan}
            onClick={scan}
            size="sm"
            variant="ghost"
          >
            {loading ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5" />
            )}
            {loading ? "Scanning..." : "Rescan"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!supportsScan ? (
          <div className="px-5 py-6 text-center text-[13px] text-zinc-500">
            Port scan currently supports LXC containers only.
          </div>
        ) : !hasRoutableIp ? (
          <div className="px-5 py-6 text-center text-[13px] text-zinc-500">
            Port scan requires a valid IP address. Start the container first.
          </div>
        ) : loading && results === null ? (
          <div className="flex items-center justify-center gap-2 px-5 py-6 text-[13px] text-zinc-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Scanning container ports...
          </div>
        ) : error ? (
          <div className="px-5 py-4 text-[13px] text-red-400">{error}</div>
        ) : results && results.length === 0 ? (
          <div className="px-5 py-6 text-center text-[13px] text-zinc-500">
            No listening ports detected inside this container.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {results?.map((result) => (
              <div
                key={result.port}
                className="flex items-center justify-between px-5 py-3"
              >
                <div className="flex items-center gap-3">
                  <Radio className="h-3.5 w-3.5 text-emerald-400" />
                  <div>
                    <p className="text-[13px] font-medium text-zinc-200">
                      {result.service}
                    </p>
                    <p className="text-[12px] tabular-nums text-zinc-500">
                      Port {result.port}
                    </p>
                  </div>
                </div>
                {result.url ? (
                  <a
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-zinc-800 px-2.5 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
                    href={result.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open
                  </a>
                ) : (
                  <span className="rounded-md bg-zinc-800/50 px-2 py-1 text-[12px] tabular-nums text-zinc-500">
                    :{result.port}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
