import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { sanitizeReturnTo } from "@/lib/oidc";

const FALLBACK = "fallback";
const ORIGIN = "https://tainer.example";

const candidate = fc.oneof(
  fc.string({ unit: "binary" }),
  fc.webPath(),
  fc
    .string({
      unit: fc.constantFrom("/", "\\", ".", "%", "2", "5", "c", "e", "f", ":", "@", "?", "#", "a", " ", "\t", "\n", "。", "／"),
    })
    .map((rest) => `/${rest}`),
);

test("sanitizeReturnTo only accepts same-origin relative paths", () => {
  fc.assert(
    fc.property(candidate, (raw) => {
      const result = sanitizeReturnTo(raw, FALLBACK);
      if (result === FALLBACK) return;
      assert.ok(result.startsWith("/"));
      assert.ok(!result.startsWith("//"));
      assert.ok(!result.startsWith("/\\"));
      assert.doesNotMatch(result, /[\\\u0000-\u001f\u007f]/);
      assert.equal(new URL(result, ORIGIN).origin, ORIGIN);
      assert.equal(sanitizeReturnTo(result, FALLBACK), result);
    }),
    { numRuns: 1000 },
  );
});

test("sanitizeReturnTo rejects protocol-relative and backslash prefixes", () => {
  fc.assert(
    fc.property(fc.constantFrom("//", "/\\", "\\/", "\\\\"), fc.string(), (prefix, rest) => {
      assert.equal(sanitizeReturnTo(prefix + rest, FALLBACK), FALLBACK);
    }),
  );
});
