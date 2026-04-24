"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, MoreVertical, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveDeployment, LiveNode, LiveTemplate } from "@/lib/proxmox";
import type { DeploymentTemplate } from "@/lib/deployment-templates";
import type { AlertRuntimeEntry } from "@/lib/alert-runtime-state";

type Tab = "deployments" | "templates" | "nodes" | "alerts";

interface DashboardTabsProps {
  siteSlug: string;
  deployments: LiveDeployment[];
  templates: DeploymentTemplate[];
  nodes: LiveNode[];
  activeAlerts: AlertRuntimeEntry[];
}

export function DashboardTabs({
  siteSlug,
  deployments,
  templates,
  nodes,
  activeAlerts,
}: DashboardTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("deployments");

  const tabs: { key: Tab; label: string; count: number; alert?: boolean }[] = [
    { key: "deployments", label: "Deployments", count: deployments.length },
    { key: "templates", label: "Templates", count: templates.length },
    { key: "nodes", label: "Nodes", count: nodes.length },
    { key: "alerts", label: "Alerts", count: activeAlerts.length, alert: activeAlerts.length > 0 },
  ];

  return (
    <div className="pt-2">
      <div className="flex flex-wrap items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full bg-white/5 border border-white/5 p-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                  activeTab === tab.key
                    ? "bg-white/10 text-white"
                    : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span
                    className={cn(
                      "ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]",
                      tab.alert
                        ? "bg-rose-500/20 text-rose-400"
                        : "bg-white/10 text-zinc-300",
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "deployments" && (
            <>
              <Link
                href={`/sites/${siteSlug}/deployments`}
                className="flex items-center gap-2 rounded-md border border-white/10 bg-[#111113] px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-white/5"
              >
                <MoreVertical className="h-3 w-3" />
                Manage Deployments
              </Link>
              <Link
                href={`/sites/${siteSlug}/deployments/create-container`}
                className="flex items-center gap-2 rounded-md border border-white/10 bg-[#111113] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-white/5"
              >
                + New Container
              </Link>
            </>
          )}
          {activeTab === "templates" && (
            <Link
              href={`/sites/${siteSlug}/templates`}
              className="flex items-center gap-2 rounded-md border border-white/10 bg-[#111113] px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-white/5"
            >
              <MoreVertical className="h-3 w-3" />
              Manage Templates
            </Link>
          )}
          {activeTab === "alerts" && (
            <Link
              href={`/sites/${siteSlug}/alerts`}
              className="flex items-center gap-2 rounded-md border border-white/10 bg-[#111113] px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-white/5"
            >
              View All Alerts
            </Link>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/5 bg-[#111113]">
        {activeTab === "deployments" && (
          <DeploymentsTable deployments={deployments} siteSlug={siteSlug} />
        )}
        {activeTab === "templates" && (
          <TemplatesTable templates={templates} siteSlug={siteSlug} />
        )}
        {activeTab === "nodes" && (
          <NodesTable nodes={nodes} />
        )}
        {activeTab === "alerts" && (
          <AlertsTable alerts={activeAlerts} siteSlug={siteSlug} />
        )}
      </div>
    </div>
  );
}

function DeploymentsTable({ deployments, siteSlug }: { deployments: LiveDeployment[]; siteSlug: string }) {
  if (deployments.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[13px] text-zinc-500">
        No deployments are currently visible with this token.
      </div>
    );
  }

  return (
    <table className="w-full text-left text-[13px]">
      <thead>
        <tr className="border-b border-white/5 bg-black/40">
          <th className="px-4 py-3 font-medium text-zinc-400 w-10"></th>
          <th className="px-4 py-3 font-medium text-zinc-400 w-10">VMID</th>
          <th className="px-4 py-3 font-medium text-zinc-400">Name</th>
          <th className="px-4 py-3 font-medium text-zinc-400">Node</th>
          <th className="px-4 py-3 font-medium text-zinc-400">Status</th>
          <th className="px-4 py-3 font-medium text-zinc-400 text-right">Uptime</th>
          <th className="px-4 py-3 font-medium text-zinc-400 w-10"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {deployments.slice(0, 10).map((d) => (
          <tr key={d.id} className="hover:bg-white/5 transition-colors group">
            <td className="px-4 py-3 text-zinc-600"><MoreVertical className="h-3.5 w-3.5" /></td>
            <td className="px-4 py-3 text-zinc-500 font-mono text-[11px]">{d.vmid}</td>
            <td className="px-4 py-3 font-medium text-zinc-200">
              <Link href={`/sites/${siteSlug}/deployments/${d.id}`} className="hover:underline">{d.name}</Link>
            </td>
            <td className="px-4 py-3">
              <span className="rounded-md border border-white/10 bg-black/50 px-2 py-0.5 text-[11px] text-zinc-400">{d.node}</span>
            </td>
            <td className="px-4 py-3">
              <StatusBadge status={d.rawStatus} label={d.statusLabel} />
            </td>
            <td className="px-4 py-3 text-right text-zinc-300 text-[12px]">{d.uptime || "—"}</td>
            <td className="px-4 py-3 text-zinc-600 opacity-0 group-hover:opacity-100">
              <Link href={`/sites/${siteSlug}/deployments/${d.id}`}><ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TemplatesTable({ templates, siteSlug }: { templates: DeploymentTemplate[]; siteSlug: string }) {
  if (templates.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[13px] text-zinc-500">
        No deployment templates defined yet.
      </div>
    );
  }

  return (
    <table className="w-full text-left text-[13px]">
      <thead>
        <tr className="border-b border-white/5 bg-black/40">
          <th className="px-4 py-3 font-medium text-zinc-400">Name</th>
          <th className="px-4 py-3 font-medium text-zinc-400">Node</th>
          <th className="px-4 py-3 font-medium text-zinc-400">Source</th>
          <th className="px-4 py-3 font-medium text-zinc-400 text-right">Created</th>
          <th className="px-4 py-3 font-medium text-zinc-400 w-10"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {templates.map((t) => (
          <tr key={t.id} className="hover:bg-white/5 transition-colors group">
            <td className="px-4 py-3 font-medium text-zinc-200">{t.name}</td>
            <td className="px-4 py-3">
              <span className="rounded-md border border-white/10 bg-black/50 px-2 py-0.5 text-[11px] text-zinc-400">{t.node}</span>
            </td>
            <td className="px-4 py-3 text-zinc-400 text-[12px]">{t.sourceName || t.sourceFileName || "—"}</td>
            <td className="px-4 py-3 text-right text-zinc-400 text-[12px]">
              {new Date(t.createdAt).toLocaleDateString()}
            </td>
            <td className="px-4 py-3 text-zinc-600 opacity-0 group-hover:opacity-100">
              <ArrowUpRight className="h-3.5 w-3.5" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NodesTable({ nodes }: { nodes: LiveNode[] }) {
  if (nodes.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[13px] text-zinc-500">
        No nodes available.
      </div>
    );
  }

  return (
    <table className="w-full text-left text-[13px]">
      <thead>
        <tr className="border-b border-white/5 bg-black/40">
          <th className="px-4 py-3 font-medium text-zinc-400">Name</th>
          <th className="px-4 py-3 font-medium text-zinc-400">Status</th>
          <th className="px-4 py-3 font-medium text-zinc-400">Fingerprint</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {nodes.map((n) => (
          <tr key={n.name} className="hover:bg-white/5 transition-colors">
            <td className="px-4 py-3 font-medium text-zinc-200">{n.name}</td>
            <td className="px-4 py-3">
              <StatusBadge status={n.status === "online" ? "running" : "stopped"} label={n.status} />
            </td>
            <td className="px-4 py-3 text-zinc-500 font-mono text-[11px] truncate max-w-[200px]">
              {n.fingerprint || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AlertsTable({ alerts, siteSlug }: { alerts: AlertRuntimeEntry[]; siteSlug: string }) {
  if (alerts.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[13px] text-zinc-500">
        No active alerts.
      </div>
    );
  }

  return (
    <table className="w-full text-left text-[13px]">
      <thead>
        <tr className="border-b border-white/5 bg-black/40">
          <th className="px-4 py-3 font-medium text-zinc-400 w-8"></th>
          <th className="px-4 py-3 font-medium text-zinc-400">Alert</th>
          <th className="px-4 py-3 font-medium text-zinc-400">Subject</th>
          <th className="px-4 py-3 font-medium text-zinc-400 text-right">Since</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {alerts.map((a) => (
          <tr key={a.key} className="hover:bg-white/5 transition-colors">
            <td className="px-4 py-3 text-rose-400"><AlertTriangle className="h-3.5 w-3.5" /></td>
            <td className="px-4 py-3 font-medium text-zinc-200">
              <Link href={`/sites/${siteSlug}/alerts`} className="hover:underline">
                {a.title}
              </Link>
            </td>
            <td className="px-4 py-3 text-zinc-400 text-[12px]">{a.subject}</td>
            <td className="px-4 py-3 text-right text-zinc-400 text-[12px]">
              {new Date(a.firstObservedAt).toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={cn(
        "flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-2.5 py-0.5 text-[11px]",
        status === "running" ? "text-emerald-400" : status === "stopped" ? "text-zinc-400" : "text-amber-400",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "running"
            ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
            : status === "stopped"
              ? "bg-zinc-500"
              : "bg-amber-500",
        )}
      />
      {label}
    </span>
  );
}
