import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import fc from "fast-check";

import {
  createAnthropicProvider,
  fromAnthropicMessage,
  thinkingConfig,
  toAnthropicMessages,
} from "@/lib/copilot/anthropic";
import type { OpenAiTool } from "@/lib/copilot/deepinfra";
import type { ConversationMessage, ModelProvider, ModelTurn } from "@/lib/copilot/provider";

type SseEvent = { type: string } & Record<string, unknown>;
type Captured = { url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> };
type Reply = { status: number; events?: SseEvent[]; json?: unknown };

const THINKING: Anthropic.Beta.BetaThinkingBlockParam = {
  type: "thinking",
  thinking: "check the node first",
  signature: "sig-1",
};

const TOOLS: OpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "list_containers",
      description: "List containers",
      parameters: { type: "object", properties: { node: { type: "string" } }, required: ["node"] },
    },
  },
];

let server: Server;
let baseURL = "";
let nextReply: Reply = { status: 200, events: [] };
let captured: Captured[] = [];

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      captured.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(raw || "{}") });
      if (nextReply.json !== undefined) {
        res.writeHead(nextReply.status, { "content-type": "application/json" });
        res.end(JSON.stringify(nextReply.json));
        return;
      }
      res.writeHead(nextReply.status, { "content-type": "text/event-stream" });
      for (const event of nextReply.events ?? []) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function messageStart(model: string, usage: Record<string, number>): SseEvent {
  return {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 1, ...usage },
    },
  };
}

function block(index: number, contentBlock: Record<string, unknown>, deltas: Record<string, unknown>[]) {
  return [
    { type: "content_block_start", index, content_block: contentBlock },
    ...deltas.map((delta) => ({ type: "content_block_delta", index, delta })),
    { type: "content_block_stop", index },
  ];
}

function finish(stopReason: string, outputTokens: number, stopDetails: unknown = null): SseEvent[] {
  return [
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null, stop_details: stopDetails },
      usage: { output_tokens: outputTokens },
    },
    { type: "message_stop" },
  ];
}

async function runProvider(
  provider: ModelProvider,
  messages: ConversationMessage[],
): Promise<{ deltas: string[]; turn: ModelTurn }> {
  const deltas: string[] = [];
  const stream = provider.stream(messages, TOOLS);
  while (true) {
    const { value, done } = await stream.next();
    if (done) return { deltas, turn: value };
    deltas.push(`${value.type}:${value.text}`);
  }
}

function provider(model: string) {
  captured = [];
  return createAnthropicProvider({ apiKey: "test-key", model, baseURL, maxRetries: 0 });
}

const question: ConversationMessage[] = [
  { role: "system", content: "You are Tainy." },
  { role: "user", content: "What runs on pve1?" },
];

test("streams thinking, text and a tool call from Claude Opus 5 and maps usage", async () => {
  nextReply = {
    status: 200,
    events: [
      messageStart("claude-opus-5", {
        input_tokens: 100,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 300,
      }),
      ...block(0, { type: "thinking", thinking: "", signature: "" }, [
        { type: "thinking_delta", thinking: "check the " },
        { type: "thinking_delta", thinking: "node first" },
        { type: "signature_delta", signature: "sig-1" },
      ]),
      ...block(1, { type: "text", text: "" }, [{ type: "text_delta", text: "Looking." }]),
      ...block(2, { type: "tool_use", id: "toolu_1", name: "list_containers", input: {} }, [
        { type: "input_json_delta", partial_json: '{"node":' },
        { type: "input_json_delta", partial_json: '"pve1"}' },
      ]),
      ...finish("tool_use", 42),
    ],
  };

  const { deltas, turn } = await runProvider(provider("claude-opus-5"), question);

  assert.deepEqual(deltas, ["reasoning:check the ", "reasoning:node first", "content:Looking."]);
  assert.equal(turn.finishReason, "tool_calls");
  assert.deepEqual(turn.toolCalls, [
    { id: "toolu_1", type: "function", function: { name: "list_containers", arguments: '{"node":"pve1"}' } },
  ]);
  assert.deepEqual(turn.reasoning, [THINKING]);
  assert.deepEqual(turn.usage, { input: 420, output: 42 });
  assert.equal(turn.refusal, undefined);

  const [request] = captured;
  assert.match(request.url, /^\/v1\/messages/);
  assert.equal(request.headers["x-api-key"], "test-key");
  assert.match(String(request.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  assert.equal(request.body.fallbacks, "default");
  assert.equal(request.body.model, "claude-opus-5");
  assert.equal(request.body.max_tokens, 64_000);
  assert.equal(request.body.stream, true);
  assert.deepEqual(request.body.thinking, { type: "adaptive", display: "summarized" });
  assert.deepEqual(request.body.cache_control, { type: "ephemeral" });
  assert.equal(request.body.system, "You are Tainy.");
  assert.deepEqual(request.body.messages, [{ role: "user", content: "What runs on pve1?" }]);
  assert.deepEqual(request.body.tools, [
    {
      name: "list_containers",
      description: "List containers",
      input_schema: TOOLS[0].function.parameters,
    },
  ]);
  for (const key of ["temperature", "top_p", "top_k", "betas"]) {
    assert.equal(key in request.body, false, key);
  }
});

test("a refusal returns no tool calls and carries the category", async () => {
  nextReply = {
    status: 200,
    events: [
      messageStart("claude-opus-5", { input_tokens: 10 }),
      ...block(0, { type: "text", text: "" }, [{ type: "text_delta", text: "Sure, " }]),
      ...block(1, { type: "tool_use", id: "toolu_9", name: "list_containers", input: {} }, [
        { type: "input_json_delta", partial_json: '{"node":"pv' },
      ]),
      ...finish("refusal", 5, { type: "refusal", category: "cyber", explanation: null }),
    ],
  };

  const { deltas, turn } = await runProvider(provider("claude-opus-5"), question);

  assert.deepEqual(deltas, ["content:Sure, "]);
  assert.equal(turn.finishReason, "refusal");
  assert.deepEqual(turn.refusal, { category: "cyber" });
  assert.deepEqual(turn.toolCalls, []);
  assert.deepEqual(turn.usage, { input: 10, output: 5 });
});

test("only the model that served after a fallback supplies tool calls and thinking", async () => {
  nextReply = {
    status: 200,
    events: [
      messageStart("claude-opus-5", { input_tokens: 7 }),
      ...block(0, { type: "thinking", thinking: "", signature: "" }, [
        { type: "thinking_delta", thinking: "declined" },
        { type: "signature_delta", signature: "sig-old" },
      ]),
      ...block(1, { type: "text", text: "" }, [{ type: "text_delta", text: "Partial " }]),
      ...block(
        2,
        {
          type: "fallback",
          from: { model: "claude-opus-5" },
          to: { model: "claude-opus-4-8" },
          trigger: { type: "refusal", category: "cyber" },
        },
        [],
      ),
      ...block(3, { type: "thinking", thinking: "", signature: "" }, [
        { type: "thinking_delta", thinking: "check the node first" },
        { type: "signature_delta", signature: "sig-1" },
      ]),
      ...block(4, { type: "tool_use", id: "toolu_2", name: "list_containers", input: {} }, [
        { type: "input_json_delta", partial_json: '{"node":"pve1"}' },
      ]),
      ...finish("tool_use", 9),
    ],
  };

  const { turn } = await runProvider(provider("claude-opus-5"), question);

  assert.deepEqual(turn.reasoning, [THINKING]);
  assert.deepEqual(turn.toolCalls.map((tc) => tc.id), ["toolu_2"]);
});

test("Haiku 4.5 gets budget thinking and no refusal fallback", async () => {
  nextReply = {
    status: 200,
    events: [
      messageStart("claude-haiku-4-5", { input_tokens: 3 }),
      ...block(0, { type: "text", text: "" }, [{ type: "text_delta", text: "Hi" }]),
      ...finish("end_turn", 2),
    ],
  };

  const { deltas, turn } = await runProvider(provider("claude-haiku-4-5"), question);

  assert.deepEqual(deltas, ["content:Hi"]);
  assert.equal(turn.finishReason, "stop");
  assert.deepEqual(turn.toolCalls, []);
  const [request] = captured;
  assert.deepEqual(request.body.thinking, { type: "enabled", budget_tokens: 16_000 });
  assert.equal("fallbacks" in request.body, false);
  assert.equal(request.headers["anthropic-beta"], undefined);
});

test("resuming a tool call whose thinking was not kept turns thinking off for that request", async () => {
  nextReply = {
    status: 200,
    events: [messageStart("claude-sonnet-5", { input_tokens: 3 }), ...finish("end_turn", 1)],
  };
  const history: ConversationMessage[] = [
    ...question,
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "t1", type: "function", function: { name: "list_containers", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "t1", content: "[]" },
  ];

  await runProvider(provider("claude-sonnet-5"), history);

  assert.deepEqual(captured[0].body.thinking, { type: "disabled" });
});

test("API errors come back as typed, readable messages", async () => {
  nextReply = {
    status: 429,
    json: { type: "error", error: { type: "rate_limit_error", message: "Slow down" } },
  };
  const p = provider("claude-sonnet-5");
  const err = await runProvider(p, question).then(
    () => assert.fail("expected an error"),
    (e: unknown) => e,
  );
  assert.equal(p.describeError(err), "Anthropic API rate limit reached. Wait a moment and try again.");

  nextReply = {
    status: 400,
    json: { type: "error", error: { type: "invalid_request_error", message: "bad tools" } },
  };
  const bad = await runProvider(p, question).then(
    () => assert.fail("expected an error"),
    (e: unknown) => e,
  );
  assert.equal(p.describeError(bad), "Anthropic API 400: bad tools");
});

test("tool calls, results, errors and reasoning convert to the Messages format", () => {
  const converted = toAnthropicMessages([
    { role: "system", content: "rules" },
    { role: "user", content: "restart web and db" },
    {
      role: "assistant",
      content: "On it.",
      reasoning: [THINKING],
      tool_calls: [
        { id: "a", type: "function", function: { name: "restart", arguments: '{"vmid":101}' } },
        { id: "b", type: "function", function: { name: "restart", arguments: "not json" } },
      ],
    },
    { role: "tool", tool_call_id: "a", content: '{"ok":true}' },
    { role: "tool", tool_call_id: "b", content: '{"error":"denied"}', isError: true },
    { role: "assistant", content: "Done." },
    { role: "user", content: "thanks" },
    { role: "assistant", content: "trailing prefill" },
  ]);

  assert.equal(converted.system, "rules");
  assert.deepEqual(converted.messages, [
    { role: "user", content: "restart web and db" },
    {
      role: "assistant",
      content: [
        THINKING,
        { type: "text", text: "On it." },
        { type: "tool_use", id: "a", name: "restart", input: { vmid: 101 } },
        { type: "tool_use", id: "b", name: "restart", input: {} },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: '{"ok":true}' },
        { type: "tool_result", tool_use_id: "b", content: '{"error":"denied"}', is_error: true },
      ],
    },
    { role: "assistant", content: [{ type: "text", text: "Done." }] },
    { role: "user", content: "thanks" },
  ]);
  assert.deepEqual(thinkingConfig("claude-opus-5", converted.messages), {
    type: "adaptive",
    display: "summarized",
  });
});

const argsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 6 }),
  fc.oneof(fc.integer(), fc.string({ maxLength: 8 }), fc.boolean()),
  { maxKeys: 3 },
);
const callArb = fc.record({ name: fc.constantFrom("get", "restart", "list"), args: argsArb, isError: fc.boolean() });
const roundArb = fc.record({
  text: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: null }),
  thinking: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: null }),
  calls: fc.array(callArb, { maxLength: 4 }),
});
const conversationArb = fc.array(
  fc.record({ user: fc.string({ minLength: 1, maxLength: 12 }), rounds: fc.array(roundArb, { maxLength: 3 }) }),
  { minLength: 1, maxLength: 4 },
);

test("every conversion keeps tool calls paired with one results message and round-trips responses", () => {
  fc.assert(
    fc.property(conversationArb, (turns) => {
      const messages: ConversationMessage[] = [{ role: "system", content: "sys" }];
      const expected = new Map<string, { input: Record<string, unknown>; isError: boolean }>();
      let n = 0;
      for (const turn of turns) {
        messages.push({ role: "user", content: turn.user });
        for (const round of turn.rounds) {
          const calls = round.calls.map((c) => ({ ...c, id: `call_${n++}` }));
          messages.push({
            role: "assistant",
            content: round.text,
            ...(calls.length
              ? {
                  tool_calls: calls.map((c) => ({
                    id: c.id,
                    type: "function" as const,
                    function: { name: c.name, arguments: JSON.stringify(c.args) },
                  })),
                }
              : {}),
            ...(round.thinking
              ? { reasoning: [{ type: "thinking" as const, thinking: round.thinking, signature: "s" }] }
              : {}),
          });
          for (const c of calls) {
            expected.set(c.id, { input: JSON.parse(JSON.stringify(c.args)), isError: c.isError });
            messages.push({ role: "tool", tool_call_id: c.id, content: "{}", ...(c.isError ? { isError: true } : {}) });
          }
        }
      }

      const { system, messages: out } = toAnthropicMessages(messages);
      assert.equal(system, "sys");
      assert.equal(out[0].role, "user");
      assert.notEqual(out.at(-1)?.role, "assistant");

      const seen = new Set<string>();
      out.forEach((message, index) => {
        if (message.role !== "assistant" || typeof message.content === "string") return;
        const blocks = message.content;
        const firstVisible = blocks.findIndex((b) => b.type !== "thinking");
        assert.ok(blocks.slice(firstVisible).every((b) => b.type !== "thinking"));
        const uses = blocks.filter((b) => b.type === "tool_use");
        if (uses.length === 0) return;
        const next = out[index + 1];
        assert.equal(next.role, "user");
        assert.ok(Array.isArray(next.content));
        const results = next.content.filter((b) => b.type === "tool_result");
        assert.deepEqual(
          results.map((r) => r.tool_use_id),
          uses.map((u) => u.id),
        );
        for (const [i, use] of uses.entries()) {
          const want = expected.get(use.id);
          assert.ok(want);
          assert.deepEqual(use.input, want.input);
          assert.equal(results[i].is_error === true, want.isError);
          seen.add(use.id);
        }

        const response = {
          id: "msg",
          type: "message",
          role: "assistant",
          model: "claude-opus-5",
          content: blocks.map((b) =>
            b.type === "tool_use" ? { ...b, caller: { type: "direct" } } : { ...b, citations: null },
          ),
          stop_reason: "tool_use",
          stop_details: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        } as unknown as Anthropic.Beta.BetaMessage;
        const back = fromAnthropicMessage(response);
        assert.deepEqual(
          back.toolCalls.map((tc) => [tc.id, JSON.parse(tc.function.arguments)]),
          uses.map((u) => [u.id, u.input]),
        );
        assert.deepEqual(back.reasoning, blocks.filter((b) => b.type === "thinking"));
      });
      assert.deepEqual([...seen].sort(), [...expected.keys()].sort());
    }),
    { numRuns: 200 },
  );
});
