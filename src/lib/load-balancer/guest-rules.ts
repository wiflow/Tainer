import type { LiveDeployment, LiveNodeMetrics } from "@/lib/proxmox";
import type { NodeScore } from "./types";

export const MEM_HEADROOM = 1.2;
export const DISK_HEADROOM = 1.1;
export const CPU_MAX_PERCENT = 90;

// Tag names follow the ProxLB convention so operators can share one tagging scheme.
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

/** Proxmox reports the full allocation for ballooned VMs; prefer the guest's own figure. */
export function effectiveMemBytes(
  guest: LiveDeployment,
  guestMemOverrides: Map<number, number>,
): number {
  return guestMemOverrides.get(guest.vmid) ?? guest.memUsedBytes ?? 0;
}

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

export function validateTargetCapacity(
  targetMetrics: LiveNodeMetrics | undefined,
  guest: LiveDeployment,
  targetScore: NodeScore,
  guestMemBytes: number,
): boolean {
  if (!targetMetrics) return false;

  if (targetScore.cpuPercent >= CPU_MAX_PERCENT) return false;

  if (guestMemBytes > 0) {
    const targetFreeMem =
      (targetMetrics.memoryTotalBytes ?? 0) - (targetMetrics.memoryUsedBytes ?? 0);
    if (targetFreeMem < guestMemBytes * MEM_HEADROOM) return false;
  }

  const guestDisk = guest.diskUsedBytes ?? 0;
  if (guestDisk > 0) {
    const targetFreeDisk =
      (targetMetrics.rootfsTotalBytes ?? 0) - (targetMetrics.rootfsUsedBytes ?? 0);
    if (targetFreeDisk < guestDisk * DISK_HEADROOM) return false;
  }

  return true;
}
