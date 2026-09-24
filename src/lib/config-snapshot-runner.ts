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

  const CONCURRENCY = 3;
  const queue = [...sites];

  async function worker() {
    while (queue.length > 0) {
      const site = queue.shift();
      if (!site) return;
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
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, sites.length) }, () => worker()),
  );

  return { errors, policiesEvaluated, sitesProcessed, snapshotsTaken };
}
