import { NextResponse } from "next/server";

import { recordAdminAudit } from "@/lib/admin-audit-log";
import { getCurrentSession } from "@/lib/auth";
import {
  getCopilotSettings,
  getCopilotUsage,
  saveCopilotSettings,
  type CopilotSettingsInput,
} from "@/lib/copilot/store";
import type { CopilotModel } from "@/lib/copilot/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [settings, usage] = await Promise.all([
    getCopilotSettings(),
    getCopilotUsage(session.user.id),
  ]);
  return NextResponse.json({ settings, usage, isAdmin: session.user.role === "admin" });
}

export async function PUT(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The key and budgets are site-wide — only admins may change them.
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  let body: Partial<CopilotSettingsInput> & {
    apiKey?: string | null;
    model?: CopilotModel;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Coerce/validate. The store layer is also defensive but we don't want
  // to pass garbage through.
  const update: CopilotSettingsInput = {};
  if (body.apiKey === null) {
    update.apiKey = null;
  } else if (typeof body.apiKey === "string") {
    update.apiKey = body.apiKey.trim() || null;
  }
  if (body.model === "fast" || body.model === "smart") update.model = body.model;
  if (typeof body.dailyTokenBudget === "number" && body.dailyTokenBudget > 0) {
    update.dailyTokenBudget = body.dailyTokenBudget;
  }
  if (typeof body.dailyToolCallBudget === "number" && body.dailyToolCallBudget > 0) {
    update.dailyToolCallBudget = body.dailyToolCallBudget;
  }
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;

  const updated = await saveCopilotSettings(update);

  await recordAdminAudit({
    action: "copilot-settings-updated",
    actorEmail: session.user.email,
    actorName: session.user.name,
    message: `Updated site-wide copilot settings — model=${updated.model}, enabled=${updated.enabled}, tokenBudget=${updated.dailyTokenBudget}, hasKey=${updated.hasKey}`,
  });

  return NextResponse.json({ settings: updated });
}
