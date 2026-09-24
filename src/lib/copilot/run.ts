import "server-only";

import type { AuthSession } from "@/lib/auth";
import {
  DeepInfraApiError,
  streamDeepInfra,
  type OpenAiMessage,
  type OpenAiToolCall,
} from "@/lib/copilot/deepinfra";
import { recordCopilotAudit } from "@/lib/copilot/audit";
import { mintApprovalToken } from "@/lib/copilot/approval";
import { redactCredentials } from "@/lib/copilot/redact";
import { buildSystemPrompt, type SidebarContext } from "@/lib/copilot/system-prompt";
import {
  getCopilotApiKey,
  getCopilotSettings,
  getCopilotUsage,
  getGroupToolPolicyForUser,
  recordCopilotUsage,
  type GroupToolPolicy,
} from "@/lib/copilot/store";
import "@/lib/copilot/tools";
import { getTool, listToolsForModel } from "@/lib/copilot/registry";
import type {
  ChatMessage,
  CopilotStreamEvent,
  ToolClass,
} from "@/lib/copilot/types";

const MAX_TOOL_CALLS_PER_TURN = 15;
const MAX_ROUNDS_PER_TURN = 8;
const MAX_TOKENS_PER_RESPONSE = 4096;

// In-memory per-user window; assumes a single server process.
const MAX_TURNS_PER_MINUTE = 10;
const TURN_RATE_WINDOW_MS = 60_000;
const turnTimestamps = new Map<string, number[]>();

function checkTurnRateLimit(userId: string): boolean {
  const now = Date.now();
  const recent = (turnTimestamps.get(userId) ?? []).filter(
    (t) => now - t < TURN_RATE_WINDOW_MS,
  );
  if (recent.length >= MAX_TURNS_PER_MINUTE) {
    turnTimestamps.set(userId, recent);
    return false;
  }
  recent.push(now);
  turnTimestamps.set(userId, recent);
  return true;
}

function klassAllowedByPolicy(klass: ToolClass, policy: GroupToolPolicy): boolean {
  if (klass === "read") return true;
  if (klass === "destructive") return policy.allowDestructive;
  return policy.allowWrite;
}

function fenceExternalContent(json: string): string {
  const escaped = json.replace(/</g, "\\u003c");
  return `<<EXTERNAL_UNTRUSTED_DATA>>\n${escaped}\n<<END_EXTERNAL_UNTRUSTED_DATA>>`;
}

function historyHasExternalContent(messages: ChatMessage[]): boolean {
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const tc of msg.toolCalls ?? []) {
      if (getTool(tc.name)?.returnsExternalContent) return true;
    }
  }
  return false;
}

export type RunInput = {
  session: AuthSession;
  context: SidebarContext;
  messages: ChatMessage[];
};

export async function* runCopilotTurn(
  input: RunInput,
): AsyncGenerator<CopilotStreamEvent> {
  const { session } = input;

  const settings = await getCopilotSettings();
  if (!settings.enabled) {
    yield { type: "error", message: "Tainy is disabled for this site." };
    return;
  }

  const apiKey = await getCopilotApiKey();
  if (!apiKey && !settings.baseUrl) {
    yield {
      type: "error",
      message:
        "No DeepInfra API key configured. An admin can add one in Settings → Tainy. Get a key at https://deepinfra.com/dash/api_keys.",
    };
    return;
  }

  if (!checkTurnRateLimit(session.user.id)) {
    await recordCopilotAudit({
      session,
      toolName: "(turn)",
      klass: "read",
      args: {},
      outcome: "budget-exceeded",
      detail: `Turn rate limit hit (${MAX_TURNS_PER_MINUTE}/min)`,
    });
    yield {
      type: "error",
      message: `Slow down — at most ${MAX_TURNS_PER_MINUTE} messages per minute. Wait a moment and try again.`,
    };
    return;
  }

  const usage = await getCopilotUsage(session.user.id);
  if (usage.tokensRemaining <= 0) {
    await recordCopilotAudit({
      session,
      toolName: "(turn)",
      klass: "read",
      args: {},
      outcome: "budget-exceeded",
      detail: `Daily token budget exhausted (${usage.tokenBudget})`,
    });
    yield {
      type: "error",
      message: `Daily token budget exhausted (${usage.tokenBudget}). Resets at 00:00 UTC — an admin can raise it in Settings → Tainy.`,
    };
    return;
  }
  if (usage.toolCallsRemaining <= 0) {
    yield {
      type: "error",
      message: `Daily tool-call budget exhausted (${usage.toolCallBudget}). Resets at 00:00 UTC — an admin can raise it in Settings → Tainy.`,
    };
    return;
  }

  const systemPrompt = await buildSystemPrompt(session, input.context, {
    operatorNotes: settings.operatorNotes,
  });
  const policy = await getGroupToolPolicyForUser(session.user);
  const tools = listToolsForModel((tool) => klassAllowedByPolicy(tool.klass, policy));
  const modelId = settings.modelId;

  const chatMessages: OpenAiMessage[] = [
    { role: "system", content: systemPrompt },
    ...toOpenAiMessages(input.messages),
  ];

  let toolCallsThisTurn = 0;
  let rounds = 0;
  let inputTokensAccum = 0;
  let outputTokensAccum = 0;
  let externalContentSeen = historyHasExternalContent(input.messages);

  // The finally block records usage even if the client disconnects mid-stream.
  try {
    while (true) {
      if (toolCallsThisTurn >= MAX_TOOL_CALLS_PER_TURN) {
        yield {
          type: "error",
          message: `Reached the per-turn tool-call ceiling (${MAX_TOOL_CALLS_PER_TURN}). Refine the question.`,
        };
        break;
      }
      if (rounds >= MAX_ROUNDS_PER_TURN) {
        yield {
          type: "error",
          message: `Reached the per-turn round limit (${MAX_ROUNDS_PER_TURN}). Refine the question.`,
        };
        break;
      }
      if (inputTokensAccum + outputTokensAccum >= usage.tokensRemaining) {
        yield {
          type: "error",
          message: `Daily token budget exhausted (${usage.tokenBudget}). Resets at 00:00 UTC.`,
        };
        break;
      }
      if (toolCallsThisTurn >= usage.toolCallsRemaining) {
        yield {
          type: "error",
          message: `Daily tool-call budget exhausted (${usage.toolCallBudget}). Resets at 00:00 UTC.`,
        };
        break;
      }
      rounds++;

      let visible = "";
      let toolCalls: OpenAiToolCall[] = [];
      let finishReason = "stop";
      try {
        const roundEvents: CopilotStreamEvent[] = [];
        const splitter = createThinkSplitter((kind, text) => {
          if (kind === "text") {
            visible += text;
            roundEvents.push({ type: "text", text });
          } else {
            roundEvents.push({ type: "reasoning", text });
          }
        });

        const stream = streamDeepInfra(
          apiKey,
          {
            model: modelId,
            max_tokens: MAX_TOKENS_PER_RESPONSE,
            messages: chatMessages,
            tools,
          },
          { signal: AbortSignal.timeout(120_000), baseUrl: settings.baseUrl },
        );

        while (true) {
          const { value, done } = await stream.next();
          if (done) {
            splitter.flush();
            toolCalls = value.toolCalls.slice(
              0,
              Math.min(MAX_TOOL_CALLS_PER_TURN, usage.toolCallsRemaining) - toolCallsThisTurn,
            );
            finishReason = value.finishReason;
            inputTokensAccum += value.usage?.prompt_tokens ?? 0;
            outputTokensAccum += value.usage?.completion_tokens ?? 0;
            for (const ev of roundEvents.splice(0)) yield ev;
            break;
          }
          if (value.type === "content") {
            splitter.push(value.text);
          } else {
            roundEvents.push({ type: "reasoning", text: value.text });
          }
          for (const ev of roundEvents.splice(0)) yield ev;
        }
      } catch (err) {
        const apiLabel = settings.baseUrl ? "Model API" : "DeepInfra API";
        const message =
          err instanceof DeepInfraApiError
            ? `${apiLabel} ${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : `Unknown ${apiLabel} error`;
        yield { type: "error", message };
        break;
      }

      chatMessages.push({
        role: "assistant",
        content: visible.trim() || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });

      if (toolCalls.length === 0) {
        yield {
          type: "turn_end",
          stopReason: finishReason,
          usage: { input: inputTokensAccum, output: outputTokensAccum },
        };
        break;
      }

      // The API needs a tool message for every tool_call, so reads run before pausing.
      const toolResults: OpenAiMessage[] = [];
      let pendingApproval: {
        tc: OpenAiToolCall;
        args: Record<string, unknown>;
        tool: NonNullable<ReturnType<typeof getTool>>;
      } | null = null;

      for (const tc of toolCalls) {
        const emitError = (message: string): OpenAiMessage => ({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: message }),
        });

        const tool = getTool(tc.function.name);
        if (!tool) {
          toolCallsThisTurn++;
          toolResults.push(emitError(`Unknown tool: ${tc.function.name}`));
          yield {
            type: "tool_result",
            toolCallId: tc.id,
            content: { error: `Unknown tool: ${tc.function.name}` },
            isError: true,
            durationMs: 0,
          };
          continue;
        }

        let args: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(tc.function.arguments || "{}");
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("arguments must be a JSON object");
          }
          args = parsed as Record<string, unknown>;
        } catch {
          const message = `Malformed JSON arguments for ${tc.function.name}.`;
          toolCallsThisTurn++;
          toolResults.push(emitError(message));
          yield {
            type: "tool_result",
            toolCallId: tc.id,
            content: { error: message },
            isError: true,
            durationMs: 0,
          };
          continue;
        }

        if (tool.klass !== "read") {
          // The model can call a denied tool by name, so re-check the policy here.
          if (!klassAllowedByPolicy(tool.klass, policy)) {
            const message = `The tool ${tc.function.name} is disabled for your group by this site's copilot policy.`;
            await recordCopilotAudit({
              session,
              toolName: tc.function.name,
              klass: tool.klass,
              args,
              outcome: "denied",
              detail: "Blocked by group tool policy",
            });
            toolCallsThisTurn++;
            toolResults.push(emitError(message));
            yield {
              type: "tool_result",
              toolCallId: tc.id,
              content: { error: message },
              isError: true,
              durationMs: 0,
            };
            continue;
          }
          if (pendingApproval) {
            const message =
              "Multiple gated tool calls in a single turn aren't allowed. " +
              "Approve the first and ask the assistant to re-issue this one.";
            toolCallsThisTurn++;
            toolResults.push(emitError(message));
            yield {
              type: "tool_result",
              toolCallId: tc.id,
              content: { error: message },
              isError: true,
              durationMs: 0,
            };
            continue;
          }
          pendingApproval = { tc, args, tool };
          continue;
        }

        const startedAt = Date.now();
        toolCallsThisTurn++;
        yield { type: "tool_call_started", toolCallId: tc.id, name: tc.function.name, args };
        try {
          const result = await tool.execute(args, { session, via: "copilot" });
          const resultJson = JSON.stringify(result ?? null);
          if (tool.returnsExternalContent) externalContentSeen = true;
          toolResults.push({
            role: "tool",
            tool_call_id: tc.id,
            content: tool.returnsExternalContent
              ? fenceExternalContent(resultJson)
              : resultJson,
          });
          yield {
            type: "tool_result",
            toolCallId: tc.id,
            content: result ?? null,
            isError: false,
            durationMs: Date.now() - startedAt,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toolResults.push(emitError(message));
          yield {
            type: "tool_result",
            toolCallId: tc.id,
            content: { error: message },
            isError: true,
            durationMs: Date.now() - startedAt,
          };
        }
      }

      if (pendingApproval) {
        const { token } = await mintApprovalToken({
          toolCallId: pendingApproval.tc.id,
          toolName: pendingApproval.tc.function.name,
          args: pendingApproval.args,
          userId: session.user.id,
          siteSlug: input.context.siteSlug ?? null,
        });
        let plan = null;
        if (pendingApproval.tool.plan) {
          try {
            plan = await pendingApproval.tool.plan(pendingApproval.args, {
              session,
              via: "copilot",
            });
          } catch {
            plan = null;
          }
        }
        yield {
          type: "approval_required",
          toolCallId: pendingApproval.tc.id,
          name: pendingApproval.tc.function.name,
          category: pendingApproval.tool.category,
          klass: pendingApproval.tool.klass as Exclude<
            typeof pendingApproval.tool.klass,
            "read"
          >,
          args: pendingApproval.args,
          describe: pendingApproval.tool.describe(pendingApproval.args),
          confirmString: pendingApproval.tool.confirmString
            ? pendingApproval.tool.confirmString(pendingApproval.args)
            : null,
          plan,
          token,
          afterExternalContent: externalContentSeen,
        };
        yield {
          type: "turn_end",
          stopReason: "approval_required",
          usage: { input: inputTokensAccum, output: outputTokensAccum },
        };
        break;
      }

      chatMessages.push(...toolResults);
    }
  } finally {
    await recordCopilotUsage(
      session.user.id,
      inputTokensAccum,
      outputTokensAccum,
      toolCallsThisTurn,
    );
  }
}

const THINK_TAGS = ["<think>", "<thinking>", "</think>", "</thinking>"];
const MAX_THINK_TAG_LENGTH = Math.max(...THINK_TAGS.map((t) => t.length));

function createThinkSplitter(
  emit: (kind: "text" | "reasoning", text: string) => void,
) {
  let buffer = "";
  let inThink = false;

  function holdbackLength(value: string): number {
    const max = Math.min(value.length, MAX_THINK_TAG_LENGTH - 1);
    for (let len = max; len > 0; len--) {
      const suffix = value.slice(-len).toLowerCase();
      if (THINK_TAGS.some((tag) => tag.startsWith(suffix))) return len;
    }
    return 0;
  }

  function push(chunk: string) {
    buffer += chunk;
    while (true) {
      const match = buffer.match(inThink ? /<\/think(?:ing)?>/i : /<think(?:ing)?>/i);
      if (match && match.index !== undefined) {
        const before = buffer.slice(0, match.index);
        if (before) emit(inThink ? "reasoning" : "text", before);
        buffer = buffer.slice(match.index + match[0].length);
        inThink = !inThink;
        continue;
      }
      const hold = holdbackLength(buffer);
      const emitNow = buffer.slice(0, buffer.length - hold);
      if (emitNow) {
        emit(inThink ? "reasoning" : "text", emitNow);
        buffer = buffer.slice(emitNow.length);
      }
      return;
    }
  }

  function flush() {
    if (buffer) {
      emit(inThink ? "reasoning" : "text", buffer);
      buffer = "";
    }
  }

  return { push, flush };
}

function toOpenAiMessages(messages: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "user") {
      out.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      for (const tc of msg.toolCalls ?? []) toolNames.set(tc.id, tc.name);
      const toolCalls: OpenAiToolCall[] = (msg.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      }));
      out.push({
        role: "assistant",
        content: msg.content || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else if (msg.role === "tool") {
      for (const r of msg.results) {
        const json = JSON.stringify(redactCredentials(r.content) ?? null);
        const external = getTool(toolNames.get(r.toolCallId) ?? "")?.returnsExternalContent;
        out.push({
          role: "tool",
          tool_call_id: r.toolCallId,
          content: external ? fenceExternalContent(json) : json,
        });
      }
    }
  }
  return out;
}

export async function executeApprovedTool(
  session: AuthSession,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ result: unknown; isError: boolean }> {
  const tool = getTool(toolName);
  if (!tool) {
    await recordCopilotAudit({
      session,
      toolName,
      klass: "read",
      args,
      outcome: "failed",
      detail: "Unknown tool",
    });
    return { result: { error: `Unknown tool: ${toolName}` }, isError: true };
  }

  const settings = await getCopilotSettings();
  if (!settings.enabled) {
    return { result: { error: "Tainy is disabled for this site." }, isError: true };
  }
  const usage = await getCopilotUsage(session.user.id);
  if (usage.toolCallsRemaining <= 0) {
    await recordCopilotAudit({
      session,
      toolName,
      klass: tool.klass,
      args,
      outcome: "budget-exceeded",
      detail: `Daily tool-call budget exhausted (${usage.toolCallBudget})`,
    });
    return {
      result: { error: `Daily tool-call budget exhausted (${usage.toolCallBudget}).` },
      isError: true,
    };
  }

  // The policy may have tightened during the 5-minute approval window.
  const policy = await getGroupToolPolicyForUser(session.user);
  if (!klassAllowedByPolicy(tool.klass, policy)) {
    await recordCopilotAudit({
      session,
      toolName,
      klass: tool.klass,
      args,
      outcome: "denied",
      detail: "Blocked by group tool policy",
    });
    return {
      result: {
        error: `The tool ${toolName} is disabled for your group by this site's copilot policy.`,
      },
      isError: true,
    };
  }

  await recordCopilotAudit({
    session,
    toolName,
    klass: tool.klass,
    args,
    outcome: "approved",
  });

  try {
    const result = await tool.execute(args, { session, via: "copilot" });
    await recordCopilotAudit({
      session,
      toolName,
      klass: tool.klass,
      args,
      outcome: "executed",
    });
    await recordCopilotUsage(session.user.id, 0, 0, 1);
    return { result: result ?? null, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordCopilotAudit({
      session,
      toolName,
      klass: tool.klass,
      args,
      outcome: "failed",
      detail: message,
    });
    return { result: { error: message }, isError: true };
  }
}
