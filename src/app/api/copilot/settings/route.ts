import { NextResponse } from "next/server";

import { recordAdminAudit } from "@/lib/admin-audit-log";
import { getCurrentSession, listManagedUsers } from "@/lib/auth";
import {
  getCopilotSettings,
  getCopilotUsage,
  listCopilotUsageSummaries,
  saveCopilotSettings,
  validateCopilotBaseUrl,
  type CopilotSettingsInput,
  type GroupToolPolicy,
} from "@/lib/copilot/store";
import { listUserGroups } from "@/lib/user-groups";
import type { CopilotModel } from "@/lib/copilot/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = session.user.role === "admin";
  const [settings, usage] = await Promise.all([
    getCopilotSettings(),
    getCopilotUsage(session.user.id),
  ]);

  if (!isAdmin) {
    return NextResponse.json({ settings, usage, isAdmin });
  }

  // Admin extras: the group list for the tool-policy editor, and per-user
  // usage joined with names so the panel can show who is spending what.
  const [groups, summaries, users] = await Promise.all([
    listUserGroups(),
    listCopilotUsageSummaries(),
    listManagedUsers(),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const userUsage = summaries.map((s) => ({
    ...s,
    email: userById.get(s.userId)?.email ?? "(deleted user)",
    name: userById.get(s.userId)?.name ?? s.userId,
  }));

  return NextResponse.json({
    settings,
    usage,
    isAdmin,
    groups: groups.map((g) => ({ id: g.id, name: g.name, isAdmin: g.isAdmin })),
    userUsage,
  });
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
  if (body.model === "fast" || body.model === "smart" || body.model === "kimi") {
    update.model = body.model;
  }
  if (body.baseUrl === null) {
    update.baseUrl = null;
  } else if (typeof body.baseUrl === "string") {
    const trimmed = body.baseUrl.trim();
    if (!trimmed) {
      update.baseUrl = null;
    } else {
      try {
        update.baseUrl = validateCopilotBaseUrl(trimmed);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Invalid endpoint URL" },
          { status: 400 },
        );
      }
    }
  }
  if (body.customModelId === null || typeof body.customModelId === "string") {
    update.customModelId = body.customModelId;
  }
  if (typeof body.dailyTokenBudget === "number" && body.dailyTokenBudget > 0) {
    update.dailyTokenBudget = body.dailyTokenBudget;
  }
  if (typeof body.dailyToolCallBudget === "number" && body.dailyToolCallBudget > 0) {
    update.dailyToolCallBudget = body.dailyToolCallBudget;
  }
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body.operatorNotes === "string") update.operatorNotes = body.operatorNotes;
  if (body.groupPolicies && typeof body.groupPolicies === "object") {
    const validIds = new Set((await listUserGroups()).map((g) => g.id));
    const clean: Record<string, GroupToolPolicy> = {};
    for (const [groupId, policy] of Object.entries(body.groupPolicies)) {
      if (!validIds.has(groupId) || !policy || typeof policy !== "object") continue;
      clean[groupId] = {
        allowWrite: (policy as GroupToolPolicy).allowWrite !== false,
        allowDestructive: (policy as GroupToolPolicy).allowDestructive !== false,
      };
    }
    update.groupPolicies = clean;
  }
  if (body.costPerMInputUsd === null || typeof body.costPerMInputUsd === "number") {
    update.costPerMInputUsd = body.costPerMInputUsd;
  }
  if (body.costPerMOutputUsd === null || typeof body.costPerMOutputUsd === "number") {
    update.costPerMOutputUsd = body.costPerMOutputUsd;
  }

  const updated = await saveCopilotSettings(update);

  await recordAdminAudit({
    action: "copilot-settings-updated",
    actorEmail: session.user.email,
    actorName: session.user.name,
    message: `Updated site-wide copilot settings — model=${updated.modelId}, endpoint=${updated.baseUrl ?? "deepinfra"}, enabled=${updated.enabled}, tokenBudget=${updated.dailyTokenBudget}, hasKey=${updated.hasKey}, restrictedGroups=${Object.keys(updated.groupPolicies).length}`,
  });

  return NextResponse.json({ settings: updated });
}
