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

// Hard ceilings — defense in depth on top of the configured daily budgets.
const MAX_TOOL_CALLS_PER_TURN = 15;
const MAX_ROUNDS_PER_TURN = 8;
const MAX_TOKENS_PER_RESPONSE = 4096;

// Burst protection: daily budgets alone let a user (or a stolen session)
// burn the whole day's tokens in seconds against the shared key. Sliding
// per-user window, in-memory — single-process deployment, same as the
// approval flow's assumptions.
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
  // write + admin share the write gate.
  return policy.allowWrite;
}

// Results from tools that carry externally-authored content (Docker Hub
// descriptions etc.) are fenced so the system prompt can declare everything
// inside as data-not-instructions.
function fenceExternalContent(json: string): string {
  return `<<EXTERNAL_UNTRUSTED_DATA>>\n${json}\n<<END_EXTERNAL_UNTRUSTED_DATA>>`;
}

/** Did any prior tool call in the conversation return external content? */
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
    yield { type: "error", message: "Tainy is disabled for this site." };
    return;
  }

  const apiKey = await getCopilotApiKey();
  // A custom (self-hosted) endpoint may legitimately run keyless; the
  // DeepInfra default never does.
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
  // Group tool policy: tools a policy denies aren't even offered to the
  // model, and the gated-call path below re-checks in case the model calls
  // one by name anyway.
  const policy = await getGroupToolPolicyForUser(session.user);
  const tools = listToolsForModel((tool) => klassAllowedByPolicy(tool.klass, policy));
  const modelId = settings.modelId;

  // Convert client messages into the OpenAI chat format, system prompt first.
  const chatMessages: OpenAiMessage[] = [
    { role: "system", content: systemPrompt },
    ...toOpenAiMessages(input.messages),
  ];

  let toolCallsThisTurn = 0;
  let rounds = 0;
  let inputTokensAccum = 0;
  let outputTokensAccum = 0;
  let externalContentSeen = historyHasExternalContent(input.messages);

  // The try/finally guarantees usage is recorded even when the client
  // disconnects mid-stream — the route's for-await abandons the generator at
  // a yield point, which runs finally blocks. Without it, closing the tab
  // during a turn would skip budget accounting for everything already spent.
  try {
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

      // Stream the model response token-by-token. Content deltas run through
      // the think-tag splitter so inline <think> blocks stream as reasoning
      // events rather than leaking into the visible text; dedicated
      // reasoning_content deltas pass straight through.
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
          // A hung upstream would otherwise hold the SSE stream (and the
          // user's "Thinking…" state) open indefinitely.
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

      // Append the assistant turn so we can feed tool results back on the next
      // loop iteration. Reasoning traces are deliberately excluded — feeding a
      // model its own thinking back wastes tokens and degrades output.
      chatMessages.push({
        role: "assistant",
        content: visible.trim() || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });

      if (toolCalls.length === 0) {
        // No tool calls — assistant produced final text. Done.
        yield {
          type: "turn_end",
          stopReason: finishReason,
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
          // The policy filter keeps denied tools out of the offered set, but
          // the model can still call any registered tool by name — re-check.
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
            // Second gated call in this turn — refuse rather than queue.
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
          // Skip adding a tool result for this — the client will append it
          // after the user approves and we resume.
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
          afterExternalContent: externalContentSeen,
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
  } finally {
    await recordCopilotUsage(
      session.user.id,
      inputTokensAccum,
      outputTokensAccum,
      toolCallsThisTurn,
    );
  }
}

// Reasoning models emit their chain-of-thought inline as <think>…</think>
// (or <thinking>…</thinking>) blocks. When streaming, a tag can be split
// across chunk boundaries, so the splitter holds back any trailing text that
// could still turn out to be the start of a tag. An unterminated block
// (response truncated by max_tokens) streams as reasoning to the end.
const THINK_TAGS = ["<think>", "<thinking>", "</think>", "</thinking>"];
const MAX_THINK_TAG_LENGTH = Math.max(...THINK_TAGS.map((t) => t.length));

function createThinkSplitter(
  emit: (kind: "text" | "reasoning", text: string) => void,
) {
  let buffer = "";
  let inThink = false;

  // Longest suffix of the buffer that is a prefix of some think tag — that
  // tail must be held back until the next chunk disambiguates it.
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
  // The client sends a structured ChatMessage[] history. We convert it into
  // the OpenAI chat format: assistant messages carry tool_calls (arguments
  // re-encoded as JSON strings); tool-result messages become one role:"tool"
  // message per result, keyed by tool_call_id.
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

  // Re-check the group policy at execution time — the approval token has a
  // 5-minute window in which an admin may have tightened the policy.
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
