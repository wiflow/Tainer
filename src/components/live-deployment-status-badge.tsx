"use client";

import { deploymentStatusVariant } from "@/components/deployment-status-badge";
import { useOptionalDeploymentStatus } from "@/components/deployment-status-context";
import { Badge } from "@/components/ui/badge";

/**
 * Status badge that honours the optimistic status from a surrounding
 * DeploymentStatusProvider (set by the lifecycle buttons on task completion),
 * falling back to the server-rendered status.
 */
export function LiveDeploymentStatusBadge({
  rawStatus,
  statusLabel,
}: {
  rawStatus: string;
  statusLabel: string;
}) {
  const ctx = useOptionalDeploymentStatus();
  const status = ctx?.optimistic ?? rawStatus;
  const label = ctx?.optimistic ?? statusLabel;
  return <Badge variant={deploymentStatusVariant(status)}>{label}</Badge>;
}
