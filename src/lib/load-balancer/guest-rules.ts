import type { LiveDeployment, LiveNodeMetrics } from "@/lib/proxmox";
import type { NodeScore } from "./types";

/**
 * Shared guest-eligibility and capacity rules used by both the automatic
 * migration trigger and the rebalance-plan optimizer. One source of truth —
 * a plan must never propose a move the trigger would refuse to execute.
 */

export const MEM_HEADROOM = 1.2;  // 20% memory headroom
export const DISK_HEADROOM = 1.1; // 10% disk headroom
export const CPU_MAX_PERCENT = 90; // Don't migrate to nodes above 90% CPU

// Guest tags follow the ProxLB convention (the de-facto standard for
// Proxmox balancers) so operators can share one tagging scheme:
//   plb_ignore            — never auto-migrate this guest
//   plb_pin_<node>        — pinned; never auto-migrated off its node
//   plb_affinity_<g>      — keep guests sharing <g> together
//   plb_anti_affinity_<g> — spread guests sharing <g> across nodes
//   plb_manual            — Tainer extension: no automatic moves, but the
//                           guest still participates in explicit admin
//                           actions (maintenance drains, rebalance plans)
const TAG_IGNORE = "plb_ignore";
const TAG_MANUAL = "plb_manual";
const TAG_PIN_PREFIX = "plb_pin_";
const TAG_AFFINITY_PREFIX = "plb_affinity_";
const TAG_ANTI_AFFINITY_PREFIX = "plb_anti_affinity_";

export function hasIgnoreTag(guest: LiveDeployment): boolean {
  return guest.tagList.some((t) => t === TAG_IGNORE || t.startsWith(`${TAG_IGNORE}_`));
}

export function hasManualTag(guest: LiveDeployment): boolean {
  return guest.tagList.includes(TAG_MANUAL);
}

export function hasPinTag(guest: LiveDeployment): boolean {
  return guest.tagList.some((t) => t.startsWith(TAG_PIN_PREFIX));
}

export function affinityTags(guest: LiveDeployment): string[] {
  return guest.tagList.filter(
    (t) => t.startsWith(TAG_AFFINITY_PREFIX) && !t.startsWith(TAG_ANTI_AFFINITY_PREFIX),
  );
}

export function antiAffinityTags(guest: LiveDeployment): string[] {
  return guest.tagList.filter((t) => t.startsWith(TAG_ANTI_AFFINITY_PREFIX));
}

/**
 * Effective memory footprint of a guest. For ballooned VMs the host reports
 * the full allocation while the guest may use a fraction of it — the balloon
 * driver's number (when available) is what actually lands on the target.
 */
export function effectiveMemBytes(
  guest: LiveDeployment,
  guestMemOverrides: Map<number, number>,
): number {
  return guestMemOverrides.get(guest.vmid) ?? guest.memUsedBytes ?? 0;
}

/**
 * Nodes that already host a running guest sharing one of `tags`
 * (other than `vmid` itself) — anti-affinity forbids these as targets.
 * `positionOverrides` lets a planner evaluate against projected positions.
 */
export function antiAffinityExcludedNodes(
  vmid: number,
  tags: string[],
  deployments: LiveDeployment[],
  positionOverrides?: Map<number, string>,
): Set<string> {
  const excluded = new Set<string>();
  if (tags.length === 0) return excluded;
  for (const d of deployments) {
    if (d.vmid === vmid || d.rawStatus !== "running") continue;
    if (d.tagList.some((t) => tags.includes(t))) {
      excluded.add(positionOverrides?.get(d.vmid) ?? d.node);
    }
  }
  return excluded;
}

/**
 * True when moving this guest off its node would split an affinity group
 * (a peer sharing one of its plb_affinity_* tags runs on the same node).
 */
export function wouldBreakAffinityGroup(
  guest: LiveDeployment,
  deployments: LiveDeployment[],
): boolean {
  const tags = affinityTags(guest);
  if (tags.length === 0) return false;
  return deployments.some(
    (d) =>
      d.vmid !== guest.vmid &&
      d.node === guest.node &&
      d.rawStatus === "running" &&
      d.tagList.some((t) => tags.includes(t)),
  );
}

/**
 * Validate that the target node has enough capacity for the guest,
 * checking CPU, memory, and disk with headroom margins.
 */
export function validateTargetCapacity(
  targetMetrics: LiveNodeMetrics | undefined,
  guest: LiveDeployment,
  targetScore: NodeScore,
  guestMemBytes: number,
): boolean {
  if (!targetMetrics) return false;

  // CPU: target must be below 90%
  if (targetScore.cpuPercent >= CPU_MAX_PERCENT) return false;

  // Memory: target must have enough free memory with 20% headroom
  if (guestMemBytes > 0) {
    const targetFreeMem =
      (targetMetrics.memoryTotalBytes ?? 0) - (targetMetrics.memoryUsedBytes ?? 0);
    if (targetFreeMem < guestMemBytes * MEM_HEADROOM) return false;
  }

  // Disk: target must have enough free disk with 10% headroom
  const guestDisk = guest.diskUsedBytes ?? 0;
  if (guestDisk > 0) {
    const targetFreeDisk =
      (targetMetrics.rootfsTotalBytes ?? 0) - (targetMetrics.rootfsUsedBytes ?? 0);
    if (targetFreeDisk < guestDisk * DISK_HEADROOM) return false;
  }

  return true;
}
