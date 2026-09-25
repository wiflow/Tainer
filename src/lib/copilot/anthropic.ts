import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { OpenAiTool, OpenAiToolCall } from "@/lib/copilot/deepinfra";
import type {
  ConversationMessage,
  ModelProvider,
  ModelTurn,
  ReasoningBlock,
} from "@/lib/copilot/provider";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type ThinkingConfig = Anthropic.Beta.BetaThinkingConfigParam;

const MAX_TOKENS = 64_000;
const BUDGET_THINKING_TOKENS = 16_000;
const REFUSAL_FALLBACK_MODEL = "claude-opus-5";
const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";

const FINISH_REASONS: Record<string, string> = {
  end_turn: "stop",
  tool_use: "tool_calls",
  max_tokens: "length",
};

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return {};
}

export function toAnthropicMessages(messages: ConversationMessage[]): {
  system: string;
  messages: MessageParam[];
} {
  const system: string[] = [];
  const out: MessageParam[] = [];
  let results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
  const flushResults = () => {
    if (results.length) out.push({ role: "user", content: results });
    results = [];
  };

  for (const m of messages) {
    if (m.role === "tool") {
      results.push({
        type: "tool_result",
        tool_use_id: m.tool_call_id,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      });
      continue;
    }
    flushResults();
    if (m.role === "system") {
      system.push(m.content);
    } else if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else {
      const visible: ContentBlockParam[] = [];
      if (m.content) visible.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls ?? []) {
        visible.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: parseToolArguments(tc.function.arguments),
        });
      }
      if (visible.length) out.push({ role: "assistant", content: [...(m.reasoning ?? []), ...visible] });
    }
  }
  flushResults();
  while (out.at(-1)?.role === "assistant") out.pop();
  return { system: system.join("\n\n"), messages: out };
}

export function toAnthropicTools(tools: OpenAiTool[]): Anthropic.Beta.BetaTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

function resumesToolUseWithoutThinking(messages: MessageParam[]): boolean {
  const lastAssistant = messages.findLastIndex((m) => m.role === "assistant");
  if (lastAssistant === -1) return false;
  const resumes = messages
    .slice(lastAssistant + 1)
    .some((m) => typeof m.content !== "string" && m.content.some((b) => b.type === "tool_result"));
  const content = messages[lastAssistant].content;
  const first = typeof content === "string" ? undefined : content[0];
  return resumes && first?.type !== "thinking" && first?.type !== "redacted_thinking";
}

export function thinkingConfig(model: string, messages: MessageParam[]): ThinkingConfig | undefined {
  const budgetOnly = model.includes("haiku");
  if (resumesToolUseWithoutThinking(messages)) {
    return budgetOnly ? undefined : { type: "disabled" };
  }
  return budgetOnly
    ? { type: "enabled", budget_tokens: BUDGET_THINKING_TOKENS }
    : { type: "adaptive", display: "summarized" };
}

export function fromAnthropicMessage(message: Anthropic.Beta.BetaMessage): ModelTurn {
  const usage = {
    input:
      message.usage.input_tokens +
      (message.usage.cache_creation_input_tokens ?? 0) +
      (message.usage.cache_read_input_tokens ?? 0),
    output: message.usage.output_tokens,
  };
  if (message.stop_reason === "refusal") {
    return {
      toolCalls: [],
      finishReason: "refusal",
      usage,
      refusal: { category: message.stop_details?.category ?? null },
    };
  }

  const served = message.content.slice(message.content.findLastIndex((b) => b.type === "fallback") + 1);
  const reasoning: ReasoningBlock[] = [];
  const toolCalls: OpenAiToolCall[] = [];
  for (const block of served) {
    if (block.type === "thinking") {
      reasoning.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
    } else if (block.type === "redacted_thinking") {
      reasoning.push({ type: "redacted_thinking", data: block.data });
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  const stopReason = message.stop_reason ?? "end_turn";
  return {
    toolCalls: stopReason === "max_tokens" ? [] : toolCalls,
    finishReason: FINISH_REASONS[stopReason] ?? stopReason,
    usage,
    reasoning,
  };
}

export function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Anthropic API rejected the API key. An admin can update it in Settings > Tainy.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Anthropic API rate limit reached. Wait a moment and try again.";
  }
  if (err instanceof Anthropic.APIError) {
    const body = err.error as { error?: { message?: unknown } } | undefined;
    const detail = typeof body?.error?.message === "string" ? body.error.message : err.message;
    return err.status ? `Anthropic API ${err.status}: ${detail}` : `Anthropic API: ${detail}`;
  }
  return err instanceof Error ? err.message : "Unknown Anthropic API error";
}

export function createAnthropicProvider(options: {
  apiKey: string;
  model: string;
  baseURL?: string;
  maxRetries?: number;
}): ModelProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    maxRetries: options.maxRetries,
  });
  const model = options.model;

  return {
    async *stream(conversation, tools) {
      const { system, messages } = toAnthropicMessages(conversation);
      const thinking = thinkingConfig(model, messages);
      const stream = client.beta.messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        cache_control: { type: "ephemeral" },
        ...(system ? { system } : {}),
        tools: toAnthropicTools(tools),
        messages,
        ...(thinking ? { thinking } : {}),
        ...(model === REFUSAL_FALLBACK_MODEL
          ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: "default" as const }
          : {}),
      });
      for await (const event of stream) {
        if (event.type !== "content_block_delta") continue;
        if (event.delta.type === "text_delta") yield { type: "content", text: event.delta.text };
        else if (event.delta.type === "thinking_delta") {
          yield { type: "reasoning", text: event.delta.thinking };
        }
      }
      return fromAnthropicMessage(await stream.finalMessage());
    },
    describeError: describeAnthropicError,
  };
}
