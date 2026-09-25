import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { logText } from "../src/lib/log-text.mjs";

test("logText keeps a user name on one log line", () => {
  assert.equal(
    logText("mallory\n[console] admin opening vnc console\r\u001b[2K"),
    "mallory[console] admin opening vnc console[2K",
  );
  assert.equal(logText("a\u2028b\u2029c\u0085d"), "abcd");
  assert.equal(logText("x\u202Eadmin\u202Cy\u2066z"), "xadminyz");
});

test("logText output never contains control or line separator characters", () => {
  fc.assert(
    fc.property(fc.string({ unit: "binary" }), (raw) => {
      assert.doesNotMatch(logText(raw), /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/u);
    }),
  );
});

test("logText leaves printable text unchanged", () => {
  assert.equal(logText("Zoë O'Brien (ops) 🙂"), "Zoë O'Brien (ops) 🙂");
  assert.equal(logText(undefined), "undefined");
});
