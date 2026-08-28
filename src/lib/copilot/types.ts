import type { AuthSession } from "@/lib/auth";

export type ToolClass = "read" | "write" | "destructive" | "admin";

export type ToolParamSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolArgs = Record<string, unknown>;

export type ToolDefinition = {
  name: string;
  description: string;
  category: string;
  klass: ToolClass;
  /**
   * JSON Schema for the tool's arguments. Sent verbatim to the model API
   * as the function-call parameter schema.
   */
  input_schema: ToolParamSchema;
  /**
   * Short human-readable summary of what running this tool will do given
   * the args. Rendered in the approval card for write/destructive/admin
   * tools. e.g. "Restart container CT 101 on node-A".
   */
  describe: (args: ToolArgs) => string;
  /**
   * For destructive tools, the exact string the user must type to confirm
   * (e.g. the container name). Returning null means "approval click is
   * enough — no typed confirmation required". Read tools never have this.
   */
  confirmString?: ((args: ToolArgs) => string | null) | null;
  /**
   * Optional async preview computed at approval time and rendered on the
   * approval card, so the user can see exactly what a gated call will do
   * before confirming once (e.g. the hostnames + IPs a batch create will
   * use). Runs read-only with the caller's session; return null to skip.
   */
  plan?: (args: ToolArgs, ctx: ToolExecutionContext) => Promise<ApprovalPlan | null>;
  /**
   * Executes the tool. The session is the caller's session — every check
   * that the UI does (requirePermission, requireSiteAccess) must be done
   * here. Throw on permission failures; the agent will see the error and
   * surface it.
   */
  execute: (args: ToolArgs, ctx: ToolExecutionContext) => Promise<unknown>;
  /**
   * True when the tool's result contains content authored outside this
   * Tainer instance (e.g. Docker Hub descriptions). Such results are fed to
   * the model wrapped in untrusted-data markers, and any gated action
   * proposed afterwards carries a provenance warning on its approval card.
   */
  returnsExternalContent?: boolean;
};

export type ToolExecutionContext = {
  session: AuthSession;
  /** "ui" for direct UI invocation (not used here), "copilot" for AI. */
  via: "copilot";
};

export type ChatRole = "user" | "assistant" | "system";

export type ChatToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ChatToolResult = {
  toolCallId: string;
  /** JSON-serialisable result; errors should be `{ error: string }`. */
  content: unknown;
  isError?: boolean;
};

export type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: ChatToolCall[];
    }
  | { role: "tool"; results: ChatToolResult[] };

export type CopilotModel = "fast" | "smart" | "kimi";

/** DeepInfra model ids (OpenAI-compatible endpoint). */
export const COPILOT_MODEL_IDS: Record<CopilotModel, string> = {
  fast: "google/gemma-4-26B-A4B-it",
  smart: "google/gemma-4-31B-it",
  kimi: "moonshotai/Kimi-K3",
};

export type ApprovalPlanRow = {
  hostname: string;
  vmid: number | null;
  /** Assigned IPv4/CIDR, or "DHCP". */
  ip: string;
};

export type ApprovalPlan = {
  /** One-line summary, e.g. '10 containers from template "grafana"'. */
  summary: string;
  rows: ApprovalPlanRow[];
  /** Optional footnote, e.g. 'Static IPs from pool "servers"'. */
  note?: string;
};

export type ApprovalPayload = {
  v: 1;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  userId: string;
  /** Active site slug at the time the call was proposed (if any). */
  siteSlug: string | null;
  /** Unix ms. */
  expiresAt: number;
};

export type CopilotStreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call_started"; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; toolCallId: string; content: unknown; isError: boolean; durationMs: number }
  | {
      type: "approval_required";
      toolCallId: string;
      name: string;
      category: string;
      klass: Exclude<ToolClass, "read">;
      args: Record<string, unknown>;
      describe: string;
      confirmString: string | null;
      plan?: ApprovalPlan | null;
      token: string;
      /** External (e.g. Docker Hub) content entered the conversation before
       *  this action was proposed — the approval card shows a provenance
       *  warning so the user double-checks the action matches their ask. */
      afterExternalContent: boolean;
    }
  | { type: "turn_end"; stopReason: string; usage: { input: number; output: number } }
  | { type: "error"; message: string };
