import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { logSafe } from "@/lib/log-safe";

test("logSafe keeps printable text unchanged", () => {
  assert.equal(logSafe("VMID 101 failed: timeout"), "VMID 101 failed: timeout");
  assert.equal(logSafe(101), "101");
});

test("logSafe folds line breaks into spaces and drops other control characters", () => {
  assert.equal(logSafe("a\r\nFAKE entry"), "a FAKE entry");
  assert.equal(logSafe("a\u2028b\u2029c"), "a b c");
  assert.equal(logSafe("red\u001b[31m\u0000x"), "red[31mx");
});

test("logSafe renders errors on a single line", () => {
  const out = logSafe(new Error("boom\nforged line"));
  assert.ok(out.startsWith("Error: boom forged line"));
  assert.ok(!/[\n\r]/.test(out));
});

test("logSafe output never contains control characters or line separators", () => {
  fc.assert(
    fc.property(fc.oneof(fc.string({ unit: "binary" }), fc.anything()), (value) => {
      assert.ok(!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(logSafe(value)));
    }),
  );
});
