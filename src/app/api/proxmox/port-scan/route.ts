import { NextRequest, NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/auth";
import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import { getDeploymentDetail, withSiteConfig } from "@/lib/proxmox";
import { scanPorts } from "@/lib/port-scan";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export const dynamic = "force-dynamic";

const PORT_SCAN_MAX_REQUESTS = 5;
const PORT_SCAN_WINDOW_MS = 60_000;
const portScanCounts = new Map<string, { count: number; firstRequest: number }>();

function checkPortScanRateLimit(userId: string) {
  const now = Date.now();
  const cutoff = now - PORT_SCAN_WINDOW_MS;

  for (const [key, entry] of portScanCounts) {
    if (entry.firstRequest < cutoff) portScanCounts.delete(key);
  }

  const entry = portScanCounts.get(userId);
  if (entry && entry.count >= PORT_SCAN_MAX_REQUESTS) {
    return false;
  }

  if (entry) {
    entry.count += 1;
  } else {
    portScanCounts.set(userId, { count: 1, firstRequest: now });
  }

  return true;
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireAdminSession();
  } catch {
    return NextResponse.json({ message: "Administrator access required." }, { status: 403 });
  }

  if (!checkPortScanRateLimit(session.user.id)) {
    return NextResponse.json(
      { message: "Too many port scan requests. Try again in a minute." },
      { status: 429 },
    );
  }

  const siteSlug = request.nextUrl.searchParams.get("siteSlug") ?? "";

  let id: string | undefined;
  try {
    const body = await request.json() as { id?: string };
    id = body.id?.trim();
  } catch {
    return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
  }

  if (!id) {
    return NextResponse.json({ message: "Deployment id is required." }, { status: 400 });
  }

  const handler = async () => {
    try {
      const deployment = await getDeploymentDetail(id);

      if (!deployment) {
        return NextResponse.json({ message: "Deployment not found." }, { status: 404 });
      }

      if (deployment.type !== "lxc") {
        return NextResponse.json(
          { message: "Port scanning currently supports LXC containers only." },
          { status: 400 },
        );
      }

      const ip = deployment.ipAddress.trim();

      if (!ip || ip === "Unavailable" || ip === "DHCP" || ip === "No IP") {
        return NextResponse.json(
          { message: "Deployment does not have a routable IP address." },
          { status: 400 },
        );
      }

      const results = await scanPorts(ip, deployment.node, deployment.vmid);

      recordDeploymentActivity({
        action: "port-scanned",
        deploymentId: id,
        message: `Port scan (${results.length} open)`,
        userEmail: session.user.email,
        userName: session.user.name,
        vmid: deployment.vmid,
      }).catch(() => {});

      return NextResponse.json(
        { results },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message.slice(0, 200).replace(/\/[^\s]+/g, "[path]") : "Port scan failed." },
        { status: 500 },
      );
    }
  };

  if (siteSlug) {
    const config = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(config, handler);
  }

  return handler();
}
