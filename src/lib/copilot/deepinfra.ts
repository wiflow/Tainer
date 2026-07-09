import "server-only";

const DEEPINFRA_API = "https://api.deepinfra.com/v1/openai/chat/completions";

export type OpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded arguments string, as returned by the API. */
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
  max_tokens: number;
  messages: OpenAiMessage[];
  tools?: OpenAiTool[];
  tool_choice?: "auto" | "none" | "required";
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

export async function callDeepInfra(
  apiKey: string,
  body: OpenAiRequest,
  options: { signal?: AbortSignal } = {},
): Promise<OpenAiResponse> {
  const response = await fetch(DEEPINFRA_API, {
    method: "POST",
    signal: options.signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
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
    } catch {
      // ignore — keep generic summary
    }
    throw new DeepInfraApiError(summary, response.status, text);
  }

  return (await response.json()) as OpenAiResponse;
}
