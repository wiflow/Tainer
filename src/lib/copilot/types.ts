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
  input_schema: ToolParamSchema;
  describe: (args: ToolArgs) => string;
  confirmString?: ((args: ToolArgs) => string | null) | null;
  plan?: (args: ToolArgs, ctx: ToolExecutionContext) => Promise<ApprovalPlan | null>;
  /** Must enforce requirePermission and requireSiteAccess itself on `session`. */
  execute: (args: ToolArgs, ctx: ToolExecutionContext) => Promise<unknown>;
  returnsExternalContent?: boolean;
};

export type ToolExecutionContext = {
  session: AuthSession;
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

export const COPILOT_PROVIDERS = ["deepinfra", "openai", "custom"] as const;

export type CopilotProvider = (typeof COPILOT_PROVIDERS)[number];

export function isCopilotProvider(value: unknown): value is CopilotProvider {
  return COPILOT_PROVIDERS.includes(value as CopilotProvider);
}

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
  summary: string;
  rows: ApprovalPlanRow[];
  note?: string;
};

export type ApprovalPayload = {
  v: 1;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  userId: string;
  siteSlug: string | null;
  /** Unix ms. */
  expiresAt: number;
  nonce: string;
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
      afterExternalContent: boolean;
    }
  | { type: "turn_end"; stopReason: string; usage: { input: number; output: number } }
  | { type: "error"; message: string };
