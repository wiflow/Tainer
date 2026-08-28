"use client";

import { useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleDotDashed,
  CircleX,
  ShieldAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ApprovalPlan } from "@/lib/copilot/types";

import { ToolResultView } from "./copilot-entities";

export type ToolCallView = {
  id: string;
  name: string;
  category?: string;
  klass?: "read" | "write" | "destructive" | "admin";
  args: Record<string, unknown>;
  status: "running" | "done" | "error" | "awaiting-approval" | "denied";
  result?: unknown;
  durationMs?: number;
  describe?: string;
  confirmString?: string | null;
  plan?: ApprovalPlan | null;
  token?: string;
  /** External content (e.g. Docker Hub descriptions) entered the conversation
   *  before this action was proposed — show a provenance warning. */
  afterExternalContent?: boolean;
};

// Humanize tool names + args into short subtask titles. Falls back to the
// raw tool name if we don't have a label.
const TOOL_LABELS: Record<string, (args: Record<string, unknown>) => string> = {
  list_sites: () => "List accessible sites",
  list_nodes: (a) => `List nodes — ${String(a.siteSlug ?? "?")}`,
  get_task_status: (a) => `Check task on ${String(a.node ?? "?")}`,
  get_cluster_overview: (a) => `Read cluster overview — ${String(a.siteSlug ?? "?")}`,
  list_containers: (a) => {
    const status = a.status && a.status !== "all" ? ` · ${a.status}` : "";
    return `List containers — ${String(a.siteSlug ?? "?")}${status}`;
  },
  get_container: () => `Read deployment details`,
  list_templates: (a) => `List OS templates — ${String(a.siteSlug ?? "?")}`,
  list_deployment_templates: (a) => `List deployment templates — ${String(a.siteSlug ?? "?")}`,
  list_storage_pools: (a) => `Check storage pools — ${String(a.siteSlug ?? "?")}`,
  list_ip_pools: (a) => `List IP pools — ${String(a.siteSlug ?? "?")}`,
  get_audit_log: () => `Read audit log`,
  start_deployment: () => `Start deployment`,
  stop_deployment: () => `Hard-stop deployment`,
  shutdown_deployment: () => `Gracefully shut down deployment`,
  restart_deployment: () => `Restart deployment`,
  update_deployment_resources: (a) => {
    const bits: string[] = [];
    if (a.cores != null) bits.push(`cores=${a.cores}`);
    if (a.memoryMb != null) bits.push(`mem=${a.memoryMb}MB`);
    if (a.swapMb != null) bits.push(`swap=${a.swapMb}MB`);
    return `Update resources — ${bits.join(", ") || "no changes"}`;
  },
  destroy_deployment: () => `Destroy deployment`,
  destroy_batch_deployments: (a) =>
    `Destroy ${Array.isArray(a.deploymentIds) ? (a.deploymentIds as unknown[]).length : "?"} deployments`,
  scan_deployment_ports: () => `Scan for open ports & services`,
  launch_from_deployment_template: (a) =>
    `Launch "${String(a.hostname ?? "?")}" from template`,
  update_container_env: (a) => {
    const env = (a.env as Record<string, unknown> | undefined) ?? {};
    const keys = Object.keys(env).slice(0, 3);
    const more = Object.keys(env).length - keys.length;
    return `Update env: ${keys.join(", ")}${more > 0 ? ` +${more}` : ""}`;
  },
  list_snapshots: () => `List snapshots`,
  create_snapshot: (a) => `Snapshot as "${String(a.snapshotName ?? "?")}"`,
  rollback_snapshot: (a) => `Roll back to "${String(a.snapshotName ?? "?")}"`,
  delete_snapshot: (a) => `Delete snapshot "${String(a.snapshotName ?? "?")}"`,
  launch_batch_from_deployment_template: (a) =>
    `Launch ${String(a.count ?? "?")}× "${String(a.hostnamePrefix ?? "?")}…" from template`,
  list_backups: (a) => `List backups — ${String(a.siteSlug ?? "?")}`,
  create_backup: () => `Back up deployment`,
  restore_backup: () => `Restore backup (overwrite)`,
  migrate_deployment: (a) => `Migrate to node ${String(a.targetNode ?? "?")}`,
  set_deployment_tags: () => `Update tags`,
  list_tags: (a) => `List tags — ${String(a.siteSlug ?? "?")}`,
  get_deployment_metrics: (a) => `Metrics trend — ${String(a.timeframe ?? "day")}`,
  get_network_path: () => `Trace network path`,
  get_cve_report: (a) => `Last CVE scan — ${String(a.siteSlug ?? "?")}`,
  run_cve_scan: (a) => `Run CVE scan — ${String(a.siteSlug ?? "?")}`,
  run_diagnostics: (a) => `Run diagnostics — ${String(a.siteSlug ?? "?")}`,
  get_alerts: (a) => `Active alerts — ${String(a.siteSlug ?? "?")}`,
  get_heartbeat_status: () => `Heartbeat status`,
  list_firewall_rules: (a) => `List firewall rules — ${String(a.siteSlug ?? "?")}`,
  add_firewall_rule: (a) => `Add firewall rule (${String(a.type ?? "?")} ${String(a.action ?? "?")})`,
  delete_firewall_rule: (a) => `Delete firewall rule #${String(a.pos ?? "?")}`,
  list_vm_templates: (a) => `List VM templates — ${String(a.siteSlug ?? "?")}`,
  list_backup_policies: (a) => `Backup policies — ${String(a.siteSlug ?? "?")}`,
  list_alert_policies: (a) => `Alert policies — ${String(a.siteSlug ?? "?")}`,
  list_config_snapshots: (a) => `Config snapshots — ${String(a.siteSlug ?? "?")}`,
  take_config_snapshot: (a) => `Snapshot node ${String(a.node ?? "?")} config`,
  list_isos: (a) => `List ISOs — ${String(a.siteSlug ?? "?")}`,
  list_users: () => `List users`,
  list_groups: () => `List permission groups`,
  search_docker_images: (a) => `Search Docker Hub — "${String(a.query ?? "?")}"`,
  pull_docker_image: (a) =>
    `Pull ${String(a.namespace ?? "library")}/${String(a.repository ?? "?")}:${String(a.tag ?? "latest")} → ${String(a.storage ?? "?")}`,
  create_container_from_image: (a) =>
    `Create "${String(a.hostname ?? "?")}" from image template`,
  download_iso: (a) => `Download ISO → ${String(a.storage ?? "?")}`,
  create_vm_from_iso: (a) => `Create VM "${String(a.name ?? "?")}" from ISO`,
};

function labelForToolCall(tc: ToolCallView): string {
  const label = TOOL_LABELS[tc.name];
  return label ? label(tc.args) : tc.name;
}

// -- Status icons & badges (dark-theme palette) ------------------------------

function StatusIcon({
  status,
  size = "sm",
}: {
  status: ToolCallView["status"];
  size?: "sm" | "md";
}) {
  const cls = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const node = (() => {
    switch (status) {
      case "done":
        return <CheckCircle2 className={cn(cls, "text-emerald-400")} />;
      case "running":
        return (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 2.2, ease: "linear", repeat: Infinity }}
            className="inline-flex"
          >
            <CircleDotDashed className={cn(cls, "text-sky-400")} />
          </motion.span>
        );
      case "awaiting-approval":
        return <CircleAlert className={cn(cls, "text-amber-400")} />;
      case "error":
        return <CircleX className={cn(cls, "text-rose-400")} />;
      case "denied":
        return <CircleX className={cn(cls, "text-zinc-500")} />;
      default:
        return <Circle className={cn(cls, "text-zinc-500")} />;
    }
  })();
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={status}
        initial={{ opacity: 0, scale: 0.8, rotate: -8 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        exit={{ opacity: 0, scale: 0.8, rotate: 8 }}
        transition={{ duration: 0.18, ease: [0.2, 0.65, 0.3, 0.9] }}
        className="inline-flex"
      >
        {node}
      </motion.span>
    </AnimatePresence>
  );
}

function StatusBadge({ status }: { status: ToolCallView["status"] }) {
  const tone = {
    done: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
    running: "bg-sky-500/15 text-sky-300 border-sky-500/20",
    "awaiting-approval": "bg-amber-500/15 text-amber-300 border-amber-500/20",
    error: "bg-rose-500/15 text-rose-300 border-rose-500/20",
    denied: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  }[status];
  const label = {
    done: "done",
    running: "running",
    "awaiting-approval": "needs approval",
    error: "error",
    denied: "denied",
  }[status];
  return (
    <motion.span
      key={status}
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.06, 1] }}
      transition={{ duration: 0.32, ease: [0.34, 1.56, 0.64, 1] }}
      className={cn(
        "rounded px-1.5 py-0.5 text-[9.5px] font-medium border tabular-nums",
        tone,
      )}
    >
      {label}
    </motion.span>
  );
}

// -- Plan view ---------------------------------------------------------------

/**
 * Renders the agent-plan-style task list for an assistant turn. The "task" is
 * the assistant's overall progress; "subtasks" are the individual tool calls.
 */
export function PlanView({
  toolCalls,
  onApprove,
  onDeny,
}: {
  toolCalls: ToolCallView[];
  onApprove: (toolCallId: string) => void;
  onDeny: (toolCallId: string) => void;
}) {
  if (toolCalls.length === 0) return null;

  // Compute overall status. Any awaiting-approval dominates; otherwise
  // any running dominates; otherwise any error → error; else all done.
  const overall: ToolCallView["status"] = toolCalls.some(
    (tc) => tc.status === "awaiting-approval",
  )
    ? "awaiting-approval"
    : toolCalls.some((tc) => tc.status === "running")
      ? "running"
      : toolCalls.some((tc) => tc.status === "error")
        ? "error"
        : toolCalls.every((tc) => tc.status === "done")
          ? "done"
          : "running";

  const title =
    overall === "awaiting-approval"
      ? "Waiting for your approval"
      : overall === "running"
        ? "Working on it"
        : overall === "error"
          ? "Hit a snag"
          : "Done";

  return (
    <motion.div
      className="rounded-lg border border-white/[0.06] bg-white/[0.025] overflow-hidden"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.2, 0.65, 0.3, 0.9] }}
    >
      <LayoutGroup>
        <div className="p-2.5">
          <div className="flex items-center gap-2 px-1 pb-1.5">
            <StatusIcon status={overall} size="md" />
            <span className="text-[12.5px] font-medium text-zinc-100">{title}</span>
            <span className="text-[10.5px] text-zinc-500">
              {toolCalls.length} {toolCalls.length === 1 ? "step" : "steps"}
            </span>
            <div className="ml-auto">
              <StatusBadge status={overall} />
            </div>
          </div>
          <div className="relative ml-1.5 pl-4 border-l-2 border-dashed border-white/[0.06]">
            <ul className="space-y-0.5">
              {toolCalls.map((tc) => (
                <ToolSubtask
                  key={tc.id}
                  tc={tc}
                  onApprove={() => onApprove(tc.id)}
                  onDeny={() => onDeny(tc.id)}
                />
              ))}
            </ul>
          </div>
        </div>
      </LayoutGroup>
    </motion.div>
  );
}

function ToolSubtask({
  tc,
  onApprove,
  onDeny,
}: {
  tc: ToolCallView;
  onApprove: () => void;
  onDeny: () => void;
}) {
  // Steps stay collapsed by default — expanding every result made long turns
  // noisy. The one exception is awaiting-approval: the approve/deny card must
  // be visible without a click, so it forces open on that transition (state
  // adjusted during render, per React's derived-state pattern).
  const [open, setOpen] = useState(tc.status === "awaiting-approval");
  const [prevStatus, setPrevStatus] = useState(tc.status);
  if (prevStatus !== tc.status) {
    setPrevStatus(tc.status);
    if (tc.status === "awaiting-approval") setOpen(true);
  }
  const label = labelForToolCall(tc);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6 }}
      transition={{
        type: "spring",
        stiffness: 500,
        damping: 28,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="-ml-[26px] flex h-4 w-4 items-center justify-center rounded-full bg-[#0c0c0e] border border-white/[0.06]">
          <StatusIcon status={tc.status} />
        </span>
        <span className="flex-1 min-w-0 truncate text-[12px] text-zinc-200">{label}</span>
        {tc.klass && tc.klass !== "read" && (
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[9px] border tabular-nums uppercase tracking-wide flex-shrink-0",
              tc.klass === "destructive"
                ? "text-rose-300 border-rose-500/30 bg-rose-500/[0.08]"
                : tc.klass === "admin"
                  ? "text-violet-300 border-violet-500/30 bg-violet-500/[0.08]"
                  : "text-amber-300 border-amber-500/30 bg-amber-500/[0.08]",
            )}
          >
            {tc.klass}
          </span>
        )}
        {tc.durationMs != null && tc.status === "done" && (
          <span className="text-[10px] text-zinc-600 tabular-nums flex-shrink-0">
            {tc.durationMs}ms
          </span>
        )}
        <ChevronRight
          className={cn(
            "h-3 w-3 text-zinc-600 transition-transform flex-shrink-0",
            open && "rotate-90",
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.65, 0.3, 0.9] }}
            className="overflow-hidden"
          >
            <div className="pl-2 pr-1 pb-1.5 pt-0.5 space-y-1.5">
              {tc.status === "awaiting-approval" ? (
                <ApprovalCard tc={tc} onApprove={onApprove} onDeny={onDeny} />
              ) : (
                <>
                  {tc.status === "done" && tc.result !== undefined && (
                    <ToolResultView name={tc.name} args={tc.args} result={tc.result} />
                  )}
                  {tc.status === "error" && tc.result !== undefined && (
                    <ToolResultView name={tc.name} args={tc.args} result={tc.result} />
                  )}
                  {tc.status === "denied" && (
                    <div className="text-[11.5px] text-zinc-500 italic px-1">
                      You denied this action.
                    </div>
                  )}
                  {Object.keys(tc.args).length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors select-none">
                        args
                      </summary>
                      <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/40 border border-white/[0.04] px-2 py-1.5 text-[10.5px] text-zinc-500">
                        {JSON.stringify(tc.args, null, 2)}
                      </pre>
                    </details>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

// -- Approval plan (batch preview) -------------------------------------------

function ApprovalPlanTable({ plan }: { plan: ApprovalPlan }) {
  return (
    <div className="mt-2 rounded-md border border-white/[0.08] bg-black/20 overflow-hidden">
      <div className="px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 border-b border-white/[0.06]">
        {plan.summary}
      </div>
      <div className="max-h-48 overflow-y-auto divide-y divide-white/[0.04]">
        {plan.rows.map((row) => (
          <div
            key={`${row.hostname}-${row.vmid ?? "?"}`}
            className="flex items-center gap-2 px-2.5 py-1 text-[11px]"
          >
            <span className="font-medium text-zinc-100 truncate flex-1 min-w-0">
              {row.hostname}
            </span>
            {row.vmid != null && (
              <span className="text-zinc-500 tabular-nums flex-shrink-0">CT {row.vmid}</span>
            )}
            <span
              className={cn(
                "tabular-nums flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] border",
                row.ip === "DHCP"
                  ? "text-zinc-400 bg-white/[0.03] border-white/[0.06]"
                  : "text-sky-300 bg-sky-500/10 border-sky-500/20",
              )}
            >
              {row.ip}
            </span>
          </div>
        ))}
      </div>
      {plan.note && (
        <div className="px-2.5 py-1 text-[10px] text-zinc-500 border-t border-white/[0.06]">
          {plan.note}
        </div>
      )}
    </div>
  );
}

// -- Approval card -----------------------------------------------------------

function ApprovalCard({
  tc,
  onApprove,
  onDeny,
}: {
  tc: ToolCallView;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const needsConfirm = !!tc.confirmString;
  const ok = !needsConfirm || confirm === tc.confirmString;

  return (
    <div
      className={cn(
        "rounded-lg border px-2.5 py-2",
        tc.klass === "destructive"
          ? "border-rose-500/30 bg-rose-500/[0.08]"
          : tc.klass === "admin"
            ? "border-violet-500/30 bg-violet-500/[0.06]"
            : "border-amber-500/30 bg-amber-500/[0.06]",
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert
          className={cn(
            "h-4 w-4 mt-0.5 flex-shrink-0",
            tc.klass === "destructive"
              ? "text-rose-300"
              : tc.klass === "admin"
                ? "text-violet-300"
                : "text-amber-300",
          )}
        />
        <div className="flex-1 min-w-0">
          {tc.describe && (
            <div className="text-[12px] text-zinc-100">{tc.describe}</div>
          )}
          {tc.plan && <ApprovalPlanTable plan={tc.plan} />}
          <div className="text-[10.5px] text-zinc-400 mt-0.5">
            This action runs with your permissions. Approve to execute or deny to cancel.
          </div>
          {tc.afterExternalContent && (
            <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-2 py-1.5 text-[10.5px] text-amber-200/90">
              <ShieldAlert className="h-3 w-3 mt-px flex-shrink-0" />
              <span>
                External content (e.g. Docker Hub descriptions) was read earlier in this
                conversation. Double-check this action matches what you actually asked for.
              </span>
            </div>
          )}
          {needsConfirm && (
            <div className="mt-2">
              <label className="block text-[10.5px] text-zinc-400 mb-1">
                Type <code className="text-zinc-100 bg-black/30 rounded px-1">{tc.confirmString}</code> to confirm:
              </label>
              <input
                className="w-full rounded-md border border-white/[0.1] bg-black/30 px-2 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-rose-400/50"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={tc.confirmString ?? ""}
                autoComplete="off"
              />
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onApprove}
              disabled={!ok}
              className={cn(
                "rounded-md px-3 py-1.5 text-[11.5px] font-medium transition-colors flex items-center gap-1.5",
                tc.klass === "destructive"
                  ? "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-600/30 disabled:cursor-not-allowed"
                  : "bg-white text-zinc-950 hover:bg-zinc-100 disabled:bg-white/30 disabled:cursor-not-allowed",
              )}
            >
              <Check className="h-3 w-3" />
              Approve
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onDeny}
              className="rounded-md border border-white/10 bg-transparent px-3 py-1.5 text-[11.5px] text-zinc-300 hover:bg-white/[0.05] transition-colors"
            >
              Deny
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
