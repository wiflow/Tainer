"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  DeploymentActivityAction,
  DeploymentActivityEntry,
} from "@/lib/deployment-activity-log";

function actionBadgeVariant(action: DeploymentActivityAction) {
  switch (action) {
    case "start":
    case "stop":
    case "restart":
    case "shutdown":
      return "review" as const;
    case "created":
    case "deleted":
      return "info" as const;
    case "env-updated":
    case "migrated":
      return "warning" as const;
    case "backup-created":
    case "backup-restored":
      return "success" as const;
    case "port-scanned":
      return "neutral" as const;
    default:
      return "neutral" as const;
  }
}

function actionLabel(action: DeploymentActivityAction) {
  switch (action) {
    case "start":
      return "Start";
    case "stop":
      return "Stop";
    case "restart":
      return "Restart";
    case "shutdown":
      return "Shutdown";
    case "created":
      return "Created";
    case "deleted":
      return "Deleted";
    case "env-updated":
      return "Env updated";
    case "migrated":
      return "Migrated";
    case "backup-created":
      return "Backup";
    case "backup-restored":
      return "Restored";
    case "port-scanned":
      return "Port scan";
    default:
      return action;
  }
}

function formatRelativeTime(iso: string) {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

type DeploymentActivityCardProps = {
  activities: DeploymentActivityEntry[];
};

export function DeploymentActivityCard({
  activities,
}: DeploymentActivityCardProps) {
  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="border-b border-white/5">
        <div className="flex items-center gap-3">
          <CardTitle>Activity log</CardTitle>
          {activities.length > 0 && (
            <Badge variant="neutral">{activities.length}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {activities.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-zinc-500">
            No activity recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/40">
            {activities.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 px-5 py-3"
              >
                <Badge variant={actionBadgeVariant(entry.action)}>
                  {actionLabel(entry.action)}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-300">
                  {entry.message}
                </span>
                <span className="shrink-0 text-[12px] text-zinc-500">
                  {entry.userName}
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-zinc-600">
                  {formatRelativeTime(entry.recordedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
