import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { validateCopilotBaseUrl } from "@/lib/copilot/store";

test("validateCopilotBaseUrl strips trailing slashes only", () => {
  assert.equal(validateCopilotBaseUrl("  https://vllm.example.com/v1/// "), "https://vllm.example.com/v1");
  assert.equal(validateCopilotBaseUrl("https://vllm.example.com//v1"), "https://vllm.example.com//v1");
  assert.equal(validateCopilotBaseUrl("https://vllm.example.com"), "https://vllm.example.com");
});

test("validateCopilotBaseUrl matches the previous trailing slash handling", () => {
  const segment = fc.stringMatching(/^[a-z0-9/]{0,12}$/);
  fc.assert(
    fc.property(segment, (path) => {
      const raw = `https://vllm.example.com/${path}`;
      assert.equal(validateCopilotBaseUrl(raw), raw.replace(/\/+$/, ""));
    }),
  );
});

test("validateCopilotBaseUrl handles long runs of slashes in linear time", () => {
  const raw = `https://vllm.example.com/${"/".repeat(200_000)}x`;
  const started = performance.now();
  assert.equal(validateCopilotBaseUrl(raw), raw);
  assert.ok(performance.now() - started < 1000);
});
