import { getBackupOverview, getOverviewData, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export type DiagnosticSeverity = "critical" | "warning" | "info";

export type DiagnosticIssue = {
  category: string;
  description: string;
  id: string;
  resourceLabel: string;
  resourceLink: string | null;
  severity: DiagnosticSeverity;
  title: string;
};

export type DiagnosticReport = {
  issues: DiagnosticIssue[];
  scanDurationMs: number;
  scannedAt: string;
};

export async function runDiagnosticScan(siteSlug: string): Promise<DiagnosticReport> {
  const start = Date.now();

  const siteConfig = await resolveSiteConfigBySlug(siteSlug);
  const report = await withSiteConfig(siteConfig, async () => {
    const [overview, backupOverview] = await Promise.all([
      getOverviewData(),
      getBackupOverview().catch(() => null),
    ]);

    const issues: DiagnosticIssue[] = [];

    // 1. Storage capacity
    for (const pool of overview.storagePools) {
      if (pool.usageRatio == null) continue;
      if (pool.usageRatio > 0.95) {
        issues.push({
          category: "storage",
          description: `Storage pool "${pool.storage}" on ${pool.node} is ${Math.round(pool.usageRatio * 100)}% full. Immediate action required.`,
          id: `storage-critical-${pool.node}-${pool.storage}`,
          resourceLabel: `${pool.storage} (${pool.node})`,
          resourceLink: `/sites/${siteSlug}`,
          severity: "critical",
          title: `Storage critically full: ${pool.storage}`,
        });
      } else if (pool.usageRatio > 0.85) {
        issues.push({
          category: "storage",
          description: `Storage pool "${pool.storage}" on ${pool.node} is ${Math.round(pool.usageRatio * 100)}% full. Consider expanding or cleaning up.`,
          id: `storage-warning-${pool.node}-${pool.storage}`,
          resourceLabel: `${pool.storage} (${pool.node})`,
          resourceLink: `/sites/${siteSlug}`,
          severity: "warning",
          title: `Storage filling up: ${pool.storage}`,
        });
      }
    }

    // 2. Node resources
    for (const node of overview.nodeMetrics) {
      if (node.cpuRatio != null && node.cpuRatio > 0.9) {
        issues.push({
          category: "node",
          description: `Node "${node.node}" has CPU usage at ${Math.round(node.cpuRatio * 100)}%. Workloads may be impacted.`,
          id: `node-cpu-${node.node}`,
          resourceLabel: node.node,
          resourceLink: `/sites/${siteSlug}`,
          severity: "warning",
          title: `High CPU usage: ${node.node}`,
        });
      }
      if (node.memoryTotalBytes && node.memoryUsedBytes) {
        const memRatio = node.memoryUsedBytes / node.memoryTotalBytes;
        if (memRatio > 0.9) {
          issues.push({
            category: "node",
            description: `Node "${node.node}" has memory usage at ${Math.round(memRatio * 100)}%. Consider migrating workloads.`,
            id: `node-memory-${node.node}`,
            resourceLabel: node.node,
            resourceLink: `/sites/${siteSlug}`,
            severity: "warning",
            title: `High memory usage: ${node.node}`,
          });
        }
      }
    }

    // 3. Backup coverage
    if (backupOverview) {
      for (const vmid of backupOverview.unprotectedVmids) {
        const deployment = overview.deployments.find((d) => d.vmid === vmid);
        const name = deployment?.name ?? `VMID ${vmid}`;
        const link = deployment ? `/sites/${siteSlug}/deployments/${deployment.id}` : null;
        issues.push({
          category: "backup",
          description: `"${name}" (VMID ${vmid}) has no backup archives. Create a backup or configure a backup policy.`,
          id: `backup-unprotected-${vmid}`,
          resourceLabel: name,
          resourceLink: link,
          severity: "warning",
          title: `No backups: ${name}`,
        });
      }
    }

    // 4. Deployment disk overuse
    for (const d of overview.deployments) {
      if (d.diskTotalBytes && d.diskUsedBytes) {
        const diskRatio = d.diskUsedBytes / d.diskTotalBytes;
        if (diskRatio > 0.9) {
          issues.push({
            category: "deployment",
            description: `"${d.name}" (VMID ${d.vmid}) disk is ${Math.round(diskRatio * 100)}% full. Consider expanding or cleaning up.`,
            id: `deployment-disk-${d.vmid}`,
            resourceLabel: d.name,
            resourceLink: `/sites/${siteSlug}/deployments/${d.id}`,
            severity: "warning",
            title: `Disk nearly full: ${d.name}`,
          });
        }
      }
    }

    // 5. Stopped deployments that may need attention
    const stoppedCount = overview.deployments.filter((d) => d.rawStatus === "stopped").length;
    if (stoppedCount > 0) {
      issues.push({
        category: "deployment",
        description: `${stoppedCount} deployment(s) are currently stopped. Verify these are intentionally offline.`,
        id: "deployments-stopped",
        resourceLabel: `${stoppedCount} stopped`,
        resourceLink: `/sites/${siteSlug}/deployments`,
        severity: "info",
        title: `${stoppedCount} stopped deployment(s)`,
      });
    }

    return issues;
  });

  return {
    issues: report,
    scanDurationMs: Date.now() - start,
    scannedAt: new Date().toISOString(),
  };
}
