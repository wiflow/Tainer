import { cn } from "@/lib/utils";
import type { DeploymentActivity } from "@/lib/proxmox";
import {
  getTagPillClass,
  managedTagSlug,
  type ManagedTagDefinition,
} from "@/lib/tag-utils";

function formatActivityAge(occurredAt: string | null) {
  if (!occurredAt) {
    return null;
  }

  const timestamp = new Date(occurredAt).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  const diffMs = Date.now() - timestamp;

  if (diffMs < 0) {
    return new Date(occurredAt).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  }

  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d ago`;
  }

  const weeks = Math.floor(days / 7);

  if (weeks < 5) {
    return `${weeks}w ago`;
  }

  return new Date(occurredAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

type DeploymentTagListProps = {
  className?: string;
  latestActivity?: DeploymentActivity | null;
  tagClassName?: string;
  tagList: string[];
  tags?: Pick<ManagedTagDefinition, "color" | "name" | "slug">[];
};

export function DeploymentTagList({
  className,
  latestActivity,
  tagClassName,
  tagList,
  tags = [],
}: DeploymentTagListProps) {
  const tagsBySlug = new Map(tags.map((tag) => [tag.slug, tag]));
  const activityAge = formatActivityAge(latestActivity?.occurredAt ?? null);
  const activityText = latestActivity
    ? activityAge
      ? `Activity · ${latestActivity.label} ${activityAge}`
      : `Activity · ${latestActivity.label}`
    : null;
  const activityTitle = latestActivity
    ? latestActivity.occurredAt
      ? `Latest activity: ${latestActivity.label} on ${new Date(latestActivity.occurredAt).toLocaleString()}`
      : `Latest activity: ${latestActivity.label}`
    : null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tagList.map((tagValue) => {
        const slug = managedTagSlug(tagValue);
        const configuredTag = slug ? tagsBySlug.get(slug) : null;
        const label = configuredTag?.name ?? slug ?? tagValue;
        const colorClassName = configuredTag
          ? getTagPillClass(configuredTag.color)
          : "border-white/5 bg-[#111113] text-zinc-400";

        return (
          <span
            key={tagValue}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px]",
              colorClassName,
              tagClassName,
            )}
            title={tagValue}
          >
            {label}
          </span>
        );
      })}

      {activityText && (
        <span
          className={cn(
            "rounded-full border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-300",
            tagClassName,
          )}
          title={activityTitle ?? undefined}
        >
          {activityText}
        </span>
      )}
    </div>
  );
}
