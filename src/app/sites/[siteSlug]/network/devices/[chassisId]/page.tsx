import Link from "next/link";
import { ChevronLeft, Router, Server, Wifi, Network, HelpCircle } from "lucide-react";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { NetworkDeviceAnnotationForm } from "@/components/network-device-annotation-form";
import { NetworkDeviceEvents } from "@/components/network-device-events";
import { NetworkSwitchPanel } from "@/components/network-switch-panel";
import {
  hasSitePermission,
  requireSession,
  requireSiteAccess,
} from "@/lib/auth";
import { getLldpAnnotation } from "@/lib/lldp-annotations";
import { listLldpEventsForSite } from "@/lib/lldp-events";
import {
  deriveTopology,
  getLldpSnapshotsForSite,
} from "@/lib/lldp-snapshots";
import { getSnmpSnapshotForChassis } from "@/lib/lldp-snmp-snapshots";
import type { LldpDevice } from "@/lib/lldp-types";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";

export const dynamic = "force-dynamic";

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ siteSlug: string; chassisId: string }>;
}) {
  const { siteSlug, chassisId: chassisIdRaw } = await params;
  await requireSitePageAccess(siteSlug);
  const chassisId = decodeURIComponent(chassisIdRaw);

  const siteConfig = await ensureSiteConfig(siteSlug);
  const session = await requireSession();
  requireSiteAccess(session, siteConfig.siteId);
  const canManage = hasSitePermission(session, siteConfig.siteId, "manage-security");

  const [snapshots, annotation, events, snmpSnapshot] = await Promise.all([
    getLldpSnapshotsForSite(siteConfig.siteId),
    getLldpAnnotation(siteConfig.siteId, chassisId),
    listLldpEventsForSite(siteConfig.siteId, { chassisId, limit: 200 }),
    getSnmpSnapshotForChassis(siteConfig.siteId, chassisId),
  ]);
  const topology = deriveTopology(snapshots);
  const device = topology.devices.find((d) => d.chassisId === chassisId);
  if (!device) notFound();

  const Icon = pickIcon(device);
  const ports = Object.values(device.ports).sort((a, b) =>
    a.portId.localeCompare(b.portId, undefined, { numeric: true }),
  );
  const now = Date.now();
  const displayName = annotation?.friendlyName ?? device.systemName ?? "Unnamed device";

  return (
    <main className="min-h-screen px-6 py-8 lg:px-10">
      <AutoRefresh />
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <Link
          className="inline-flex w-fit items-center gap-1 text-[11.5px] text-zinc-500 hover:text-zinc-300"
          href={`/sites/${siteSlug}/network?tab=devices`}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All devices
        </Link>

        <header className="rounded-xl border border-white/[0.06] bg-zinc-950/40 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
              <Icon className="h-5 w-5 text-sky-300" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold text-zinc-50">{displayName}</h1>
              {annotation?.friendlyName && device.systemName ? (
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  LLDP reports: <span className="text-zinc-400">{device.systemName}</span>
                </div>
              ) : null}
              <div className="mt-0.5 font-mono text-[11.5px] text-zinc-500">
                {device.chassisId}
              </div>
              {device.capabilities.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {device.capabilities.map((c) => (
                    <span
                      key={c}
                      className="rounded bg-white/5 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-zinc-300"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="text-right text-[11px] text-zinc-400">
              <div className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
                Last seen
              </div>
              <div>{formatAge(now - Date.parse(device.lastSeenAt))}</div>
              <div className="mt-1 text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
                First seen
              </div>
              <div>{new Date(device.firstSeenAt).toLocaleString()}</div>
            </div>
          </div>

          {device.systemDescription || device.managementAddress ? (
            <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-white/[0.04] pt-4 text-[12px] sm:grid-cols-2">
              {device.managementAddress ? (
                <div>
                  <dt className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
                    Management
                  </dt>
                  <dd className="mt-0.5 font-mono text-zinc-200">
                    {device.managementAddress}
                  </dd>
                </div>
              ) : null}
              {device.systemDescription ? (
                <div className="sm:col-span-2">
                  <dt className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
                    System description
                  </dt>
                  <dd className="mt-0.5 text-zinc-300">{device.systemDescription}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </header>

        <section className="rounded-xl border border-white/[0.06] bg-zinc-950/40 p-4">
          <header className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-medium text-zinc-100">
                {snmpSnapshot ? `Front panel (${snmpSnapshot.ports.length} ports)` : `Ports observed (${ports.length})`}
              </h2>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {snmpSnapshot
                  ? `Live port inventory from SNMP, last polled ${new Date(snmpSnapshot.collectedAt).toLocaleTimeString()}. Click a port for details.`
                  : "Front-panel mock based on LLDP-observed ports. Only ports with one of this site's Proxmox nodes attached are visible. Enable SNMP polling in the Integrations panel to see the full chassis."}
              </p>
            </div>
            {snmpSnapshot ? (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/[0.06] px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                SNMP
              </span>
            ) : (
              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                LLDP only
              </span>
            )}
          </header>
          <NetworkSwitchPanel
            ports={ports}
            portCountOverride={annotation?.portCountOverride ?? null}
            snmpPorts={snmpSnapshot?.ports ?? null}
          />
        </section>

        <NetworkDeviceAnnotationForm
          annotation={annotation}
          canEdit={canManage}
          chassisId={device.chassisId}
          siteSlug={siteSlug}
        />

        <NetworkDeviceEvents events={events} />
      </div>
    </main>
  );
}

function pickIcon(d: LldpDevice) {
  const caps = d.capabilities;
  if (caps.includes("router")) return Router;
  if (caps.includes("wlan-access-point") || caps.includes("wlan")) return Wifi;
  if (caps.includes("bridge")) return Network;
  if (caps.includes("station") || caps.includes("host")) return Server;
  return HelpCircle;
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
