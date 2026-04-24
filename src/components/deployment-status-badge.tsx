import { Badge } from "@/components/ui/badge";

export function deploymentStatusVariant(status: string) {
  if (status === "running") {
    return "success" as const;
  }

  if (status === "stopped") {
    return "neutral" as const;
  }

  if (status === "paused") {
    return "warning" as const;
  }

  return "review" as const;
}

export function DeploymentStatusBadge({
  rawStatus,
  statusLabel,
}: {
  rawStatus: string;
  statusLabel: string;
}) {
  return <Badge variant={deploymentStatusVariant(rawStatus)}>{statusLabel}</Badge>;
}
