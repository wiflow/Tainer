import "server-only";

import type { LiveNode, LiveNodeMetrics } from "@/lib/proxmox";
import { getBestNode } from "@/lib/proxmox";
import type { LoadBalancerStatus } from "./types";
import { getLoadBalancerStatus, getNodeScoresForSite, getSiteLbSettings } from "./observer";
import { selectNodeP2C } from "./p2c-selector";

/** Nodes an admin has excluded or marked for maintenance — never placement targets. */
function placementExclusions(siteId: string, extra?: Set<string>): Set<string> {
  const settings = getSiteLbSettings(siteId);
  const excluded = new Set(extra);
  for (const node of settings?.excludedNodes ?? []) excluded.add(node);
  for (const node of settings?.maintenanceNodes ?? []) excluded.add(node);
  return excluded;
}

export type { LoadBalancerSettings, LoadBalancerStatus, NodeScore } from "./types";
export { getLoadBalancerSettings, saveLoadBalancerSettings } from "./settings";
export { startLoadBalancerObserver, getLoadBalancerStatus } from "./observer";

/**
 * Select the best node for a new deployment using P2C if the load balancer
 * is active for the given site, otherwise fall back to the standard greedy
 * selector from proxmox.ts.
 *
 * Note: The fallback uses getBestNode() from proxmox.ts which has different
 * weights (70% memory, 30% CPU, no latency/disk). This is intentional —
 * when P2C scores are unavailable, we use the same greedy algorithm that
 * existed before the load balancer was added.
 */
export function selectBestNode(
  siteId: string,
  nodes: LiveNode[],
  metrics: LiveNodeMetrics[],
  excludeNodes?: Set<string>,
): string | null {
  const scores = getNodeScoresForSite(siteId);

  if (scores.length > 0) {
    const result = selectNodeP2C(scores, placementExclusions(siteId, excludeNodes));
    if (result) return result;
  }

  // Fallback: use the canonical greedy selector from proxmox.ts
  return getBestNode(nodes, metrics);
}

export function getStatus(siteId: string): LoadBalancerStatus {
  return getLoadBalancerStatus(siteId);
}

/**
 * Get a P2C-suggested node for deployment, or null if the LB has no scores.
 * Designed to be called from server components and passed as the
 * `suggestedNode` prop to `<NodeSelector />`.
 */
export function getSuggestedNode(siteId: string): string | null {
  const scores = getNodeScoresForSite(siteId);
  if (scores.length === 0) return null;
  return selectNodeP2C(scores, placementExclusions(siteId));
}
