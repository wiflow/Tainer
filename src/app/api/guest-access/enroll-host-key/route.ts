import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/auth";
import { enrollGuestHostKey } from "@/lib/guest-host-keys";
import { extractSshHost } from "@/lib/guest-access";
import { getDeploymentDetail, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

function validateOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    const originUrl = new URL(origin);
    // Use x-forwarded-host (reverse proxy) or Host header instead of request.url,
    // which may reflect the internal server address behind a proxy.
    const expectedHost =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      new URL(request.url).host;
    if (originUrl.host !== expectedHost) {
      throw new Error("Cross-origin request rejected.");
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("Cross-origin")) throw e;
    throw new Error("Invalid request origin.");
  }
}

export async function POST(request: Request) {
  try {
    validateOrigin(request);
    await requireAdminSession();

    const payload = (await request.json()) as { deploymentId?: string; siteSlug?: string };
    const deploymentId = String(payload.deploymentId ?? "").trim();
    const siteSlug = String(payload.siteSlug ?? "").trim();

    if (!deploymentId) {
      return NextResponse.json({ error: "Missing deployment reference." }, { status: 400 });
    }

    let deployment;
    if (siteSlug) {
      const siteConfig = await resolveSiteConfigBySlug(siteSlug);
      deployment = await withSiteConfig(siteConfig, () => getDeploymentDetail(deploymentId));
    } else {
      deployment = await getDeploymentDetail(deploymentId);
    }
    if (!deployment) {
      return NextResponse.json({ error: "Deployment not found." }, { status: 404 });
    }

    const host = extractSshHost(deployment.networkInfo?.ipAddress ?? deployment.ipAddress);
    if (!host) {
      return NextResponse.json({ error: "Guest IP is not available for host-key enrollment yet." }, { status: 400 });
    }

    const record = await enrollGuestHostKey({
      host,
      node: deployment.node,
      type: deployment.type,
      vmid: deployment.vmid,
    });

    return NextResponse.json({
      fingerprint: record.fingerprint,
      host: record.host,
      pinnedAt: record.pinnedAt,
      success: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to enroll the guest host key." },
      { status: 400 },
    );
  }
}
