import "server-only";

import type { AuthSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/admin-audit-log";
import type { ToolClass } from "@/lib/copilot/types";

type AuditInput = {
  session: AuthSession;
  toolName: string;
  klass: ToolClass;
  args: Record<string, unknown>;
  outcome: "approved" | "denied" | "executed" | "failed" | "budget-exceeded";
  detail?: string;
};

/**
 * Every copilot tool-use lifecycle event lands in the admin audit log.
 * Read-class auto-runs do NOT audit individually (they'd flood the log);
 * the message itself is audited once at copilot-message-sent. Write,
 * destructive, and admin tools always audit on approval and execution.
 */
export async function recordCopilotAudit(input: AuditInput): Promise<void> {
  const verb = ({
    approved: "approved",
    denied: "denied",
    executed: "executed",
    failed: "failed",
    "budget-exceeded": "exceeded budget on",
  } as const)[input.outcome];

  const argsStr = formatArgs(input.args);
  const detail = input.detail ? ` — ${input.detail}` : "";
  const message = `Tainy ${verb} ${input.klass} tool ${input.toolName}${
    argsStr ? ` (${argsStr})` : ""
  }${detail}`;

  await recordAdminAudit({
    action:
      input.outcome === "denied"
        ? "copilot-tool-denied"
        : input.outcome === "executed"
          ? "copilot-tool-executed"
          : input.outcome === "failed"
            ? "copilot-tool-failed"
            : input.outcome === "budget-exceeded"
              ? "copilot-budget-exceeded"
              : "copilot-tool-approved",
    actorEmail: input.session.user.email,
    actorName: input.session.user.name,
    message,
  });
}

function formatArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (v === null || typeof v === "undefined") continue;
    if (typeof v === "object") {
      parts.push(`${k}=…`);
    } else {
      const s = String(v);
      parts.push(`${k}=${s.length > 40 ? `${s.slice(0, 40)}…` : s}`);
    }
    if (parts.length >= 4) break;
  }
  return parts.join(", ");
}
