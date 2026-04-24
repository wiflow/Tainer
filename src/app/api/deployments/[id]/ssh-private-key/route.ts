import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/auth";
import { getGeneratedDeploymentSshPrivateKey } from "@/lib/deployment-ssh-keys";
import { getDeploymentDetail, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireAdminSession();

    const { id } = await context.params;
    const deploymentId = String(id ?? "").trim();

    if (!deploymentId) {
      return NextResponse.json({ error: "Missing deployment reference." }, { status: 400 });
    }

    const url = new URL(request.url);
    const siteSlug = url.searchParams.get("siteSlug") ?? "";

    const handler = async () => {
      const deployment = await getDeploymentDetail(deploymentId);
      if (!deployment) {
        return NextResponse.json({ error: "Deployment not found." }, { status: 404 });
      }

      if (deployment.tainerMeta?.localSsh?.mode !== "generated") {
        return NextResponse.json({ error: "This deployment does not have a downloadable private key." }, { status: 404 });
      }

      const storedKey = await getGeneratedDeploymentSshPrivateKey(deploymentId);
      if (!storedKey) {
        return NextResponse.json({ error: "Private key file is no longer available." }, { status: 404 });
      }

      return new Response(`${storedKey.privateKey.trimEnd()}\n`, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${storedKey.fileName}"`,
          "Content-Type": "application/x-pem-file; charset=utf-8",
        },
        status: 200,
      });
    };

    if (siteSlug) {
      const config = await resolveSiteConfigBySlug(siteSlug);
      return withSiteConfig(config, handler);
    }

    return handler();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to download the private key." },
      { status: 400 },
    );
  }
}
