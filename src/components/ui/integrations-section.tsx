"use client";

import {
  Bot,
  Cloud,
  Container,
  Database,
  GitMerge,
  PenTool,
  Server,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { IpamForm } from "@/app/integrations/ipam-form";
import { HetznerBoxPanel } from "@/components/hetzner-box-panel";
import { StorageBoxCard } from "@/components/storage-box-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { HetznerSnapshot, HetznerStorageBox } from "@/lib/hetzner-storage-api";
import type { PhpIpamIntegrationPublic } from "@/lib/integrations";
import type { OffloadLogEntry, StorageBoxSummary } from "@/lib/storage-box";

export type StorageBoxSiteState = {
  siteSlug: string;
  siteName: string;
  summary: StorageBoxSummary;
  offloadLog: OffloadLogEntry[];
  hetznerBox: HetznerStorageBox | null;
  hetznerSnapshots: HetznerSnapshot[];
  hetznerError: string | null;
};

// Card-grid catalogue of third-party integrations Tainer exposes on the
// /integrations page. Visual style is borrowed from the cnblocks
// integrations-section demo (right-hand grid only — the left text
// column is dropped because the page already has its own heading).
//
// Each card reflects the live store state via a status badge. The
// phpIPAM card is interactive: clicking opens a dialog with the
// existing IpamForm (save / test / remove). Other cards are render-
// only "Coming soon" placeholders so the grid doesn't look empty.

type IntegrationStatus = "configured" | "available" | "coming-soon";

type Integration = {
  name: string;
  description: string;
  icon: ReactNode;
  status: IntegrationStatus;
  onClick?: () => void;
};

const STATUS_STYLES: Record<IntegrationStatus, string> = {
  configured: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/20",
  available: "bg-sky-500/15 text-sky-300 ring-sky-500/20",
  "coming-soon": "bg-zinc-800/80 text-zinc-500 ring-zinc-700/40",
};

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  configured: "Configured",
  available: "Available",
  "coming-soon": "Coming soon",
};

function StatusBadge({ status }: { status: IntegrationStatus }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1",
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const interactive =
    integration.status !== "coming-soon" && Boolean(integration.onClick);
  const baseClasses =
    "space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-left transition-colors";
  const interactiveClasses =
    "hover:border-zinc-700 hover:bg-zinc-900/70 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40";
  const inertClasses = integration.status === "coming-soon" ? "opacity-70" : "";

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex size-fit items-center justify-center text-zinc-300">
          {integration.icon}
        </div>
        <StatusBadge status={integration.status} />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-zinc-100">
          {integration.name}
        </h3>
        <p className="line-clamp-2 text-[12px] text-zinc-500">
          {integration.description}
        </p>
      </div>
    </>
  );

  if (interactive) {
    return (
      <button
        className={cn(baseClasses, interactiveClasses)}
        onClick={integration.onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return <div className={cn(baseClasses, inertClasses)}>{content}</div>;
}

export type IntegrationsSectionProps = {
  ipam: PhpIpamIntegrationPublic | null;
  storageBoxSites: StorageBoxSiteState[];
};

export function IntegrationsSection({ ipam, storageBoxSites }: IntegrationsSectionProps) {
  const [ipamOpen, setIpamOpen] = useState(false);
  const [storageBoxOpen, setStorageBoxOpen] = useState(false);
  const ipamConfigured = Boolean(ipam?.enabled && ipam?.hasToken);
  const storageBoxConfigured = storageBoxSites.some((s) => s.summary.configured);

  const integrations: Integration[] = [
    {
      name: "phpIPAM",
      description:
        "IP address management — reserve subnets and allocations during deployment.",
      icon: <Database className="size-9" />,
      status: ipamConfigured ? "configured" : "available",
      onClick: () => setIpamOpen(true),
    },
    {
      name: "Hetzner Storage Box",
      description:
        "Off-site backup target — verified offload, native CIFS mount, box management via the Hetzner API.",
      icon: <Cloud className="size-9" />,
      status: storageBoxConfigured ? "configured" : "available",
      onClick: () => setStorageBoxOpen(true),
    },
    {
      name: "NetBox",
      description:
        "Source-of-truth IPAM and DCIM. Bring inventory data into deployments.",
      icon: <Server className="size-9" />,
      status: "coming-soon",
    },
    {
      name: "Git",
      description:
        "Pull deployment templates straight from a Git repository.",
      icon: <GitMerge className="size-9" />,
      status: "coming-soon",
    },
    {
      name: "Docker Hub",
      description:
        "Browse and pull OCI images directly into the template catalog.",
      icon: <Container className="size-9" />,
      status: "coming-soon",
    },
    {
      name: "Ollama",
      description:
        "Run local LLMs and surface them as a deployable template.",
      icon: <Bot className="size-9" />,
      status: "coming-soon",
    },
    {
      name: "Penpot",
      description:
        "Open-source design platform — link mockups to deployment templates.",
      icon: <PenTool className="size-9" />,
      status: "coming-soon",
    },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.name} integration={integration} />
        ))}
      </div>

      <Dialog onOpenChange={setStorageBoxOpen} open={storageBoxOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {storageBoxConfigured ? "Hetzner Storage Box" : "Connect a Hetzner Storage Box"}
            </DialogTitle>
            <DialogDescription>
              Per-site off-site backup target. Once connected, offload controls appear on the
              site&apos;s Backups page; a Hetzner Console API token additionally unlocks service
              toggles, box snapshots and live usage.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {storageBoxSites.map((site) => (
              <div className="space-y-4" key={site.siteSlug}>
                {storageBoxSites.length > 1 && (
                  <h3 className="text-[13px] font-medium text-zinc-300">{site.siteName}</h3>
                )}
                <StorageBoxCard
                  dirStorages={[]}
                  nodes={[]}
                  offloadLog={site.offloadLog}
                  showRetrieve={false}
                  siteSlug={site.siteSlug}
                  summary={site.summary}
                />
                {site.summary.configured && (
                  <HetznerBoxPanel
                    box={site.hetznerBox}
                    error={site.hetznerError}
                    hetznerConnected={site.summary.hetznerConnected}
                    siteSlug={site.siteSlug}
                    snapshots={site.hetznerSnapshots}
                  />
                )}
              </div>
            ))}
            {storageBoxSites.length === 0 && (
              <p className="text-[12.5px] text-zinc-500">
                No enabled sites — add a Proxmox site first.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setIpamOpen} open={ipamOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {ipam ? "Edit phpIPAM connection" : "Connect phpIPAM"}
            </DialogTitle>
            <DialogDescription>
              Tainer reads subnet reservations from phpIPAM when sizing IP
              pools so static deployments don&apos;t collide with addresses
              already in use elsewhere.
            </DialogDescription>
          </DialogHeader>
          <IpamForm
            initial={ipam}
            onCancel={() => setIpamOpen(false)}
            onDeleted={() => setIpamOpen(false)}
            onSaved={() => setIpamOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
