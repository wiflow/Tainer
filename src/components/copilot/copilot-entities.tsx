"use client";

import { useState } from "react";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Box,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileBox,
  Globe,
  HardDrive,
  History,
  KeyRound,
  LineChart,
  Mail,
  MemoryStick,
  MessageSquare,
  Network,
  Play,
  Plus,
  Power,
  Radio,
  Rewind,
  RotateCcw,
  ScrollText,
  Server,
  Settings2,
  TerminalSquare,
  Trash2,
  Workflow,
} from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

// -- Shared types (kept structural to match tool-result JSON) ---------------

type Deployment = {
  id: string;
  vmid: number;
  name: string;
  node: string;
  type: "lxc" | "qemu";
  status: string;
  ip?: string;
  cpu?: string;
  memory?: string;
  disk?: string;
  uptime?: string;
  cpuUsage?: number | null;
  memUsedBytes?: number | null;
  memTotalBytes?: number | null;
  tags?: string[];
};

type Site = {
  slug: string;
  name: string;
  enabled?: boolean;
  healthy?: boolean | null;
  countryCode?: string | null;
};

type Node = {
  name: string;
  status: string;
};

type NodeMetric = {
  node: string;
  cpuRatio: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  uptimeSeconds: number | null;
};

type ClusterOverview = {
  nodes: Node[];
  nodeMetrics: NodeMetric[];
  clusterResources?: {
    cpuRatio: number | null;
    memoryUsedBytes: number;
    memoryTotalBytes: number;
  } | null;
  deploymentCount: number;
  runningCount: number;
  stoppedCount: number;
};

type OsTemplate = {
  id: string;
  name: string;
  node: string;
  storage: string;
  sizeLabel: string;
};

type DeploymentTemplate = {
  id: string;
  name: string;
  description: string;
  sourceName: string;
  cores: string;
  memory: string;
  rootfsSize: string;
  node: string;
};

type StoragePool = {
  node: string;
  storage: string;
  type: string;
  usedBytes: number | null;
  availableBytes: number | null;
  totalBytes: number | null;
  usageRatio: number | null;
};

type IpPool = {
  id: string;
  name: string;
  subnet: string;
  gateway: string;
  bridge: string;
  availableCount?: number;
  usableHostCount?: number;
};

type AuditEntry = {
  id: string;
  action: string;
  message: string;
  actorName: string;
  recordedAt: string;
};

// -- Helpers ----------------------------------------------------------------

const DEPLOYMENT_STATUS_TONE: Record<string, string> = {
  running: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
  stopped: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
  paused: "text-amber-300 bg-amber-500/10 border-amber-500/20",
};

function statusTone(status: string): string {
  return DEPLOYMENT_STATUS_TONE[status] ?? "text-zinc-400 bg-white/[0.04] border-white/10";
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
}

function fmtPct(ratio: number | null | undefined): string {
  if (ratio == null) return "—";
  return `${Math.round(ratio * 100)}%`;
}

const cardBase =
  "group block rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 hover:border-white/15 hover:bg-white/[0.04] transition-colors";

// -- Cards ------------------------------------------------------------------

export function DeploymentCard({
  d,
  siteSlug,
}: {
  d: Deployment;
  siteSlug: string;
}) {
  const href = siteSlug ? `/sites/${siteSlug}/deployments/${d.id}` : null;
  const Inner = (
    <motion.div
      className={cn(cardBase, "flex flex-col gap-1.5")}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.04]">
          {d.type === "qemu" ? (
            <Server className="h-3.5 w-3.5 text-zinc-300" />
          ) : (
            <Box className="h-3.5 w-3.5 text-zinc-300" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[12.5px] font-medium text-zinc-100 truncate">{d.name}</span>
            <span className="text-[10px] text-zinc-500 flex-shrink-0">
              {d.type === "qemu" ? "VM" : "CT"} {d.vmid}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 truncate">
            {d.node}
            {d.ip && d.ip !== "Unavailable" ? ` · ${d.ip}` : ""}
          </div>
        </div>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium border flex-shrink-0",
            statusTone(d.status),
          )}
        >
          {d.status}
        </span>
      </div>
      {(d.cpuUsage != null || d.memUsedBytes != null) && (
        <div className="flex items-center gap-2 text-[10.5px] text-zinc-500">
          {d.cpuUsage != null && (
            <span className="inline-flex items-center gap-1">
              <Cpu className="h-2.5 w-2.5" /> {fmtPct(d.cpuUsage)}
            </span>
          )}
          {d.memUsedBytes != null && d.memTotalBytes != null && (
            <span className="inline-flex items-center gap-1">
              <MemoryStick className="h-2.5 w-2.5" />
              {fmtBytes(d.memUsedBytes)} / {fmtBytes(d.memTotalBytes)}
            </span>
          )}
          {href && (
            <span className="ml-auto inline-flex items-center gap-0.5 text-zinc-500 group-hover:text-zinc-200 transition-colors">
              Open <ArrowRight className="h-2.5 w-2.5" />
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
  if (!href) return Inner;
  return <Link href={href}>{Inner}</Link>;
}

export function DeploymentGrid({
  deployments,
  siteSlug,
}: {
  deployments: Deployment[];
  siteSlug: string;
}) {
  if (deployments.length === 0) {
    return <EmptyResult message="No deployments returned." />;
  }
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {deployments.slice(0, 20).map((d) => (
        <DeploymentCard key={d.id} d={d} siteSlug={siteSlug} />
      ))}
      {deployments.length > 20 && (
        <div className="text-[10.5px] text-zinc-500 px-1">
          + {deployments.length - 20} more (ask the assistant to filter)
        </div>
      )}
    </div>
  );
}

export function SiteCard({ site }: { site: Site }) {
  const href = `/sites/${site.slug}`;
  return (
    <Link href={href}>
      <motion.div
        className={cn(cardBase, "flex items-center gap-2")}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.04] overflow-hidden">
          {site.countryCode ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://flagcdn.com/${site.countryCode.toLowerCase()}.svg`}
              alt={site.countryCode}
              className="h-full w-full object-cover"
            />
          ) : (
            <Globe className="h-3.5 w-3.5 text-zinc-300" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium text-zinc-100 truncate">{site.name}</div>
          <div className="text-[10.5px] text-zinc-500 truncate">{site.slug}</div>
        </div>
        {site.healthy != null && (
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              site.healthy ? "bg-emerald-400" : "bg-rose-400",
            )}
            title={site.healthy ? "healthy" : "unhealthy"}
          />
        )}
        <ArrowRight className="h-3 w-3 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
      </motion.div>
    </Link>
  );
}

export function SiteGrid({ sites }: { sites: Site[] }) {
  if (sites.length === 0) return <EmptyResult message="No accessible sites." />;
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {sites.map((s) => (
        <SiteCard key={s.slug} site={s} />
      ))}
    </div>
  );
}

export function NodeChip({
  node,
  metric,
  siteSlug,
}: {
  node: Node;
  metric?: NodeMetric;
  siteSlug?: string;
}) {
  const tone = node.status === "online" ? "bg-emerald-400" : "bg-rose-400";
  const body = (
    <motion.div
      className="rounded-md border border-white/[0.06] bg-white/[0.025] px-2.5 py-1.5 hover:bg-white/[0.04] hover:border-white/15 transition-colors"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", tone)} />
        <Server className="h-3 w-3 text-zinc-400" />
        <span className="text-[12px] font-medium text-zinc-200">{node.name}</span>
        {metric && (
          <>
            {metric.cpuRatio != null && (
              <span className="ml-auto text-[10.5px] text-zinc-500">
                CPU {fmtPct(metric.cpuRatio)}
              </span>
            )}
            {metric.memoryUsedBytes != null && metric.memoryTotalBytes != null && (
              <span className="text-[10.5px] text-zinc-500">
                mem {Math.round((metric.memoryUsedBytes / metric.memoryTotalBytes) * 100)}%
              </span>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
  if (!siteSlug) return body;
  return <Link href={`/sites/${siteSlug}/network`}>{body}</Link>;
}

export function NodeGrid({
  nodes,
  metrics,
  siteSlug,
}: {
  nodes: Node[];
  metrics?: NodeMetric[];
  siteSlug?: string;
}) {
  if (nodes.length === 0) return <EmptyResult message="No nodes." />;
  return (
    <div className="grid grid-cols-1 gap-1">
      {nodes.map((n) => (
        <NodeChip
          key={n.name}
          node={n}
          metric={metrics?.find((m) => m.node === n.name)}
          siteSlug={siteSlug}
        />
      ))}
    </div>
  );
}

export function ClusterOverviewView({
  data,
  siteSlug,
}: {
  data: ClusterOverview;
  siteSlug: string;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        <StatTile
          icon={<Server className="h-3 w-3" />}
          label="Nodes"
          value={String(data.nodes.length)}
        />
        <StatTile
          icon={<Box className="h-3 w-3" />}
          label="Running"
          value={String(data.runningCount)}
          tone="emerald"
        />
        <StatTile
          icon={<Box className="h-3 w-3" />}
          label="Stopped"
          value={String(data.stoppedCount)}
          tone="zinc"
        />
      </div>
      {data.clusterResources && (
        <div className="grid grid-cols-2 gap-1.5">
          <StatTile
            icon={<Cpu className="h-3 w-3" />}
            label="Cluster CPU"
            value={fmtPct(data.clusterResources.cpuRatio)}
          />
          <StatTile
            icon={<MemoryStick className="h-3 w-3" />}
            label="Cluster mem"
            value={`${fmtBytes(data.clusterResources.memoryUsedBytes)} / ${fmtBytes(
              data.clusterResources.memoryTotalBytes,
            )}`}
          />
        </div>
      )}
      <NodeGrid nodes={data.nodes} metrics={data.nodeMetrics} siteSlug={siteSlug} />
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "emerald" | "zinc";
}) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.025] px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] text-zinc-500">
        {icon} {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-[13px] font-medium tabular-nums",
          tone === "emerald" ? "text-emerald-300" : "text-zinc-100",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function OsTemplateGrid({ templates }: { templates: OsTemplate[] }) {
  if (templates.length === 0) return <EmptyResult message="No OS templates found." />;
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {templates.slice(0, 12).map((t) => (
        <motion.div
          key={t.id}
          className={cn(cardBase, "flex items-center gap-2")}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <FileBox className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-zinc-100 truncate">{t.name}</div>
            <div className="text-[10.5px] text-zinc-500 truncate">
              {t.node} · {t.storage} · {t.sizeLabel}
            </div>
          </div>
        </motion.div>
      ))}
      {templates.length > 12 && (
        <div className="text-[10.5px] text-zinc-500 px-1">
          + {templates.length - 12} more
        </div>
      )}
    </div>
  );
}

export function DeploymentTemplateGrid({
  templates,
  siteSlug,
}: {
  templates: DeploymentTemplate[];
  siteSlug: string;
}) {
  if (templates.length === 0)
    return <EmptyResult message="No deployment templates configured for this site." />;
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {templates.map((t) => {
        const href = siteSlug ? `/sites/${siteSlug}/templates` : null;
        const inner = (
          <motion.div
            className={cn(cardBase, "flex items-start gap-2")}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            <FileBox className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-zinc-100 truncate">{t.name}</div>
              {t.description && (
                <div className="text-[10.5px] text-zinc-500 line-clamp-2">{t.description}</div>
              )}
              <div className="text-[10px] text-zinc-600 mt-0.5 truncate">
                {t.cores} cores · {t.memory}MB · {t.rootfsSize}GB
              </div>
            </div>
            {href && <ArrowRight className="h-3 w-3 text-zinc-600" />}
          </motion.div>
        );
        return href ? (
          <Link key={t.id} href={href}>
            {inner}
          </Link>
        ) : (
          <div key={t.id}>{inner}</div>
        );
      })}
    </div>
  );
}

export function StoragePoolList({ pools }: { pools: StoragePool[] }) {
  if (pools.length === 0) return <EmptyResult message="No storage pools." />;
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {pools.slice(0, 12).map((p) => {
        const pct =
          p.usedBytes != null && p.totalBytes
            ? (p.usedBytes / p.totalBytes) * 100
            : null;
        return (
          <motion.div
            key={`${p.node}-${p.storage}`}
            className="rounded-md border border-white/[0.06] bg-white/[0.025] px-2.5 py-1.5"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-center gap-2">
              <HardDrive className="h-3 w-3 text-zinc-400 flex-shrink-0" />
              <span className="text-[12px] font-medium text-zinc-200 truncate">
                {p.storage}
              </span>
              <span className="text-[10px] text-zinc-500 flex-shrink-0">
                {p.node} · {p.type}
              </span>
              {pct != null && (
                <span
                  className={cn(
                    "ml-auto text-[10.5px] tabular-nums flex-shrink-0",
                    pct >= 90
                      ? "text-rose-300"
                      : pct >= 75
                        ? "text-amber-300"
                        : "text-zinc-400",
                  )}
                >
                  {Math.round(pct)}%
                </span>
              )}
            </div>
            {pct != null && (
              <div className="mt-1 h-1 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className={cn(
                    "h-full",
                    pct >= 90 ? "bg-rose-400" : pct >= 75 ? "bg-amber-400" : "bg-emerald-400",
                  )}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            )}
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {fmtBytes(p.usedBytes)} used · {fmtBytes(p.availableBytes)} free
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

export function IpPoolList({
  pools,
  siteSlug,
}: {
  pools: IpPool[];
  siteSlug: string;
}) {
  if (pools.length === 0) return <EmptyResult message="No IP pools configured for this site." />;
  const href = siteSlug ? `/sites/${siteSlug}/network` : null;
  return (
    <div className="space-y-1.5">
      {pools.map((p) => (
        <motion.div
          key={p.id}
          className={cn(cardBase, "flex items-center gap-2")}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <Network className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-zinc-100 truncate">{p.name}</div>
            <div className="text-[10.5px] text-zinc-500 truncate">
              {p.subnet} · gw {p.gateway} · {p.bridge}
            </div>
          </div>
          {typeof p.availableCount === "number" && (
            <span
              className={cn(
                "flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] border",
                p.availableCount > 0
                  ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
                  : "text-rose-300 bg-rose-500/10 border-rose-500/20",
              )}
            >
              {p.availableCount} free
              {typeof p.usableHostCount === "number" ? ` / ${p.usableHostCount}` : ""}
            </span>
          )}
        </motion.div>
      ))}
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[10.5px] text-zinc-500 hover:text-zinc-300 transition-colors px-1"
        >
          Manage IP pools <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      )}
    </div>
  );
}

export function AuditLogList({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <EmptyResult message="Audit log is empty." />;
  return (
    <div className="space-y-1">
      {entries.slice(0, 10).map((e) => (
        <motion.div
          key={e.id}
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="flex items-start gap-2">
            <ScrollText className="h-3 w-3 text-zinc-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-[11.5px] text-zinc-200">{e.message}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">
                {e.actorName} · {new Date(e.recordedAt).toLocaleString()}
              </div>
            </div>
            <span className="text-[9.5px] text-zinc-500 rounded bg-white/[0.04] px-1 py-0.5 flex-shrink-0">
              {e.action}
            </span>
          </div>
        </motion.div>
      ))}
      <Link
        href="/audit-log"
        className="inline-flex items-center gap-1 text-[10.5px] text-zinc-500 hover:text-zinc-300 transition-colors px-1"
      >
        Open audit log <ExternalLink className="h-2.5 w-2.5" />
      </Link>
    </div>
  );
}

function EmptyResult({ message }: { message: string }) {
  return <div className="text-[11.5px] text-zinc-500 italic px-1">{message}</div>;
}

// -- Service ports view -----------------------------------------------------

type PortResult = {
  open: boolean;
  port: number;
  service: string;
  url: string | null;
};

type ScanResult = {
  deployment: {
    id: string;
    vmid: number;
    name: string;
    node: string;
    type: string;
    status: string;
    ip: string;
  };
  ports: PortResult[];
};

// Pick an icon based on the service name (server-side may have set the real
// process name, or it falls back to the well-known port label).
function serviceIcon(service: string, port: number) {
  const s = service.toLowerCase();
  if (/grafana/.test(s)) return BarChart3;
  if (/prometheus|node[ -]?exporter/.test(s)) return LineChart;
  if (/postgres|mysql|mariadb|mongodb|redis|mssql/.test(s)) return Database;
  if (/ssh/.test(s)) return TerminalSquare;
  if (/mqtt|mosquitto|cedalo|rabbit|kafka|nats/.test(s)) return Radio;
  if (/smtp|imap|pop3|mail/.test(s)) return Mail;
  if (/dns|bind/.test(s)) return Globe;
  if (/ignition/.test(s)) return Workflow;
  if (/chat|discord|matrix|slack/.test(s)) return MessageSquare;
  if (/^http|web|nginx|caddy|apache|traefik/.test(s)) return Globe;
  // Port-based fallback
  if (port === 22) return TerminalSquare;
  if (port === 80 || port === 443 || port === 8080 || port === 8443) return Globe;
  if (port === 3306 || port === 5432 || port === 6379 || port === 27017) return Database;
  return Network;
}

function serviceTone(port: number): string {
  if (port === 22) return "border-violet-500/30 bg-violet-500/[0.08] text-violet-300";
  if (port === 443 || port === 8443) return "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300";
  if (port === 80 || port === 8080 || port === 8000 || port === 8888 || port === 3000 || port === 3030 || port === 9090)
    return "border-sky-500/30 bg-sky-500/[0.08] text-sky-300";
  if (port === 3306 || port === 5432 || port === 6379 || port === 27017 || port === 1433)
    return "border-amber-500/30 bg-amber-500/[0.08] text-amber-300";
  return "border-white/[0.08] bg-white/[0.04] text-zinc-300";
}

export function ServicePortsView({
  data,
  siteSlug,
}: {
  data: ScanResult;
  siteSlug: string;
}) {
  const d = data.deployment;
  const ports = data.ports.filter((p) => p.open);
  const deploymentHref = siteSlug ? `/sites/${siteSlug}/deployments/${d.id}` : null;
  return (
    <div className="space-y-2">
      <Link
        href={deploymentHref ?? "#"}
        className="group block rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 hover:border-white/15 hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.04]">
            <Activity className="h-3.5 w-3.5 text-zinc-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[12.5px] font-medium text-zinc-100 truncate">
                {d.name}
              </span>
              <span className="text-[10px] text-zinc-500">
                CT {d.vmid}
              </span>
            </div>
            <div className="text-[10.5px] text-zinc-500 truncate">
              {d.node} · {d.ip} · {ports.length} open port
              {ports.length === 1 ? "" : "s"}
            </div>
          </div>
          {deploymentHref && (
            <ArrowRight className="h-3 w-3 text-zinc-600 group-hover:text-zinc-200 transition-colors" />
          )}
        </div>
      </Link>

      {ports.length === 0 ? (
        <div className="text-[11.5px] text-zinc-500 italic px-1">
          No listening services detected on {d.ip}.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {ports.map((p) => (
            <ServicePortCard key={p.port} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ServicePortCard({ p }: { p: PortResult }) {
  const Icon = serviceIcon(p.service, p.port);
  const tone = serviceTone(p.port);
  const body = (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "group rounded-lg border px-2.5 py-2 transition-colors min-w-0",
        tone,
        p.url && "hover:brightness-110",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-zinc-100 truncate">
            {p.service}
          </div>
          <div className="text-[10.5px] text-zinc-400 tabular-nums">
            :{p.port}
          </div>
        </div>
        {p.url && (
          <ExternalLink className="h-3 w-3 text-zinc-400 group-hover:text-zinc-100 transition-colors flex-shrink-0" />
        )}
      </div>
    </motion.div>
  );

  if (!p.url) return body;
  return (
    <a href={p.url} target="_blank" rel="noreferrer noopener" className="block min-w-0">
      {body}
    </a>
  );
}

/**
 * Dispatch a tool-result object to the matching entity renderer. Falls back
 * to a collapsed JSON dump when the tool is unknown or the shape doesn't
 * match — the user can always inspect raw JSON via the expand-arrow.
 */
export function ToolResultView({
  name,
  args,
  result,
}: {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}) {
  const siteSlug = String((args.siteSlug as string | undefined) ?? "");

  if (!result || typeof result !== "object") {
    return <RawJson data={result} />;
  }

  // Error envelope from server
  if ("error" in (result as object)) {
    return (
      <div className="text-[11.5px] text-rose-300 bg-rose-500/[0.06] border border-rose-500/20 rounded-md px-2.5 py-1.5">
        {String((result as { error: unknown }).error)}
      </div>
    );
  }

  switch (name) {
    case "list_sites":
      return Array.isArray(result) ? (
        <SiteGrid sites={result as Site[]} />
      ) : (
        <RawJson data={result} />
      );
    case "list_nodes":
      return Array.isArray(result) ? (
        <NodeGrid nodes={result as Node[]} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "list_containers":
      return Array.isArray(result) ? (
        <DeploymentGrid deployments={result as Deployment[]} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "get_container":
      return (result as Deployment).id ? (
        <DeploymentCard d={result as Deployment} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "get_cluster_overview":
      return (result as ClusterOverview).nodes ? (
        <ClusterOverviewView data={result as ClusterOverview} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "list_templates":
      return Array.isArray(result) ? (
        <OsTemplateGrid templates={result as OsTemplate[]} />
      ) : (
        <RawJson data={result} />
      );
    case "list_deployment_templates":
      return Array.isArray(result) ? (
        <DeploymentTemplateGrid
          templates={result as DeploymentTemplate[]}
          siteSlug={siteSlug}
        />
      ) : (
        <RawJson data={result} />
      );
    case "list_storage_pools":
      return Array.isArray(result) ? (
        <StoragePoolList pools={result as StoragePool[]} />
      ) : (
        <RawJson data={result} />
      );
    case "list_ip_pools":
      return Array.isArray(result) ? (
        <IpPoolList pools={result as IpPool[]} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "get_audit_log":
      return Array.isArray(result) ? (
        <AuditLogList entries={result as AuditEntry[]} />
      ) : (
        <RawJson data={result} />
      );
    case "list_backups":
      return Array.isArray(result) ? (
        <BackupList archives={result as BackupArchive[]} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "list_tags":
      return Array.isArray(result) ? (
        <TagList tags={result as TagSummary[]} />
      ) : (
        <RawJson data={result} />
      );
    case "get_deployment_metrics":
      return (result as MetricsResult).cpuPercent ? (
        <MetricsCard data={result as MetricsResult} />
      ) : (
        <RawJson data={result} />
      );
    case "get_cve_report":
    case "run_cve_scan":
      return (result as CveReport).summary ? (
        <CveReportCard data={result as CveReport} />
      ) : (
        <RawJson data={result} />
      );
    case "run_diagnostics":
      return Array.isArray((result as DiagnosticsResult).issues) ? (
        <DiagnosticsCard data={result as DiagnosticsResult} />
      ) : (
        <RawJson data={result} />
      );
    case "get_alerts":
      return Array.isArray(result) ? (
        <AlertsCard alerts={result as AlertItem[]} />
      ) : (
        <RawJson data={result} />
      );
    case "get_heartbeat_status":
      return typeof (result as HeartbeatResult).allHealthy === "boolean" ? (
        <HeartbeatCard data={result as HeartbeatResult} />
      ) : (
        <RawJson data={result} />
      );
    case "get_network_path":
      return Array.isArray((result as NetworkPathResult).interfaces) ? (
        <NetworkPathCard data={result as NetworkPathResult} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "list_firewall_rules":
      return Array.isArray(result) ? (
        <FirewallRuleList rules={result as FirewallRule[]} />
      ) : (
        <RawJson data={result} />
      );
    case "add_firewall_rule":
    case "delete_firewall_rule":
    case "pull_docker_image":
    case "download_iso":
    case "create_vm_from_iso":
      return (result as SimpleResult).ok !== undefined ? (
        <SimpleResultCard result={result as SimpleResult} />
      ) : (
        <RawJson data={result} />
      );
    case "list_vm_templates":
      return Array.isArray(result) ? (
        <VmTemplateList templates={result as VmTemplateItem[]} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "list_users":
      return Array.isArray(result) ? (
        <UserList users={result as UserItem[]} />
      ) : (
        <RawJson data={result} />
      );
    case "list_groups":
      return Array.isArray(result) ? (
        <GroupList groups={result as GroupItem[]} />
      ) : (
        <RawJson data={result} />
      );
    case "take_config_snapshot":
      return (result as SimpleResult).ok !== undefined ? (
        <SimpleResultCard result={result as SimpleResult} />
      ) : (
        <RawJson data={result} />
      );
    case "start_deployment":
    case "stop_deployment":
    case "shutdown_deployment":
    case "restart_deployment":
    case "update_deployment_resources":
    case "update_container_env":
    case "change_deployment_ip":
    case "set_deployment_tags":
    case "create_backup":
    case "restore_backup":
    case "migrate_deployment":
    case "destroy_deployment":
    case "create_snapshot":
    case "rollback_snapshot":
    case "delete_snapshot":
      return (result as LifecycleResult).verb ? (
        <LifecycleResultCard result={result as LifecycleResult} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "launch_from_deployment_template":
      return (result as CreateResult).deployment ? (
        <CreateDeploymentCard result={result as CreateResult} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "launch_batch_from_deployment_template":
      return (result as BatchCreateResult).verb === "batch-create" ? (
        <BatchCreateCard result={result as BatchCreateResult} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "destroy_batch_deployments":
      return (result as BatchDestroyResult).verb === "batch-destroy" ? (
        <BatchDestroyCard result={result as BatchDestroyResult} />
      ) : (
        <RawJson data={result} />
      );
    case "list_snapshots":
      return Array.isArray((result as SnapshotListResult).snapshots) ? (
        <SnapshotListView data={result as SnapshotListResult} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "scan_deployment_ports":
      return (result as ScanResult).deployment ? (
        <ServicePortsView data={result as ScanResult} siteSlug={siteSlug} />
      ) : (
        <RawJson data={result} />
      );
    case "open_page": {
      const path = (result as { navigate?: unknown }).navigate;
      return typeof path === "string" ? (
        <Link
          href={path}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[11.5px] text-zinc-300 hover:text-white transition-colors"
        >
          <ExternalLink className="h-3 w-3 text-zinc-500" />
          Opened <code className="text-zinc-100">{path}</code>
        </Link>
      ) : (
        <RawJson data={result} />
      );
    }
    default:
      return <RawJson data={result} />;
  }
}

function RawJson({ data }: { data: unknown }) {
  return (
    <pre className="max-h-48 overflow-auto rounded bg-black/40 border border-white/[0.04] px-2 py-1.5 text-[10.5px] text-zinc-400">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// -- Lifecycle result card --------------------------------------------------

type LifecycleVerb =
  | "start"
  | "stop"
  | "shutdown"
  | "restart"
  | "update-resources"
  | "destroy"
  | "env-updated"
  | "change-ip"
  | "backup-create"
  | "backup-restore"
  | "migrate"
  | "snapshot-create"
  | "snapshot-rollback"
  | "snapshot-delete";

type LifecycleResult = {
  ok: boolean;
  verb: LifecycleVerb;
  message?: string;
  upid?: string;
  deployment?: Deployment | null;
  applied?:
    | { cores: number | null; memoryMb: number | null; swapMb: number | null }
    | Record<string, string | null>;
  snapshotName?: string;
};

const VERB_LABEL: Record<LifecycleVerb, string> = {
  start: "Starting",
  stop: "Stopping",
  shutdown: "Shutting down",
  restart: "Restarting",
  "update-resources": "Resources updated",
  destroy: "Destroying",
  "env-updated": "Env updated",
  "change-ip": "IP changed",
  "backup-create": "Backup started",
  "backup-restore": "Restoring backup",
  migrate: "Migrating",
  "snapshot-create": "Snapshot taken",
  "snapshot-rollback": "Rolling back",
  "snapshot-delete": "Snapshot deleted",
};

const VERB_TONE: Record<LifecycleVerb, string> = {
  start: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300",
  stop: "border-rose-500/30 bg-rose-500/[0.06] text-rose-300",
  shutdown: "border-amber-500/30 bg-amber-500/[0.06] text-amber-300",
  restart: "border-sky-500/30 bg-sky-500/[0.06] text-sky-300",
  "update-resources": "border-violet-500/30 bg-violet-500/[0.06] text-violet-300",
  destroy: "border-rose-500/40 bg-rose-500/[0.08] text-rose-300",
  "env-updated": "border-violet-500/30 bg-violet-500/[0.06] text-violet-300",
  "change-ip": "border-sky-500/30 bg-sky-500/[0.06] text-sky-300",
  "backup-create": "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300",
  "backup-restore": "border-rose-500/40 bg-rose-500/[0.08] text-rose-300",
  migrate: "border-sky-500/30 bg-sky-500/[0.06] text-sky-300",
  "snapshot-create": "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300",
  "snapshot-rollback": "border-rose-500/40 bg-rose-500/[0.08] text-rose-300",
  "snapshot-delete": "border-zinc-500/30 bg-zinc-500/[0.08] text-zinc-300",
};

function VerbIcon({ verb, className }: { verb: LifecycleVerb; className?: string }) {
  switch (verb) {
    case "start":
      return <Play className={className} />;
    case "stop":
    case "shutdown":
      return <Power className={className} />;
    case "restart":
      return <RotateCcw className={className} />;
    case "update-resources":
    case "env-updated":
      return <Settings2 className={className} />;
    case "change-ip":
      return <Network className={className} />;
    case "migrate":
      return <ArrowRight className={className} />;
    case "backup-create":
    case "backup-restore":
      return <Database className={className} />;
    case "destroy":
      return <Trash2 className={className} />;
    case "snapshot-create":
      return <Camera className={className} />;
    case "snapshot-rollback":
      return <Rewind className={className} />;
    case "snapshot-delete":
      return <Trash2 className={className} />;
  }
}

export function LifecycleResultCard({
  result,
  siteSlug,
}: {
  result: LifecycleResult;
  siteSlug: string;
}) {
  const verb = result.verb;
  const d = result.deployment ?? null;
  const isDestroy = verb === "destroy";
  // Verbs whose effect is immediate and complete (no UPID/task to track).
  const isFinal =
    verb === "update-resources" ||
    verb === "env-updated" ||
    verb === "change-ip" ||
    verb === "snapshot-delete";
  const tone = VERB_TONE[verb];
  const href = d && siteSlug && !isDestroy ? `/sites/${siteSlug}/deployments/${d.id}` : null;
  const appliedResources =
    verb === "update-resources" && result.applied && typeof result.applied === "object"
      ? (result.applied as { cores: number | null; memoryMb: number | null; swapMb: number | null })
      : null;
  const appliedEnv =
    verb === "env-updated" && result.applied && typeof result.applied === "object"
      ? (result.applied as Record<string, string | null>)
      : null;

  const headerInner = (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "rounded-lg border px-3 py-2.5",
        tone,
        isDestroy && "ring-1 ring-rose-500/20",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border",
            verb === "destroy" ? "border-rose-500/30 bg-rose-500/10" : "border-white/10 bg-white/[0.05]",
          )}
        >
          {isFinal ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
          ) : (
            <motion.span
              animate={verb === "destroy" ? {} : { rotate: 360 }}
              transition={{ duration: 2.4, ease: "linear", repeat: Infinity }}
              className="inline-flex"
            >
              <VerbIcon verb={verb} className="h-3.5 w-3.5" />
            </motion.span>
          )}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12.5px] font-medium text-zinc-100">
              {VERB_LABEL[verb]}
            </span>
            {d && (
              <span className="text-[11px] text-zinc-400 truncate">
                {d.name}{" "}
                <span className="text-zinc-600">
                  · {d.type === "qemu" ? "VM" : "CT"} {d.vmid}
                </span>
              </span>
            )}
          </div>
          {d && (
            <div className="text-[10.5px] text-zinc-500 truncate mt-0.5">
              {d.node}
              {d.ip && d.ip !== "Unavailable" ? ` · ${d.ip}` : ""}
            </div>
          )}
          {appliedResources && (
            <div className="text-[10.5px] text-zinc-400 mt-1 flex flex-wrap gap-1.5">
              {appliedResources.cores != null && (
                <ResourceChip label="cores" value={String(appliedResources.cores)} />
              )}
              {appliedResources.memoryMb != null && (
                <ResourceChip label="mem" value={`${appliedResources.memoryMb}MB`} />
              )}
              {appliedResources.swapMb != null && (
                <ResourceChip label="swap" value={`${appliedResources.swapMb}MB`} />
              )}
            </div>
          )}
          {appliedEnv && (
            <div className="text-[10.5px] text-zinc-400 mt-1 flex flex-wrap gap-1.5">
              {Object.entries(appliedEnv)
                .slice(0, 6)
                .map(([k, v]) => (
                  <ResourceChip
                    key={k}
                    label={k}
                    value={v === null ? "(deleted)" : v}
                  />
                ))}
              {Object.keys(appliedEnv).length > 6 && (
                <span className="text-[10px] text-zinc-500">
                  + {Object.keys(appliedEnv).length - 6} more
                </span>
              )}
            </div>
          )}
          {result.snapshotName && (
            <div className="text-[10.5px] text-zinc-400 mt-1">
              <span className="text-zinc-500">name: </span>
              <code className="text-zinc-100 bg-black/30 rounded px-1 py-px font-mono">
                {result.snapshotName}
              </code>
            </div>
          )}
          {result.message && !d && (
            <div className="text-[10.5px] text-zinc-400 mt-0.5">{result.message}</div>
          )}
          {result.upid && (
            <div className="text-[9.5px] text-zinc-600 mt-1 font-mono truncate" title={result.upid}>
              task: {result.upid}
            </div>
          )}
        </div>
        {href && (
          <span className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-zinc-300 group-hover:text-white flex-shrink-0 self-center">
            Open <ArrowRight className="h-2.5 w-2.5" />
          </span>
        )}
      </div>
    </motion.div>
  );

  return href ? (
    <Link href={href} className="group block">
      {headerInner}
    </Link>
  ) : (
    headerInner
  );
}

function ResourceChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded border border-white/[0.06] bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-200">
      <span className="text-zinc-500">{label}=</span>
      {value}
    </span>
  );
}

// -- Create deployment card (with one-time credentials reveal) --------------

type CreateResult = {
  ok: boolean;
  verb: "create";
  upid: string;
  message?: string;
  deployment: Deployment;
  credentials?: {
    type: "root-password";
    username: string;
    value: string;
    warning: string;
  };
  envApplied?: Record<string, string> | null;
  willAutoStart?: boolean;
};

export function CreateDeploymentCard({
  result,
  siteSlug,
}: {
  result: CreateResult;
  siteSlug: string;
}) {
  const d = result.deployment;
  const href = siteSlug ? `/sites/${siteSlug}/deployments/${d.id}` : null;
  return (
    <div className="space-y-2">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2.5"
      >
        <div className="flex items-start gap-2">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10">
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 2.4, ease: "linear", repeat: Infinity }}
              className="inline-flex"
            >
              <Plus className="h-3.5 w-3.5 text-emerald-300" />
            </motion.span>
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[12.5px] font-medium text-emerald-200">
                Launching new container
              </span>
              <span className="text-[11px] text-zinc-300 truncate">
                {d.name}{" "}
                <span className="text-zinc-500">
                  · {d.type === "qemu" ? "VM" : "CT"} {d.vmid}
                </span>
              </span>
            </div>
            <div className="text-[10.5px] text-zinc-500 truncate mt-0.5">
              {d.node}
              {result.willAutoStart === false ? " · won't auto-start" : " · auto-start enabled"}
            </div>
            {result.envApplied && Object.keys(result.envApplied).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries(result.envApplied).map(([k, v]) => (
                  <ResourceChip key={k} label={k} value={String(v)} />
                ))}
              </div>
            )}
            {result.upid && (
              <div className="text-[9.5px] text-zinc-600 mt-1 font-mono truncate" title={result.upid}>
                task: {result.upid}
              </div>
            )}
          </div>
          {href && (
            <Link
              href={href}
              className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-zinc-200 hover:text-white flex-shrink-0 self-center"
            >
              Open <ArrowRight className="h-2.5 w-2.5" />
            </Link>
          )}
        </div>
      </motion.div>

      {result.credentials && <CredentialsCard creds={result.credentials} />}
    </div>
  );
}

function CredentialsCard({
  creds,
}: {
  creds: NonNullable<CreateResult["credentials"]>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.08 }}
      className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/10">
          <KeyRound className="h-3.5 w-3.5 text-amber-300" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-amber-200">
            Root password — shown once
          </div>
          <div className="text-[10.5px] text-amber-200/70 mt-0.5">{creds.warning}</div>
          <div className="mt-2 flex items-center gap-1.5">
            <code className="flex-1 min-w-0 truncate rounded border border-amber-500/30 bg-black/40 px-2 py-1.5 text-[12px] font-mono text-zinc-100">
              {revealed ? creds.value : "•".repeat(Math.min(creds.value.length, 18))}
            </code>
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="rounded-md border border-amber-500/30 bg-amber-500/[0.08] p-1.5 text-amber-200 hover:bg-amber-500/[0.15] transition-colors"
              title={revealed ? "Hide" : "Reveal"}
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(creds.value);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-md border border-amber-500/30 bg-amber-500/[0.08] p-1.5 text-amber-200 hover:bg-amber-500/[0.15] transition-colors"
              title="Copy"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            <span className="text-zinc-400">user:</span> {creds.username}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// -- Backups ----------------------------------------------------------------

type BackupArchive = {
  volid: string;
  vmid: number;
  node: string;
  storage: string;
  createdAt: string;
  sizeBytes: number;
  format?: string;
  notes?: string;
};

function BackupList({ archives, siteSlug }: { archives: BackupArchive[]; siteSlug: string }) {
  if (archives.length === 0) return <EmptyResult message="No backups found." />;
  const href = siteSlug ? `/sites/${siteSlug}/backups` : null;
  return (
    <div className="space-y-1">
      {archives.slice(0, 15).map((a) => (
        <motion.div
          key={a.volid}
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="flex items-center gap-2">
            <Database className="h-3 w-3 text-zinc-500 flex-shrink-0" />
            <span className="text-[11.5px] text-zinc-200 flex-shrink-0">
              {a.vmid ? `CT/VM ${a.vmid}` : "guest"}
            </span>
            <span className="text-[10.5px] text-zinc-500 truncate flex-1 min-w-0">
              {a.storage} · {new Date(a.createdAt).toLocaleString()}
            </span>
            <span className="text-[10px] text-zinc-500 tabular-nums flex-shrink-0">
              {fmtBytes(a.sizeBytes)}
            </span>
          </div>
          {a.notes && <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{a.notes}</div>}
        </motion.div>
      ))}
      {archives.length > 15 && (
        <div className="text-[10.5px] text-zinc-500 px-1">+ {archives.length - 15} more</div>
      )}
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[10.5px] text-zinc-500 hover:text-zinc-300 transition-colors px-1"
        >
          Manage backups <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      )}
    </div>
  );
}

// -- Tags -------------------------------------------------------------------

type TagSummary = { slug: string; name: string; color?: string; memberCount: number };

function TagList({ tags }: { tags: TagSummary[] }) {
  if (tags.length === 0) return <EmptyResult message="No tags defined for this site." />;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span
          key={t.slug}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-zinc-200"
        >
          <span className="h-2 w-2 rounded-full bg-sky-400/70" />
          {t.name}
          <span className="text-[10px] text-zinc-500">{t.memberCount}</span>
        </span>
      ))}
    </div>
  );
}

// -- Metrics ----------------------------------------------------------------

type MetricStat = { avg: number; peak: number; series?: number[] };
type MetricsResult = {
  timeframe: string;
  points: number;
  cpuPercent: MetricStat;
  memPercent: MetricStat;
  netInKBps: MetricStat;
  netOutKBps: MetricStat;
  issue?: string | null;
};

function Sparkline({ series, tone }: { series: number[]; tone: string }) {
  if (!series || series.length < 2) return null;
  const max = Math.max(...series, 1);
  const w = 120;
  const h = 22;
  const step = w / (series.length - 1);
  const pts = series
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="flex-shrink-0" viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={tone} strokeWidth="1.5" />
    </svg>
  );
}

function MetricsRow({
  label,
  stat,
  unit,
  tone,
}: {
  label: string;
  stat: MetricStat;
  unit: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[11px] text-zinc-400 w-10 flex-shrink-0">{label}</span>
      {stat.series && stat.series.length > 1 ? (
        <Sparkline series={stat.series} tone={tone} />
      ) : (
        <span className="flex-1" />
      )}
      <span className="ml-auto text-[10.5px] text-zinc-500 tabular-nums flex-shrink-0">
        avg <span className="text-zinc-300">{stat.avg}{unit}</span> · peak{" "}
        <span className="text-zinc-300">{stat.peak}{unit}</span>
      </span>
    </div>
  );
}

function MetricsCard({ data }: { data: MetricsResult }) {
  if (data.issue && data.points === 0) {
    return <EmptyResult message={`No metrics available — ${data.issue}`} />;
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2"
    >
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 mb-1">
        <LineChart className="h-3 w-3" /> Trend · last {data.timeframe}
      </div>
      <div className="divide-y divide-white/[0.04]">
        <MetricsRow label="CPU" stat={data.cpuPercent} unit="%" tone="#38bdf8" />
        <MetricsRow label="Mem" stat={data.memPercent} unit="%" tone="#a78bfa" />
        <MetricsRow label="Net in" stat={data.netInKBps} unit="" tone="#34d399" />
        <MetricsRow label="Net out" stat={data.netOutKBps} unit="" tone="#fbbf24" />
      </div>
    </motion.div>
  );
}

// -- CVE report -------------------------------------------------------------

type CveReport = {
  scannedAt: string;
  summary: {
    nodesScanned: number;
    guestsScanned: number;
    totalCves: number;
    totalSecurityUpdates: number;
  };
  nodes: Array<{ node: string; cveCount: number; securityUpdates: number | null; error: string | null }>;
  guests: Array<{ vmid: number; name: string; cveCount: number; error: string | null }>;
};

function CveReportCard({ data }: { data: CveReport }) {
  const clean = data.summary.totalCves === 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "rounded-lg border px-3 py-2",
        clean
          ? "border-emerald-500/25 bg-emerald-500/[0.05]"
          : "border-amber-500/25 bg-amber-500/[0.05]",
      )}
    >
      <div className="flex items-center gap-2 text-[12px] font-medium">
        <ShieldIcon clean={clean} />
        <span className={clean ? "text-emerald-200" : "text-amber-200"}>
          {clean
            ? "No known CVEs"
            : `${data.summary.totalCves} CVEs · ${data.summary.totalSecurityUpdates} security updates`}
        </span>
        <span className="ml-auto text-[10px] text-zinc-500">
          {data.summary.nodesScanned}n · {data.summary.guestsScanned}g
        </span>
      </div>
      {data.guests.filter((g) => g.cveCount > 0 || g.error).slice(0, 8).map((g) => (
        <div key={g.vmid} className="mt-1 flex items-center gap-2 text-[11px]">
          <span className="text-zinc-300 truncate flex-1 min-w-0">
            {g.name} <span className="text-zinc-600">CT/VM {g.vmid}</span>
          </span>
          {g.error ? (
            <span className="text-rose-300/80 text-[10px]">{g.error}</span>
          ) : (
            <span className="text-amber-300 tabular-nums text-[10px]">{g.cveCount} CVE</span>
          )}
        </div>
      ))}
      <div className="mt-1 text-[10px] text-zinc-500">
        Scanned {new Date(data.scannedAt).toLocaleString()}
      </div>
    </motion.div>
  );
}

function ShieldIcon({ clean }: { clean: boolean }) {
  return (
    <span
      className={cn(
        "flex h-4 w-4 items-center justify-center flex-shrink-0",
        clean ? "text-emerald-300" : "text-amber-300",
      )}
    >
      <Activity className="h-3.5 w-3.5" />
    </span>
  );
}

// -- Diagnostics ------------------------------------------------------------

type DiagnosticsResult = {
  scannedAt: string;
  issueCount: number;
  bySeverity: Record<string, number>;
  issues: Array<{
    severity: string;
    category: string;
    title: string;
    description: string;
    resource: string;
  }>;
};

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-rose-300 bg-rose-500/10 border-rose-500/20",
  warning: "text-amber-300 bg-amber-500/10 border-amber-500/20",
  info: "text-sky-300 bg-sky-500/10 border-sky-500/20",
};

function DiagnosticsCard({ data }: { data: DiagnosticsResult }) {
  if (data.issueCount === 0) {
    return <EmptyResult message="No issues found — site looks healthy." />;
  }
  return (
    <div className="space-y-1">
      {data.issues.slice(0, 12).map((i, idx) => (
        <motion.div
          key={`${i.category}-${idx}`}
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, delay: idx * 0.01 }}
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-1 py-0.5 text-[9px] border uppercase tracking-wide flex-shrink-0",
                SEVERITY_TONE[i.severity] ?? SEVERITY_TONE.info,
              )}
            >
              {i.severity}
            </span>
            <span className="text-[11.5px] text-zinc-200 truncate flex-1 min-w-0">{i.title}</span>
            <span className="text-[10px] text-zinc-500 flex-shrink-0">{i.resource}</span>
          </div>
          {i.description && (
            <div className="text-[10.5px] text-zinc-500 mt-0.5">{i.description}</div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

// -- Alerts / heartbeat -----------------------------------------------------

type AlertItem = {
  title: string;
  severity: string;
  category: string;
  subject: string;
  message: string;
  policy: string | null;
};

function AlertRow({ a }: { a: AlertItem }) {
  return (
    <motion.div
      className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded px-1 py-0.5 text-[9px] border uppercase flex-shrink-0",
            SEVERITY_TONE[a.severity] ?? SEVERITY_TONE.info,
          )}
        >
          {a.severity}
        </span>
        <span className="text-[11.5px] text-zinc-200 truncate flex-1 min-w-0">{a.title}</span>
        <span className="text-[10px] text-zinc-500 flex-shrink-0">{a.subject}</span>
      </div>
      {a.message && <div className="text-[10.5px] text-zinc-500 mt-0.5 truncate">{a.message}</div>}
    </motion.div>
  );
}

function AlertsCard({ alerts }: { alerts: AlertItem[] }) {
  if (alerts.length === 0) return <EmptyResult message="No active alerts. All quiet." />;
  return (
    <div className="space-y-1">
      {alerts.slice(0, 12).map((a, i) => (
        <AlertRow key={i} a={a} />
      ))}
    </div>
  );
}

type HeartbeatResult = { allHealthy: boolean; activeCount: number; alerts: AlertItem[] };

function HeartbeatCard({ data }: { data: HeartbeatResult }) {
  if (data.allHealthy) {
    return <EmptyResult message="All monitored endpoints are reachable." />;
  }
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-rose-200 px-1">
        {data.activeCount} connectivity issue{data.activeCount === 1 ? "" : "s"}
      </div>
      {data.alerts.slice(0, 10).map((a, i) => (
        <AlertRow key={i} a={a} />
      ))}
    </div>
  );
}

// -- Network path -----------------------------------------------------------

type NetworkPathResult = {
  node: string;
  agentHost: string | null;
  lldpObserved: boolean;
  interfaces: Array<{
    netKey: string;
    bridge: string | null;
    vlan: number | null;
    uplinks: Array<{
      nic: string;
      upstreamDevice: string | null;
      upstreamPort: string | null;
      chassisId: string | null;
      vlan: number | null;
    }>;
  }>;
};

function NetworkPathCard({ data, siteSlug }: { data: NetworkPathResult; siteSlug: string }) {
  if (data.interfaces.length === 0) {
    return <EmptyResult message="No network interfaces to trace." />;
  }
  return (
    <div className="space-y-1.5">
      {data.interfaces.map((iface) => (
        <div
          key={iface.netKey}
          className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2"
        >
          <div className="flex items-center gap-1.5 text-[11.5px] text-zinc-200 flex-wrap">
            <span className="font-medium">{iface.netKey}</span>
            <ArrowRight className="h-3 w-3 text-zinc-600" />
            <span className="text-zinc-400">{iface.bridge ?? "?"}</span>
            {iface.vlan != null && (
              <span className="text-[10px] text-zinc-500">VLAN {iface.vlan}</span>
            )}
          </div>
          {iface.uplinks.map((u, i) => {
            const chassisHref =
              siteSlug && u.chassisId
                ? `/sites/${siteSlug}/network/devices/${encodeURIComponent(u.chassisId)}`
                : null;
            return (
              <div
                key={i}
                className="mt-1 flex items-center gap-1.5 text-[10.5px] text-zinc-500 flex-wrap pl-2"
              >
                <Network className="h-3 w-3 flex-shrink-0" />
                <span className="text-zinc-400">{u.nic}</span>
                {u.upstreamDevice ? (
                  <>
                    <ArrowRight className="h-2.5 w-2.5" />
                    {chassisHref ? (
                      <Link href={chassisHref} className="text-sky-300 hover:text-sky-200">
                        {u.upstreamDevice}
                      </Link>
                    ) : (
                      <span className="text-sky-300">{u.upstreamDevice}</span>
                    )}
                    {u.upstreamPort && <span className="text-zinc-500">port {u.upstreamPort}</span>}
                    {u.vlan != null && <span className="text-zinc-600">VLAN {u.vlan}</span>}
                  </>
                ) : (
                  <span className="text-zinc-600">— no LLDP neighbour observed</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// -- Users & groups ---------------------------------------------------------

type UserItem = {
  name: string;
  email: string;
  role: string;
  hasTwoFactor: boolean;
  groupCount: number;
  activeSessions: number;
  lastSeenAt: string | null;
};

function UserList({ users }: { users: UserItem[] }) {
  if (users.length === 0) return <EmptyResult message="No users." />;
  return (
    <div className="space-y-1">
      {users.map((u) => (
        <div
          key={u.email}
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 flex items-center gap-2"
        >
          <div className="flex-1 min-w-0">
            <div className="text-[11.5px] text-zinc-200 truncate">
              {u.name} <span className="text-zinc-600">{u.email}</span>
            </div>
            <div className="text-[10px] text-zinc-500">
              {u.role} · {u.groupCount} group{u.groupCount === 1 ? "" : "s"} ·{" "}
              {u.lastSeenAt ? `seen ${new Date(u.lastSeenAt).toLocaleDateString()}` : "never seen"}
            </div>
          </div>
          <span
            className={cn(
              "text-[9px] rounded px-1 py-0.5 border flex-shrink-0",
              u.hasTwoFactor
                ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
                : "text-amber-300 bg-amber-500/10 border-amber-500/20",
            )}
          >
            {u.hasTwoFactor ? "2FA" : "no 2FA"}
          </span>
        </div>
      ))}
    </div>
  );
}

type GroupItem = {
  name: string;
  isAdmin: boolean;
  globalPermissions: string[];
  siteAccessCount: number;
};

function GroupList({ groups }: { groups: GroupItem[] }) {
  if (groups.length === 0) return <EmptyResult message="No groups defined." />;
  return (
    <div className="space-y-1">
      {groups.map((g) => (
        <div
          key={g.name}
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 flex items-center gap-2"
        >
          <span className="text-[11.5px] text-zinc-200 truncate flex-1 min-w-0">{g.name}</span>
          {g.isAdmin && (
            <span className="text-[9px] text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded px-1 py-0.5 flex-shrink-0">
              admin
            </span>
          )}
          <span className="text-[10px] text-zinc-500 flex-shrink-0">
            {g.globalPermissions.length} perms · {g.siteAccessCount} sites
          </span>
        </div>
      ))}
    </div>
  );
}

// -- Firewall / simple results / VM templates -------------------------------

type FirewallRule = {
  pos: number;
  type: string | null;
  action: string | null;
  proto: string | null;
  dport: string | null;
  source: string | null;
  dest: string | null;
  enable: number | null;
  comment: string | null;
};

function FirewallRuleList({ rules }: { rules: FirewallRule[] }) {
  if (rules.length === 0) return <EmptyResult message="No cluster firewall rules set." />;
  return (
    <div className="space-y-1">
      {rules.map((r) => (
        <div
          key={r.pos}
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 flex items-center gap-2 text-[11px]"
        >
          <span className="text-zinc-600 tabular-nums flex-shrink-0">#{r.pos}</span>
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[9.5px] border flex-shrink-0",
              r.action === "ACCEPT"
                ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
                : "text-rose-300 bg-rose-500/10 border-rose-500/20",
            )}
          >
            {r.type} {r.action}
          </span>
          <span className="text-zinc-300 truncate flex-1 min-w-0">
            {[r.proto, r.dport ? `:${r.dport}` : "", r.source ? `from ${r.source}` : ""]
              .filter(Boolean)
              .join(" ") || "any"}
          </span>
          {r.enable === 0 && <span className="text-[9px] text-zinc-600 flex-shrink-0">disabled</span>}
        </div>
      ))}
    </div>
  );
}

type SimpleResult = { ok: boolean; message?: string };

function SimpleResultCard({ result }: { result: SimpleResult }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "rounded-lg border px-3 py-2 flex items-center gap-2 text-[12px]",
        result.ok
          ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200"
          : "border-rose-500/30 bg-rose-500/[0.06] text-rose-200",
      )}
    >
      <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
      {result.message ?? (result.ok ? "Done." : "Failed.")}
    </motion.div>
  );
}

type VmTemplateItem = {
  id: string;
  name: string;
  description: string;
  cores: string;
  memory: string;
  diskSize: string;
  bridge: string;
  node: string;
  cloudInitCapable: boolean;
};

function VmTemplateList({ templates, siteSlug }: { templates: VmTemplateItem[]; siteSlug: string }) {
  if (templates.length === 0) return <EmptyResult message="No VM templates configured." />;
  const href = siteSlug ? `/sites/${siteSlug}/deployments/create-vm-from-template` : null;
  return (
    <div className="space-y-1.5">
      {templates.map((t) => (
        <div
          key={t.id}
          className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
            <span className="text-[12px] font-medium text-zinc-100 truncate flex-1 min-w-0">
              {t.name}
            </span>
            {t.cloudInitCapable && (
              <span className="text-[9px] text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded px-1 py-0.5 flex-shrink-0">
                cloud-init
              </span>
            )}
          </div>
          <div className="text-[10.5px] text-zinc-500 mt-0.5">
            {t.cores} cores · {t.memory} · {t.diskSize} · {t.bridge} · {t.node}
          </div>
        </div>
      ))}
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[10.5px] text-zinc-500 hover:text-zinc-300 transition-colors px-1"
        >
          Create a VM <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      )}
    </div>
  );
}

// -- Batch destroy ----------------------------------------------------------

type BatchDestroyResult = {
  verb: "batch-destroy";
  destroyedCount: number;
  failedCount: number;
  destroyed: Array<{ name: string; vmid: number }>;
  failed: Array<{ name: string; vmid: number; error: string }>;
  message?: string;
};

function BatchDestroyCard({ result }: { result: BatchDestroyResult }) {
  return (
    <div className="space-y-2">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="rounded-lg border border-rose-500/30 bg-rose-500/[0.07] overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-rose-500/20">
          <Trash2 className="h-3.5 w-3.5 text-rose-300 flex-shrink-0" />
          <span className="text-[12.5px] font-medium text-rose-200">
            Destroyed {result.destroyedCount} deployment{result.destroyedCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="max-h-56 overflow-y-auto divide-y divide-white/[0.04]">
          {result.destroyed.map((d) => (
            <div key={d.vmid} className="flex items-center gap-2 px-3 py-1 text-[11.5px]">
              <span className="text-zinc-200 truncate flex-1 min-w-0">{d.name}</span>
              <span className="text-zinc-500 tabular-nums flex-shrink-0">CT/VM {d.vmid}</span>
            </div>
          ))}
        </div>
      </motion.div>
      {result.failed.length > 0 && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 space-y-1">
          <div className="text-[11.5px] font-medium text-amber-200">
            {result.failed.length} not destroyed
          </div>
          {result.failed.map((f) => (
            <div key={f.vmid} className="text-[10.5px] text-amber-200/80">
              <span className="font-medium">{f.name}</span> (CT/VM {f.vmid}) — {f.error}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -- Batch create -----------------------------------------------------------

type BatchCreatedItem = {
  hostname: string;
  vmid: number;
  node: string;
  ip: string;
  deploymentId: string;
  password: string;
};

type BatchCreateResult = {
  ok: boolean;
  verb: "batch-create";
  mode: "static" | "dhcp";
  poolName: string | null;
  template: string;
  node: string;
  createdCount: number;
  failedCount: number;
  created: BatchCreatedItem[];
  failed: Array<{ hostname: string; error: string }>;
  willAutoStart?: boolean;
  message?: string;
};

function BatchCreateCard({
  result,
  siteSlug,
}: {
  result: BatchCreateResult;
  siteSlug: string;
}) {
  return (
    <div className="space-y-2">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-500/20">
          <Plus className="h-3.5 w-3.5 text-emerald-300 flex-shrink-0" />
          <span className="text-[12.5px] font-medium text-emerald-200">
            Launching {result.createdCount} container{result.createdCount === 1 ? "" : "s"}
          </span>
          <span className="text-[10.5px] text-zinc-400 truncate">
            from &ldquo;{result.template}&rdquo; on {result.node}
          </span>
          <span className="ml-auto flex-shrink-0 text-[10px] text-zinc-500">
            {result.mode === "static" ? `static · ${result.poolName ?? "pool"}` : "DHCP"}
          </span>
        </div>
        <div className="max-h-64 overflow-y-auto divide-y divide-white/[0.04]">
          {result.created.map((item) => (
            <BatchCreatedRow key={item.deploymentId} item={item} siteSlug={siteSlug} />
          ))}
        </div>
      </motion.div>

      {result.failed.length > 0 && (
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 space-y-1">
          <div className="text-[11.5px] font-medium text-rose-200">
            {result.failed.length} failed
          </div>
          {result.failed.map((f) => (
            <div key={f.hostname} className="text-[10.5px] text-rose-200/80">
              <span className="font-medium">{f.hostname}</span> — {f.error}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-md border border-amber-500/25 bg-amber-500/[0.05] px-2.5 py-1.5 text-[10.5px] text-amber-200/80">
        Each root password is shown once — reveal and store them now.
      </div>
    </div>
  );
}

function BatchCreatedRow({
  item,
  siteSlug,
}: {
  item: BatchCreatedItem;
  siteSlug: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const href = siteSlug ? `/sites/${siteSlug}/deployments/${item.deploymentId}` : null;
  return (
    <div className="px-3 py-1.5">
      <div className="flex items-center gap-2 text-[11.5px]">
        <span className="font-medium text-zinc-100 truncate flex-1 min-w-0">{item.hostname}</span>
        <span className="text-zinc-500 tabular-nums flex-shrink-0">CT {item.vmid}</span>
        <span
          className={cn(
            "tabular-nums flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] border",
            item.ip === "DHCP"
              ? "text-zinc-400 bg-white/[0.03] border-white/[0.06]"
              : "text-sky-300 bg-sky-500/10 border-sky-500/20",
          )}
        >
          {item.ip}
        </span>
        {href && (
          <Link
            href={href}
            className="text-zinc-400 hover:text-white flex-shrink-0"
            title="Open"
          >
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <code className="flex-1 min-w-0 truncate rounded border border-white/[0.08] bg-black/40 px-2 py-1 text-[11px] font-mono text-zinc-200">
          {revealed ? item.password : "•".repeat(18)}
        </code>
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="rounded border border-white/[0.08] bg-white/[0.03] p-1 text-zinc-300 hover:bg-white/[0.08] transition-colors"
          title={revealed ? "Hide" : "Reveal"}
        >
          {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(item.password);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded border border-white/[0.08] bg-white/[0.03] p-1 text-zinc-300 hover:bg-white/[0.08] transition-colors"
          title="Copy password"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}

// -- Snapshot list ----------------------------------------------------------

type Snapshot = {
  name: string;
  parent: string | null;
  createdAt: string | null;
  description: string;
  hasVmState: boolean;
};

type SnapshotListResult = {
  deployment: Deployment | null;
  snapshots: Snapshot[];
};

export function SnapshotListView({
  data,
  siteSlug,
}: {
  data: SnapshotListResult;
  siteSlug: string;
}) {
  const d = data.deployment;
  const href = d && siteSlug ? `/sites/${siteSlug}/deployments/${d.id}` : null;
  return (
    <div className="space-y-2">
      {d && (
        <Link
          href={href ?? "#"}
          className="group block rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 hover:border-white/15 hover:bg-white/[0.04] transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.04]">
              <History className="h-3.5 w-3.5 text-zinc-300" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium text-zinc-100 truncate">
                {d.name}{" "}
                <span className="text-zinc-500 text-[10px]">
                  · {d.type === "qemu" ? "VM" : "CT"} {d.vmid}
                </span>
              </div>
              <div className="text-[10.5px] text-zinc-500 truncate">
                {data.snapshots.length} snapshot{data.snapshots.length === 1 ? "" : "s"}
              </div>
            </div>
            {href && (
              <ArrowRight className="h-3 w-3 text-zinc-600 group-hover:text-zinc-200 transition-colors" />
            )}
          </div>
        </Link>
      )}
      {data.snapshots.length === 0 ? (
        <EmptyResult message="No snapshots yet — take one with create_snapshot." />
      ) : (
        <div className="space-y-1">
          {data.snapshots.map((s) => (
            <motion.div
              key={s.name}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
            >
              <div className="flex items-start gap-2">
                <Camera className="h-3 w-3 text-zinc-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <code className="text-[11.5px] text-zinc-100 font-mono">{s.name}</code>
                    {s.hasVmState && (
                      <span className="rounded bg-sky-500/15 border border-sky-500/20 text-sky-300 text-[9.5px] px-1 py-px">
                        with RAM
                      </span>
                    )}
                  </div>
                  {s.description && (
                    <div className="text-[10.5px] text-zinc-400 mt-0.5">
                      {s.description}
                    </div>
                  )}
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    {s.createdAt ? new Date(s.createdAt).toLocaleString() : "—"}
                    {s.parent ? ` · parent: ${s.parent}` : ""}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
