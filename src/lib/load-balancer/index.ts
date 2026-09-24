import "server-only";

import type { LiveNode, LiveNodeMetrics } from "@/lib/proxmox";
import { getBestNode } from "@/lib/proxmox";
import type { LoadBalancerStatus } from "./types";
import { getLoadBalancerStatus, getNodeScoresForSite, getSiteLbSettings } from "./observer";
import { selectNodeP2C } from "./p2c-selector";

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

  return getBestNode(nodes, metrics);
}

export function getStatus(siteId: string): LoadBalancerStatus {
  return getLoadBalancerStatus(siteId);
}

export function getSuggestedNode(siteId: string): string | null {
  const scores = getNodeScoresForSite(siteId);
  if (scores.length === 0) return null;
  return selectNodeP2C(scores, placementExclusions(siteId));
}
