import "server-only";

import { runCveScan, type CveScanReport } from "@/lib/cve-scanner";
import { getLastScanResults } from "@/lib/cve-history";
import { runDiagnosticScan } from "@/lib/diagnostics";
import { registerTool } from "@/lib/copilot/registry";
import {
  resolveSiteForUser,
  runInSite,
  runInSiteWithPermission,
  siteSlugSchema,
} from "@/lib/copilot/tools/helpers";

function leanCveReport(report: CveScanReport) {
  return {
    scannedAt: report.scannedAt,
    summary: report.summary,
    nodes: report.nodes.map((n) => ({
      node: n.node,
      cveCount: n.cves?.length ?? 0,
      securityUpdates: n.securityUpdateCount ?? null,
      error: n.error ?? null,
    })),
    guests: report.guests
      .filter((g) => (g.cves?.length ?? 0) > 0 || g.error)
      .map((g) => ({
        vmid: g.vmid,
        name: g.name,
        cveCount: g.cves?.length ?? 0,
        error: g.error ?? null,
      })),
  };
}

registerTool({
  name: "get_cve_report",
  category: "Diagnostics",
  klass: "read",
  description:
    "Return the most recent CVE scan results for a site (nodes + guests, CVE counts, pending security updates) without launching a new scan. Use for 'any known vulnerabilities?', 'what's the last CVE scan show?'. Use run_cve_scan to refresh.",
  input_schema: siteSlugSchema(),
  describe: (args) => `Read last CVE scan for site ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const config = await resolveSiteForUser(ctx.session, siteSlug);
    const report = await getLastScanResults(config.siteId);
    if (!report) return { error: "No CVE scan has been run for this site yet. Use run_cve_scan." };
    return leanCveReport(report);
  },
});

registerTool({
  name: "run_cve_scan",
  category: "Diagnostics",
  klass: "write",
  description:
    "Launch a fresh CVE / security-update scan across a site's nodes and running guests (uses debsecan + apt over SSH). This can take a while on large clusters. Requires the manage-security permission. For just reading the previous results, use get_cve_report instead.",
  input_schema: siteSlugSchema(),
  describe: (args) => `Run a CVE scan on site ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSiteWithPermission(ctx.session, siteSlug, "manage-security", async () => {
      const report = await runCveScan(siteSlug);
      return { verb: "cve-scan", ...leanCveReport(report) };
    });
  },
});

registerTool({
  name: "run_diagnostics",
  category: "Diagnostics",
  klass: "read",
  description:
    "Run a health diagnostic scan of a site. Surfaces issues like nodes offline, storage nearly full, guests without recent backups, resource pressure, etc. Returns a categorised issue list with severities. Use for 'is prod healthy?', 'what's wrong with this site?', 'anything I should worry about?'.",
  input_schema: siteSlugSchema(),
  describe: (args) => `Run diagnostics on site ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const report = await runDiagnosticScan(siteSlug);
      const bySeverity: Record<string, number> = {};
      for (const issue of report.issues) {
        bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
      }
      return {
        scannedAt: report.scannedAt,
        issueCount: report.issues.length,
        bySeverity,
        issues: report.issues.map((i) => ({
          severity: i.severity,
          category: i.category,
          title: i.title,
          description: i.description,
          resource: i.resourceLabel,
        })),
      };
    });
  },
});
