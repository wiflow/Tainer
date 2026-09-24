import "server-only";

import {
  requireSiteAccess,
  requireSitePermission,
  type AuthSession,
} from "@/lib/auth";
import type { Permission } from "@/lib/permissions";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { listEnabledSites } from "@/lib/site-store";
import type { ToolParamSchema } from "@/lib/copilot/types";

export async function resolveSiteForUser(session: AuthSession, siteSlug: string) {
  if (!siteSlug || typeof siteSlug !== "string") {
    throw new Error("siteSlug is required.");
  }

  const trimmed = siteSlug.trim();
  if (!trimmed) {
    throw new Error("siteSlug is required.");
  }

  const config = await resolveSiteConfigBySlug(trimmed);

  requireSiteAccess(session, config.siteId);

  return config;
}

export async function runInSite<T>(
  session: AuthSession,
  siteSlug: string,
  fn: () => Promise<T>,
): Promise<T> {
  const config = await resolveSiteForUser(session, siteSlug);
  return withSiteConfig(config, fn);
}

export async function runInSiteWithPermission<T>(
  session: AuthSession,
  siteSlug: string,
  permission: Permission,
  fn: () => Promise<T>,
): Promise<T> {
  const config = await resolveSiteForUser(session, siteSlug);
  requireSitePermission(session, config.siteId, permission);
  return withSiteConfig(config, fn);
}

export async function listAccessibleSites(session: AuthSession) {
  const sites = await listEnabledSites();
  if (session.user.role === "admin") return sites;
  return sites.filter((s) => session.user.accessibleSiteIds.includes(s.id));
}

export function siteSlugSchema(extra: Record<string, unknown> = {}): ToolParamSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      siteSlug: {
        type: "string",
        description:
          "The slug of the site to operate against (e.g. 'production', 'staging'). " +
          "Use list_sites to discover available slugs.",
      },
      ...extra,
    },
    required: ["siteSlug", ...Object.keys(extra)],
  };
}

export type LeanDeployment = {
  id: string;
  vmid: number;
  name: string;
  node: string;
  type: "lxc" | "qemu";
  status: string;
  ip: string;
  cpu: string;
  memory: string;
  disk: string;
  uptime: string;
  cpuUsage: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  tags: string[];
};
