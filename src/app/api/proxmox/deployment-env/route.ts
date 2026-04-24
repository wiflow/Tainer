import { NextRequest, NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/auth";
import { getDeploymentDetail, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id")?.trim();
  const siteSlug = request.nextUrl.searchParams.get("siteSlug") ?? "";

  if (!id) {
    return NextResponse.json({ message: "Deployment id is required." }, { status: 400 });
  }

  const handler = async () => {
    try {
      const detail = await getDeploymentDetail(id);

      if (!detail) {
        return NextResponse.json({ message: "Deployment not found." }, { status: 404 });
      }

      return NextResponse.json(
        { envText: detail.envText },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message.slice(0, 200).replace(/\/[^\s]+/g, "[path]") : "Failed to read deployment env." },
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
