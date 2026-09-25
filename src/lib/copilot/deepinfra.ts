import "server-only";

export const DEFAULT_OPENAI_BASE_URL = "https://api.deepinfra.com/v1/openai";

function chatCompletionsUrl(baseUrl: string | null | undefined): string {
  const base = (baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function buildHeaders(apiKey: string | null): Record<string, string> {
  return {
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    "content-type": "application/json",
  };
}

export type OpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded string, as returned by the API. */
    arguments: string;
  };
};

export type OpenAiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type OpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

export type OpenAiRequest = {
  model: string;
  max_tokens?: number;
  max_completion_tokens?: number;
  messages: OpenAiMessage[];
  tools?: OpenAiTool[];
  tool_choice?: "auto" | "none" | "required";
  stream?: boolean;
  stream_options?: { include_usage: boolean };
};

export type OpenAiUsage = {
  prompt_tokens: number;
  completion_tokens: number;
};

export type OpenAiResponse = {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      reasoning_content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
    finish_reason: "stop" | "tool_calls" | "length" | string;
  }>;
  usage: OpenAiUsage;
};

export class DeepInfraApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "DeepInfraApiError";
    this.status = status;
    this.body = body;
  }
}

async function throwApiError(response: Response): Promise<never> {
  const text = await response.text().catch(() => "");
  let summary = `DeepInfra API error ${response.status}`;
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string } | string;
      detail?: string;
    };
    if (typeof parsed.error === "string") summary = parsed.error;
    else if (parsed.error?.message) summary = parsed.error.message;
    else if (parsed.detail) summary = parsed.detail;
  } catch {}
  throw new DeepInfraApiError(summary, response.status, text);
}

export async function callDeepInfra(
  apiKey: string | null,
  body: OpenAiRequest,
  options: { signal?: AbortSignal; baseUrl?: string | null } = {},
): Promise<OpenAiResponse> {
  const response = await fetch(chatCompletionsUrl(options.baseUrl), {
    method: "POST",
    signal: options.signal,
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    await throwApiError(response);
  }

  return (await response.json()) as OpenAiResponse;
}

export type DeepInfraStreamDelta =
  | { type: "content"; text: string }
  | { type: "reasoning"; text: string };

export type DeepInfraStreamResult = {
  content: string;
  reasoningContent: string;
  toolCalls: OpenAiToolCall[];
  finishReason: string;
  usage: OpenAiUsage | null;
};

type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenAiUsage | null;
};

export async function* streamDeepInfra(
  apiKey: string | null,
  body: OpenAiRequest,
  options: { signal?: AbortSignal; baseUrl?: string | null } = {},
): AsyncGenerator<DeepInfraStreamDelta, DeepInfraStreamResult> {
  const response = await fetch(chatCompletionsUrl(options.baseUrl), {
    method: "POST",
    signal: options.signal,
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      ...body,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok || !response.body) {
    await throwApiError(response);
  }

  let content = "";
  let reasoningContent = "";
  let finishReason = "stop";
  let usage: OpenAiUsage | null = null;
  // Only a tool call's first fragment carries id and name; arguments accumulate.
  const toolCallAcc = new Map<number, { id: string; name: string; args: string }>();

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(payload) as StreamChunk;
        } catch {
          continue;
        }
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta;
        if (!delta) continue;
        if (delta.reasoning_content) {
          reasoningContent += delta.reasoning_content;
          yield { type: "reasoning", text: delta.reasoning_content };
        }
        if (delta.content) {
          content += delta.content;
          yield { type: "content", text: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          const entry = toolCallAcc.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
          toolCallAcc.set(tc.index, entry);
        }
      }
    }
  }

  const toolCalls: OpenAiToolCall[] = Array.from(toolCallAcc.entries())
    .sort(([a], [b]) => a - b)
    .map(([, entry]) => ({
      id: entry.id,
      type: "function" as const,
      function: { name: entry.name, arguments: entry.args },
    }))
    .filter((tc) => tc.id && tc.function.name);

  return { content, reasoningContent, toolCalls, finishReason, usage };
}
