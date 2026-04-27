import "server-only";

import { runConfigSnapshotTick } from "@/lib/node-config-backup";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfig } from "@/lib/site-resolver";
import { listEnabledSites } from "@/lib/site-store";

export type ConfigSnapshotMultiSiteResult = {
  errors: string[];
  policiesEvaluated: number;
  sitesProcessed: number;
  snapshotsTaken: number;
};

/**
 * Runs `runConfigSnapshotTick()` once per enabled site, each call wrapped in
 * its own `withSiteConfig` so per-site policy stores resolve correctly.
 * Errors are collected — a failure in one site does not stop the others.
 */
export async function runConfigSnapshotTickAllSites(): Promise<ConfigSnapshotMultiSiteResult> {
  const errors: string[] = [];
  let policiesEvaluated = 0;
  let snapshotsTaken = 0;
  let sitesProcessed = 0;

  let sites: Awaited<ReturnType<typeof listEnabledSites>>;
  try {
    sites = await listEnabledSites();
  } catch (error) {
    return {
      errors: [
        `Failed to load enabled sites: ${error instanceof Error ? error.message : String(error)}`,
      ],
      policiesEvaluated: 0,
      sitesProcessed: 0,
      snapshotsTaken: 0,
    };
  }

  for (const site of sites) {
    try {
      const config = await resolveSiteConfig(site);
      const result = await withSiteConfig(config, () => runConfigSnapshotTick());
      policiesEvaluated += result.policiesEvaluated;
      snapshotsTaken += result.snapshotsTaken;
      sitesProcessed++;
      for (const err of result.errors) {
        errors.push(`[${site.name}] ${err}`);
      }
    } catch (error) {
      errors.push(
        `[${site.name}] Tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { errors, policiesEvaluated, sitesProcessed, snapshotsTaken };
}
