import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { createAnthropicProvider } from "@/lib/copilot/anthropic";
import {
  DEFAULT_OPENAI_BASE_URL,
  DeepInfraApiError,
  streamDeepInfra,
  type DeepInfraStreamDelta,
  type OpenAiMessage,
  type OpenAiTool,
  type OpenAiToolCall,
} from "@/lib/copilot/deepinfra";
import type { CopilotSettings } from "@/lib/copilot/store";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

const OPENAI_COMPATIBLE_MAX_TOKENS = 4096;
const OPENAI_MAX_COMPLETION_TOKENS = 16_384;
const OPENAI_COMPATIBLE_TIMEOUT_MS = 120_000;

export type ReasoningBlock =
  | Anthropic.Beta.BetaThinkingBlockParam
  | Anthropic.Beta.BetaRedactedThinkingBlockParam;

export type ConversationMessage =
  | Extract<OpenAiMessage, { role: "system" | "user" }>
  | (Extract<OpenAiMessage, { role: "assistant" }> & { reasoning?: ReasoningBlock[] })
  | (Extract<OpenAiMessage, { role: "tool" }> & { isError?: boolean });

export type ModelStreamDelta = DeepInfraStreamDelta;

export type ModelTurn = {
  toolCalls: OpenAiToolCall[];
  finishReason: string;
  usage: { input: number; output: number };
  reasoning?: ReasoningBlock[];
  refusal?: { category: string | null };
};

export type ModelProvider = {
  stream(
    messages: ConversationMessage[],
    tools: OpenAiTool[],
  ): AsyncGenerator<ModelStreamDelta, ModelTurn>;
  describeError(err: unknown): string;
};

function toWireMessages(messages: ConversationMessage[]): OpenAiMessage[] {
  return messages.map((m) => {
    if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
    if (m.role === "assistant") {
      return { role: "assistant", content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) };
    }
    return m;
  });
}

function createOpenAiCompatibleProvider(options: {
  apiKey: string | null;
  model: string;
  baseUrl: string | null;
  label: string;
  limit: { max_tokens: number } | { max_completion_tokens: number };
}): ModelProvider {
  return {
    async *stream(messages, tools) {
      const result = yield* streamDeepInfra(
        options.apiKey,
        { model: options.model, ...options.limit, messages: toWireMessages(messages), tools },
        { signal: AbortSignal.timeout(OPENAI_COMPATIBLE_TIMEOUT_MS), baseUrl: options.baseUrl },
      );
      return {
        toolCalls: result.toolCalls,
        finishReason: result.finishReason,
        usage: {
          input: result.usage?.prompt_tokens ?? 0,
          output: result.usage?.completion_tokens ?? 0,
        },
      };
    },
    describeError(err) {
      if (err instanceof DeepInfraApiError) return `${options.label} ${err.status}: ${err.message}`;
      return err instanceof Error ? err.message : `Unknown ${options.label} error`;
    },
  };
}

export function createModelProvider(
  settings: CopilotSettings,
  apiKey: string | null,
): ModelProvider {
  const model = settings.modelId;
  switch (settings.provider) {
    case "anthropic":
      return createAnthropicProvider({ apiKey: apiKey ?? "", model });
    case "openai":
      return createOpenAiCompatibleProvider({
        apiKey,
        model,
        baseUrl: OPENAI_BASE_URL,
        label: "OpenAI API",
        limit: { max_completion_tokens: OPENAI_MAX_COMPLETION_TOKENS },
      });
    case "custom":
      return createOpenAiCompatibleProvider({
        apiKey,
        model,
        baseUrl: settings.baseUrl,
        label: "Model API",
        limit: { max_tokens: OPENAI_COMPATIBLE_MAX_TOKENS },
      });
    default:
      return createOpenAiCompatibleProvider({
        apiKey,
        model,
        baseUrl: DEFAULT_OPENAI_BASE_URL,
        label: "DeepInfra API",
        limit: { max_tokens: OPENAI_COMPATIBLE_MAX_TOKENS },
      });
  }
}
