import { getOverviewData, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { listEnabledSites } from "@/lib/site-store";

export const dynamic = "force-dynamic";

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function metric(name: string, labels: Record<string, string>, value: number): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(",");
  return `${name}{${labelStr}} ${value}`;
}

export async function GET(request: Request) {
  const token = process.env.METRICS_TOKEN;
  if (!token) {
    return new Response("Metrics endpoint disabled. Set METRICS_TOKEN env var.\n", {
      status: 503,
    });
  }

  const auth = request.headers.get("authorization");
  if (!auth || auth !== `Bearer ${token}`) {
    return new Response("Unauthorized\n", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const siteSlug = searchParams.get("siteSlug");

  try {
    const lines: string[] = [];

    if (siteSlug) {
      const siteConfig = await resolveSiteConfigBySlug(siteSlug);
      const overview = await withSiteConfig(siteConfig, () => getOverviewData());
      emitMetrics(lines, overview, siteSlug);
    } else {
      const sites = await listEnabledSites();
      for (const site of sites) {
        try {
          const siteConfig = await resolveSiteConfigBySlug(site.slug);
          const overview = await withSiteConfig(siteConfig, () => getOverviewData());
          emitMetrics(lines, overview, site.slug);
        } catch {}
      }
    }

    lines.push("");
    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Failed to collect metrics\n", { status: 500 });
  }
}

type OverviewLike = Awaited<ReturnType<typeof getOverviewData>>;

function emitMetrics(lines: string[], overview: OverviewLike, site: string) {
  lines.push("# HELP tainer_node_cpu_usage Current CPU usage ratio (0-1)");
  lines.push("# TYPE tainer_node_cpu_usage gauge");
  for (const n of overview.nodeMetrics) {
    if (n.cpuRatio != null) {
      lines.push(metric("tainer_node_cpu_usage", { node: n.node, site }, n.cpuRatio));
    }
  }

  lines.push("# HELP tainer_node_memory_usage_bytes Current memory usage in bytes");
  lines.push("# TYPE tainer_node_memory_usage_bytes gauge");
  lines.push("# HELP tainer_node_memory_total_bytes Total memory in bytes");
  lines.push("# TYPE tainer_node_memory_total_bytes gauge");
  for (const n of overview.nodeMetrics) {
    if (n.memoryUsedBytes != null) {
      lines.push(metric("tainer_node_memory_usage_bytes", { node: n.node, site }, n.memoryUsedBytes));
    }
    if (n.memoryTotalBytes != null) {
      lines.push(metric("tainer_node_memory_total_bytes", { node: n.node, site }, n.memoryTotalBytes));
    }
  }

  lines.push("# HELP tainer_deployment_up 1 if running, 0 otherwise");
  lines.push("# TYPE tainer_deployment_up gauge");
  lines.push("# HELP tainer_deployment_cpu_usage Current CPU usage ratio (0-1)");
  lines.push("# TYPE tainer_deployment_cpu_usage gauge");
  lines.push("# HELP tainer_deployment_memory_usage_bytes Current memory usage in bytes");
  lines.push("# TYPE tainer_deployment_memory_usage_bytes gauge");
  lines.push("# HELP tainer_deployment_disk_usage_bytes Current disk usage in bytes");
  lines.push("# TYPE tainer_deployment_disk_usage_bytes gauge");

  for (const d of overview.deployments) {
    const labels = { vmid: String(d.vmid), name: d.name, node: d.node, type: d.type, site };
    lines.push(metric("tainer_deployment_up", labels, d.rawStatus === "running" ? 1 : 0));
    if (d.cpuUsage != null) {
      lines.push(metric("tainer_deployment_cpu_usage", labels, d.cpuUsage));
    }
    if (d.memUsedBytes != null) {
      lines.push(metric("tainer_deployment_memory_usage_bytes", labels, d.memUsedBytes));
    }
    if (d.diskUsedBytes != null) {
      lines.push(metric("tainer_deployment_disk_usage_bytes", labels, d.diskUsedBytes));
    }
  }

  lines.push("# HELP tainer_storage_usage_bytes Current storage usage in bytes");
  lines.push("# TYPE tainer_storage_usage_bytes gauge");
  lines.push("# HELP tainer_storage_total_bytes Total storage capacity in bytes");
  lines.push("# TYPE tainer_storage_total_bytes gauge");
  for (const s of overview.storagePools) {
    const labels = { storage: s.storage, node: s.node, type: s.type, site };
    if (s.usedBytes != null) {
      lines.push(metric("tainer_storage_usage_bytes", labels, s.usedBytes));
    }
    if (s.totalBytes != null) {
      lines.push(metric("tainer_storage_total_bytes", labels, s.totalBytes));
    }
  }

  lines.push("# HELP tainer_cluster_deployments_total Total number of deployments");
  lines.push("# TYPE tainer_cluster_deployments_total gauge");
  lines.push(metric("tainer_cluster_deployments_total", { site }, overview.deployments.length));

  lines.push("# HELP tainer_cluster_nodes_total Total number of nodes");
  lines.push("# TYPE tainer_cluster_nodes_total gauge");
  lines.push(metric("tainer_cluster_nodes_total", { site }, overview.nodes.length));
}
