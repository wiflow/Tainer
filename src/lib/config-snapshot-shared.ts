// Imported by client components, so no node:fs or server-only imports here.

export const CONFIG_SNAPSHOT_INTERVAL_OPTIONS = [
  { label: "Every hour", value: 60 },
  { label: "Every 6 hours", value: 360 },
  { label: "Every 12 hours", value: 720 },
  { label: "Every 24 hours", value: 1440 },
  { label: "Every 48 hours", value: 2880 },
  { label: "Weekly", value: 10080 },
] as const;

export function formatConfigIntervalLabel(minutes: number): string {
  const match = CONFIG_SNAPSHOT_INTERVAL_OPTIONS.find((o) => o.value === minutes);
  if (match) return match.label;
  if (minutes < 60) return `Every ${minutes}m`;
  if (minutes < 1440) return `Every ${Math.round(minutes / 60)}h`;
  return `Every ${Math.round(minutes / 1440)}d`;
}

/** Mirrors the shape in `@/lib/config-snapshot-policies`; keep the two in sync. */
export type ConfigSnapshotPolicyView = {
  createdAt: string;
  description: string;
  enabled: boolean;
  id: string;
  intervalMinutes: number;
  lastRunAt: string | null;
  name: string;
  nextRunAt: string | null;
  nodeName: string;
  retentionCount: number;
  updatedAt: string;
};
