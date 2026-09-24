import "server-only";

import { getAdminAuditLog } from "@/lib/admin-audit-log";
import { registerTool } from "@/lib/copilot/registry";

registerTool({
  name: "get_audit_log",
  category: "Diagnostics",
  klass: "admin",
  returnsExternalContent: true,
  description:
    "Read recent admin audit log entries (login attempts, settings changes, copilot activity, etc.). Admin role required. Use this to investigate 'who did X?' or 'when was the last failed login?' questions.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 200,
        description: "Number of most-recent entries to return. Default 50.",
      },
    },
    required: [],
  },
  describe: (args) => `Read audit log (limit=${args.limit ?? 50})`,
  execute: async (args, ctx) => {
    if (ctx.session.user.role !== "admin") {
      throw new Error("Administrator access required for get_audit_log.");
    }
    const limit = Math.min(200, Math.max(1, Number(args.limit ?? 50)));
    const entries = await getAdminAuditLog(limit);
    return entries.map((e) => ({
      id: e.id,
      action: e.action,
      message: e.message,
      actorName: e.actorName,
      actorEmail: e.actorEmail,
      targetEmail: e.targetEmail,
      recordedAt: e.recordedAt,
    }));
  },
});
