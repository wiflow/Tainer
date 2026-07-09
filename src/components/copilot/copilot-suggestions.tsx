"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

import type { ToolCallView } from "./copilot-plan";

type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCallView[] }
  | { role: "error"; text: string };

/**
 * Generate context-aware suggestions for the always-visible suggestion rack.
 * Drawn from (in priority order):
 *   1. The most recent tool result (e.g. after list_containers → "which is using most memory?")
 *   2. The current page (deployment-detail / network / etc.)
 *   3. The active site slug
 *   4. Defaults
 */
export function generateSuggestions(
  turns: Turn[],
  pathname: string,
  siteSlug: string | null,
): string[] {
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant") as
    | (Turn & { role: "assistant" })
    | undefined;

  // (1) Tool-result-driven suggestions
  if (lastAssistant?.toolCalls.length) {
    const lastTool = [...lastAssistant.toolCalls]
      .reverse()
      .find((tc) => tc.status === "done" && tc.result);
    if (lastTool) {
      const r = lastTool.result;
      switch (lastTool.name) {
        case "list_containers": {
          if (Array.isArray(r) && r.length) {
            const items = r as Array<{ status?: string; name?: string }>;
            const stoppedCount = items.filter((x) => x.status === "stopped").length;
            const sug = ["Which container is using the most memory?"];
            if (stoppedCount > 0) {
              sug.push(`Why are ${stoppedCount} container${stoppedCount === 1 ? "" : "s"} stopped?`);
            } else {
              sug.push("Check overall cluster health");
            }
            sug.push("Which nodes are most loaded?");
            return sug;
          }
          break;
        }
        case "get_container":
          return [
            "What services run on this container?",
            "Take a snapshot of this",
            "Spin up another like this",
          ];
        case "scan_deployment_ports":
          return [
            "Open the web UI",
            "Snapshot before changes",
            "Restart this container",
          ];
        case "list_deployment_templates":
          return [
            "Launch a new container from one of these",
            "Which template includes Grafana?",
          ];
        case "list_snapshots":
          return [
            "Take a new snapshot",
            "Roll back to the most recent",
          ];
        case "get_cluster_overview":
          return [
            "List running containers",
            "Which storage pool is fullest?",
            "Show recent audit log entries",
          ];
        case "list_storage_pools":
          if (Array.isArray(r) && r.length) {
            return [
              "Where can I deploy a new container?",
              "Which pool is closest to full?",
              "Show me the largest deployments",
            ];
          }
          break;
        case "list_sites":
          return ["What's running on each site?", "Are all sites healthy?"];
        case "list_deployment_templates":
          return [
            "What's in the Debian template?",
            "Launch a container from a template",
          ];
        case "list_nodes":
          return ["Show resource usage per node", "Are all nodes online?"];
        case "list_ip_pools":
          return ["Which addresses are free?", "Add a new IP pool"];
        case "get_audit_log":
          return [
            "Were there any failed logins today?",
            "Show me the most recent settings changes",
          ];
      }
    }
  }

  // (2) Path-driven (the user is looking at a specific page)
  const deploymentMatch = pathname.match(
    /^\/sites\/([^/]+)\/deployments\/([^/]+)$/,
  );
  if (deploymentMatch) {
    return [
      "What services are running here?",
      "Summarise this deployment",
      "Restart this container",
    ];
  }

  if (pathname.match(/^\/sites\/[^/]+\/network/)) {
    return [
      "Show me the network topology",
      "List IP pools for this site",
      "Which switch ports are down?",
    ];
  }

  if (pathname.match(/^\/sites\/[^/]+\/backups/)) {
    return [
      "When was the last backup?",
      "Which deployments don't have backups?",
    ];
  }

  // (3) Site-aware defaults
  if (siteSlug) {
    return [
      `What's running on ${siteSlug}?`,
      `Show node usage in ${siteSlug}`,
      `Which container in ${siteSlug} uses the most memory?`,
    ];
  }

  // (4) Bare defaults
  return [
    "What sites can I access?",
    "Walk me through Tainer's features",
    "Show me the audit log",
  ];
}

export function CopilotSuggestions({
  suggestions,
  onPick,
  disabled,
}: {
  suggestions: string[];
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  if (!suggestions.length) return null;
  return (
    <div className="px-3 pt-2 pb-1">
      <div className="flex items-center gap-1 text-[10px] text-zinc-600 mb-1.5 px-0.5">
        <Sparkles className="h-2.5 w-2.5" />
        <span>Try asking</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {suggestions.map((s, i) => (
          <motion.button
            key={`${s}-${i}`}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: i * 0.04 }}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            className="rounded-full border border-white/[0.06] bg-white/[0.025] px-2.5 py-1 text-[11px] text-zinc-300 hover:border-white/15 hover:bg-white/[0.05] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {s}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
