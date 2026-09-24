import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { escapeLdapFilter } from "@/lib/ldap";

const input = fc.oneof(
  fc.string({ unit: "binary" }),
  fc.string({ unit: fc.constantFrom("(", ")", "*", "\\", "\0", "2", "8", "a", "c", "=", "é") }),
);

test("escapeLdapFilter leaves no unescaped filter metacharacters", () => {
  fc.assert(
    fc.property(input, (raw) => {
      const bare = escapeLdapFilter(raw).replace(/\\[0-9a-f]{2}/g, "");
      assert.doesNotMatch(bare, /[()*\\\0]/);
    }),
  );
});

test("escapeLdapFilter round-trips through hex unescaping", () => {
  fc.assert(
    fc.property(input, (raw) => {
      const decoded = escapeLdapFilter(raw).replace(/\\([0-9a-f]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
      assert.equal(decoded, raw);
    }),
  );
});
