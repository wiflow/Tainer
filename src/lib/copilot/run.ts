import "server-only";

import type { AuthSession } from "@/lib/auth";
import {
  DeepInfraApiError,
  callDeepInfra,
  type OpenAiMessage,
  type OpenAiResponse,
  type OpenAiToolCall,
} from "@/lib/copilot/deepinfra";
import { recordCopilotAudit } from "@/lib/copilot/audit";
import { mintApprovalToken } from "@/lib/copilot/approval";
import { buildSystemPrompt, type SidebarContext } from "@/lib/copilot/system-prompt";
import {
  getCopilotApiKey,
  getCopilotSettings,
  getCopilotUsage,
  recordCopilotUsage,
} from "@/lib/copilot/store";
import "@/lib/copilot/tools";
import { getTool, listToolsForModel } from "@/lib/copilot/registry";
import {
  COPILOT_MODEL_IDS,
  type ChatMessage,
  type CopilotStreamEvent,
} from "@/lib/copilot/types";

// Hard ceilings — defense in depth on top of the configured daily budgets.
const MAX_TOOL_CALLS_PER_TURN = 15;
const MAX_TOKENS_PER_RESPONSE = 4096;

export type RunInput = {
  session: AuthSession;
  context: SidebarContext;
  messages: ChatMessage[];
};

/**
 * Drives one user-turn through DeepInfra's OpenAI-compatible chat API. Read
 * tools auto-execute server-side; write/destructive/admin tools cause the run
 * to pause and emit `approval_required`. The client resumes the conversation
 * after the user approves (via /api/copilot/approve, which appends a tool
 * result to messages and POSTs back to /chat).
 *
 * Yields stream events the API route forwards to the client as SSE.
 */
export async function* runCopilotTurn(
  input: RunInput,
): AsyncGenerator<CopilotStreamEvent> {
  const { session } = input;

  const settings = await getCopilotSettings();
  if (!settings.enabled) {
    yield { type: "error", message: "Copilot is disabled for this site." };
    return;
  }

  const apiKey = await getCopilotApiKey();
  if (!apiKey) {
    yield {
      type: "error",
      message:
        "No DeepInfra API key configured. An admin can add one in Settings → Copilot. Get a key at https://deepinfra.com/dash/api_keys.",
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
      message: `Daily token budget exhausted (${usage.tokenBudget}). Resets at 00:00 UTC — an admin can raise it in Settings → Copilot.`,
    };
    return;
  }
  if (usage.toolCallsRemaining <= 0) {
    yield {
      type: "error",
      message: `Daily tool-call budget exhausted (${usage.toolCallBudget}). Resets at 00:00 UTC — an admin can raise it in Settings → Copilot.`,
    };
    return;
  }

  const systemPrompt = await buildSystemPrompt(session, input.context);
  const tools = listToolsForModel();
  const modelId = COPILOT_MODEL_IDS[settings.model];

  // Convert client messages into the OpenAI chat format, system prompt first.
  const chatMessages: OpenAiMessage[] = [
    { role: "system", content: systemPrompt },
    ...toOpenAiMessages(input.messages),
  ];

  let toolCallsThisTurn = 0;
  let inputTokensAccum = 0;
  let outputTokensAccum = 0;

  // Tool-use loop: keep calling the model, running read tools, and looping
  // back, until we either (a) finish a text-only assistant turn, (b) emit an
  // approval-required for a write tool, or (c) hit the per-turn ceiling.
  while (true) {
    if (toolCallsThisTurn >= MAX_TOOL_CALLS_PER_TURN) {
      yield {
        type: "error",
        message: `Reached the per-turn tool-call ceiling (${MAX_TOOL_CALLS_PER_TURN}). Refine the question.`,
      };
      break;
    }

    let response: OpenAiResponse;
    try {
      response = await callDeepInfra(apiKey, {
        model: modelId,
        max_tokens: MAX_TOKENS_PER_RESPONSE,
        messages: chatMessages,
        tools,
      });
    } catch (err) {
      const message =
        err instanceof DeepInfraApiError
          ? `DeepInfra API ${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown DeepInfra API error";
      yield { type: "error", message };
      break;
    }

    inputTokensAccum += response.usage?.prompt_tokens ?? 0;
    outputTokensAccum += response.usage?.completion_tokens ?? 0;

    const choice = response.choices[0];
    if (!choice) {
      yield { type: "error", message: "DeepInfra returned an empty response." };
      break;
    }
    const assistant = choice.message;
    const toolCalls = assistant.tool_calls ?? [];

    // Append the assistant turn so we can feed tool results back on the next
    // loop iteration.
    chatMessages.push({
      role: "assistant",
      content: assistant.content ?? null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });

    if (assistant.content) {
      yield { type: "text", text: assistant.content };
    }

    if (toolCalls.length === 0) {
      // No tool calls — assistant produced final text. Done.
      yield {
        type: "turn_end",
        stopReason: choice.finish_reason,
        usage: { input: inputTokensAccum, output: outputTokensAccum },
      };
      break;
    }

    // Process tool calls in order. Read tools auto-execute now; the FIRST
    // write/destructive/admin tool pauses the turn for approval. Subsequent
    // gated calls in the same turn are refused (one approval at a time) so
    // the user never sees two destructive cards from a single model burst.
    //
    // We must execute all read calls before pausing, because the API requires
    // a tool message for every tool_call in the assistant message when the
    // conversation resumes. Skipping reads would leave unmatched tool_calls
    // and break the next call.
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

      // OpenAI-format tool arguments arrive as a JSON string — parse
      // defensively; a malformed blob becomes an error result the model can
      // recover from rather than a crashed turn.
      let args: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(tc.function.arguments || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("arguments must be a JSON object");
        }
        args = parsed as Record<string, unknown>;
      } catch {
        const message = `Malformed JSON arguments for ${tc.function.name}.`;
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
        if (pendingApproval) {
          // Second gated call in this turn — refuse rather than queue.
          const message =
            "Multiple gated tool calls in a single turn aren't allowed. " +
            "Approve the first and ask the assistant to re-issue this one.";
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
        // Skip adding a tool result for this — the client will append it
        // after the user approves and we resume.
        continue;
      }

      const startedAt = Date.now();
      yield { type: "tool_call_started", toolCallId: tc.id, name: tc.function.name, args };
      try {
        const result = await tool.execute(args, { session, via: "copilot" });
        toolCallsThisTurn++;
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result ?? null),
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
      // Optional preview shown on the approval card (e.g. the hostnames + IPs
      // a batch create will use). Best-effort — a failure here must not block
      // the approval; the card just shows the describe line without a plan.
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
      };
      // We do NOT push tool results to chatMessages here — the client will
      // assemble the next /chat call with our reads plus the approved tool
      // result. End the SSE stream.
      yield {
        type: "turn_end",
        stopReason: "approval_required",
        usage: { input: inputTokensAccum, output: outputTokensAccum },
      };
      break;
    }

    chatMessages.push(...toolResults);

    // Loop — the model now sees the tool results and can either produce
    // final text, call more tools, or call a gated tool (which will pause us
    // at the top of the next iteration).
  }

  await recordCopilotUsage(
    session.user.id,
    inputTokensAccum,
    outputTokensAccum,
    toolCallsThisTurn,
  );
}

function toOpenAiMessages(messages: ChatMessage[]): OpenAiMessage[] {
  // The client sends a structured ChatMessage[] history. We convert it into
  // the OpenAI chat format: assistant messages carry tool_calls (arguments
  // re-encoded as JSON strings); tool-result messages become one role:"tool"
  // message per result, keyed by tool_call_id.
  const out: OpenAiMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      out.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
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
        out.push({
          role: "tool",
          tool_call_id: r.toolCallId,
          content: JSON.stringify(r.content ?? null),
        });
      }
    }
  }
  return out;
}

/**
 * Run a single tool after the user has approved it. Audits and updates
 * usage. Returns the tool result for the client to append to the chat
 * history before re-calling /chat.
 */
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
