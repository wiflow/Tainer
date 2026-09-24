import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { consumeApprovalToken } from "@/lib/copilot/approval";
import { recordCopilotAudit } from "@/lib/copilot/audit";
import { executeApprovedTool } from "@/lib/copilot/run";
import { ensureSiteConfig } from "@/lib/site-context";
import { withSiteConfig } from "@/lib/proxmox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApprovePayload = {
  token: string;
  decision: "approve" | "deny";
};

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ApprovePayload;
  try {
    body = (await request.json()) as ApprovePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.token !== "string" || (body.decision !== "approve" && body.decision !== "deny")) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  let payload;
  try {
    payload = await consumeApprovalToken(body.token, session.user.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid token" },
      { status: 400 },
    );
  }

  if (body.decision === "deny") {
    await recordCopilotAudit({
      session,
      toolName: payload.toolName,
      klass: "write",
      args: payload.args,
      outcome: "denied",
    });
    return NextResponse.json({
      toolCallId: payload.toolCallId,
      decision: "deny",
    });
  }

  // The tool re-checks site access on `session`, so a tampered siteSlug is rejected.
  const run = async () => executeApprovedTool(session, payload.toolName, payload.args);
  const { result, isError } = payload.siteSlug
    ? await withSiteConfig(await ensureSiteConfig(payload.siteSlug), run)
    : await run();

  return NextResponse.json({
    toolCallId: payload.toolCallId,
    decision: "approve",
    result,
    isError,
  });
}
